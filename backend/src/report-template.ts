// 2026-09-21 模板的少量复用/误写占位符需要按表格上下文区分。
const decode = (value: string) => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const encode = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const textOf = (block: string) => [...block.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(match => decode(match[1])).join('');

// 基本信息表由复选框/输入框拼成多行。旧版页面曾把 HTML 缩进也保存为换行；
// 导出时只对这些结构化字段去掉空白行，不改用户撰写的报告正文段落。
const structuredBasicInfoSlots = new Set([
  '关基认定情况', '等保已定级备案情况', '等保未定级情况',
  '已测评情况', '正在测评情况', '未测评情况',
  '服务范围', '服务领域', '服务对象', '覆盖范围', '网络性质',
  '系统服务用户数量', '系统投入运行情况', '系统互联情况',
  '系统使用密码产品情况', '系统使用的密码算法情况',
  '依赖云平台', '依赖云平台情况', '不依赖云平台情况',
  '有密码应用方案且通过密评情况', '有密码应用方案但未通过密评情况', '无密码应用方案情况',
]);

export function normalizeBasicInfoTemplateValues(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name,
    structuredBasicInfoSlots.has(name)
      ? String(value ?? '').replace(/\r\n?/g, '\n').replace(/[ \t\u00a0]*\n[ \t\u00a0]*/g, '\n').replace(/\n+/g, '\n').trim()
      : value,
  ]));
}

export function normalizeCheckboxLabelSpacing(value: string): string {
  return String(value ?? '').replace(/([☑□☐])[ \t\u00a0\u2000-\u200a\u202f\u3000]+/g, '$1');
}

export function formatLatinFonts(xml: string): string {
  return xml.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, run => {
    let properties = /<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/.exec(run)?.[0] || '';
    if (!properties) {
      const selfClosing = /<w:rPr\b([^>]*)\/>/.exec(run);
      properties = selfClosing ? `<w:rPr${selfClosing[1]}></w:rPr>` : '<w:rPr></w:rPr>';
    }
    const fontTag = (existing: string) => {
      const attributes = existing
        .replace(/\s+w:(?:ascii|hAnsi|cs|asciiTheme|hAnsiTheme|cstheme)="[^"]*"/g, '');
      return `<w:rFonts${attributes} w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>`;
    };
    if (/<w:rFonts\b/.test(properties)) {
      properties = properties.replace(/<w:rFonts\b([^>]*?)(?:\/>|>[\s\S]*?<\/w:rFonts>)/, (_match, attributes: string) => fontTag(attributes));
    } else {
      properties = properties.replace('</w:rPr>', '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/></w:rPr>');
    }
    if (/<w:rPr\b[^>]*\/>/.test(run)) return run.replace(/<w:rPr\b[^>]*\/>/, properties);
    return /<w:rPr\b/.test(run)
      ? run.replace(/<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/, properties)
      : run.replace(/<w:r\b[^>]*>/, match => match + properties);
  });
}

export function allowLatinWordWrap(xml: string): string {
  const addWordWrap = (paragraph: string) => {
    const wordWrap = '<w:wordWrap w:val="1"/>';
    let properties = /<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/.exec(paragraph)?.[0] || '';
    if (properties) {
      if (/<w:wordWrap\b/.test(properties)) {
        properties = properties.replace(/<w:wordWrap\b[^>]*\/>|<w:wordWrap\b[^>]*>[\s\S]*?<\/w:wordWrap>/, wordWrap);
      } else {
        const nextProperty = /<w:(?:overflowPunct|topLinePunct|autoSpaceDE|autoSpaceDN|bidi|adjustRightInd|snapToGrid|spacing|ind|contextualSpacing|mirrorIndents|suppressOverlap|jc|textDirection|textAlignment|textboxTightWrap|outlineLvl|divId|cnfStyle|rPr|sectPr|pPrChange)\b/.exec(properties);
        properties = nextProperty
          ? properties.slice(0, nextProperty.index) + wordWrap + properties.slice(nextProperty.index)
          : properties.replace('</w:pPr>', wordWrap + '</w:pPr>');
      }
      return paragraph.replace(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/, properties);
    }
    const selfClosing = /<w:pPr\b([^>]*)\/>/.exec(paragraph);
    if (selfClosing) return paragraph.replace(selfClosing[0], `<w:pPr${selfClosing[1]}>${wordWrap}</w:pPr>`);
    return paragraph.replace(/<w:p\b[^>]*>/, match => match + `<w:pPr>${wordWrap}</w:pPr>`);
  };
  xml = xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, addWordWrap);
  return xml.replace(/<w:p\b([^>]*)\/>/g, (_match, attributes: string) => `<w:p${attributes}><w:pPr><w:wordWrap w:val="1"/></w:pPr></w:p>`);
}

