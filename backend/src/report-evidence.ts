import JSZip from 'jszip';
import sharp from 'sharp';

const layerNames = ['物理和环境安全', '网络和通信安全', '设备和计算安全', '应用和数据安全', '管理制度', '人员管理', '建设运行', '应急处置'];
type Evidence = { no?: string; name?: string; dataUrl?: string };
type OnsiteRecord = { evidence?: Evidence[] };
type EvidenceImage = { id?: string; dataUrl?: string };
type EvidenceGroup = { id?: string; layer?: number; no?: string; name?: string; images?: EvidenceImage[]; dataUrl?: string };

function evidenceGroupsForLayer(records: Record<string, OnsiteRecord>, groups: EvidenceGroup[], layer: number) {
  let evidenceGroups = (groups || [])
    .filter(group => Number(group.layer) === layer)
    .map(group => ({ ...group, images: Array.isArray(group.images) ? group.images : (group.dataUrl ? [{ dataUrl: group.dataUrl }] : []) }))
    .sort((a, b) => Number(/\.(\d+)$/.exec(a.no || '')?.[1] || 0) - Number(/\.(\d+)$/.exec(b.no || '')?.[1] || 0));
  // 兼容旧项目“一张图片一个编号、图片挂在测评对象记录上”的历史数据。
  if (!evidenceGroups.length) {
    evidenceGroups = Object.entries(records || {})
      .filter(([key]) => key.split('|')[0] === String(layer))
      .flatMap(([, record]) => (record.evidence || []).map(item => ({
        no: item.no, name: item.name, images: item.dataUrl ? [{ dataUrl: item.dataUrl }] : [],
      })))
      .sort((a, b) => Number(/\.(\d+)$/.exec(a.no || '')?.[1] || 0) - Number(/\.(\d+)$/.exec(b.no || '')?.[1] || 0));
  }
  return evidenceGroups;
}

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

