import JSZip from 'jszip';
import sharp from 'sharp';

const layerNames = ['物理和环境安全', '网络和通信安全', '设备和计算安全', '应用和数据安全', '管理制度', '人员管理', '建设运行', '应急处置'];
type Evidence = { no?: string; name?: string; dataUrl?: string };
type OnsiteRecord = { evidence?: Evidence[] };

const xmlEscape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const paragraphText = (xml: string) => [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(match => match[1]).join('').replace(/&amp;/g, '&');
const compact = (value: string) => value.replace(/\s/g, '');
function removeParagraphSlot(paragraph: string, slot: string): string {
  const updated = paragraphText(paragraph).replace(`{{${slot}}}`, '');
  let first = true;
  return paragraph.replace(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g, () => {
    const value = first ? xmlEscape(updated) : '';
    first = false;
    return `<w:t xml:space="preserve">${value}</w:t>`;
  });
}

function imageSize(data: Buffer, type: string): { width: number; height: number } {
  if (type === 'png' && data.length >= 24 && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (type === 'gif' && data.length >= 10 && data.subarray(0, 3).toString() === 'GIF') {
    return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
  }
  if (type === 'jpeg' && data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) { offset++; continue; }
      const marker = data[offset + 1];
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) { offset += 2; continue; }
      const length = data.readUInt16BE(offset + 2);
      if (length < 2 || offset + length + 2 > data.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) };
      }
      offset += length + 2;
    }
  }
  throw new Error('证据截图格式无效，请重新上传 PNG、JPEG 或 GIF 图片');
}