function updateRunProperties(run: string, unbold = false): string {
  if (!/<w:t\b/.test(run)) return run;
  let properties = /<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/.exec(run)?.[0] || '<w:rPr></w:rPr>';
  properties = properties
    .replace(/<w:rFonts\b[^>]*\/>|<w:rFonts\b[^>]*>[\s\S]*?<\/w:rFonts>/g, '')
    .replace(/<w:sz\b[^>]*\/>|<w:sz\b[^>]*>[\s\S]*?<\/w:sz>/g, '')
    .replace(/<w:szCs\b[^>]*\/>|<w:szCs\b[^>]*>[\s\S]*?<\/w:szCs>/g, '');
  if (unbold) {
    properties = properties
      .replace(/<w:b\b[^>]*\/>|<w:b\b[^>]*>[\s\S]*?<\/w:b>/g, '')
      .replace(/<w:bCs\b[^>]*\/>|<w:bCs\b[^>]*>[\s\S]*?<\/w:bCs>/g, '');
  }
  const additions = `<w:rFonts w:ascii="宋体" w:hAnsi="宋体" w:eastAsia="宋体" w:cs="宋体"/><w:sz w:val="21"/><w:szCs w:val="21"/>${unbold ? '<w:b w:val="0"/><w:bCs w:val="0"/>' : ''}`;
  properties = properties.replace('</w:rPr>', additions + '</w:rPr>');
  return /<w:rPr\b/.test(run)
    ? run.replace(/<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/, properties)
    : run.replace(/<w:r\b[^>]*>/, match => match + properties);
}

function removeTableParagraphIndent(xml: string): string {
  let depth = 0;
  return xml.replace(/<w:tbl\b[^>]*>|<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, block => {
    if (block.startsWith('<w:tbl')) { depth++; return block; }
    if (block === '</w:tbl>') { depth--; return block; }
    if (depth <= 0) return block;
    const indent = '<w:ind w:firstLine="0" w:firstLineChars="0"/>';
    const properties = /<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/.exec(block)?.[0];
    if (!properties) return block.replace(/<w:p\b[^>]*>/, match => match + `<w:pPr>${indent}</w:pPr>`);
    const updated = /<w:ind\b/.test(properties)
      ? properties.replace(/<w:ind\b([^>]*)\/>/, (_match, attrs: string) => {
        const clean = attrs.replace(/\s+w:(?:firstLine|firstLineChars|hanging|hangingChars)="[^"]*"/g, '');
        return `<w:ind${clean} w:firstLine="0" w:firstLineChars="0"/>`;
      })
      : properties.replace('</w:pPr>', indent + '</w:pPr>');
    return block.replace(properties, updated);
  });
}

