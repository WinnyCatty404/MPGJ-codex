import JSZip from 'jszip';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { replaceReportSlots } from './report-template.js';
import { appendRawRecordEvidence } from './report-evidence.js';

type JsonRecord = Record<string, any>;
type GeneratedFile = { path: string; data: Buffer };

export type RawRecordSource = {
  project: JsonRecord;
  stages: JsonRecord[];
  institution: JsonRecord;
};

function decodeXml(value: string) {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function textOf(xml: string) {
  return [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(match => decodeXml(match[1])).join('');
}

function replaceAllSlots(xml: string, replacements: Record<string, string>) {
  for (const [slot, value] of Object.entries(replacements)) {
    // report-template 的替换器负责保留跨 run 占位符的样式；重复调用用于处理同一段落中的重复槽位。
    while (textOf(xml).includes(slot)) {
      const next = replaceReportSlots(xml, { [slot]: value });
      if (next === xml) break;
      xml = next;
    }
  }
  return xml;
}

function safeName(value: unknown) {
  return String(value || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || '未编号';
}

function fieldMap(stage: JsonRecord) {
  return Object.fromEntries((stage?.fields || []).filter((field: JsonRecord) => field?.id)
    .map((field: JsonRecord) => [field.id, field.type === 'checkbox' || field.type === 'radio' ? (field.checked ? '是' : '') : String(field.value || '')]));
}

function cnDate(value: unknown) {
  const format = (year: number, month: number, day: number) =>
    `${String(year).padStart(4, '0')}年${String(month).padStart(2, '0')}月${String(day).padStart(2, '0')}日`;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return format(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  const text = String(value || '').trim();
  if (!text) return '';
  const match = /^(\d{4})(?:[-/年])(\d{1,2})(?:[-/月])(\d{1,2})日?/.exec(text);
  if (match) return format(Number(match[1]), Number(match[2]), Number(match[3]));
  // PostgreSQL 的 date 字段在部分运行环境中会成为 Date 对象；序列化后形如
  // "Mon Aug 31 2026 00:00:00 GMT+0800 (...)"，统一转回中文年月日。
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime())
    ? text
    : format(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
}

function dateRange(start: unknown, end: unknown) {
  const first = cnDate(start), last = cnDate(end);
  return first && last ? `${first}至${last}` : first || last;
}

function nonEmpty(values: unknown[]) {
  return values.map(value => String(value || '').trim()).filter(Boolean);
}

function normalizeBasicInfoLine(value: unknown) {
  return String(value || '').replace(/\r/g, '').replace(/[ \t\u3000]+/g, ' ').trim();
}

function splitGradingRecord(gradedValue: unknown, ungradedValue: unknown) {
  const graded = normalizeBasicInfoLine(gradedValue);
  const ungraded = normalizeBasicInfoLine(ungradedValue);
  const serialMatch = /备案证明编号\s*[：:]\s*([^\n，。；;]+)/.exec(graded);
  const agreementMatch = /本次被测信息系统与等级保护定级系统是否一致\s*[：:]\s*([\s\S]*)/.exec(graded);
  const grading = graded
    .replace(/备案证明编号\s*[：:][\s\S]*$/, '')
    .replace(/本次被测信息系统与等级保护定级系统是否一致\s*[：:][\s\S]*$/, '')
    .trim();
  const ungradedLine = ungraded && !/^[□☐]?\s*未定级\s*$/.test(ungraded) ? ungraded : ungraded;
  return {
    grading: nonEmpty([grading, ungradedLine]).join('\n'),
    serial: `备案证明编号：${serialMatch?.[1]?.trim() || ''}`,
    agreement: agreementMatch?.[1]?.trim() || '☑是　□否，变化情况说明：',
  };
}

function assetNames(assets: JsonRecord, types: string[]) {
  return types.flatMap(type => (assets?.[type] || []).map((row: JsonRecord[]) => String(row?.[0]?.value || '').trim()).filter(Boolean));
}

function buildContext(source: RawRecordSource) {
  const stages = Object.fromEntries(source.stages.map(stage => [stage.stage_key, stage.data || {}]));
  const planning = stages.planning || {};
  const reporting = stages.reporting || {};
  const values = reporting.templateValues || {};
  const fields = fieldMap(planning);
  const project = source.project;
  const institution = source.institution || {};
  const projectNo = project.report_code || project.code;
  const planMembers = Array.isArray(planning.planMembers) ? planning.planMembers : [];
  const selectedMembers = planMembers.filter((member: JsonRecord) => String(member?.name || '').trim());
  const leaderRow = selectedMembers.find((member: JsonRecord) => /负责人/.test(String(member.role || '')));
  const leader = String(leaderRow?.name || fields['plan-member-1-name'] || values['项目负责人'] || project.owner_name || '');
  const memberNames = nonEmpty([
    ...selectedMembers.filter((member: JsonRecord) => member !== leaderRow).map((member: JsonRecord) => member.name),
    fields['plan-member-2-name'],
    ...(String(values['测评人员'] || '').split(/[、,，;；\s]+/)),
  ]).filter((name, index, all) => name !== leader && all.indexOf(name) === index);
  const member1 = memberNames[0] || '';
  const member2 = memberNames[1] || '';
  const phase1Start = fields['plan-phase-1-start'] || project.start_date;
  const phase1End = fields['plan-phase-1-end'] || phase1Start;
  const phase2Start = fields['plan-phase-2-start'] || phase1End;
  const phase2End = fields['plan-phase-2-end'] || phase2Start;
  const phase3Start = fields['plan-phase-3-start'] || phase2End;
  const phase3End = fields['plan-phase-3-end'] || phase3Start;
  const phase4Start = fields['plan-phase-4-start'] || phase3End;
  const phase4End = fields['plan-phase-4-end'] || project.end_date || phase4Start;
  const level = Number(project.system_level || planning.assessmentLevel || 3);
  const levelCn = ['', '一', '二', '三', '四'][level] || String(level);
  const assets = planning.assets || {};
  const deviceNames = assetNames(assets, ['crypto', 'server', 'network', 'db', 'app']);
  const tools = (planning.toolData || []).filter((tool: JsonRecord) => tool?.name || tool?.version);
  const riskTable = (reporting.exportContent?.tables || []).find((table: JsonRecord) => String(table.caption || '').includes('风险分析'));
  const risks = (riskTable?.rows || []).map((row: unknown[]) => ({
    number: String(row?.[0] || ''), classify: String(row?.[1] || ''), prob_discrpt: String(row?.[2] || ''), note: '-',
  })).filter((item: JsonRecord) => item.prob_discrpt);
  if (!risks.length) {
    (project.risks || []).forEach((risk: JsonRecord, index: number) => risks.push({
      number: String(index + 1), classify: risk.domain || '', prob_discrpt: risk.issue_description || '', note: '-',
    }));
  }
  const appendix = reporting.appendixBData || {};
  const reviewer = appendix['b7-reviewer'] || '';
  const approver = appendix['b7-approver'] || '';
  const gradingRecord = splitGradingRecord(values['等保已定级备案情况'], values['等保未定级情况']);
  const context: JsonRecord = {
    project_no: projectNo,
    project_name: project.system_name,
    c_name: values['被测单位名称'] || values['被测单位'] || project.org_name,
    c_addr: values['被测单位地址'] || fields['prep-address'] || '',
    c_pcode: values['邮政编码'] || fields['prep-zipcode'] || '',
    c_contract_name: values['被测单位联系人姓名'] || fields['prep-contact-name'] || '',
    c_contract_title: values['被测单位联系人职务/职称'] || fields['prep-contact-title'] || '',
    c_contract_department: values['被测单位联系人所属部门'] || fields['prep-contact-dept'] || '',
    c_contract_tel: values['被测单位联系人办公电话'] || fields['prep-contact-tel'] || '',
    c_contract_mobile: values['被测单位联系人移动电话'] || fields['prep-contact-mobile'] || '',
    c_contract_mail: values['被测单位联系人电子邮件'] || fields['prep-contact-email'] || '',
    s_name: institution.name || '', s_addr: institution.address || '', s_pcode: institution.postalCode || '',
    s_contract_name: institution.contact || '', s_contract_mobile: institution.mobile || '', s_contract_tel: institution.telephone || '',
    sys_djbh: gradingRecord.grading, djbh_serials: gradingRecord.serial,
    sys_level: gradingRecord.agreement, sys_level1: `S${level}A${level}G${level}`, sys_level2: `第${levelCn}级`,
    sys_introduce: values['系统及测评情况简介-系统简介'] || '', project_mplevel: `第${levelCn}级`,
    sys_cryptographic_product: values['系统使用密码产品情况'] || '',
    sys_cryptographic_algorithm: values['系统使用的密码算法情况'] || values['系统使用密码算法情况'] || '',
    evaluate_group_leader: leader, evaluate_member1: member1, evaluate_member2: member2,
    evaluate_group_leader_work: String(leaderRow?.task || fields['plan-member-1-task'] || ''),
    evaluate_member1_work: String(selectedMembers.find((member: JsonRecord) => member !== leaderRow)?.task || fields['plan-member-2-task'] || ''),
    evaluate_member2_work: String(selectedMembers.filter((member: JsonRecord) => member !== leaderRow)[1]?.task || ''),
    evaluate_tech_member: nonEmpty([leader, member1]).join('、'), evaluate_mana_member: member2 || member1,
    project_quality_supervisor: institution.contact || '',
    project_starttime: cnDate(project.start_date || phase1Start), project_endtime: cnDate(project.end_date || phase4End),
    evaluate_plan_date: cnDate(phase2End), evaluate_plan_approve_date: cnDate(phase1End),
    evaluate_note_date: cnDate(phase3Start), evaluate_feedback_date: cnDate(phase3End),
    // 风险告知书现有模板把双方“日期”位置沿用了旧工具的签名图片槽名。
    // 兼容该占位符，统一写入现场测评阶段开始时间，便于管理员仅调整模板样式。
    evaluate_client_sign_pic: cnDate(phase3Start), evaluate_server_sign_pic: cnDate(phase3Start),
    evaluate_do_start_date: cnDate(phase3Start), evaluate_do_end_date: cnDate(phase3End),
    evaluate_starttime: cnDate(phase3Start), evaluate_endtime: cnDate(phase3End),
    evaluate_report_date: cnDate(phase4End), evaluate_reviewer_date: cnDate(phase4End),
    evaluate_dcb_date: cnDate(phase1End), evaluate_archieve_date: cnDate(phase4End),
    evaluate_pre_dates: dateRange(phase1Start, phase1End), evaluate_pre_date1: cnDate(phase1Start), evaluate_pre_date2: cnDate(phase1End),
    evaluate_plan_dates: dateRange(phase2Start, phase2End), evaluate_plan_dates1: cnDate(phase2End),
    evaluate_do_dates: dateRange(phase3Start, phase3End), evaluate_report_dates: dateRange(phase4Start, phase4End),
    evaluate_report_date1: cnDate(phase4Start), evaluate_report_date2: cnDate(phase4End),
    evaluate_cost_dates: dateRange(phase1Start, phase4End), evaluate_cost_datese: dateRange(phase1Start, phase4End),
    evaluate_do_date1: cnDate(phase3Start), evaluate_do_date2: dateRange(phase3Start, phase3End),
    evaluate_do_date3: dateRange(phase3Start, phase3End), evaluate_do_date4: dateRange(phase3Start, phase3End),
    evaluate_do_date5: dateRange(phase3Start, phase3End), evaluate_do_date6: dateRange(phase3Start, phase3End),
    evaluate_do_date7: cnDate(phase3End), evaluate_do_date8: cnDate(phase3End),
    evaluate_plan_approve_leader: reviewer, evaluate_plan_approve_member1: reviewer,
    evaluate_plan_approve_member2: leader, evaluate_plan_approve_member3: '',
    evaluate_reviewer_leader: approver, evaluate_reviewer_member1: reviewer,
    // 兼容尚未更新占位符的旧模板；新版模板直接复用 evaluate_plan_approve_member2。
    evaluate_reviewer_member2: leader, evaluate_reviewer_member3: '',
    devicelist: deviceNames.map((name, index) => ({ number: String(index + 1), name, note: '-' })),
    toollist: tools.map((tool: JsonRecord, index: number) => ({ number: String(index + 1), name: tool.name || '', version: tool.version || '', note: '-' })),
    problist: risks,
    docslist: (assets.doc || []).map((row: JsonRecord[], index: number) => ({
      project_no: projectNo,
      number: String(index + 1).padStart(3, '0'),
      name: String(row?.[0]?.value || '').trim(),
      note: String(row?.[1]?.value || '-').trim() || '-',
    })).filter((item: JsonRecord) => item.name),
  };
  const pictureDates: JsonRecord = {
    evaluate_plan_date_pic: context.evaluate_plan_date,
    evaluate_impelement_start_date_pic: context.evaluate_do_start_date,
    evaluate_impelement_end_date_pic: context.evaluate_do_end_date,
    evaluate_wlhj_start_date_pic: context.evaluate_do_start_date, evaluate_wlhj_end_date_pic: context.evaluate_do_end_date,
    evaluate_wltx_start_date_pic: context.evaluate_do_start_date, evaluate_wltx_end_date_pic: context.evaluate_do_end_date,
    evaluate_sbjs_start_date_pic: context.evaluate_do_start_date, evaluate_sbjs_end_date_pic: context.evaluate_do_end_date,
    evaluate_yysj_start_date_pic: context.evaluate_do_start_date, evaluate_yysj_end_date_pic: context.evaluate_do_end_date,
    evaluate_glzd_start_date_pic: context.evaluate_do_start_date, evaluate_glzd_end_date_pic: context.evaluate_do_end_date,
    evaluate_rygl_start_date_pic: context.evaluate_do_start_date, evaluate_rygl_end_date_pic: context.evaluate_do_end_date,
    evaluate_jsyx_start_date_pic: context.evaluate_do_start_date, evaluate_jsyx_end_date_pic: context.evaluate_do_end_date,
    evaluate_yjcz_start_date_pic: context.evaluate_do_start_date, evaluate_yjcz_end_date_pic: context.evaluate_do_end_date,
  };
  Object.assign(context, pictureDates);
  for (const name of ['evaluate_editor_sign_pic', 'evaluate_approver_sign_pic', 'evaluate_client2_sign_pic',
    'evaluate_wlhj_member_sign_pic', 'evaluate_wltx_member_sign_pic', 'evaluate_sbjs_member_sign_pic',
    'evaluate_yysj_member_sign_pic', 'evaluate_glzd_member_sign_pic', 'evaluate_rygl_member_sign_pic', 'evaluate_jsyx_member_sign_pic', 'evaluate_yjcz_member_sign_pic']) context[name] = '';
  return context;
}

function expandTableLoops(xml: string, context: JsonRecord) {
  let changed = true;
  while (changed) {
    changed = false;
    const rows = [...xml.matchAll(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g)];
    for (let startIndex = 0; startIndex < rows.length; startIndex++) {
      const control = /\{%\s*tr\s+for\s+item\s+in\s+([\w]+)\s*%\}/.exec(textOf(rows[startIndex][0]));
      if (!control) continue;
      const endIndex = rows.findIndex((row, index) => index > startIndex && /\{%\s*tr\s+endfor\s*%\}/.test(textOf(row[0])));
      if (endIndex < 0) continue;
      const templates = rows.slice(startIndex + 1, endIndex).map(row => row[0]).join('');
      const rendered = (Array.isArray(context[control[1]]) ? context[control[1]] : []).map((item: JsonRecord) => {
        const replacements = Object.fromEntries(Object.entries(item).map(([key, value]) => [`{{item.${key}}}`, String(value ?? '')]));
        return replaceAllSlots(templates, replacements);
      }).join('');
      const begin = rows[startIndex].index!;
      const finish = rows[endIndex].index! + rows[endIndex][0].length;
      xml = xml.slice(0, begin) + rendered + xml.slice(finish);
      changed = true;
      break;
    }
  }
  return xml;
}

function directXmlValue(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    .replace(/\r?\n/g, '</w:t><w:br/><w:t xml:space="preserve">');
}

async function renderDocx(buffer: Buffer, context: JsonRecord) {
  const zip = await JSZip.loadAsync(buffer);
  const replacements = Object.fromEntries(Object.entries(context).filter(([, value]) => !Array.isArray(value) && typeof value !== 'object')
    .map(([key, value]) => [`{{${key}}}`, String(value ?? '')]));
  for (const name of Object.keys(zip.files).filter(name => name.endsWith('.xml'))) {
    const file = zip.file(name);
    if (!file) continue;
    let xml = await file.async('string');
    if (name === 'word/document.xml') xml = expandTableLoops(xml, context);
    // 同一段落中常有多个长度不同的占位符。逐个替换可在每次操作后重新计算 run 偏移，
    // 避免批量替换时前一个值改变长度导致后续占位符错位。
    xml = replaceAllSlots(xml, replacements);
    // 文本框等结构可能形成嵌套段落，通用段落替换器无法命中其中仍保持单节点的槽位。
    // 对连续 XML 槽位做一次兜底替换，避免模板标记泄露到导出文件。
    for (const [slot, value] of Object.entries(replacements)) xml = xml.split(slot).join(directXmlValue(value));
    // 管理员上传的自定义模板可能包含系统尚未提供的字段。未知字段不应原样泄露到成品中。
    const unknown = new Set<string>();
    for (const paragraph of xml.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) || []) {
      for (const match of textOf(paragraph).matchAll(/\{\{([^{}]+)\}\}/g)) unknown.add(match[0]);
    }
    if (unknown.size) xml = replaceAllSlots(xml, Object.fromEntries([...unknown].map(slot => [slot, ''])));
    xml = xml.replace(/\{\{[^{}]+\}\}/g, '');
    zip.file(name, xml);
  }
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

async function normalizeBasicInfoFonts(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const fonts = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="宋体"/>';
  for (const name of Object.keys(zip.files).filter(name => /^word\/(document|styles|header\d*|footer\d*)\.xml$/.test(name))) {
    const file = zip.file(name);
    if (!file) continue;
    let xml = await file.async('string');
    xml = xml.replace(/<w:rFonts\b[^>]*\/>/g, fonts);
    xml = xml.replace(/<w:rPr\s*\/>/g, `<w:rPr>${fonts}</w:rPr>`);
    xml = xml.replace(/<w:rPr\b([^>]*)>([\s\S]*?)<\/w:rPr>/g, (whole, attrs, content) =>
      /<w:rFonts\b/.test(content) ? whole : `<w:rPr${attrs}>${fonts}${content}</w:rPr>`);
    xml = xml.replace(/<w:r\b([^>]*)>(?!\s*<w:rPr\b)/g, `<w:r$1><w:rPr>${fonts}</w:rPr>`);
    zip.file(name, xml);
  }
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

function escapeXml(value: unknown) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function recordTextXml(value: unknown, bold = false) {
  const content = escapeXml(value).replace(/\r?\n/g, '</w:t><w:br/><w:t xml:space="preserve">');
  return `<w:p><w:pPr><w:spacing w:after="0" w:line="360" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体"/>${bold ? '<w:b/>' : ''}<w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">${content}</w:t></w:r></w:p>`;
}

function recordCellXml(value: unknown, width: number, header = false) {
  const shade = header ? '<w:shd w:val="clear" w:color="auto" w:fill="D9EAF7"/>' : '';
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shade}<w:tcMar><w:top w:w="80" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tcMar><w:vAlign w:val="center"/></w:tcPr>${recordTextXml(value, header)}</w:tc>`;
}

function onsiteRecordTableXml(table: JsonRecord | undefined, layerIndex: number) {
  const technical = layerIndex < 4;
  const headers = technical
    ? ['测评单元', '测评对象', '现场测评记录', 'D', 'A', 'K', '测评对象得分', '测评单元得分']
    : ['测评单元', '测评对象', '现场测评记录', '测评结果', '测评单元得分'];
  const widths = technical ? [1300, 1500, 4300, 650, 650, 650, 1150, 1150] : [1600, 1800, 5400, 1300, 1300];
  const rows = (table?.groups || []).flatMap((group: JsonRecord) => group.rows || []);
  const border = '<w:top w:val="single" w:sz="4" w:color="808080"/><w:left w:val="single" w:sz="4" w:color="808080"/><w:bottom w:val="single" w:sz="4" w:color="808080"/><w:right w:val="single" w:sz="4" w:color="808080"/><w:insideH w:val="single" w:sz="4" w:color="B7B7B7"/><w:insideV w:val="single" w:sz="4" w:color="B7B7B7"/>';
  const grid = widths.map(width => `<w:gridCol w:w="${width}"/>`).join('');
  const rowXml = (values: unknown[], header = false) => `<w:tr>${headers.map((_, index) => recordCellXml(values[index] ?? '', widths[index], header)).join('')}</w:tr>`;
  const data = rows.length ? rows.map((row: unknown[]) => rowXml(row)).join('') : rowXml(['', '', '暂无现场测评记录']);
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${border}</w:tblBorders><w:tblLayout w:type="autofit"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rowXml(headers, true)}${data}</w:tbl>`;
}

async function appendOnsiteRecords(buffer: Buffer, table: JsonRecord | undefined, layerIndex: number,
  records: Record<string, any>, evidenceGroups: JsonRecord[]) {
  const zip = await JSZip.loadAsync(buffer);
  const document = zip.file('word/document.xml');
  if (!document) return buffer;
  let xml = await document.async('string');
  // 模板已经带有 A.1～A.8 层面标题。表格直接跟在标题后，不再额外插入分页符或重复标题。
  const content = onsiteRecordTableXml(table, layerIndex);
  const bodyEnd = xml.lastIndexOf('</w:body>');
  const finalSection = xml.lastIndexOf('<w:sectPr', bodyEnd);
  if (bodyEnd < 0 || finalSection < 0) throw new Error('现场核查模板正文结构无效，无法追加现场记录');
  xml = xml.slice(0, finalSection) + content + xml.slice(finalSection);
  xml = await appendRawRecordEvidence(xml, zip, records, evidenceGroups, layerIndex);
  zip.file('word/document.xml', xml);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

// 追加进第一个文档的正文可能引用第二个文档的关系部件（嵌入对象、图片、超链接等）。
// 合并时必须把这些部件拷入第一个包、在 rels 中登记新编号并重写正文引用，
// 否则 Word 会因关系缺失或撞号（如 rId12 同时指向页眉与 OLE 对象）报“无法读取的内容”。
async function adoptAppendedBodyRelationships(firstZip: JSZip, secondZip: JSZip, secondBody: string) {
  const relsPath = 'word/_rels/document.xml.rels';
  const relsFile = firstZip.file(relsPath);
  const typesFile = firstZip.file('[Content_Types].xml');
  if (!relsFile || !typesFile) return secondBody;
  let rels = await relsFile.async('string');
  let types = await typesFile.async('string');
  const secondRelsXml = await secondZip.file(relsPath)?.async('string') || '';
  const secondRels = new Map<string, { type: string; target: string; external: boolean }>();
  for (const match of secondRelsXml.matchAll(/<Relationship\b[^>]*\/>/g)) {
    const id = /\bId="([^"]+)"/.exec(match[0])?.[1];
    if (id) secondRels.set(id, {
      type: /\bType="([^"]+)"/.exec(match[0])?.[1] || '',
      target: /\bTarget="([^"]+)"/.exec(match[0])?.[1] || '',
      external: /\bTargetMode="External"/.test(match[0]),
    });
  }
  const usedIds = new Set<string>();
  for (const match of secondBody.matchAll(/\b(?:r:(?:id|embed|link|pict|href)|o:relid)="(rId\d+)"/g)) usedIds.add(match[1]);
  if (!usedIds.size) return secondBody;
  // 新编号必须同时避开第一个文档的现有编号和第二个文档的旧编号，
  // 否则逐个重写时会出现“旧编号撞上新编号”的链式误替换。
  let nextId = Math.max(0,
    ...[...rels.matchAll(/\bId="rId(\d+)"/g)].map(match => Number(match[1])),
    ...[...usedIds].map(id => Number(id.slice(3)))) + 1;
  const contentTypesByExtension: Record<string, string> = {
    bin: 'application/vnd.openxmlformats-officedocument.oleObject',
    emf: 'image/x-emf', wmf: 'image/x-wmf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  };
  const knownExtensions = new Set([...types.matchAll(/<Default\b[^>]*\bExtension="([^"]+)"/g)]
    .map(match => match[1].toLowerCase()));
  // 先整体确定编号映射，再统一重写正文引用。
  const remap = new Map<string, string>();
  for (const oldId of usedIds) {
    if (secondRels.has(oldId)) remap.set(oldId, `rId${nextId++}`);
  }
  for (const [oldId, newId] of remap) {
    const rel = secondRels.get(oldId)!;
    if (!rel.external) {
      // 关系目标相对 word/ 目录解析，支持 ../ 形式（如 ../customXml/item1.xml）。
      const segments = ['word'];
      for (const segment of rel.target.split('/')) {
        if (!segment || segment === '.') continue;
        if (segment === '..') segments.pop(); else segments.push(segment);
      }
      const partPath = segments.join('/');
      const data = await secondZip.file(partPath)?.async('nodebuffer');
      if (data) {
        firstZip.file(partPath, data);
        const extension = partPath.split('.').pop()?.toLowerCase() || '';
        if (extension && !knownExtensions.has(extension) && contentTypesByExtension[extension]) {
          types = types.replace('</Types>', `<Default Extension="${extension}" ContentType="${contentTypesByExtension[extension]}"/></Types>`);
          knownExtensions.add(extension);
        }
      }
    }
    rels = rels.replace('</Relationships>',
      `<Relationship Id="${newId}" Type="${escapeXml(rel.type)}" Target="${escapeXml(rel.target)}"${rel.external ? ' TargetMode="External"' : ''}/></Relationships>`);
  }
  let body = secondBody;
  for (const [oldId, newId] of remap) {
    body = body.replace(new RegExp(`\\b((?:r:(?:id|embed|link|pict|href)|o:relid)=")${oldId}(")`, 'g'), `$1${newId}$2`);
  }
  firstZip.file(relsPath, rels);
  firstZip.file('[Content_Types].xml', types);
  return body;
}

