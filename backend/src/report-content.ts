export type ReportContent = {
  tables: { caption: string; rows: (string | null)[][]; skip: number; repeat?: boolean; required?: boolean; footerRows?: (string | null)[][]; groups?: { unit: string; rows: (string | null)[][] }[] }[];
  sections: { heading: string; text: string }[];
};
const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const text = (xml: string) => [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(m => unescape(m[1])).join('');
const norm = (s: string) => s.replace(/\s/g, '').replace(/^表[A-Za-z0-9０-９]+[-—－.]?[A-Za-z0-9０-９]*/, '').replace(/安全安全/g, '安全');
const repeatableAssetTables = new Set(['物理环境', '物理安防设施', '密码产品', '服务器/存储设备', '网络及安全设备', '数据库管理系统', '关键业务应用', '重要数据', '安全管理文档', '人员']);

// Keep paragraph, run and table properties; change only text nodes in an existing slot.
function writeText(xml: string, value: string): string {
  let first = true;
  // 兼容旧项目中已保存为两个字符“\n”的换行，并将实际换行写成 Word 换行符。
  const escaped = escape(value.replace(/\\n/g, '\n')).replace(/\r?\n/g, '</w:t><w:br/><w:t xml:space="preserve">');
  if (/<w:t\b/.test(xml)) return xml.replace(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g, () => {
    const result = '<w:t xml:space="preserve">' + (first ? escaped : '') + '</w:t>';
    first = false;
    return result;
  });
  const run = '<w:r><w:t xml:space="preserve">' + escaped + '</w:t></w:r>';
  if (/<\/w:p>/.test(xml)) return xml.replace('</w:p>', run + '</w:p>');
  return xml.replace(/<w:p\b([^>]*)\/>/, '<w:p$1>' + run + '</w:p>');
}

// 表6-1的“问题描述”和“风险分析”是表格叙述文本：不使用首行缩进，并按报告格式两端对齐。
function formatRiskNarrativeCell(cell: string): string {
  return cell.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, paragraph => {
    const indent = '<w:ind w:firstLine="0" w:firstLineChars="0"/>';
    const justify = '<w:jc w:val="both"/>';
    let properties = /<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/.exec(paragraph)?.[0];
    if (!properties) {
      const selfClosing = /<w:pPr\b([^>]*)\/>/.exec(paragraph);
      if (selfClosing) {
        return paragraph.replace(selfClosing[0], `<w:pPr${selfClosing[1]}>${indent}${justify}</w:pPr>`);
      }
      return paragraph.replace(/<w:p\b[^>]*>/, match => match + `<w:pPr>${indent}${justify}</w:pPr>`);
    }
    properties = properties
      .replace(/<w:jc\b[^>]*\/>|<w:jc\b[^>]*>[\s\S]*?<\/w:jc>/g, '')
      .replace(/<w:ind\b([^>]*?)(?:\/>|>[\s\S]*?<\/w:ind>)/g, (_match, attrs: string) => {
        const clean = attrs.replace(/\s+w:(?:firstLine|firstLineChars|hanging|hangingChars)="[^"]*"/g, '');
        return `<w:ind${clean} w:firstLine="0" w:firstLineChars="0"/>`;
      });
    if (!/<w:ind\b/.test(properties)) properties = properties.replace('</w:pPr>', indent + '</w:pPr>');
    properties = properties.replace('</w:pPr>', justify + '</w:pPr>');
    return paragraph.replace(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/, properties);
  });
}