// 旧项目可能保存了未经浏览器压缩的原图；导出时统一限制嵌入文件大小与像素尺寸。
const PHOTO_THRESHOLD = 400 * 1024;
const PHOTO_LONG_EDGE = 1400;
const EMU_PER_CM = 360_000;
const APPENDIX_B_IMAGE_WIDTH_EMU = 7 * EMU_PER_CM;
const APPENDIX_B1_IMAGE_WIDTH_EMU = 5 * EMU_PER_CM;
const APPENDIX_B3_PHOTO_WIDTH_EMU = 5 * EMU_PER_CM;
const APPENDIX_B4_IMAGE_WIDTH_EMU = 5 * EMU_PER_CM;
const APPENDIX_B_OTHER_IMAGE_WIDTH_EMU = 10 * EMU_PER_CM;
const REPORT_IMAGE_WIDTH_EMU = 13 * EMU_PER_CM;
async function exportImage(dataUrl: string, label: string) {
  const match = /^data:image\/(png|jpe?g|gif);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error(`${label}图片格式不支持`);
  let ext = match[1] === 'jpg' ? 'jpeg' : match[1];
  let bytes: Buffer<ArrayBufferLike> = Buffer.from(match[2], 'base64');
  if (bytes.length > 15 * 1024 * 1024) throw new Error(`${label}图片超过15 MB`);
  const original = imageSize(bytes, ext);
  if (bytes.length > PHOTO_THRESHOLD || Math.max(original.width, original.height) > PHOTO_LONG_EDGE) {
    const encoded = await sharp(bytes, { failOn: 'error' })
      .rotate().resize({ width: PHOTO_LONG_EDGE, height: PHOTO_LONG_EDGE, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    if (encoded.length < bytes.length || Math.max(original.width, original.height) > PHOTO_LONG_EDGE) {
      bytes = encoded;
      ext = 'jpeg';
    }
  }
  const size = imageSize(bytes, ext);
  if (!size.width || !size.height) throw new Error(`${label}图片尺寸无效`);
  return { bytes, ext, size };
}

function imageRun(rid: string, id: number, width: number, height: number, description: string,
  targetWidth = REPORT_IMAGE_WIDTH_EMU): string {
  // Word 中固定图片宽度，高度按原图比例自动计算。
  const cx = targetWidth;
  const cy = Math.max(1, Math.round(targetWidth * height / width));
  const label = xmlEscape(description);
  return `<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="${label}" descr="${label}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="${label}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

function imageParagraph(rid: string, id: number, width: number, height: number, description: string,
  targetWidth = REPORT_IMAGE_WIDTH_EMU): string {
  return `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="120"/></w:pPr>${imageRun(rid, id, width, height, description, targetWidth)}</w:p>`;
}

export async function writeReportEvidence(xml: string, zip: JSZip, records: Record<string, OnsiteRecord>): Promise<string> {
  const relPath = 'word/_rels/document.xml.rels';
  let rels = await zip.file(relPath)?.async('string');
  let types = await zip.file('[Content_Types].xml')?.async('string');
  if (!rels || !types) throw new Error('报告模板缺少图片关系或内容类型定义');
  let rid = Math.max(0, ...[...rels.matchAll(/\bId="rId(\d+)"/g)].map(match => Number(match[1]))) + 1;
  let drawingId = Math.max(0, ...[...xml.matchAll(/<wp:docPr\b[^>]*\bid="(\d+)"/g)].map(match => Number(match[1]))) + 1;
  const inserts: string[] = [];
  for (let layer = 0; layer < layerNames.length; layer++) {
    const evidence = Object.entries(records || {})
      .filter(([key]) => key.split('|')[0] === String(layer))
      .flatMap(([, record]) => record.evidence || [])
      .sort((a, b) => Number(/\.(\d+)$/.exec(a.no || '')?.[1] || 0) - Number(/\.(\d+)$/.exec(b.no || '')?.[1] || 0));
    const paragraphs: string[] = [];
    for (let index = 0; index < evidence.length; index++) {
      const item = evidence[index];
      const { bytes, ext, size } = await exportImage(item.dataUrl || '', '证据截图' + (item.no || layerNames[layer]));
      const filename = `bb-evidence-${layer + 1}-${index + 1}.${ext === 'jpeg' ? 'jpg' : ext}`;
      zip.file(`word/media/${filename}`, bytes);
      const relationId = `rId${rid++}`;
      rels = rels.replace('</Relationships>', `<Relationship Id="${relationId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${filename}"/></Relationships>`);
      const description = [item.no || `图A-${layer + 1}.${index + 1}`, item.name || ''].filter(Boolean).join(' ');
      paragraphs.push(imageParagraph(relationId, drawingId++, size.width, size.height, description));
      paragraphs.push(`<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>${xmlEscape(description)}</w:t></w:r></w:p>`);
      const mime = ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
      const suffix = ext === 'jpeg' ? 'jpg' : ext;
      if (!new RegExp(`<Default\\b[^>]*Extension="${suffix}"`, 'i').test(types)) {
        types = types.replace('</Types>', `<Default Extension="${suffix}" ContentType="${mime}"/></Types>`);
      }
    }
    inserts.push(paragraphs.join(''));
  }

  const blocks = [...xml.matchAll(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)];
  const changes: { start: number; end: number; value: string }[] = [];
  for (let layer = 0; layer < layerNames.length; layer++) {
    const captionIndex = blocks.findIndex(block => block[0].startsWith('<w:p') && new RegExp(`^表A[-－]\\s*${layer + 1}.*测评结果记录$`).test(compact(paragraphText(block[0]))));
    if (captionIndex < 0 || !blocks[captionIndex + 1]?.[0].startsWith('<w:tbl')) throw new Error('模板中未找到现场测评表：' + layerNames[layer]);
    const nextCaptionIndex = blocks.findIndex((block, index) =>
      index > captionIndex + 1 && block[0].startsWith('<w:p') &&
      /^表A[-－]\d+.*测评结果记录$/.test(compact(paragraphText(block[0]))));
    const boundaryIndex = nextCaptionIndex < 0 ? blocks.length : nextCaptionIndex;
    const placeholderIndexes = blocks
      .map((block, index) => ({ block, index }))
      .filter(({ block, index }) => index > captionIndex + 1 && index < boundaryIndex &&
        block[0].startsWith('<w:p') && /^\{\{?证据截图列表\}\}?$/.test(paragraphText(block[0]).trim()))
      .map(({ index }) => index);
    if (placeholderIndexes.length > 1) throw new Error('同一张现场测评表下只能有一个 {{证据截图列表}}：' + layerNames[layer]);
    if (placeholderIndexes.length === 1) {
      const placeholder = blocks[placeholderIndexes[0]];
      const sectionBreaks = [...placeholder[0].matchAll(/<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>|<w:sectPr\b[^>]*\/>/g)]
        .map(match => `<w:p><w:pPr>${match[0]}</w:pPr></w:p>`).join('');
      changes.push({ start: placeholder.index!, end: placeholder.index! + placeholder[0].length,
        value: inserts[layer] + sectionBreaks });
      continue;
    }
    // 兼容已导入的旧报告：仅允许原有图题和空段落位于表格与下一节之间。
    const boundary = layer < 7 ? layerNames[layer + 1] : '附录B密评活动有效性证明记录';
    const legacyBoundaryIndex = blocks.findIndex((block, index) => index > captionIndex + 1 &&
      block[0].startsWith('<w:p') && compact(paragraphText(block[0])) === boundary);
    if (legacyBoundaryIndex < 0) throw new Error('表A-' + (layer + 1) + '后缺少 {{证据截图列表}} 占位符');
    const sectionBreaks: string[] = [];
    for (const block of blocks.slice(captionIndex + 2, legacyBoundaryIndex)) {
      const value = paragraphText(block[0]).trim();
      if (!block[0].startsWith('<w:p') || (value && !new RegExp(`^图\\s*A[-－]\\s*${layer + 1}[.．]`).test(value))) {
        throw new Error('现场测评表后存在非截图内容，请核对模板：' + layerNames[layer]);
      }
      for (const match of block[0].matchAll(/<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>|<w:sectPr\b[^>]*\/>/g)) {
        sectionBreaks.push(`<w:p><w:pPr>${match[0]}</w:pPr></w:p>`);
      }
    }
    changes.push({
      start: blocks[captionIndex + 1].index! + blocks[captionIndex + 1][0].length,
      end: blocks[legacyBoundaryIndex].index!,
      value: inserts[layer] + sectionBreaks.join(''),
    });
  }
  for (const change of changes.reverse()) xml = xml.slice(0, change.start) + change.value + xml.slice(change.end);
  zip.file(relPath, rels);
  zip.file('[Content_Types].xml', types);
  return xml;
}

const appendixImageSlots: Record<string, string[]> = {
  'b1-file': ['委托证明文件照片列表'],
  'b2-travel': ['差旅票证照片列表'],
  'b2-bill': ['住宿账单列表', '住宿账单照片列表'],
  'b2-invoice': ['住宿费发票列表', '住宿发票照片列表'],
  'b3-sign': ['现场测评签到表'],
  'b3-photo': ['现场照片列表'],
  'b4-auth': ['现场授权测评书照片列表', '现场测评授权书照片列表'],
  'b4-risk': ['风险告知书照片'],
  'b5-review': ['测评方案评审记录扫描件/照片'],
  'b5-confirm': ['测评方案确认记录扫描件/照片'],
  b6: ['密评报告评审记录照片列表', '密评报告评审照片列表'],
  'b8-slot-1': ['密评人员考核成绩证明照片1'],
  'b8-slot-2': ['密评人员考核成绩证明照片2'],
  'b8-slot-3': ['密评人员考核成绩证明照片3'],
  'b8-slot-4': ['密评人员考核成绩证明照片4'],
  b9: ['定级备案证明'],
};

function normalizeAppendixB8TableLayout(xml: string): string {
  const slots = [1, 2, 3, 4].map(index => `{{密评人员考核成绩证明照片${index}}}`);
  return xml.replace(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/g, table => {
    if (!slots.every(slot => paragraphText(table).includes(slot))) return table;
    const rows = table.match(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g) || [];
    if (rows.length !== 2 || rows.some(row => (row.match(/<w:tc\b[^>]*>/g) || []).length !== 2)) {
      throw new Error('表B-8模板必须保持两行两列，每行只放2张证书图片');
    }
    const width = Number(/<w:tblW\b[^>]*w:w="(\d+)"/.exec(table)?.[1] || 13948);
    const columnWidths = [Math.floor(width / 2), width - Math.floor(width / 2)];
    table = /<w:tblLayout\b/.test(table)
      ? table.replace(/<w:tblLayout\b[^>]*\/>|<w:tblLayout\b[^>]*>[\s\S]*?<\/w:tblLayout>/, '<w:tblLayout w:type="fixed"/>')
      : table.replace('</w:tblPr>', '<w:tblLayout w:type="fixed"/></w:tblPr>');
    table = table.replace(/<w:tblGrid\b[^>]*>[\s\S]*?<\/w:tblGrid>/,
      `<w:tblGrid><w:gridCol w:w="${columnWidths[0]}"/><w:gridCol w:w="${columnWidths[1]}"/></w:tblGrid>`);
    return table.replace(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g, row => {
      let cellIndex = 0;
      return row.replace(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g, cell => {
        const cellWidth = `<w:tcW w:w="${columnWidths[cellIndex++]}" w:type="dxa"/>`;
        return /<w:tcW\b/.test(cell)
          ? cell.replace(/<w:tcW\b[^>]*\/>|<w:tcW\b[^>]*>[\s\S]*?<\/w:tcW>/, cellWidth)
          : cell.replace(/<w:tcPr\b[^>]*>/, match => match + cellWidth);
      });
    });
  });
}

// 附录B四处多图槽：占位符写在对应 Word 表格的图片单元格内，旧项目单张图片自动兼容。
export async function writeAppendixBImages(xml: string, zip: JSZip, saved: Record<string, string | string[]>): Promise<string> {
  xml = normalizeAppendixB8TableLayout(xml);
  const relPath = 'word/_rels/document.xml.rels';
  let rels = await zip.file(relPath)?.async('string');
  let types = await zip.file('[Content_Types].xml')?.async('string');
  if (!rels || !types) throw new Error('报告模板缺少图片关系或内容类型定义');
  let rid = Math.max(0, ...[...rels.matchAll(/\bId="rId(\d+)"/g)].map(match => Number(match[1]))) + 1;
  let drawingId = Math.max(0, ...[...xml.matchAll(/<wp:docPr\b[^>]*\bid="(\d+)"/g)].map(match => Number(match[1]))) + 1;
  for (const [key, aliases] of Object.entries(appendixImageSlots)) {
    const label = aliases[0];
    const value = saved?.[key];
    const images = (Array.isArray(value) ? value : value ? [value] : []).filter(Boolean);
    const paragraphs = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)]
      .filter(match => aliases.some(alias => paragraphText(match[0]).includes(`{{${alias}}}`)));
    if (paragraphs.length > 1) throw new Error(`Word模板中 {{${label}}} 重复，请只保留一个`);
    if (!paragraphs.length) {
      if (images.length) throw new Error(`Word模板缺少 {{${label}}}，无法导出已上传的图片`);
      continue;
    }
    const replacement: string[] = [];
    // 页面中的附录 B.1—B.4 覆盖表 B-1 至表 B-8；B.5（表 B-9）之后按普通报告图片处理。
    const targetWidth = key === 'b1-file'
      ? APPENDIX_B1_IMAGE_WIDTH_EMU
      : (key === 'b3-photo'
        ? APPENDIX_B3_PHOTO_WIDTH_EMU
        : (key === 'b4-auth' || key === 'b4-risk' || /^b8-slot-\\d+$/.test(key)
        ? APPENDIX_B4_IMAGE_WIDTH_EMU
          : (!/^b9(?:-|$)/.test(key) ? APPENDIX_B_IMAGE_WIDTH_EMU : APPENDIX_B_OTHER_IMAGE_WIDTH_EMU)));
    for (let index = 0; index < images.length; index++) {
      const { bytes, ext, size } = await exportImage(images[index], `${label}第${index + 1}张`);
      const suffix = ext === 'jpeg' ? 'jpg' : ext;
      const filename = `bb-appendix-${key}-${index + 1}.${suffix}`;
      zip.file(`word/media/${filename}`, bytes);
      const relationId = `rId${rid++}`;
      rels = rels.replace('</Relationships>', `<Relationship Id="${relationId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${filename}"/></Relationships>`);
      replacement.push(imageRun(relationId, drawingId++, size.width, size.height, `${label} ${index + 1}`, targetWidth));
      if (!new RegExp(`<Default\\b[^>]*Extension="${suffix}"`, 'i').test(types)) {
        types = types.replace('</Types>', `<Default Extension="${suffix}" ContentType="${ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`}"/></Types>`);
      }
    }
    const paragraph = paragraphs[0];
    const alias = aliases.find(item => paragraphText(paragraph[0]).includes(`{{${item}}}`))!;
    const leading = removeParagraphSlot(paragraph[0], alias);
    const hasLabel = paragraphText(leading).trim().length > 0;
    const imageLine = replacement.length
      ? (key === 'b3-photo'
        // B-3 现场照片连续写入同一段落；图片之间不插入换行、段落或空白文本。
        ? `<w:p><w:pPr><w:jc w:val="center"/><w:keepLines/><w:wordWrap w:val="0"/><w:spacing w:before="0" w:after="0"/></w:pPr>${replacement.join('')}</w:p>`
        : `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="120"/></w:pPr>${replacement.join('')}</w:p>`)
      : '';
    // Word 保存文档时会把行尾仅含空段落的单元格压缩成 gridAfter，造成表B-8的
    // 两列布局丢失。空证书格保留一个不可见的不换行空格，使每行始终显示两个框。
    const emptyImageCell = /^b8-slot-\d+$/.test(key)
      ? '<w:p><w:r><w:t xml:space="preserve">&#160;</w:t></w:r></w:p>'
      : '<w:p/>';
    xml = xml.slice(0, paragraph.index!) + (hasLabel ? leading : '') + (imageLine || (hasLabel ? '' : emptyImageCell))
      + xml.slice(paragraph.index! + paragraph[0].length);
  }
  zip.file(relPath, rels);
  zip.file('[Content_Types].xml', types);
  return xml;
}

const planningImageSlots: Record<string, string> = {
  '被测系统情况_拓扑图': 'topology-image',
  '工具接入示意图': 'access-image',
  '被测系统情况_密码应用情况_设备和计算安全_密码应用情况图片': 'device-crypto-image',
  '被测系统情况_密码应用情况_应用和数据安全_密码应用情况图片': 'application-crypto-image',
};

export async function writePlanningImages(xml: string, zip: JSZip, images: Record<string, string>): Promise<string> {
  const relPath = 'word/_rels/document.xml.rels';
  let rels = await zip.file(relPath)?.async('string');
  let types = await zip.file('[Content_Types].xml')?.async('string');
  if (!rels || !types) throw new Error('报告模板缺少图片关系或内容类型定义');
  let rid = Math.max(0, ...[...rels.matchAll(/\bId="rId(\d+)"/g)].map(match => Number(match[1]))) + 1;
  let drawingId = Math.max(0, ...[...xml.matchAll(/<wp:docPr\b[^>]*\bid="(\d+)"/g)].map(match => Number(match[1]))) + 1;
  for (const [slot, imageId] of Object.entries(planningImageSlots)) {
    const paragraphs = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)]
      .filter(match => paragraphText(match[0]).trim() === `{{${slot}}}`);
    if (paragraphs.length !== 1) throw new Error(`Word模板中的 {{${slot}}} 必须恰好出现一次`);
    const paragraph = paragraphs[0];
    const dataUrl = images[imageId];
    let replacement = '<w:p/>';
    if (dataUrl) {
      const { bytes, ext, size } = await exportImage(dataUrl, slot);
      const suffix = ext === 'jpeg' ? 'jpg' : ext;
      const filename = `bb-planning-${imageId}.${suffix}`;
      zip.file(`word/media/${filename}`, bytes);
      const relationId = `rId${rid++}`;
      rels = rels.replace('</Relationships>', `<Relationship Id="${relationId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${filename}"/></Relationships>`);
      replacement = imageParagraph(relationId, drawingId++, size.width, size.height, slot);
      if (!new RegExp(`<Default\\b[^>]*Extension="${suffix}"`, 'i').test(types)) {
        types = types.replace('</Types>', `<Default Extension="${suffix}" ContentType="${ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`}"/></Types>`);
      }
    }
    xml = xml.slice(0, paragraph.index!) + replacement + xml.slice(paragraph.index! + paragraph[0].length);
  }
  zip.file(relPath, rels);
  zip.file('[Content_Types].xml', types);
  return xml;
}