function updateTableParagraphMarkProperties(paragraph: string): string {
  const fonts = '<w:rFonts w:eastAsia="宋体" w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>';
  const sizes = '<w:sz w:val="21"/><w:szCs w:val="21"/>';
  let paragraphProperties = /<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/.exec(paragraph)?.[0] || '';
  if (!paragraphProperties) {
    const selfClosing = /<w:pPr\b([^>]*)\/>/.exec(paragraph);
    if (selfClosing) {
      return paragraph.replace(selfClosing[0], `<w:pPr${selfClosing[1]}><w:rPr>${fonts}${sizes}</w:rPr></w:pPr>`);
    }
    return paragraph.replace(/<w:p\b[^>]*>/, match => match + `<w:pPr><w:rPr>${fonts}${sizes}</w:rPr></w:pPr>`);
  }
  const runPropertiesMatch = /<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>|<w:rPr\b[^>]*\/>/.exec(paragraphProperties);
  if (!runPropertiesMatch) {
    const updated = paragraphProperties.replace('</w:pPr>', `<w:rPr>${fonts}${sizes}</w:rPr></w:pPr>`);
    return paragraph.replace(paragraphProperties, updated);
  }
  let runProperties = runPropertiesMatch[0];
  if (/\/>$/.test(runProperties)) runProperties = runProperties.replace(/\/>$/, '></w:rPr>');
  runProperties = runProperties
    .replace(/<w:rFonts\b[^>]*\/>|<w:rFonts\b[^>]*>[\s\S]*?<\/w:rFonts>/g, '')
    .replace(/<w:sz\b[^>]*\/>|<w:sz\b[^>]*>[\s\S]*?<\/w:sz>/g, '')
    .replace(/<w:szCs\b[^>]*\/>|<w:szCs\b[^>]*>[\s\S]*?<\/w:szCs>/g, '')
    .replace('</w:rPr>', fonts + sizes + '</w:rPr>');
  const updated = paragraphProperties.replace(runPropertiesMatch[0], runProperties);
  return paragraph.replace(paragraphProperties, updated);
}

function formatParagraphMarksInsideTables(xml: string): string {
  let depth = 0;
  return xml.replace(/<w:tbl\b[^>]*>|<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, block => {
    if (block.startsWith('<w:tbl')) { depth++; return block; }
    if (block === '</w:tbl>') { depth--; return block; }
    return depth > 0 ? updateTableParagraphMarkProperties(block) : block;
  });
}
function formatRunsInsideTables(xml: string): string {
  let depth = 0;
  return xml.replace(/<w:tbl\b[^>]*>|<\/w:tbl>|<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, block => {
    if (block.startsWith('<w:tbl')) { depth++; return block; }
    if (block === '</w:tbl>') { depth--; return block; }
    return depth > 0 ? updateRunProperties(block) : block;
  });
}

function findBalancedTableEnd(xml: string, start: number): number {
  let depth = 0;
  const tags = /<w:tbl\b[^>]*>|<\/w:tbl>/g;
  tags.lastIndex = start;
  for (let match = tags.exec(xml); match; match = tags.exec(xml)) {
    if (match[0].startsWith('<w:tbl')) depth++;
    else if (--depth === 0) return tags.lastIndex;
  }
  return -1;
}

function normalizeCaption(value: string): string {
  return value.replace(/\s/g, '').replace(/^表[A-Za-z0-9０-９]+[-—－.]?[A-Za-z0-9０-９]+/, '');
}

function addKeepNext(paragraph: string): string {
  if (/<w:keepNext\b/.test(paragraph)) return paragraph;
  const properties = /<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/.exec(paragraph)?.[0];
  if (!properties) return paragraph.replace(/<w:p\b[^>]*>/, match => match + '<w:pPr><w:keepNext/></w:pPr>');
  return paragraph.replace(properties, properties.replace('</w:pPr>', '<w:keepNext/></w:pPr>'));
}

function preventRowSplit(row: string): string {
  if (/<w:cantSplit\b/.test(row)) return row;
  const properties = /<w:trPr\b[^>]*>[\s\S]*?<\/w:trPr>/.exec(row)?.[0];
  if (!properties) return row.replace(/<w:tr\b[^>]*>/, match => match + '<w:trPr><w:cantSplit/></w:trPr>');
  return row.replace(properties, properties.replace('</w:trPr>', '<w:cantSplit/></w:trPr>'));
}