async function appendDocument(first: Buffer, second: Buffer) {
  const firstZip = await JSZip.loadAsync(first), secondZip = await JSZip.loadAsync(second);
  const firstXml = await firstZip.file('word/document.xml')!.async('string');
  const secondXml = await secondZip.file('word/document.xml')!.async('string');
  const secondBodyXml = /<w:body\b[^>]*>([\s\S]*?)<\/w:body>/.exec(secondXml)?.[1] || '';
  const secondFinalSection = secondBodyXml.lastIndexOf('<w:sectPr');
  const secondBody = secondFinalSection >= 0 ? secondBodyXml.slice(0, secondFinalSection) : secondBodyXml;
  const firstBodyEnd = firstXml.lastIndexOf('</w:body>');
  const firstFinalSection = firstXml.lastIndexOf('<w:sectPr', firstBodyEnd);
  if (!secondBody.trim() || firstBodyEnd < 0 || firstFinalSection < 0) {
    throw new Error('测评方案 init/last 模板正文结构无效，无法合并');
  }
  const adoptedBody = await adoptAppendedBodyRelationships(firstZip, secondZip, secondBody);
  const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  const merged = firstXml.slice(0, firstFinalSection) + pageBreak + adoptedBody
    + firstXml.slice(firstFinalSection);
  firstZip.file('word/document.xml', merged);
  return Buffer.from(await firstZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

async function listFiles(root: string, relative = ''): Promise<string[]> {
  const folder = path.join(root, relative);
  const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(entries.map(entry => entry.isDirectory()
    ? listFiles(root, path.join(relative, entry.name)) : Promise.resolve([path.join(relative, entry.name)])));
  return files.flat();
}

export async function generateRawRecords(templateRoot: string, source: RawRecordSource): Promise<GeneratedFile[]> {
  const available = await listFiles(templateRoot);
  if (!available.length) throw new Error('尚未配置原始记录模板，请先在“模板设置”中导入模板文件夹');
  const byName = new Map(available.map(relative => [path.basename(relative), relative]));
  const context = buildContext(source);
  const stages = Object.fromEntries(source.stages.map(stage => [stage.stage_key, stage.data || {}]));
  const reportTables: JsonRecord[] = stages.reporting?.exportContent?.tables || [];
  const projectNo = safeName(context.project_no);
  const onsite = stages.onsite || {};
  const output: GeneratedFile[] = [];
  const render = async (templateName: string, outputPath: string) => {
    const relative = byName.get(templateName);
    if (!relative) return;
    output.push({ path: outputPath, data: await renderDocx(await fs.readFile(path.join(templateRoot, relative)), context) });
  };
  const level = Number(source.project.system_level || 3) === 2 ? '二级' : '三级';
  const basicInfoTemplate = byName.get(`1-系统基本情况调查表（${level}）.docx`);
  if (basicInfoTemplate) {
    const rendered = await renderDocx(await fs.readFile(path.join(templateRoot, basicInfoTemplate)), context);
    output.push({ path: `${path.parse(basicInfoTemplate).name}${projectNo}-A.docx`, data: await normalizeBasicInfoFonts(rendered) });
  }
  const planInit = byName.get('2-测评方案-init.docx'), planLast = byName.get('2-测评方案-last.docx');
  if (planInit && planLast) {
    const first = await renderDocx(await fs.readFile(path.join(templateRoot, planInit)), context);
    const second = await renderDocx(await fs.readFile(path.join(templateRoot, planLast)), context);
    output.push({ path: `2-测评方案${projectNo}-B.docx`, data: await appendDocument(first, second) });
  }
  await render('3-测评方案评审表.docx', `3-测评方案评审表${projectNo}-C.docx`);
  await render('4-现场测评授权书.docx', `4-现场测评授权书${projectNo}-D.docx`);
  await render('5-风险告知书.docx', `5-风险告知书${projectNo}-E.docx`);
  const onsiteFolder = `6-现场核查表${projectNo}-F`;
  await render('0-测评现场记录表封面.docx', `${onsiteFolder}/0-测评现场记录表封面.docx`);
  for (const [layerIndex, name] of ['1-物理和环境安全', '2-网络和通信安全', '3-设备和计算安全', '4-应用和数据安全',
    '5-管理制度', '6-人员管理', '7-建设运行', '8-应急处置'].entries()) {
    const relative = byName.get(`${name}init.docx`);
    if (!relative) continue;
    const rendered = await renderDocx(await fs.readFile(path.join(templateRoot, relative)), context);
    const caption = name.replace(/^\d+-/, '') + '测评结果记录';
    const table = reportTables.find(item => item.caption === caption);
    output.push({ path: `${onsiteFolder}/${name}.docx`, data: await appendOnsiteRecords(rendered, table, layerIndex,
      onsite.onsiteRecords || {}, onsite.onsiteEvidenceGroups || []) });
  }
  await render('7-测试问题反馈单.docx', `7-测试问题反馈单${projectNo}-G.docx`);
  await render('9-评估报告评审表.docx', `9-评估报告评审表${projectNo}-I.docx`);
  await render('10-项目交接单.docx', `10-项目交接单${projectNo}-J.docx`);
  const qualityTemplateName = `11-质量监督记录表(${level}).docx`;
  if (!byName.has(qualityTemplateName)) {
    throw new Error(`缺少原始记录模板：${qualityTemplateName}`);
  }
  await render(qualityTemplateName, `${path.parse(qualityTemplateName).name}${projectNo}-K.docx`);
  if (!output.length) throw new Error('原始记录模板文件夹中没有可识别的 DOCX 模板');
  return output;
}
