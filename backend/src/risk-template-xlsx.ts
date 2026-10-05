import JSZip from 'jszip';

export type RiskTemplateRow = {
  id: string;
  layer: string;
  unit: string;
  result: string;
  threat: string;
  analysis: string;
  advice: string;
  defaultLevel: '高' | '中' | '低';
  version: number;
  enabled: boolean;
};

const HEADERS = ['安全层面', '测评单元', '威胁', '风险等级', '风险分析', '整改建议'];

function decodeXml(value: string) {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function escapeXml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function columnIndex(reference: string) {
  const letters = String(reference || '').replace(/[^A-Z]/g, '');
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return Math.max(0, result - 1);
}

function slug(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export async function parseRiskTemplateWorkbook(buffer: Buffer): Promise<RiskTemplateRow[]> {
  const zip = await JSZip.loadAsync(buffer);
  const sharedXml = await zip.file('xl/sharedStrings.xml')?.async('string');
  const sharedStrings = sharedXml
    ? [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(match =>
        decodeXml([...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(item => item[1]).join('')),
      )
    : [];
  const sheet = zip.file('xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('Excel 中未找到第一个工作表');
  const xml = await sheet.async('string');
  const rows = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(rowMatch => {
    const values: string[] = [];
    for (const cell of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const reference = /\br="([A-Z]+\d+)"/.exec(cell[1])?.[1] || '';
      const type = /\bt="([^"]+)"/.exec(cell[1])?.[1] || '';
      const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cell[2])?.[1]
        ?? /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(cell[2])?.[1]
        ?? '';
      const value = type === 's' ? (sharedStrings[Number(raw)] || '') : decodeXml(raw);
      values[columnIndex(reference)] = value.trim();
    }
    return values;
  });
  if (!rows.length || HEADERS.some((header, index) => rows[0]?.[index] !== header)) {
    throw new Error('Excel 表头不正确，应为：' + HEADERS.join('、'));
  }
  const seen = new Set<string>();
  return rows.slice(1).flatMap((row, index) => {
    const [layer, unit, threat, level, analysis, advice] = Array.from({ length: 6 }, (_, column) => String(row[column] || '').trim());
    if (!layer && !unit) return [];
    if (!layer || !unit) throw new Error(`第 ${index + 2} 行缺少安全层面或测评单元`);
    const key = `${layer}|${unit}`;
    if (seen.has(key)) throw new Error(`第 ${index + 2} 行测评单元重复：${layer} / ${unit}`);
    seen.add(key);
    if (!['高', '中', '低'].includes(level)) throw new Error(`第 ${index + 2} 行风险等级应为高、中或低`);
    return [{
      id: `risk-unit-${slug(key)}`, layer, unit, result: '*', threat,
      analysis, advice, defaultLevel: level as '高' | '中' | '低', version: 1, enabled: true,
    }];
  });
}

export async function buildRiskTemplateWorkbook(rows: RiskTemplateRow[]) {
  const zip = new JSZip();
  const allRows = [HEADERS, ...rows.map(row => [row.layer, row.unit, row.threat, row.defaultLevel, row.analysis, row.advice])];
  const sheetRows = allRows.map((row, rowIndex) => {
    const cells = row.map((value, column) => {
      const ref = String.fromCharCode(65 + column) + (rowIndex + 1);
      return `<c r="${ref}" t="inlineStr" s="${rowIndex === 0 ? 1 : 0}"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="24" customHeight="1"' : ''}>${cells}</row>`;
  }).join('');
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="风险模板" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="等线"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="等线"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2456A6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs></styleSheet>');
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:F${allRows.length}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="18" customWidth="1"/><col min="2" max="2" width="38" customWidth="1"/><col min="3" max="3" width="12" customWidth="1"/><col min="4" max="4" width="12" customWidth="1"/><col min="5" max="6" width="60" customWidth="1"/></cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:F${allRows.length}"/></worksheet>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