// 第一章“测评项目概述”开始后的表格统一使用五号宋体；
// 表2-4、2-5、2-10的数据行不加粗，并处理表2-5和表B-3的分页属性。
export function formatReportTables(xml: string): string {
  const chapterOne = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)]
    .find(match => textOf(match[0]).trim() === '测评项目概述');
  const bodyStart = chapterOne?.index ?? 0;
  const body = xml.slice(bodyStart);
  xml = xml.slice(0, bodyStart) + removeTableParagraphIndent(formatParagraphMarksInsideTables(formatRunsInsideTables(body)));

  const keepCaptionWithTable = new Set(['密码产品', '进场记录']);
  const formattedBody = xml.slice(bodyStart).replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, paragraph =>
    keepCaptionWithTable.has(normalizeCaption(textOf(paragraph).trim())) ? addKeepNext(paragraph) : paragraph);
  xml = xml.slice(0, bodyStart) + formattedBody;

  const unboldDataCaptions = new Set(['物理安防设施', '密码产品', '重要数据']);
  const paginationCaptions = new Set(['密码产品', '进场记录']);
  let caption = '';
  const blocks = /<w:p\b[^>]*>[\s\S]*?<\/w:p>|<w:tbl\b[^>]*>/g;
  blocks.lastIndex = bodyStart;
  for (let match = blocks.exec(xml); match; match = blocks.exec(xml)) {
    if (match[0].startsWith('<w:p')) {
      const value = textOf(match[0]).trim();
      if (value) caption = value;
      continue;
    }
    const normalized = normalizeCaption(caption);
    caption = '';
    if (!unboldDataCaptions.has(normalized) && !paginationCaptions.has(normalized)) continue;
    const start = match.index;
    const end = findBalancedTableEnd(xml, start);
    if (end < 0) throw new Error('报告模板表格结构不完整：' + normalized);
    let table = xml.slice(start, end);
    if (unboldDataCaptions.has(normalized)) {
      let rowIndex = -1;
      table = table.replace(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g, row => {
        rowIndex++;
        return rowIndex === 0 ? row : row.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, run => updateRunProperties(run, true));
      });
    }
    if (normalized === '进场记录') {
      const rowCount = (table.match(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g) || []).length;
      let rowIndex = -1;
      table = table.replace(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g, row => {
        rowIndex++;
        let updated = preventRowSplit(row);
        if (rowIndex < rowCount - 1) {
          updated = updated.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, addKeepNext);
        }
        return updated;
      });
    } else if (normalized === '密码产品') {
      let rowIndex = -1;
      table = table.replace(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g, row => {
        rowIndex++;
        if (rowIndex > 1) return row;
        const updated = preventRowSplit(row);
        return rowIndex === 0
          ? updated.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, addKeepNext)
          : updated;
      });
    }
    xml = xml.slice(0, start) + table + xml.slice(end);
    blocks.lastIndex = start + table.length;
  }
  return xml;
}
// B.2～B.5 使用自动编号。标题样式中遗留的远距离制表位会把编号和标题推到两侧。
// 清除继承位置对应的制表位和各段的直接缩进，再设置统一的紧凑制表位。
export function formatAppendixBHeadings(xml: string): string {
  const targetTitles = new Set(['密评活动证明', '密评活动质量文件', '密评人员资格证明', '系统定级匹配证明']);
  const tabs = '<w:tabs><w:tab w:val="clear" w:pos="432"/><w:tab w:val="clear" w:pos="4545"/><w:tab w:val="left" w:pos="840"/></w:tabs>';
  return xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, paragraph => {
    if (!targetTitles.has(textOf(paragraph).trim())) return paragraph;
    const existing = /<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/.exec(paragraph)?.[0];
    if (!existing) return paragraph.replace(/<w:p\b[^>]*>/, match => match + '<w:pPr>' + tabs + '</w:pPr>');
    const properties = existing
      .replace(/<w:tabs\b[^>]*>[\s\S]*?<\/w:tabs>/g, '')
      .replace(/<w:ind\b[^>]*\/>|<w:ind\b[^>]*>[\s\S]*?<\/w:ind>/g, '')
      .replace('</w:pPr>', tabs + '</w:pPr>');
    return paragraph.replace(existing, properties);
  });
}
// 模板中的图1-1为嵌入式 Visio/OLE 对象。固定为10厘米宽，并按原始比例计算高度。
export function formatFigureOneOne(xml: string): string {
  const paragraphs = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)];
  const captionIndex = paragraphs.findIndex(match => /^图\s*1[-－]\s*1/.test(textOf(match[0]).replace(/\s/g, '')));
  if (captionIndex < 1) return xml;
  for (let index = captionIndex - 1; index >= Math.max(0, captionIndex - 3); index--) {
    const paragraph = paragraphs[index];
    if (!/<o:OLEObject\b[^>]*ProgID="Visio\./.test(paragraph[0])) continue;
    const updated = paragraph[0].replace(/(<v:shape\b[^>]*\bstyle=")([^"]*)(")/, (_match, start, style, end) => {
      const width = /\bwidth:([\d.]+)pt/.exec(style);
      const height = /\bheight:([\d.]+)pt/.exec(style);
      if (!width || !height || Number(width[1]) <= 0) return start + style + end;
      const targetWidthPt = 10 * 72 / 2.54;
      const targetHeightPt = Number(height[1]) * targetWidthPt / Number(width[1]);
      const resized = style
        .replace(/\bwidth:[\d.]+pt/, `width:${targetWidthPt.toFixed(2)}pt`)
        .replace(/\bheight:[\d.]+pt/, `height:${targetHeightPt.toFixed(2)}pt`);
      return start + resized + end;
    });
    return xml.slice(0, paragraph.index!) + updated + xml.slice(paragraph.index! + paragraph[0].length);
  }
  return xml;
}