// 优先原样嵌入截图，保留文字和细线；仅对超大图片做一次高质量缩放。
// 2400px 足以覆盖报告中最大约 13cm 的图片在 300 DPI 下的清晰度需求。
const PHOTO_THRESHOLD = 8 * 1024 * 1024;
const PHOTO_LONG_EDGE = 2400;
const EMU_PER_CM = 360_000;
const APPENDIX_B_IMAGE_WIDTH_EMU = 7 * EMU_PER_CM;
const APPENDIX_B1_IMAGE_WIDTH_EMU = 5 * EMU_PER_CM;
const APPENDIX_B3_PHOTO_WIDTH_EMU = 5 * EMU_PER_CM;
const APPENDIX_B4_IMAGE_WIDTH_EMU = 5 * EMU_PER_CM;
const APPENDIX_B_OTHER_IMAGE_WIDTH_EMU = 10 * EMU_PER_CM;
const REPORT_IMAGE_WIDTH_EMU = 13 * EMU_PER_CM;
// 当前报告模板中 15cm 高的图片已接近占满正文页；证据图超过 12cm 时等比例缩小，
// 确保“图片 + 编号/名称”能够作为一组放进同一页。
const REPORT_IMAGE_MAX_HEIGHT_EMU = 12 * EMU_PER_CM;
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
      .flatten({ background: '#ffffff' }).jpeg({ quality: 94, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer();
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
  targetWidth = REPORT_IMAGE_WIDTH_EMU, maxHeight = 0): string {
  // Word 中以目标宽度为上限，高度按原图比例计算；超高图片再按最大高度等比例缩小。
  let cx = targetWidth;
  let cy = Math.max(1, Math.round(targetWidth * height / width));
  if (maxHeight > 0 && cy > maxHeight) {
    cx = Math.max(1, Math.round(cx * maxHeight / cy));
    cy = maxHeight;
  }
  const label = xmlEscape(description);
  return `<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="${label}" descr="${label}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="${label}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

function imageParagraph(rid: string, id: number, width: number, height: number, description: string,
  targetWidth = REPORT_IMAGE_WIDTH_EMU, keepWithCaption = false, maxHeight = 0): string {
  const keepNext = keepWithCaption ? '<w:keepNext/>' : '';
  return `<w:p><w:pPr><w:jc w:val="center"/>${keepNext}<w:spacing w:after="120"/></w:pPr>${imageRun(rid, id, width, height, description, targetWidth, maxHeight)}</w:p>`;
}

function imageRowParagraph(runs: string[], keepWithCaption = false): string {
  const keepNext = keepWithCaption ? '<w:keepNext/>' : '';
  return `<w:p><w:pPr><w:jc w:val="center"/>${keepNext}<w:spacing w:after="120"/></w:pPr>${runs.join('')}</w:p>`;
}

function evidenceCaptionParagraph(description: string): string {
  return `<w:p><w:pPr><w:jc w:val="center"/><w:keepLines/><w:widowControl/><w:spacing w:before="0" w:after="120"/></w:pPr><w:r><w:t>${xmlEscape(description)}</w:t></w:r></w:p>`;
}

export async function writeReportEvidence(xml: string, zip: JSZip, records: Record<string, OnsiteRecord>,
  groups: EvidenceGroup[] = []): Promise<string> {
  const relPath = 'word/_rels/document.xml.rels';
  let rels = await zip.file(relPath)?.async('string');
  let types = await zip.file('[Content_Types].xml')?.async('string');
  if (!rels || !types) throw new Error('报告模板缺少图片关系或内容类型定义');
  let rid = Math.max(0, ...[...rels.matchAll(/\bId="rId(\d+)"/g)].map(match => Number(match[1]))) + 1;
  let drawingId = Math.max(0, ...[...xml.matchAll(/<wp:docPr\b[^>]*\bid="(\d+)"/g)].map(match => Number(match[1]))) + 1;
  const inserts: string[] = [];
  for (let layer = 0; layer < layerNames.length; layer++) {
    const evidenceGroups = evidenceGroupsForLayer(records, groups, layer);
    const paragraphs: string[] = [];
    for (let groupIndex = 0; groupIndex < evidenceGroups.length; groupIndex++) {
      const group = evidenceGroups[groupIndex];
      const description = [group.no || `图A-${layer + 1}.${groupIndex + 1}`, group.name || ''].filter(Boolean).join(' ');
      const images = (group.images || []).filter(image => image.dataUrl);
      for (let imageIndex = 0; imageIndex < images.length; imageIndex++) {
        const { bytes, ext, size } = await exportImage(images[imageIndex].dataUrl || '',
          `${description}第${imageIndex + 1}张`);
        const filename = `bb-evidence-${layer + 1}-${groupIndex + 1}-${imageIndex + 1}.${ext === 'jpeg' ? 'jpg' : ext}`;
        zip.file(`word/media/${filename}`, bytes);
        const relationId = `rId${rid++}`;
        rels = rels.replace('</Relationships>', `<Relationship Id="${relationId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${filename}"/></Relationships>`);
        paragraphs.push(imageParagraph(relationId, drawingId++, size.width, size.height, description,
          REPORT_IMAGE_WIDTH_EMU, imageIndex === images.length - 1, REPORT_IMAGE_MAX_HEIGHT_EMU));
        const mime = ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
        const suffix = ext === 'jpeg' ? 'jpg' : ext;
        if (!new RegExp(`<Default\\b[^>]*Extension="${suffix}"`, 'i').test(types)) {
          types = types.replace('</Types>', `<Default Extension="${suffix}" ContentType="${mime}"/></Types>`);
        }
      }
      if (!images.length) continue;
      // 同一证据编号只输出一次图题；该编号下的多张图片连续列出。
      paragraphs.push(evidenceCaptionParagraph(description));
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

// 原始记录的每个安全层面是独立 DOCX。证据的筛选、排序、多图连续排列和图题规则
// 与正式报告保持一致，并统一插入到现场测评表之后、文档末尾节属性之前。
export async function appendRawRecordEvidence(xml: string, zip: JSZip, records: Record<string, OnsiteRecord>,
  groups: EvidenceGroup[] = [], layer: number): Promise<string> {
  const evidenceGroups = evidenceGroupsForLayer(records, groups, layer);
  if (!evidenceGroups.length) return xml;
  const relPath = 'word/_rels/document.xml.rels';
  let rels = await zip.file(relPath)?.async('string');
  let types = await zip.file('[Content_Types].xml')?.async('string');
  if (!rels || !types) throw new Error('现场核查模板缺少图片关系或内容类型定义');
  let rid = Math.max(0, ...[...rels.matchAll(/\bId="rId(\d+)"/g)].map(match => Number(match[1]))) + 1;
  let drawingId = Math.max(0, ...[...xml.matchAll(/<wp:docPr\b[^>]*\bid="(\d+)"/g)].map(match => Number(match[1]))) + 1;
  const paragraphs: string[] = [];
  for (let groupIndex = 0; groupIndex < evidenceGroups.length; groupIndex++) {
    const group = evidenceGroups[groupIndex];
    const description = [group.no || `图A-${layer + 1}.${groupIndex + 1}`, group.name || ''].filter(Boolean).join(' ');
    const images = (group.images || []).filter(image => image.dataUrl);
    const imageRuns: string[] = [];
    // 同一图片编号下的照片共用正式报告的 13cm 图片宽度上限，并均分这一行的可用宽度。
    // 所有图片作为同一段落中的连续内嵌对象写入，Word 会优先在一行展示，空间不足时再自动换行。
    const imageWidth = Math.max(1, Math.floor(REPORT_IMAGE_WIDTH_EMU / Math.max(1, images.length)));
    for (let imageIndex = 0; imageIndex < images.length; imageIndex++) {
      const { bytes, ext, size } = await exportImage(images[imageIndex].dataUrl || '', `${description}第${imageIndex + 1}张`);
      const filename = `raw-evidence-${layer + 1}-${groupIndex + 1}-${imageIndex + 1}.${ext === 'jpeg' ? 'jpg' : ext}`;
      zip.file(`word/media/${filename}`, bytes);
      const relationId = `rId${rid++}`;
      rels = rels.replace('</Relationships>', `<Relationship Id="${relationId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${filename}"/></Relationships>`);
      imageRuns.push(imageRun(relationId, drawingId++, size.width, size.height, description,
        imageWidth, REPORT_IMAGE_MAX_HEIGHT_EMU));
      const mime = ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
      const suffix = ext === 'jpeg' ? 'jpg' : ext;
      if (!new RegExp(`<Default\\b[^>]*Extension="${suffix}"`, 'i').test(types)) {
        types = types.replace('</Types>', `<Default Extension="${suffix}" ContentType="${mime}"/></Types>`);
      }
    }
    if (images.length) {
      paragraphs.push(imageRowParagraph(imageRuns, true));
      paragraphs.push(evidenceCaptionParagraph(description));
    }
  }
  if (!paragraphs.length) return xml;
  const bodyEnd = xml.lastIndexOf('</w:body>');
  const finalSection = xml.lastIndexOf('<w:sectPr', bodyEnd);
  if (bodyEnd < 0 || finalSection < 0) throw new Error('现场核查模板正文结构无效，无法写入证据列表');
  zip.file(relPath, rels);
  zip.file('[Content_Types].xml', types);
  return xml.slice(0, finalSection) + paragraphs.join('') + xml.slice(finalSection);
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
  '工具接入示意图': 'access-image',
  '被测系统情况_密码应用情况_设备和计算安全_密码应用情况图片': 'device-crypto-image',
  '被测系统情况_密码应用情况_应用和数据安全_密码应用情况图片': 'application-crypto-image',
};

const planningImageCaptionLabels: Record<string, string> = {
  '被测系统情况_密码应用情况_设备和计算安全_密码应用情况图片': '设备和计算安全密码应用情况',
  '被测系统情况_密码应用情况_应用和数据安全_密码应用情况图片': '应用和数据安全密码应用情况',
};

type TopologyBlock = { type?: string; content?: string; dataUrl?: string; caption?: string };

function topologyTextParagraph(content: string) {
  const value = xmlEscape(String(content || '').replace(/\r\n?/g, '\n'))
    .replace(/\n/g, '</w:t><w:br/><w:t xml:space="preserve">');
  return `<w:p><w:pPr><w:spacing w:line="360" w:lineRule="auto"/><w:ind w:firstLine="480" w:firstLineChars="200"/></w:pPr><w:r><w:t xml:space="preserve">${value}</w:t></w:r></w:p>`;
}

export async function writeTopologyBlocks(xml: string, zip: JSZip, blocks: TopologyBlock[] | undefined,
  legacyImage: string | undefined, legacyDescription: string | undefined, systemName: string): Promise<string> {
  const imageSlot = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)]
    .find(match => paragraphText(match[0]).trim() === '{{被测系统情况_拓扑图}}');
  const descriptionSlot = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)]
    .find(match => paragraphText(match[0]).trim() === '{{被测系统情况_网络拓扑图及描述_描述}}');
  if (!imageSlot || !descriptionSlot || descriptionSlot.index! < imageSlot.index!) {
    throw new Error('Word模板中的网络拓扑图和描述占位符位置无效');
  }
  let ordered = Array.isArray(blocks) ? blocks.filter(block => block && (block.type === 'text' || block.type === 'image')) : [];
  if (!ordered.length) {
    ordered = [];
    if (legacyImage) ordered.push({ type: 'image', dataUrl: legacyImage });
    if (legacyDescription) ordered.push({ type: 'text', content: legacyDescription });
  }
  const relPath = 'word/_rels/document.xml.rels';
  let rels = await zip.file(relPath)?.async('string');
  let types = await zip.file('[Content_Types].xml')?.async('string');
  if (!rels || !types) throw new Error('报告模板缺少图片关系或内容类型定义');
  let rid = Math.max(0, ...[...rels.matchAll(/\bId="rId(\d+)"/g)].map(match => Number(match[1]))) + 1;
  let drawingId = Math.max(0, ...[...xml.matchAll(/<wp:docPr\b[^>]*\bid="(\d+)"/g)].map(match => Number(match[1]))) + 1;
  let imageNumber = 0;
  const output: string[] = [];
  for (let index = 0; index < ordered.length; index++) {
    const block = ordered[index];
    if (block.type === 'text') {
      if (String(block.content || '').trim()) output.push(topologyTextParagraph(String(block.content)));
      continue;
    }
    if (!block.dataUrl) continue;
    const { bytes, ext, size } = await exportImage(block.dataUrl, `网络拓扑图第${imageNumber + 1}张`);
    const suffix = ext === 'jpeg' ? 'jpg' : ext;
    const filename = `bb-topology-${++imageNumber}.${suffix}`;
    zip.file(`word/media/${filename}`, bytes);
    const relationId = `rId${rid++}`;
    rels = rels.replace('</Relationships>', `<Relationship Id="${relationId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${filename}"/></Relationships>`);
    output.push(imageParagraph(relationId, drawingId++, size.width, size.height, `网络拓扑图 ${imageNumber}`));
    const caption = String(block.caption || `图 2-${imageNumber} ${systemName || '被测信息系统'}网络拓扑图`).trim();
    output.push(`<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="21"/></w:rPr><w:t>${xmlEscape(caption)}</w:t></w:r></w:p>`);
    if (!new RegExp(`<Default\\b[^>]*Extension="${suffix}"`, 'i').test(types)) {
      types = types.replace('</Types>', `<Default Extension="${suffix}" ContentType="${ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`}"/></Types>`);
    }
  }
  zip.file(relPath, rels);
  zip.file('[Content_Types].xml', types);
  const start = imageSlot.index!;
  const end = descriptionSlot.index! + descriptionSlot[0].length;
  return xml.slice(0, start) + (output.join('') || '<w:p/>') + xml.slice(end);
}

export async function writePlanningImages(xml: string, zip: JSZip, images: Record<string, string>,
  topologyImageCount = 0): Promise<string> {
  const relPath = 'word/_rels/document.xml.rels';
  let rels = await zip.file(relPath)?.async('string');
  let types = await zip.file('[Content_Types].xml')?.async('string');
  if (!rels || !types) throw new Error('报告模板缺少图片关系或内容类型定义');
  let rid = Math.max(0, ...[...rels.matchAll(/\bId="rId(\d+)"/g)].map(match => Number(match[1]))) + 1;
  let drawingId = Math.max(0, ...[...xml.matchAll(/<wp:docPr\b[^>]*\bid="(\d+)"/g)].map(match => Number(match[1]))) + 1;
  let cryptoImageNumber = Math.max(0, Number(topologyImageCount) || 0);
  for (const [slot, imageId] of Object.entries(planningImageSlots)) {
    const paragraphs = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)]
      .filter(match => paragraphText(match[0]).trim() === `{{${slot}}}`);
    if (paragraphs.length !== 1) throw new Error(`Word模板中的 {{${slot}}} 必须恰好出现一次`);
    const paragraph = paragraphs[0];
    const captionLabel = planningImageCaptionLabels[slot];
    const captionParagraph = captionLabel
      ? [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].find(match => {
        const text = paragraphText(match[0]).trim();
        return match.index! > paragraph.index! && /^\u56fe\s*2[-－—]\s*\d+/.test(text) && text.endsWith(captionLabel);
      })
      : undefined;
    if (captionLabel && !captionParagraph) throw new Error(`Word模板中缺少“${captionLabel}”图片标题`);
    const dataUrl = images[imageId];
    let replacement = '<w:p/>';
    if (dataUrl) {
      const description = captionLabel ? `图 2-${++cryptoImageNumber} ${captionLabel}` : slot;
      const { bytes, ext, size } = await exportImage(dataUrl, slot);
      const suffix = ext === 'jpeg' ? 'jpg' : ext;
      const filename = `bb-planning-${imageId}.${suffix}`;
      zip.file(`word/media/${filename}`, bytes);
      const relationId = `rId${rid++}`;
      rels = rels.replace('</Relationships>', `<Relationship Id="${relationId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${filename}"/></Relationships>`);
      replacement = imageParagraph(relationId, drawingId++, size.width, size.height, description,
        REPORT_IMAGE_WIDTH_EMU, !!captionLabel, REPORT_IMAGE_MAX_HEIGHT_EMU);
      if (captionLabel) replacement += evidenceCaptionParagraph(description);
      if (!new RegExp(`<Default\\b[^>]*Extension="${suffix}"`, 'i').test(types)) {
        types = types.replace('</Types>', `<Default Extension="${suffix}" ContentType="${ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`}"/></Types>`);
      }
    }
    const end = captionParagraph ? captionParagraph.index! + captionParagraph[0].length : paragraph.index! + paragraph[0].length;
    xml = xml.slice(0, paragraph.index!) + replacement + xml.slice(end);
  }
  zip.file(relPath, rels);
  zip.file('[Content_Types].xml', types);
  return xml;
}