export function writeReportContent(xml: string, styles: string, content: ReportContent): string {
  const tables = content.tables || [];
  const seen = new Set<string>();
  let caption = '';
  // Table matching is restricted to captions immediately preceding existing tables.
  xml = xml.replace(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, block => {
    if (!block.startsWith('<w:tbl')) { const t = text(block).trim(); if (t) caption = t; return block; }
    const patch = tables.find(t => {
      if (norm(caption) === norm(t.caption)) return true;
      // 当前报告模板在表6-1前使用说明段落（“……具体见表6-1”），而不是独立表题。
      // 同时校验表号和固定表头，避免说明文字中的“风险分析”误匹配其他表格。
      if (norm(t.caption) !== '风险分析' || !/表\s*6\s*[-—－.]?\s*1/.test(caption)) return false;
      const header = text(block).replace(/\s/g, '');
      return ['序号', '安全层面', '问题描述', '关联威胁', '风险分析', '风险等级']
        .every(label => header.includes(label));
    });
    caption = '';
    if (!patch) return block;
    if (seen.has(patch.caption)) throw new Error('模板中存在重复表名，无法安全写入：' + patch.caption);
    seen.add(patch.caption);
    const rows = [...block.matchAll(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g)];
    if (patch.groups) {
      const textOfCell = (cell: string) => text(cell).trim();
      const cellsOfRow = (row: string) => [...row.matchAll(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g)].map(m => m[0]);
      const samples = new Map<string, string>();
      for (const row of rows.slice(patch.skip)) {
        const unit = textOfCell(cellsOfRow(row[0])[0] || '');
        if (unit && !samples.has(norm(unit))) samples.set(norm(unit), row[0]);
      }
      if (samples.size !== patch.groups.length || patch.groups.some(group => !samples.has(norm(group.unit)))) {
        throw new Error('模板测评单元与系统数据不一致，请核对：' + patch.caption);
      }
      const fillGroupedRow = (sample: string, values: (string | null)[], rowIndex: number, groupSize: number) => {
        let column = 0;
        const lastColumn = values.length - 1;
        return sample.replace(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g, cell => {
          const index = column;
          column += Number(/<w:gridSpan\b[^>]*w:val="(\d+)"/.exec(cell)?.[1] || 1);
          cell = cell.replace(/<w:vMerge\b[^>]*\/>|<w:vMerge\b[^>]*>[\s\S]*?<\/w:vMerge>/g, '');
          if (groupSize > 1 && (index === 0 || index === lastColumn)) {
            const merge = `<w:vMerge w:val="${rowIndex === 0 ? 'restart' : 'continue'}"/>`;
            cell = /<w:tcPr\b[^>]*>/.test(cell)
              ? cell.replace(/<w:tcPr\b[^>]*>/, match => match + merge)
              : cell.replace(/<w:tc\b[^>]*>/, match => match + '<w:tcPr>' + merge + '</w:tcPr>');
          }
          const value = rowIndex > 0 && (index === 0 || index === lastColumn) ? '' : (values[index] ?? '');
          return writeText(cell, value);
        });
      };
      const dataRows = patch.groups.map(group => {
        const sample = samples.get(norm(group.unit))!
          .replace(/ w14:(?:paraId|textId)="[^"]*"/g, '');
        const templateColumns = cellsOfRow(sample).length;
        if (!group.rows.length || group.rows.some(values => values.length !== templateColumns)) {
          throw new Error('测评结果记录的列数与模板不一致：' + patch.caption + '／' + group.unit);
        }
        return group.rows.map((values, index) => fillGroupedRow(sample, values, index, group.rows.length)).join('');
      }).join('');
      const first = rows[patch.skip];
      const last = rows[rows.length - 1];
      if (!first || !last) throw new Error('模板缺少测评单元样板行：' + patch.caption);
      return block.slice(0, first.index!) + dataRows + block.slice(last.index! + last[0].length);
    }
    const repeatable = patch.repeat === true || (repeatableAssetTables.has(norm(patch.caption)) && patch.skip === 1);
    const footerRows = patch.footerRows || [];
    if (repeatable && rows.length <= patch.skip + footerRows.length) throw new Error('模板缺少可复制的数据行，请核对：' + patch.caption);
    if (!repeatable && rows.length - patch.skip !== patch.rows.length) throw new Error('模板行数与系统数据不一致，请核对：' + patch.caption);
    if (norm(patch.caption) === '风险分析') {
      const columns = (row: string) => {
        let offset = 0;
        return [...row.matchAll(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g)].map(match => {
          const start = offset;
          offset += Number(/<w:gridSpan\b[^>]*w:val="(\d+)"/.exec(match[0])?.[1] || 1);
          return start;
        });
      };
      const dataColumns = columns(rows[patch.skip][0]);
      if (dataColumns.join(',') !== '0,1,2,3,4,5,6,7') {
        throw new Error('表6-1示例数据行必须保留八个独立单元格：序号、安全层面、问题描述、关联威胁、风险分析、高、中、低');
      }
      if (footerRows.length !== 1 || columns(rows[rows.length - 1][0]).slice(-3).join(',') !== '5,6,7') {
        throw new Error('表6-1统计行的高、中、低必须分别位于最后三列');
      }
    }
    const merged: Record<number, string> = {};
    const fillRow = (row: string, values: (string | null)[]) => {
      let col = 0;
      return row.replace(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g, cell => {
        const span = Number(/<w:gridSpan\b[^>]*w:val="(\d+)"/.exec(cell)?.[1] || 1);
        const index = col; col += span;
        const value = values[index];
        if (value === null || value === undefined) return cell;
        const merge = /<w:vMerge\b([^>]*)/.exec(cell);
        if (merge && !/w:val="restart"/.test(merge[1])) {
          if (merged[index] !== value) throw new Error('合并单元格中的多条结果不一致，不能无损导出：' + patch.caption);
          return cell;
        }
        merged[index] = value;
        const isRiskNarrative = norm(patch.caption) === '风险分析' && (index === 2 || index === 4);
        const written = writeText(cell, isRiskNarrative ? value.replace(/^[\s\u3000]+/, '') : value);
        return isRiskNarrative ? formatRiskNarrativeCell(written) : written;
      });
    };
    if (repeatable) {
      const first = rows[patch.skip];
      const last = rows[rows.length - 1];
      const start = first.index!;
      const end = last.index! + last[0].length;
      // Repeated data rows must not inherit vertical merges or duplicate paragraph IDs.
      const sample = first[0]
        .replace(/<w:vMerge\b[^>]*\/>|<w:vMerge\b[^>]*>[\s\S]*?<\/w:vMerge>/g, '')
        .replace(/<w:tblHeader\b[^>]*\/>|<w:tblHeader\b[^>]*>[\s\S]*?<\/w:tblHeader>/g, '')
        .replace(/\s+w:firstRow="1"/g, ' w:firstRow="0"')
        .replace(/ w14:(?:paraId|textId)="[^"]*"/g, '');
      const dataRows = patch.rows.map(values => fillRow(sample, values)).join('');
      const filledFooter = footerRows.map((values, index) => fillRow(rows[rows.length - footerRows.length + index][0], values)).join('');
      return block.slice(0, start) + dataRows + filledFooter + block.slice(end);
    }
    let rowIndex = -1;
    return block.replace(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g, row => {
      rowIndex++;
      return rowIndex < patch.skip ? row : fillRow(row, patch.rows[rowIndex - patch.skip]);
    });
  });
  for (const patch of tables) {
    if (patch.required && !seen.has(patch.caption)) throw new Error('模板中未找到需要写入的表格：' + patch.caption);
  }
  // Missing fields are intentionally not appended to the template.
  const levels: Record<string, number> = {};
  for (const m of styles.matchAll(/<w:style\b[^>]*>[\s\S]*?<\/w:style>/g)) {
    const id = /w:styleId="([^"]+)"/.exec(m[0])?.[1];
    const level = /<w:outlineLvl\b[^>]*w:val="(\d+)"/.exec(m[0])?.[1];
    if (id && level !== undefined) levels[id] = Number(level) + 1;
  }
  let active: { text: string; level: number; written: boolean } | null = null;
  xml = xml.replace(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, block => {
    if (block.startsWith('<w:tbl')) return block;
    const style = /<w:pStyle\b[^>]*w:val="([^"]+)"/.exec(block)?.[1] || '';
    const level = levels[style] || 0;
    const t = text(block).trim();
    if (active && level && level <= active.level) active = null;
    const section = level ? content.sections.find(s => s.heading === t) : null;
    if (section) { active = { text: section.text, level, written: false }; return block; }
    if (!active || level || !t || /\{\{[^{}]+\}\}/.test(t) || /<w:(drawing|pict)\b/.test(block) || /^图\s*\d/.test(t)) return block;
    const updated = writeText(block, active.written ? '' : active.text);
    active.written = true;
    return updated;
  });
  return xml;
}