function replaceInBlock(block: string, source: string, target: string): string {
  const current = textOf(block);
  if (!current.includes(source)) return block;
  const updated = current.split(source).join(target);
  let first = true;
  return block.replace(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g, () => {
    const value = first ? encode(updated).replace(/\r?\n/g, '</w:t><w:br/><w:t xml:space="preserve">') : '';
    first = false;
    return `<w:t xml:space="preserve">${value}</w:t>`;
  });
}

function replaceInCell(row: string, source: string, target: string): string {
  return row.replace(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g, cell => replaceInBlock(cell, source, target));
}

function formatReferenceListParagraph(paragraph: string): string {
  const indent = '<w:ind w:left="720" w:hanging="360"/>';
  const properties = /<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/.exec(paragraph)?.[0];
  if (!properties) return paragraph.replace(/<w:p\b[^>]*>/, match => match + `<w:pPr>${indent}</w:pPr>`);
  const clean = properties
    .replace(/<w:numPr\b[^>]*>[\s\S]*?<\/w:numPr>|<w:numPr\b[^>]*\/>/g, '')
    .replace(/<w:ind\b[^>]*\/?>/g, '');
  return paragraph.replace(properties, clean.replace('</w:pPr>', indent + '</w:pPr>'));
}

function expandReferenceStandardsList(xml: string, value: string): string {
  const slot = '{{参考标准和规范列表}}';
  return xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, paragraph => {
    if (!textOf(paragraph).includes(slot)) return paragraph;
    const items = String(value || '').replace(/\r\n?/g, '\n').split('\n')
      .map(item => item.trim().replace(/^[●•·]\s*/, ''))
      .filter(Boolean);
    if (!items.length) return replaceInBlock(paragraph, slot, '');
    return items.map(item => formatReferenceListParagraph(replaceInBlock(paragraph, slot, '●　' + item))).join('');
  });
}
export function specializeReportTemplate(xml: string, values: Record<string, string>): string {
  xml = expandReferenceStandardsList(xml, values['参考标准和规范列表'] || '');
  let gradingRow = 0;
  xml = xml.replace(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g, row => {
    const text = textOf(row);
    if (text.includes('{{等保已定级备案情况}}')) {
      gradingRow++;
      if (gradingRow === 2) return replaceInCell(row, '{{等保已定级备案情况}}', values['等保未定级情况'] || '');
    }
    if (text.includes('所属省部密码管理部门') && text.includes('浙江省密码管理局')) {
      return replaceInCell(row, '浙江省密码管理局', values['所属省部密码管理部门'] || '');
    }
    if (text.includes('系统等保定级备案名称') && text.includes('{{系统名称}}')) {
      return replaceInCell(row, '{{系统名称}}', values['B9备案系统名称'] || values['系统名称'] || '');
    }
    if (text.includes('委托单位') && text.includes('{{被测单位名称}}')) {
      return replaceInCell(row, '{{被测单位名称}}', values['B1委托单位'] || values['被测单位名称'] || '');
    }
    return row;
  });
  // 同名占位符在结论表格内代表“符合/基本符合/不符合”，仅表格外的独立段落代表结论正文。
  let tableDepth = 0;
  xml = xml.replace(/<\/?w:tbl\b[^>]*>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, block => {
    if (block.startsWith('<w:tbl')) { tableDepth++; return block; }
    if (block.startsWith('</w:tbl')) { tableDepth--; return block; }
    return tableDepth === 0 && textOf(block).trim() === '{{评估结论}}'
      ? replaceInBlock(block, '{{评估结论}}', values['评估结论正文'] || '')
      : block;
  });
  return xml;
}

