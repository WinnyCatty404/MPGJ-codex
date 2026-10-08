import JSZip from 'jszip';

export type UserImportRow = {
  username: string;
  displayName: string;
  role: 'admin' | 'manager' | 'evaluator' | 'reviewer';
  certificateDate: string | null;
  rowNumber: number;
};

const HEADERS = ['用户名（必填）', '姓名（必填）', '系统角色（必填）', '密评考试通过时间（选填）'];
const ROLE_LABELS: Record<string, UserImportRow['role']> = {
  系统管理员: 'admin',
  项目负责人: 'manager',
  测评人员: 'evaluator',
  审核人员: 'reviewer',
  admin: 'admin',
  manager: 'manager',
  evaluator: 'evaluator',
  reviewer: 'reviewer',
};
const ROLE_NAMES = '系统管理员、项目负责人、测评人员、审核人员';

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

function normalizeDate(value: string, rowNumber: number) {
  const source = value.trim();
  if (!source) return null;
  if (/^\d+(?:\.\d+)?$/.test(source)) {
    const serial = Number(source);
    if (serial >= 1 && serial <= 100000) {
      const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
      return date.toISOString().slice(0, 10);
    }
  }
  const matched = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(source);
  if (!matched) throw new Error(`第 ${rowNumber} 行密评考试通过时间格式不正确，请填写 YYYY-MM-DD`);
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`第 ${rowNumber} 行密评考试通过时间不是有效日期`);
  }
  return `${matched[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export async function parseUserImportWorkbook(buffer: Buffer): Promise<UserImportRow[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new Error('文件不是有效的 .xlsx Excel 工作簿');
  }
  const sharedXml = await zip.file('xl/sharedStrings.xml')?.async('string');
  const sharedStrings = sharedXml
    ? [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(match =>
        decodeXml([...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(item => item[1]).join('')),
      )
    : [];
  const sheet = zip.file('xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('Excel 中未找到“用户导入”工作表');
  const xml = await sheet.async('string');
  const rows = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(rowMatch => {
    const values: string[] = [];
    for (const cell of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const reference = /\br="([A-Z]+\d+)"/.exec(cell[1])?.[1] || '';
      const type = /\bt="([^"]+)"/.exec(cell[1])?.[1] || '';
      const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cell[2])?.[1]
        ?? /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(cell[2])?.[1]
        ?? '';
      values[columnIndex(reference)] = (type === 's' ? (sharedStrings[Number(raw)] || '') : decodeXml(raw)).trim();
    }
    return values;
  });
  if (!rows.length || HEADERS.some((header, index) => rows[0]?.[index] !== header)) {
    throw new Error('Excel 表头不正确，请下载并使用最新的用户批量导入模板');
  }
  if (rows.length > 501) throw new Error('单次最多导入 500 名用户');
  const seen = new Set<string>();
  const result = rows.slice(1).flatMap((row, index) => {
    const rowNumber = index + 2;
    const [username, displayName, roleValue, certificateDateValue] = Array.from(
      { length: 4 }, (_, column) => String(row[column] || '').trim(),
    );
    if (!username && !displayName && !roleValue && !certificateDateValue) return [];
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
      throw new Error(`第 ${rowNumber} 行用户名应为 3-20 位英文、数字或下划线`);
    }
    if (displayName.length < 2 || displayName.length > 80) throw new Error(`第 ${rowNumber} 行姓名应为 2-80 个字符`);
    const role = ROLE_LABELS[roleValue];
    if (!role) throw new Error(`第 ${rowNumber} 行系统角色无效，应为：${ROLE_NAMES}`);
    const normalizedUsername = username.toLowerCase();
    if (seen.has(normalizedUsername)) throw new Error(`第 ${rowNumber} 行用户名在文件中重复：${username}`);
    seen.add(normalizedUsername);
    return [{ username, displayName, role, certificateDate: normalizeDate(certificateDateValue, rowNumber), rowNumber }];
  });
  if (!result.length) throw new Error('模板中没有可导入的用户数据');
  return result;
}

export async function buildUserImportWorkbook(rows: UserImportRow[] = []) {
  const zip = new JSZip();
  const roleNames: Record<UserImportRow['role'], string> = {
    admin: '系统管理员', manager: '项目负责人', evaluator: '测评人员', reviewer: '审核人员',
  };
  const allRows = [HEADERS, ...rows.map(row => [row.username, row.displayName, roleNames[row.role], row.certificateDate || ''])];
  const sheetRows = allRows.map((row, rowIndex) => {
    const cells = row.map((value, column) => {
      const ref = String.fromCharCode(65 + column) + (rowIndex + 1);
      return `<c r="${ref}" t="inlineStr" s="${rowIndex === 0 ? 1 : 0}"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="26" customHeight="1"' : ''}>${cells}</row>`;
  }).join('');
  const rowCount = Math.max(2, allRows.length);
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="用户导入" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="等线"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="等线"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2456A6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs></styleSheet>');
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:D${rowCount}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="24" customWidth="1"/><col min="2" max="2" width="20" customWidth="1"/><col min="3" max="3" width="24" customWidth="1"/><col min="4" max="4" width="30" customWidth="1"/></cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:D${rowCount}"/><dataValidations count="1"><dataValidation type="list" allowBlank="0" showErrorMessage="1" errorTitle="角色不正确" error="请从下拉列表中选择系统角色" sqref="C2:C501"><formula1>&quot;系统管理员,项目负责人,测评人员,审核人员&quot;</formula1></dataValidation></dataValidations></worksheet>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