export function unresolvedReportSlots(xml: string): string[] {
  const slots = new Set<string>();
  for (const paragraph of xml.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) || []) {
    for (const match of textOf(paragraph).matchAll(/\{\{([^{}]+)\}\}/g)) slots.add(match[1]);
  }
  return [...slots].sort();
}

// 只改占位符覆盖的文本节点；周围文字、run 样式和段落属性保持模板原样。
export function replaceReportSlots(xml: string, replacements: Record<string, string>): string {
  return xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, paragraph => {
    const nodes = [...paragraph.matchAll(/<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g)];
    if (!nodes.length) return paragraph;
    const parts = nodes.map(node => decode(node[2]));
    const original = parts.join('');
    if (!original.includes('{{')) return paragraph;
    const occupied: [number, number][] = [];
    const operations: { start: number; end: number; value: string }[] = [];
    for (const [slot, value] of Object.entries(replacements).sort((a, b) => b[0].length - a[0].length)) {
      let from = 0;
      while (slot && from < original.length) {
        const start = original.indexOf(slot, from);
        if (start < 0) break;
        const end = start + slot.length;
        if (!occupied.some(([a, b]) => start < b && end > a)) {
          occupied.push([start, end]);
          operations.push({ start, end, value: value || '' });
        }
        from = end;
      }
    }
    const locate = (position: number) => {
      let offset = 0;
      for (let index = 0; index < parts.length; index++) {
        const end = offset + decode(nodes[index][2]).length;
        if (position < end || (position === end && index === parts.length - 1)) return { index, local: position - offset };
        offset = end;
      }
      return { index: parts.length - 1, local: parts.at(-1)!.length };
    };
    for (const operation of operations.sort((a, b) => b.start - a.start)) {
      const first = locate(operation.start);
      const last = locate(operation.end - 1);
      const lastEnd = last.local + 1;
      if (first.index === last.index) {
        parts[first.index] = parts[first.index].slice(0, first.local) + operation.value + parts[first.index].slice(lastEnd);
      } else {
        parts[first.index] = parts[first.index].slice(0, first.local) + operation.value;
        for (let index = first.index + 1; index < last.index; index++) parts[index] = '';
        parts[last.index] = parts[last.index].slice(lastEnd);
      }
    }
    let index = 0;
    return paragraph.replace(/<w:t\b([^>]*)>[\s\S]*?<\/w:t>/g, (_match, attrs: string) => {
      const content = encode(parts[index++]).replace(/\r?\n/g, '</w:t><w:br/><w:t xml:space="preserve">');
      const preserve = attrs.includes('xml:space=') ? attrs : attrs + ' xml:space="preserve"';
      return `<w:t${preserve}>${content}</w:t>`;
    });
  });
}

