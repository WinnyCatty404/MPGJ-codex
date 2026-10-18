import cors from 'cors';
import dotenv from 'dotenv';
import express, { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import JSZip from 'jszip';
import pg from 'pg';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { writeReportContent } from './report-content.js';
import { writeAppendixBImages, writePlanningImages, writeReportEvidence, writeTopologyBlocks } from './report-evidence.js';
import { allowLatinWordWrap, formatAppendixBHeadings, formatFigureOneOne, formatLatinFonts, formatReportTables, normalizeBasicInfoTemplateValues, normalizeCheckboxLabelSpacing, placeRiskTableCaptionAbove, prepareLevelTwoTemplate, replaceReportSlots, specializeReportTemplate, unresolvedReportSlots } from './report-template.js';
import { generatePreviousAssessment } from './previous-assessment.js';
import { generateRawRecords } from './raw-records.js';
import { replaceProjectTextInStageData, syncProjectDatesInStageData } from './project-date-sync.js';
import { calculateStageCompletion, deriveProjectProgress } from './project-progress.js';
import { buildRiskTemplateWorkbook, parseRiskTemplateWorkbook } from './risk-template-xlsx.js';
import { buildUserImportWorkbook, parseUserImportWorkbook } from './user-import-xlsx.js';
import { DocxOptimizeError, optimizeDocxForWordImport, WORD_IMPORT_DIRECT_LIMIT, WORD_IMPORT_HARD_LIMIT } from './docx-image-optimizer.js';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const { Pool } = pg;
// PostgreSQL DATE 没有时区语义。保持 YYYY-MM-DD 字符串，避免 Asia/Shanghai 下
// 被转换为前一天 16:00Z，导致项目编辑框显示并再次保存成前一天。
pg.types.setTypeParser(1082, value => value);
const port = Number(process.env.PORT || 3100);
const jwtSecret = process.env.JWT_SECRET || 'development-only-change-me';
const execFileAsync = promisify(execFile);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('未配置 DATABASE_URL。请通过安装版控制台或源码根目录的 npm run dev 启动，禁止后端猜测数据库实例。');
}
const instanceId = process.env.BMPBGS_INSTANCE_ID || 'unmanaged';
// 大量证据截图会使报告达到约 30 MB。Word 更新目录、重新分页及 PDF 转换
// 在此体积下可能超过 3 分钟，保留充足处理时间，避免正常任务被提前终止。
const WORD_AUTOMATION_TIMEOUT_MS = 10 * 60 * 1000;
const storageRoot = process.env.BB_DATA_ROOT
  ? path.join(process.env.BB_DATA_ROOT, 'storage')
  : fileURLToPath(new URL('../../storage/', import.meta.url));
const defaultReportTemplate = path.join(storageRoot, 'templates', 'report', 'default-report-template.docx');
const levelTwoReportTemplate = path.join(storageRoot, 'templates', 'report', 'level-2', 'default-report-template.docx');
const reportTemplateForLevel = (level: number) => level === 2 ? levelTwoReportTemplate : defaultReportTemplate;
const rawTemplateRoot = path.join(storageRoot, 'templates', 'records');
const projectEvidenceRoot = (projectId: string) => path.join(storageRoot, 'projects', projectId, 'evidence');
const pool = new Pool({
  connectionString: databaseUrl,
});
// 数据库重启或恢复操作会断开空闲连接。pg 会将该连接移出连接池；
// 监听错误可避免未处理的 error 事件直接结束整个后端进程。
pool.on('error', error => {
  console.error('PostgreSQL 空闲连接已断开，后续请求将重新建立连接：', error);
});

type AuthRequest = Request & { user?: { id: string; username: string; role: string } };

type EvidenceImageRef = {
  id?: string;
  dataUrl?: string;
  fileId?: string;
  mimeType?: string;
  fileSize?: number;
};
type EvidenceGroupRef = {
  id?: string;
  layer?: number;
  no?: string;
  name?: string;
  dataUrl?: string;
  images?: EvidenceImageRef[];
};

function decodeEvidenceDataUrl(dataUrl: string) {
  const match = /^data:image\/(png|jpe?g|gif);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) throw new Error('证据图片格式不支持，请使用 PNG、JPEG 或 GIF');
  const type = match[1].toLowerCase() === 'jpg' ? 'jpeg' : match[1].toLowerCase();
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error('单张证据图片必须小于15 MB');
  return { bytes, extension: type === 'jpeg' ? 'jpg' : type, mimeType: type === 'jpeg' ? 'image/jpeg' : `image/${type}` };
}

async function storeEvidenceDataUrl(client: pg.PoolClient, projectId: string, dataUrl: string,
  imageId: string | undefined, uploadedBy: string | undefined): Promise<EvidenceImageRef> {
  const decoded = decodeEvidenceDataUrl(dataUrl);
  const fileId = randomUUID();
  const resolvedImageId = imageId || `evi-${randomUUID()}`;
  const relativePath = path.posix.join('projects', projectId, 'evidence', `${fileId}.${decoded.extension}`);
  const destination = path.join(storageRoot, ...relativePath.split('/'));
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, decoded.bytes);
  await client.query(
    `INSERT INTO evidence_files(id,project_id,stage_key,evidence_type,original_name,storage_path,mime_type,file_size,uploaded_by)
     VALUES($1,$2,'onsite','onsite-image',$3,$4,$5,$6,$7)`,
    [fileId, projectId, `${resolvedImageId}.${decoded.extension}`, relativePath, decoded.mimeType, decoded.bytes.length, uploadedBy || null],
  );
  return { id: resolvedImageId, fileId, mimeType: decoded.mimeType, fileSize: decoded.bytes.length };
}

async function materializeEvidenceGroups(client: pg.PoolClient, projectId: string, groups: unknown,
  uploadedBy: string | undefined): Promise<EvidenceGroupRef[]> {
  if (!Array.isArray(groups)) return [];
  const output: EvidenceGroupRef[] = [];
  for (const rawGroup of groups as EvidenceGroupRef[]) {
    const group: EvidenceGroupRef = { ...rawGroup };
    if (!group.id) group.id = `evi-group-${randomUUID()}`;
    const sourceImages = Array.isArray(group.images) ? group.images : (group.dataUrl ? [{ dataUrl: group.dataUrl }] : []);
    const images: EvidenceImageRef[] = [];
    for (const rawImage of sourceImages) {
      if (rawImage?.fileId) {
        images.push({ id: rawImage.id, fileId: rawImage.fileId, mimeType: rawImage.mimeType, fileSize: rawImage.fileSize });
      } else if (rawImage?.dataUrl) {
        images.push(await storeEvidenceDataUrl(client, projectId, rawImage.dataUrl, rawImage.id, uploadedBy));
      }
    }
    delete group.dataUrl;
    group.images = images;
    output.push(group);
  }
  return output;
}

async function hydrateEvidenceGroups(projectId: string, groups: unknown): Promise<EvidenceGroupRef[]> {
  if (!Array.isArray(groups)) return [];
  const cloned = structuredClone(groups) as EvidenceGroupRef[];
  const fileIds = Array.from(new Set(cloned.flatMap(group => (group.images || []).map(image => image.fileId).filter(Boolean)))) as string[];
  if (!fileIds.length) return cloned;
  const rows = await pool.query(
    'SELECT id,storage_path,mime_type FROM evidence_files WHERE project_id=$1 AND id=ANY($2::uuid[])',
    [projectId, fileIds],
  );
  const files = new Map(rows.rows.map(row => [String(row.id), row]));
  await Promise.all(cloned.flatMap(group => (group.images || []).map(async image => {
    if (!image.fileId || image.dataUrl) return;
    const file = files.get(image.fileId);
    if (!file) throw new Error('证据图片文件不存在：' + image.fileId);
    const bytes = await fs.readFile(path.join(storageRoot, ...String(file.storage_path).split('/')));
    image.dataUrl = `data:${file.mime_type || image.mimeType || 'image/jpeg'};base64,${bytes.toString('base64')}`;
  })));
  return cloned;
}

const app = express();
app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174'] }));
app.use(express.json({ limit: '80mb' }));

const defaultInstitution = {
  name: '浙江省电子信息产品检验研究院',
  address: '浙江省杭州市天目山路50号信息技术大厦',
  postalCode: '310012',
  contact: '朱晨鸣',
  title: '主任 / 高工',
  department: '信息安全测评中心',
  telephone: '0571-81029696',
  mobile: '15167100948',
  email: 'zcm@zdjy.org.cn',
};

const defaultRiskTemplates = [
  { id: 'risk-physical', layer: '物理和环境安全', unit: '*', result: '*', threat: 'TP1', analysis: '该测评单元未完全满足密码应用要求，可能导致物理区域身份真实性或相关记录完整性无法得到有效保障。', advice: '建议按照相关标准要求，采用合规密码技术和密码产品完善物理访问身份鉴别及相关记录完整性保护措施。', defaultLevel: '中', version: 1, enabled: true },
  { id: 'risk-network', layer: '网络和通信安全', unit: '*', result: '*', threat: 'TN2', analysis: '该测评单元未完全满足密码应用要求，可能导致通信实体被仿冒，或者通信数据被窃取、篡改。', advice: '建议采用合规的密码协议、密码算法、密码产品和密码服务，对通信实体及通信数据实施相应保护。', defaultLevel: '中', version: 1, enabled: true },
  { id: 'risk-device', layer: '设备和计算安全', unit: '*', result: '*', threat: 'TD1', analysis: '该测评单元未完全满足密码应用要求，可能导致设备被非法登录，或者设备资源、日志及重要程序文件被非授权访问和篡改。', advice: '建议采用合规密码技术完善设备身份鉴别、远程管理通道、访问控制信息和日志记录保护措施。', defaultLevel: '中', version: 1, enabled: true },
  { id: 'risk-application', layer: '应用和数据安全', unit: '*', result: '*', threat: 'TA4', analysis: '该测评单元未完全满足密码应用要求，可能导致应用被非法登录，或者重要数据在传输、存储过程中泄露或被篡改。', advice: '建议根据数据安全需求采用合规密码算法、密码产品和密码服务，完善身份鉴别以及重要数据机密性、完整性保护。', defaultLevel: '中', version: 1, enabled: true },
  { id: 'risk-policy', layer: '管理制度', unit: '*', result: '*', threat: 'TK7', analysis: '密码应用安全管理制度存在不足，可能导致密码应用和密钥管理活动缺少统一、有效的制度约束。', advice: '建议完善密码应用安全管理制度、密钥管理规则和操作规程，明确发布、修订及执行记录留存要求。', defaultLevel: '低', version: 1, enabled: true },
  { id: 'risk-personnel', layer: '人员管理', unit: '*', result: '*', threat: 'TK7', analysis: '密码相关人员管理措施存在不足，可能导致岗位职责、培训考核、保密及调离管理不能有效落实。', advice: '建议完善密码应用岗位责任、培训考核、保密和调离制度，并留存相应执行记录。', defaultLevel: '低', version: 1, enabled: true },
  { id: 'risk-construction', layer: '建设运行', unit: '*', result: '*', threat: 'TK7', analysis: '密码应用方案制定、实施或运行评估存在不足，可能导致密码应用建设与系统实际安全需求不一致。', advice: '建议完善密码应用方案、密钥安全管理策略和实施方案，并按要求开展密码应用安全性评估。', defaultLevel: '低', version: 1, enabled: true },
  { id: 'risk-emergency', layer: '应急处置', unit: '*', result: '*', threat: 'TK7', analysis: '密码应用安全事件应急处置措施存在不足，可能影响密码安全事件的发现、响应、处置和上报。', advice: '建议完善密码应用应急策略、事件处置和报告机制，定期组织演练并留存记录。', defaultLevel: '低', version: 1, enabled: true },
];

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || '未命名';
}

function safeRelativePath(value: string) {
  const normalized = value.replace(/\\/g, '/').split('/').filter(part => part && part !== '.');
  if (!normalized.length || normalized.some(part => part === '..')) throw new Error('模板路径无效');
  return normalized.join('/');
}

function normalizeRawTemplateUploadPaths(paths: string[]) {
  const normalized = paths.map(safeRelativePath);
  const parts = normalized.map(item => item.split('/'));
  const commonFolder = parts[0]?.[0];
  const stripSelectedFolder = Boolean(commonFolder) && parts.every(item => item.length > 1 && item[0] === commonFolder);
  const relativePaths = parts.map(item => (stripSelectedFolder ? item.slice(1) : item).join('/'));
  if (new Set(relativePaths.map(item => item.toLowerCase())).size !== relativePaths.length) {
    throw new Error('模板文件夹中存在重名文件');
  }
  return relativePaths;
}

async function buildProjectDocx(projectId: string) {
  const [projectResult, stagesResult, institutionResult] = await Promise.all([
    pool.query('SELECT * FROM projects WHERE id=$1', [projectId]),
    pool.query('SELECT stage_key,data FROM project_stage_records WHERE project_id=$1', [projectId]),
    pool.query(`SELECT setting_value FROM system_settings WHERE setting_key='institution'`),
  ]);
  const project = projectResult.rows[0];
  if (!project) return null;
  if (![2, 3].includes(Number(project.system_level))) throw new Error('仅支持二级和三级系统');
  // 使用“模板设置 → 报告模板”上传的当前文件；项目导入的 Word 只作为数据来源。
  const template = await fs.readFile(reportTemplateForLevel(Number(project.system_level))).catch(() => {
    throw new Error('尚未配置报告模板，请先在“模板设置”中上传 DOCX 文件');
  });
  const zip = await JSZip.loadAsync(template);
  const stageData = Object.fromEntries(stagesResult.rows.map(row => [row.stage_key, row.data || {}]));
  const previousAssessment = generatePreviousAssessment(stageData.planning || {});
  const content = stageData.reporting?.exportContent;
  const savedValues = stageData.reporting?.templateValues as Record<string, string> | undefined;
  const reportEvidenceGroups = await hydrateEvidenceGroups(projectId, stageData.onsite?.onsiteEvidenceGroups || []);
  if (stageData.reporting?.assessmentLevel && Number(stageData.reporting.assessmentLevel) !== Number(project.system_level)) throw new Error('项目等级已变更，请重新打开实施页面并保存后导出');
  if (!content || !savedValues) throw new Error('请刷新项目实施页面并重新导出，以保存最新报告字段');
  const institution = institutionResult.rows[0]?.setting_value || defaultInstitution;
  const levelNumber = Number(project.system_level);
  const levelChinese = ['', '一', '二', '三', '四'][levelNumber];
  const values: Record<string, string> = {
    ...normalizeBasicInfoTemplateValues(savedValues),
    '报告编号': project.report_code || project.code,
    '项目编号': project.code,
    '系统名称': project.system_name,
    '系统等级': levelChinese ? `第${levelChinese}级` : `第${project.system_level}级`,
    '测评年度': String(project.assessment_year),
    '密评机构名称': institution.name || '',
    '密评机构通信地址': institution.address || '',
    '密评机构邮政编码': institution.postalCode || '',
    '密评机构联系人姓名': institution.contact || '',
    '密评机构联系人职务/职称': institution.title || '',
    '密评机构联系人所属部门': institution.department || '',
    '密评机构办公电话': institution.telephone || '',
    '密评机构联系人手机': institution.mobile || '',
    '密评机构联系人邮箱': institution.email || '',
    '前次测评情况': previousAssessment || '',
    '电子门禁系统名称': savedValues['电子门禁系统名称'] || '',
  };
  // 两种结论分开使用：{{评估结论}}为单项判定，{{总体评价_评估结论}}为第7章完整评价段落。
  // 目前尚无录入界面的密码应用分层描述，明确导出为空，绝不沿用模板示例文字。
  for (const name of ['物理和环境安全', '网络和通信安全', '设备和计算安全', '应用和数据安全']) {
    values[`被测系统情况_密码应用情况_${name}`] ??= '';
  }
  // 兼容此前已保存的字段；只删除复选框后的水平空白，不改变其他词间空格或换行。
  for (const name of Object.keys(values)) {
    values[name] = normalizeCheckboxLabelSpacing(values[name]);
    // 第8章的问题描述和改进建议按同一层面连续排版；页面中用于区分条目的换行不写入 Word。
    if (/^安全问题及改进建议_.*_(问题描述|改进建议)$/.test(name)) {
      values[name] = String(values[name] || '').replace(/(?:\\n|\r?\n)[\t \u3000]*/g, '');
    }
  }
  const replacements = Object.fromEntries(Object.entries(values).map(([name, value]) => [`{{${name}}}`, value]));
  replacements['{{报告编号}}}'] = values['报告编号']; // 兼容封面多写的一个右花括号。
  const planningImages = Object.fromEntries((stageData.planning?.images || []).map((image: { id: string; src: string }) => [image.id, image.src]));
  const planningFields = Object.fromEntries((stageData.planning?.fields || []).map((field: { id: string; value: string }) => [field.id, field.value]));
  const planningImageCaptions = Object.fromEntries(['physical', 'network', 'device', 'application'].map(layer => [
    `${layer}-crypto-image`, String(planningFields[`plan-crypto-caption-${layer}`] || ''),
  ]));
  const xmlEntries = Object.keys(zip.files).filter(name => /^word\/(document|header\d*|footer\d*)\.xml$/.test(name));
  const unresolved = new Set<string>();
  for (const name of xmlEntries) {
    const file = zip.file(name);
    if (!file) continue;
    let xml = await file.async('string');
    if (name === 'word/document.xml') {
      if (levelNumber === 2) xml = prepareLevelTwoTemplate(xml, await zip.file('word/styles.xml')!.async('string'));
      xml = specializeReportTemplate(xml, values);
      // “现场测评方法”在二级、三级模板中均已按正式报告样式设置为五项项目符号列表。
      // 不再用页面中的整段文本覆盖模板列表，否则会把全文写进第一项，并遗留空项目符号。
      const reportSections = levelNumber === 2
        ? content.sections.filter((section: { heading: string }) => section.heading !== '现场测评方法')
        : [];
      xml = writeReportContent(xml, await zip.file('word/styles.xml')!.async('string'), { ...content, sections: reportSections });
      const topologyBlocks = Array.isArray(stageData.planning?.topologyBlocks)
        ? stageData.planning.topologyBlocks.filter((block: { type?: string }) => block && (block.type === 'text' || block.type === 'image'))
        : [];
      const topologyImageCount = topologyBlocks.length
        ? topologyBlocks.filter((block: { type?: string; dataUrl?: string }) => block.type === 'image' && block.dataUrl).length
        : (planningImages['topology-image'] ? 1 : 0);
      xml = await writeTopologyBlocks(xml, zip, stageData.planning?.topologyBlocks,
        planningImages['topology-image'], values['被测系统情况_网络拓扑图及描述_描述'], project.system_name);
      xml = await writePlanningImages(xml, zip, planningImages, topologyImageCount, planningImageCaptions);
      xml = await writeReportEvidence(xml, zip, stageData.onsite?.onsiteRecords || {},
        reportEvidenceGroups);
      xml = await writeAppendixBImages(xml, zip, stageData.reporting?.appendixBImages || {});
    }
    xml = replaceReportSlots(xml, replacements);
    if (name === 'word/document.xml') {
      xml = formatAppendixBHeadings(xml);
      xml = formatFigureOneOne(xml);
      xml = placeRiskTableCaptionAbove(xml);
      xml = formatReportTables(xml);
    }
    xml = formatLatinFonts(xml);
    xml = allowLatinWordWrap(xml);
    unresolvedReportSlots(xml).forEach(slot => unresolved.add(slot));
    zip.file(name, xml);
  }
  if (unresolved.size) throw new Error('Word模板占位符没有对应的项目字段：' + [...unresolved].join('、'));
  const settings = zip.file('word/settings.xml');
  if (settings) {
    let xml = await settings.async('string');
    xml = /<w:updateFields\b[^>]*\/>/.test(xml)
      ? xml.replace(/<w:updateFields\b[^>]*\/>/, '<w:updateFields w:val="true"/>')
      : xml.replace('</w:settings>', '<w:updateFields w:val="true"/></w:settings>');
    // 保留嵌入图片的原始像素，避免 Word/WPS 再次按屏幕分辨率压缩。
    if (!/<w:doNotCompressPictures\b/.test(xml)) {
      xml = xml.replace('</w:settings>', '<w:doNotCompressPictures/><w14:defaultImageDpi w14:val="300"/></w:settings>');
    } else if (!/<w14:defaultImageDpi\b/.test(xml)) {
      xml = xml.replace('</w:settings>', '<w14:defaultImageDpi w14:val="300"/></w:settings>');
    }
    zip.file('word/settings.xml', xml);
  }
  return { project, buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) };
}

async function normalizeFinalReportDocx(docx: Buffer) {
  const zip = await JSZip.loadAsync(docx);
  const xmlEntries = Object.keys(zip.files).filter(name => /^word\/(document|header\d*|footer\d*)\.xml$/.test(name));
  for (const name of xmlEntries) {
    const file = zip.file(name);
    if (!file) continue;
    let xml = await file.async('string');
    // Word 刷新目录和页码后可能重新写入直接字体；最终再按报告规则固定字体。
    if (name === 'word/document.xml') xml = formatReportTables(xml);
    xml = formatLatinFonts(xml);
    xml = allowLatinWordWrap(xml);
    zip.file(name, xml);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
async function refreshReportFields(docx: Buffer, format: 'docx' | 'pdf') {
  const work = path.join(os.tmpdir(), `bb-miping-${randomUUID()}`);
  await fs.mkdir(work, { recursive: true });
  const input = path.join(work, 'report.docx');
  const output = path.join(work, 'report.pdf');
  await fs.writeFile(input, docx);
  const script = [
    '$ErrorActionPreference="Stop"; $docPath=$env:BB_DOCX_INPUT; $pdfPath=$env:BB_PDF_OUTPUT;',
    '$word=$null; $doc=$null;',
    'try { $word=New-Object -ComObject Word.Application; $word.Visible=$false; $word.DisplayAlerts=0;',
    '$doc=$word.Documents.Open($docPath,$false,$false);',
    'if($doc.TablesOfContents.Count -lt 1){throw "报告模板中没有自动目录域"};',
    '$doc.Repaginate(); [void]$doc.Fields.Update();',
    'foreach($section in $doc.Sections){foreach($header in $section.Headers){[void]$header.Range.Fields.Update()}; foreach($footer in $section.Footers){[void]$footer.Range.Fields.Update()}};',
    'foreach($toc in $doc.TablesOfContents){$toc.Update()}; $doc.Repaginate();',
    'foreach($toc in $doc.TablesOfContents){$toc.UpdatePageNumbers()};',
    'foreach($section in $doc.Sections){foreach($footer in $section.Footers){[void]$footer.Range.Fields.Update()}};',
    '$doc.Repaginate(); foreach($toc in $doc.TablesOfContents){$toc.UpdatePageNumbers()};',
    '$doc.Save(); }',
    'finally { if($doc){$doc.Close($false); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc)};',
    'if($word){$word.Quit(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)}; [GC]::Collect(); [GC]::WaitForPendingFinalizers() }',
  ].join(' ');
  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script], {
      timeout: WORD_AUTOMATION_TIMEOUT_MS,
      env: { ...process.env, BB_DOCX_INPUT: input, BB_PDF_OUTPUT: output, BB_REPORT_FORMAT: format },
    });
    const normalizedDocx = await normalizeFinalReportDocx(await fs.readFile(input));
    if (format === 'docx') return normalizedDocx;
    await fs.writeFile(input, normalizedDocx);
    const pdfScript = [
      '$ErrorActionPreference="Stop"; $docPath=$env:BB_DOCX_INPUT; $pdfPath=$env:BB_PDF_OUTPUT;',
      '$word=$null; $doc=$null;',
      'try { $word=New-Object -ComObject Word.Application; $word.Visible=$false; $word.DisplayAlerts=0;',
      '$doc=$word.Documents.Open($docPath,$false,$true); $doc.SaveAs2($pdfPath,17) }',
      'finally { if($doc){$doc.Close($false); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc)};',
      'if($word){$word.Quit(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)}; [GC]::Collect(); [GC]::WaitForPendingFinalizers() }',
    ].join(' ');
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', pdfScript], {
      timeout: WORD_AUTOMATION_TIMEOUT_MS,
      env: { ...process.env, BB_DOCX_INPUT: input, BB_PDF_OUTPUT: output },
    });
    return await fs.readFile(output);
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

async function ensureRuntimeSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS system_settings (
    setting_key varchar(80) PRIMARY KEY,
    setting_value jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query(
    `INSERT INTO system_settings(setting_key,setting_value) VALUES('institution',$1)
     ON CONFLICT(setting_key) DO NOTHING`,
    [defaultInstitution],
  );
  await pool.query(
    `INSERT INTO system_settings(setting_key,setting_value) VALUES('risk_templates',$1)
     ON CONFLICT(setting_key) DO NOTHING`,
    [JSON.stringify(defaultRiskTemplates)],
  );
  await fs.mkdir(path.dirname(defaultReportTemplate), { recursive: true });
  await fs.mkdir(rawTemplateRoot, { recursive: true });
}

function asyncRoute(
  fn: (req: AuthRequest, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function auth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ message: '请先登录' });
  try {
    req.user = jwt.verify(token, jwtSecret) as AuthRequest['user'];
    next();
  } catch {
    res.status(401).json({ message: '登录状态已失效' });
  }
}

// <img> 标签无法携带 Authorization 请求头，仅证据图片读取接口允许查询参数中的令牌。
function evidenceReadAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const queryToken = typeof req.query.access_token === 'string' ? req.query.access_token : '';
  const tokenValue = req.headers.authorization?.replace(/^Bearer\s+/i, '') || queryToken;
  if (!tokenValue) return res.status(401).json({ message: '请先登录' });
  try {
    req.user = jwt.verify(tokenValue, jwtSecret) as AuthRequest['user'];
    next();
  } catch {
    res.status(401).json({ message: '登录状态已失效' });
  }
}

app.get('/api/health', asyncRoute(async (_req, res) => {
  const result = await pool.query('SELECT current_database() AS database, inet_server_port()::int AS database_port, now() AS time');
  const { database_port: databasePort, ...databaseState } = result.rows[0];
  res.json({ ok: true, instanceId, databasePort, ...databaseState });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const input = z.object({ username: z.string().min(1), password: z.string().min(1) }).parse(req.body);
  const result = await pool.query(
    `SELECT id, username, display_name, role, status, must_change_password
     FROM users
     WHERE username = $1 AND password_hash = crypt($2, password_hash)`,
    [input.username, input.password],
  );
  const user = result.rows[0];
  if (!user) return res.status(401).json({ message: '用户名或密码错误' });
  if (user.status === 'disabled') return res.status(403).json({ message: '账号已被禁用' });
  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, jwtSecret, { expiresIn: '8h' });
  res.json({ token, user });
}));

app.get('/api/auth/me', auth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    'SELECT id, username, display_name, role, status, must_change_password FROM users WHERE id = $1',
    [req.user!.id],
  );
  res.json(result.rows[0]);
}));

app.post('/api/auth/change-password', auth, asyncRoute(async (req, res) => {
  const input = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(80) }).parse(req.body);
  const check = await pool.query(
    'SELECT id FROM users WHERE id=$1 AND password_hash=crypt($2,password_hash)',
    [req.user!.id, input.currentPassword],
  );
  if (!check.rows[0]) return res.status(400).json({ message: '当前密码不正确' });
  await pool.query(
    `UPDATE users SET password_hash=crypt($1,gen_salt('bf')),must_change_password=false,status='active',updated_at=now() WHERE id=$2`,
    [input.newPassword, req.user!.id],
  );
  res.json({ changed: true });
}));

app.get('/api/dashboard', auth, asyncRoute(async (_req, res) => {
  const [summary, stages, recent, risks] = await Promise.all([
    pool.query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
      count(*) FILTER (WHERE status = 'reviewing')::int AS reviewing,
      count(*) FILTER (WHERE status = 'completed')::int AS completed
      FROM projects WHERE status <> 'archived'`),
    pool.query(`SELECT current_stage, count(*)::int AS count FROM projects
      WHERE status NOT IN ('completed', 'archived') GROUP BY current_stage ORDER BY current_stage`),
    pool.query(`SELECT p.*, u.display_name AS owner_name,
      (SELECT count(*)::int FROM risks r WHERE r.project_id = p.id AND r.risk_level = 'high' AND r.status <> 'closed') AS high_risk_count
      FROM projects p LEFT JOIN users u ON u.id = p.owner_id
      WHERE p.status <> 'archived' ORDER BY p.updated_at DESC LIMIT 8`),
    pool.query(`SELECT risk_level, count(*)::int AS count FROM risks WHERE status <> 'closed' GROUP BY risk_level`),
  ]);
  res.json({ summary: summary.rows[0], stages: stages.rows, recent: recent.rows, risks: risks.rows });
}));

app.get('/api/projects', auth, asyncRoute(async (req, res) => {
  const search = String(req.query.search || '').trim();
  const year = Number(req.query.year || 0);
  const level = Number(req.query.level || 0);
  const status = String(req.query.status || '');
  const result = await pool.query(
    `SELECT p.*, u.display_name AS owner_name,
      (SELECT count(*)::int FROM risks r WHERE r.project_id = p.id AND r.risk_level = 'high' AND r.status <> 'closed') AS high_risk_count,
      NULLIF((SELECT ps.data->>'systemScore' FROM project_stage_records ps WHERE ps.project_id=p.id AND ps.stage_key='reporting'),'')::numeric AS system_score
     FROM projects p LEFT JOIN users u ON u.id = p.owner_id
     WHERE ($1 = '' OR p.code ILIKE '%' || $1 || '%' OR COALESCE(p.report_code, '') ILIKE '%' || $1 || '%'
       OR p.system_name ILIKE '%' || $1 || '%' OR p.org_name ILIKE '%' || $1 || '%')
       AND ($2 = 0 OR p.assessment_year = $2)
       AND ($3 = 0 OR p.system_level = $3)
       AND ($4 = '' OR p.status = $4)
     ORDER BY p.updated_at DESC`,
    [search, year, level, status],
  );
  res.json(result.rows);
}));

app.get('/api/projects/:id', auth, asyncRoute(async (req, res) => {
  const [project, stages, risks, assets, userDirectory] = await Promise.all([
    pool.query(`SELECT p.*, u.display_name AS owner_name FROM projects p LEFT JOIN users u ON u.id=p.owner_id WHERE p.id=$1`, [req.params.id]),
    pool.query(`SELECT * FROM project_stage_records WHERE project_id=$1
      ORDER BY CASE stage_key
        WHEN 'preparation' THEN 1 WHEN 'planning' THEN 2 WHEN 'onsite' THEN 3
        WHEN 'reporting' THEN 4 WHEN 'review' THEN 5 ELSE 99 END`, [req.params.id]),
    pool.query('SELECT * FROM risks WHERE project_id=$1 ORDER BY CASE risk_level WHEN \'high\' THEN 1 WHEN \'medium\' THEN 2 ELSE 3 END, created_at DESC', [req.params.id]),
    pool.query('SELECT * FROM asset_items WHERE project_id=$1 ORDER BY category, sort_order, created_at', [req.params.id]),
    pool.query(`SELECT username, display_name, role, status, certificate_date, certificate_file_path
      FROM users ORDER BY created_at`),
  ]);
  if (!project.rows[0]) return res.status(404).json({ message: '项目不存在' });
  res.json({ ...project.rows[0], stages: stages.rows, risks: risks.rows, assets: assets.rows, user_directory: userDirectory.rows });
}));

app.get('/api/projects/:id/evidence-files/:fileId', evidenceReadAuth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    'SELECT storage_path,mime_type FROM evidence_files WHERE id=$1 AND project_id=$2 AND evidence_type=$3',
    [req.params.fileId, req.params.id, 'onsite-image'],
  );
  const file = result.rows[0];
  if (!file) return res.status(404).json({ message: '证据图片不存在' });
  const absolute = path.resolve(storageRoot, ...String(file.storage_path).split('/'));
  const evidenceRoot = path.resolve(projectEvidenceRoot(String(req.params.id)));
  if (absolute !== evidenceRoot && !absolute.startsWith(evidenceRoot + path.sep)) {
    return res.status(400).json({ message: '证据图片路径无效' });
  }
  const bytes = await fs.readFile(absolute).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!bytes) return res.status(404).json({ message: '证据图片文件已丢失' });
  res.type(file.mime_type || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.send(bytes);
}));

app.post('/api/projects/:id/evidence-files', auth, asyncRoute(async (req, res) => {
  const input = z.object({ imageId: z.string().max(100).optional(), dataUrl: z.string().min(20).max(22 * 1024 * 1024) }).parse(req.body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const project = await client.query('SELECT id FROM projects WHERE id=$1 FOR SHARE', [req.params.id]);
    if (!project.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: '项目不存在' });
    }
    const image = await storeEvidenceDataUrl(client, String(req.params.id), input.dataUrl, input.imageId, req.user!.id);
    await client.query('COMMIT');
    res.status(201).json(image);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.post('/api/projects/:id/evidence-files/migrate', auth, asyncRoute(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT data FROM project_stage_records WHERE project_id=$1 AND stage_key='onsite' FOR UPDATE`,
      [req.params.id],
    );
    if (!current.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: '现场测评数据不存在' });
    }
    const data = structuredClone(current.rows[0].data || {});
    data.onsiteEvidenceGroups = await materializeEvidenceGroups(client, String(req.params.id), data.onsiteEvidenceGroups, req.user!.id);
    await client.query(
      `UPDATE project_stage_records SET data=$1,updated_at=now(),updated_by=$2 WHERE project_id=$3 AND stage_key='onsite'`,
      [data, req.user!.id, req.params.id],
    );
    await client.query('COMMIT');
    res.json({ onsiteEvidenceGroups: data.onsiteEvidenceGroups });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.delete('/api/projects/:id/evidence-files/:fileId', auth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    'DELETE FROM evidence_files WHERE id=$1 AND project_id=$2 AND evidence_type=$3 RETURNING storage_path',
    [req.params.fileId, req.params.id, 'onsite-image'],
  );
  const relativePath = result.rows[0]?.storage_path;
  if (relativePath) {
    const absolute = path.resolve(storageRoot, ...String(relativePath).split('/'));
    const evidenceRoot = path.resolve(projectEvidenceRoot(String(req.params.id)));
    if (absolute.startsWith(evidenceRoot + path.sep)) await fs.rm(absolute, { force: true });
  }
  res.json({ deleted: Boolean(relativePath) });
}));

app.post('/api/projects', auth, asyncRoute(async (req, res) => {
  const input = z.object({
    reportCode: z.string().max(60).optional().nullable(),
    systemName: z.string().min(2).max(200),
    orgName: z.string().min(2).max(200),
    assessmentYear: z.number().int().min(2000).max(2100),
    systemLevel: z.union([z.literal(2), z.literal(3)]),
    // 兼容旧客户端提交，但项目日期仅由测评过程派生，不在新建弹窗维护。
    startDate: z.string().optional().nullable(),
    endDate: z.string().optional().nullable(),
  }).parse(req.body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [900000 + input.assessmentYear]);
    const sequence = await client.query(
      `SELECT COALESCE(MAX((regexp_match(code, '^MP-' || $1 || '-([0-9]+)$'))[1]::int),0)+1 AS next_no
       FROM projects WHERE code ~ ('^MP-' || $1 || '-[0-9]+$')`,
      [String(input.assessmentYear)],
    );
    const projectCode = `MP-${input.assessmentYear}-${String(sequence.rows[0].next_no).padStart(3, '0')}`;
    const project = await client.query(
      `INSERT INTO projects (code, report_code, system_name, org_name, assessment_year, system_level, start_date, end_date, owner_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,
      [projectCode, input.reportCode || null, input.systemName, input.orgName, input.assessmentYear, input.systemLevel, null, null, req.user!.id],
    );
    await client.query(
      `INSERT INTO project_stage_records(project_id, stage_key, title) SELECT $1, * FROM (VALUES
       ('preparation','项目准备'),('planning','测评准备与方案编制'),('onsite','现场测评'),('reporting','报告编制'),('review','报告导出')) s(stage_key,title)`,
      [project.rows[0].id],
    );
    await client.query('COMMIT');
    res.status(201).json(project.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.put('/api/projects/:id', auth, asyncRoute(async (req, res) => {
  const input = z.object({
    code: z.string().min(3).max(40).optional(),
    reportCode: z.string().max(60).optional().nullable(),
    systemName: z.string().min(2).max(200),
    orgName: z.string().min(2).max(200),
    assessmentYear: z.number().int().min(2000).max(2100),
    systemLevel: z.union([z.literal(2), z.literal(3)]),
    startDate: z.string().optional().nullable(),
    endDate: z.string().optional().nullable(),
  }).parse(req.body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const previousResult = await client.query('SELECT * FROM projects WHERE id=$1 FOR UPDATE', [req.params.id]);
    const previous = previousResult.rows[0];
    if (!previous) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: '项目不存在' });
    }
    const result = await client.query(
      `UPDATE projects SET report_code=$1,system_name=$2,org_name=$3,assessment_year=$4,
        system_level=$5,updated_at=now() WHERE id=$6 RETURNING *`,
      [input.reportCode || null, input.systemName, input.orgName, input.assessmentYear,
        input.systemLevel, req.params.id],
    );
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.delete('/api/projects/:id', auth, asyncRoute(async (req, res) => {
  const result = await pool.query('DELETE FROM projects WHERE id=$1 RETURNING id,system_name', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ message: '项目不存在' });
  res.json({ deleted: true, project: result.rows[0] });
}));

app.post('/api/projects/:id/copy', auth, asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const input = z.object({
    systemName: z.string().trim().min(1).max(255),
    reportCode: z.string().trim().max(60).optional().default(''),
    assessmentYear: z.number().int().min(2000).max(2100),
  }).parse(req.body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sourceResult = await client.query('SELECT * FROM projects WHERE id=$1 FOR SHARE', [projectId]);
    const source = sourceResult.rows[0];
    if (!source) { await client.query('ROLLBACK'); return res.status(404).json({ message: '项目不存在' }); }
    await client.query('SELECT pg_advisory_xact_lock($1)', [900000 + input.assessmentYear]);
    const sequence = await client.query(
      `SELECT COALESCE(MAX((regexp_match(code, '^MP-' || $1 || '-([0-9]+)$'))[1]::int),0)+1 AS next_no
       FROM projects WHERE code ~ ('^MP-' || $1 || '-[0-9]+$')`,
      [String(input.assessmentYear)],
    );
    const code = `MP-${input.assessmentYear}-${String(sequence.rows[0].next_no).padStart(3, '0')}`;
    const copied = await client.query(
      `INSERT INTO projects(code,report_code,system_name,org_name,assessment_year,system_level,status,current_stage,progress,start_date,end_date,owner_id,created_by)
       SELECT $1,$2,$3,org_name,$4,system_level,'draft',1,0,start_date,end_date,owner_id,$5
       FROM projects WHERE id=$6 RETURNING *`,
      [code, input.reportCode || null, input.systemName, input.assessmentYear, req.user!.id, projectId],
    );
    const newId = copied.rows[0].id;
    const evidenceIdMap = new Map<string, string>();
    const sourceEvidence = await client.query(
      `SELECT id,stage_key,evidence_type,original_name,storage_path,mime_type,file_size
       FROM evidence_files WHERE project_id=$1 AND evidence_type='onsite-image'`,
      [projectId],
    );
    for (const evidence of sourceEvidence.rows) {
      const newEvidenceId = randomUUID();
      const extension = path.extname(String(evidence.storage_path || '')) || '.jpg';
      const relativePath = path.posix.join('projects', newId, 'evidence', newEvidenceId + extension);
      const sourcePath = path.join(storageRoot, ...String(evidence.storage_path).split('/'));
      const targetPath = path.join(storageRoot, ...relativePath.split('/'));
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(sourcePath, targetPath);
      await client.query(
        `INSERT INTO evidence_files(id,project_id,stage_key,evidence_type,original_name,storage_path,mime_type,file_size,uploaded_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [newEvidenceId, newId, evidence.stage_key, evidence.evidence_type, evidence.original_name,
          relativePath, evidence.mime_type, evidence.file_size, req.user!.id],
      );
      evidenceIdMap.set(String(evidence.id), newEvidenceId);
    }
    const stageRows = await client.query(
      'SELECT stage_key,title,data FROM project_stage_records WHERE project_id=$1 ORDER BY updated_at,stage_key',
      [projectId],
    );
    for (const stage of stageRows.rows) {
      let data = structuredClone(stage.data || {});
      data = replaceProjectTextInStageData(data, source.system_name, input.systemName);
      data = replaceProjectTextInStageData(data, source.report_code || '', input.reportCode || '');
      if (stage.stage_key === 'onsite') {
        // 现场测评证据列表是复测项目的基础材料：保留证据组、标题、层面及全部图片数据。
        data.onsiteEvidenceGroups = Array.isArray(data.onsiteEvidenceGroups)
          ? data.onsiteEvidenceGroups : [];
        data.onsiteEvidenceGroups.forEach((group: EvidenceGroupRef) => {
          (group.images || []).forEach(image => {
            if (image.fileId && evidenceIdMap.has(image.fileId)) image.fileId = evidenceIdMap.get(image.fileId);
          });
        });
      }
      if (stage.stage_key === 'reporting') {
        // 复测保留第三、四步已整理的文字，但附录B材料属于本次活动，必须重新录入。
        data.appendixBData = {};
        data.appendixBImages = {};
        // 导出内容、分数和模板字段在新项目打开并保存后按新对象、结果及日期重新生成。
        delete data.exportContent;
        delete data.templateValues;
        delete data.systemScore;
      }
      await client.query(
        `INSERT INTO project_stage_records(project_id,stage_key,title,data,completion,updated_by)
         VALUES($1,$2,$3,$4,0,$5)`,
        [newId, stage.stage_key, stage.title, data, req.user!.id],
      );
    }
    await client.query(`INSERT INTO project_members(project_id,user_id,member_role) SELECT $1,user_id,member_role FROM project_members WHERE project_id=$2`, [newId, projectId]);
    await client.query(`INSERT INTO asset_items(project_id,category,name,importance,details,sort_order) SELECT $1,category,name,importance,details,sort_order FROM asset_items WHERE project_id=$2`, [newId, projectId]);
    await client.query(`INSERT INTO assessment_records(project_id,domain,indicator_code,indicator_name,target_name,applicable,result,score,evidence,analysis,risk_level,updated_by) SELECT $1,domain,indicator_code,indicator_name,target_name,applicable,result,score,evidence,analysis,risk_level,$3 FROM assessment_records WHERE project_id=$2`, [newId, projectId, req.user!.id]);
    await client.query(`INSERT INTO risks(project_id,domain,issue_description,threat_code,risk_analysis,risk_level,recommendation,status) SELECT $1,domain,issue_description,threat_code,risk_analysis,risk_level,recommendation,status FROM risks WHERE project_id=$2`, [newId, projectId]);
    await client.query(`INSERT INTO evidence_files(project_id,stage_key,evidence_type,original_name,storage_path,mime_type,file_size,uploaded_by)
      SELECT $1,stage_key,evidence_type,original_name,storage_path,mime_type,file_size,$3 FROM evidence_files
      WHERE project_id=$2 AND evidence_type<>'onsite-image'`, [newId, projectId, req.user!.id]);
    const sourceTemplate = path.join(storageRoot, 'projects', projectId, 'report-template.docx');
    const copiedTemplate = path.join(storageRoot, 'projects', newId, 'report-template.docx');
    try { await fs.mkdir(path.dirname(copiedTemplate), { recursive: true }); await fs.copyFile(sourceTemplate, copiedTemplate); } catch { /* source project may use the global template */ }
    await client.query('COMMIT');
    res.status(201).json(copied.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}));

app.post('/api/projects/:id/report-template', auth, asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const input = z.object({ name: z.string().min(1).max(255), dataBase64: z.string().min(1), sourceMeta: z.object({ systemName: z.string().optional(), orgName: z.string().optional(), reportCode: z.string().optional() }).optional() }).parse(req.body);
  if (!input.name.toLowerCase().endsWith('.docx')) return res.status(400).json({ message: '仅支持 DOCX 报告模板' });
  const exists = await pool.query('SELECT * FROM projects WHERE id=$1', [projectId]);
  if (!exists.rows[0]) return res.status(404).json({ message: '项目不存在' });
  const folder = path.join(storageRoot, 'projects', projectId);
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, 'report-template.docx'), Buffer.from(input.dataBase64, 'base64'));
  const source = exists.rows[0];
  await fs.writeFile(path.join(folder, 'report-template.json'), JSON.stringify({
    originalName: input.name,
    sourceSystemName: input.sourceMeta?.systemName || source.system_name,
    sourceOrgName: input.sourceMeta?.orgName || source.org_name,
    sourceReportCode: input.sourceMeta?.reportCode || source.report_code || '',
    uploadedAt: new Date().toISOString(),
  }, null, 2));
  res.json({ stored: true, name: input.name });
}));

app.post('/api/projects/:id/report-template-staging', auth, asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const input = z.object({ name: z.string().min(1).max(255), dataBase64: z.string().min(1) }).parse(req.body);
  if (!input.name.toLowerCase().endsWith('.docx')) return res.status(400).json({ message: '仅支持 DOCX 报告模板' });
  const exists = await pool.query('SELECT 1 FROM projects WHERE id=$1', [projectId]);
  if (!exists.rows[0]) return res.status(404).json({ message: '项目不存在' });
  const data = Buffer.from(input.dataBase64, 'base64');
  if (!data.length || data.length > WORD_IMPORT_DIRECT_LIMIT) return res.status(413).json({ message: '待导入文件必须小于或等于 55 MiB' });
  const importToken = randomUUID();
  const folder = path.join(storageRoot, 'projects', projectId, 'word-import-staging');
  await fs.mkdir(folder, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(folder, `${importToken}.docx`), data),
    fs.writeFile(path.join(folder, `${importToken}.json`), JSON.stringify({ originalName: input.name, createdAt: new Date().toISOString() })),
  ]);
  res.json({ staged: true, importToken });
}));

app.get('/api/projects/:id/report-template-staging/:token', auth, asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const importToken = z.string().uuid().parse(req.params.token);
  const folder = path.join(storageRoot, 'projects', projectId, 'word-import-staging');
  const templatePath = path.join(folder, `${importToken}.docx`);
  const metadataPath = path.join(folder, `${importToken}.json`);
  try {
    const [content, metadataText] = await Promise.all([fs.readFile(templatePath), fs.readFile(metadataPath, 'utf8')]);
    const originalName = JSON.parse(metadataText).originalName || 'imported-report.docx';
    res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(originalName)}`);
    res.send(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return res.status(404).json({ message: 'Word 临时导入文件不存在或已使用，请重新选择文件' });
    throw error;
  } finally {
    await Promise.allSettled([fs.unlink(templatePath), fs.unlink(metadataPath)]);
  }
}));

app.post('/api/word-import/optimize', auth, express.raw({
  type: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream'],
  limit: WORD_IMPORT_HARD_LIMIT,
}), asyncRoute(async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ message: '未收到 DOCX 文件内容' });
  const result = await optimizeDocxForWordImport(req.body);
  res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('X-BMPBGS-Original-Size', String(result.originalSize));
  res.setHeader('X-BMPBGS-Optimized-Size', String(result.optimizedSize));
  res.setHeader('X-BMPBGS-Optimized-Images', String(result.optimizedImages));
  res.setHeader('X-BMPBGS-Optimization-Pass', String(result.pass));
  res.send(result.data);
}));

app.get('/api/projects/:id/report-template', auth, asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const templatePath = path.join(storageRoot, 'projects', projectId, 'report-template.docx');
  try {
    const metadataPath = path.join(storageRoot, 'projects', projectId, 'report-template.json');
    let originalName = 'imported-report.docx';
    try { originalName = JSON.parse(await fs.readFile(metadataPath, 'utf8')).originalName || originalName; } catch { /* metadata is optional */ }
    const content = await fs.readFile(templatePath);
    res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(originalName)}`);
    return res.send(content);
  } catch {
    return res.status(404).json({ message: '该项目尚未上传 Word 报告' });
  }
}));

app.get('/api/projects/:id/export/:format', auth, asyncRoute(async (req, res) => {
  const format = z.enum(['docx', 'pdf']).parse(req.params.format);
  let generated;
  try { generated = await buildProjectDocx(String(req.params.id)); }
  catch (error) { return res.status(409).json({ message: error instanceof Error ? error.message : '报告内容校验失败，未生成文件' }); }
  if (!generated) return res.status(404).json({ message: '项目不存在' });
  const reportCode = generated.project.report_code || generated.project.code;
  let refreshed: Buffer;
  try { refreshed = await refreshReportFields(generated.buffer, format); }
  catch (error) {
    console.error('Word report field refresh failed', error);
    if (format === 'pdf') {
      return res.status(500).json({ message: 'PDF 生成失败：' + (error instanceof Error ? error.message : String(error)) });
    }
    // The DOCX still carries w:updateFields so Word can refresh the TOC when opened.
    refreshed = generated.buffer;
    res.setHeader('X-Report-Fields-Refresh', 'on-open');
  }
  if (format === 'docx') {
    res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeFileName(reportCode + '-' + generated.project.system_name) + '.docx')}`);
    return res.send(refreshed);
  }
  res.type('application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeFileName(reportCode + '-' + generated.project.system_name) + '.pdf')}`);
  return res.send(refreshed);
}));

function planningFieldValue(data: Record<string, unknown>, id: string) {
  const fields = Array.isArray(data.fields) ? data.fields as Array<Record<string, unknown>> : [];
  return String(fields.find(field => field?.id === id)?.value || '').trim();
}

function planningPhaseDates(data: Record<string, unknown>) {
  return Array.from({ length: 4 }, (_, offset) => {
    const phase = offset + 1;
    return {
      start: planningFieldValue(data, `plan-phase-${phase}-start`),
      end: planningFieldValue(data, `plan-phase-${phase}-end`),
    };
  });
}

function validatePlanningPhaseDates(phases: Array<{ start: string; end: string }>) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const validIsoDate = (value: string) => {
    if (!iso.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  };
  let previous = '';
  for (let index = 0; index < phases.length; index += 1) {
    const phase = phases[index];
    if ((phase.start && !validIsoDate(phase.start)) || (phase.end && !validIsoDate(phase.end))) return `第${index + 1}阶段日期格式不正确`;
    if (phase.start && phase.end && phase.start > phase.end) return `第${index + 1}阶段结束时间不能早于开始时间`;
    for (const value of [phase.start, phase.end]) {
      if (!value) continue;
      if (previous && previous > value) return `第${index + 1}阶段日期不能早于前序阶段日期`;
      previous = value;
    }
  }
  return '';
}

app.put('/api/projects/:id/stages/:stageKey', auth, asyncRoute(async (req, res) => {
  const input = z.object({ data: z.record(z.string(), z.unknown()), completion: z.number().int().min(0).max(100) }).parse(req.body);
  const isPlanning = String(req.params.stageKey) === 'planning';
  const phaseDates = isPlanning ? planningPhaseDates(input.data) : [];
  const phaseDateError = isPlanning ? validatePlanningPhaseDates(phaseDates) : '';
  if (phaseDateError) return res.status(400).json({ message: phaseDateError });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const projectResult = await client.query('SELECT start_date,end_date FROM projects WHERE id=$1 FOR UPDATE', [req.params.id]);
    const project = projectResult.rows[0];
    if (!project) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: '项目不存在' });
    }
    const currentStart = project.start_date ? String(project.start_date).slice(0, 10) : '';
    const currentEnd = project.end_date ? String(project.end_date).slice(0, 10) : '';
    const derivedStart = isPlanning ? phaseDates[0].start : currentStart;
    const derivedEnd = isPlanning ? phaseDates[3].end : currentEnd;
    const sourceDates = (input.data.projectDates || {}) as Record<string, unknown>;
    const sourceStart = isPlanning ? currentStart : (sourceDates.startDate ?? currentStart);
    const sourceEnd = isPlanning ? currentEnd : (sourceDates.endDate ?? currentEnd);
    const data = syncProjectDatesInStageData(input.data,
      sourceStart, derivedStart, sourceEnd, derivedEnd);
    if (isPlanning && (derivedStart !== currentStart || derivedEnd !== currentEnd)) {
      await client.query('UPDATE projects SET start_date=$1,end_date=$2,updated_at=now() WHERE id=$3',
        [derivedStart || null, derivedEnd || null, req.params.id]);
      const otherStages = await client.query(
        'SELECT stage_key,data FROM project_stage_records WHERE project_id=$1 AND stage_key<>$2 FOR UPDATE',
        [req.params.id, req.params.stageKey],
      );
      for (const stage of otherStages.rows) {
        const synced = syncProjectDatesInStageData(stage.data || {}, currentStart, derivedStart, currentEnd, derivedEnd);
        await client.query(
          'UPDATE project_stage_records SET data=$1,updated_at=now(),updated_by=$2 WHERE project_id=$3 AND stage_key=$4',
          [synced, req.user!.id, req.params.id, stage.stage_key],
        );
      }
    }
    if (String(req.params.stageKey) === 'onsite') {
      data.onsiteEvidenceGroups = await materializeEvidenceGroups(client, String(req.params.id), data.onsiteEvidenceGroups, req.user!.id);
    }
    const existingStage = await client.query(
      'SELECT completion FROM project_stage_records WHERE project_id=$1 AND stage_key=$2',
      [req.params.id, req.params.stageKey],
    );
    const completion = calculateStageCompletion(String(req.params.stageKey), data, Number(existingStage.rows[0]?.completion || 0));
    const result = await client.query(
      `UPDATE project_stage_records SET data=$1, completion=$2, updated_by=$3, updated_at=now()
       WHERE project_id=$4 AND stage_key=$5 RETURNING *`,
      [data, completion, req.user!.id, req.params.id, req.params.stageKey],
    );
    const stageProgress = await client.query('SELECT stage_key,completion FROM project_stage_records WHERE project_id=$1', [req.params.id]);
    const summary = deriveProjectProgress(stageProgress.rows);
    await client.query(`UPDATE projects SET progress=$2,current_stage=$3,
      status=CASE WHEN status='archived' THEN status ELSE $4 END,updated_at=now() WHERE id=$1`,
      [req.params.id, summary.progress, summary.currentStage, summary.status]);
    await client.query('COMMIT');
    res.json({ ...result.rows[0], projectDates: { startDate: derivedStart, endDate: derivedEnd } });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.get('/api/users', auth, asyncRoute(async (_req, res) => {
  const result = await pool.query(`SELECT id, username, display_name, role, status, certificate_date, certificate_no,
    certificate_file_name, certificate_file_path, must_change_password, last_login_at, created_at FROM users ORDER BY created_at`);
  res.json(result.rows);
}));

function defaultPasswordForUsername(username: string) {
  return `${username.slice(-4)}@Pwd${String(new Date().getFullYear()).slice(-2)}`;
}

app.get('/api/users/import-template', auth, asyncRoute(async (req, res) => {
  if (req.user!.role !== 'admin') return res.status(403).json({ message: '仅管理员可下载用户导入模板' });
  const workbook = await buildUserImportWorkbook();
  res.json({ name: '用户批量导入模板.xlsx', dataBase64: workbook.toString('base64') });
}));

app.post('/api/users/import', auth, asyncRoute(async (req, res) => {
  if (req.user!.role !== 'admin') return res.status(403).json({ message: '仅管理员可批量导入用户' });
  const input = z.object({ name: z.string().min(1).max(255), dataBase64: z.string().min(1).max(15_000_000) }).parse(req.body);
  if (!/\.xlsx$/i.test(input.name)) return res.status(400).json({ message: '请选择 .xlsx 用户导入文件' });
  let rows;
  try {
    rows = await parseUserImportWorkbook(Buffer.from(input.dataBase64, 'base64'));
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : '用户导入文件解析失败' });
  }
  const usernames = rows.map(row => row.username.toLowerCase());
  const existing = await pool.query('SELECT username FROM users WHERE lower(username)=ANY($1::text[]) ORDER BY username', [usernames]);
  if (existing.rows.length) {
    return res.status(409).json({ message: `以下用户名已存在：${existing.rows.map(row => row.username).join('、')}` });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = [];
    for (const row of rows) {
      const defaultPassword = defaultPasswordForUsername(row.username);
      const result = await client.query(
        `INSERT INTO users(username,display_name,password_hash,role,status,certificate_date,must_change_password)
         VALUES($1,$2,crypt($3,gen_salt('bf')),$4,'pending',$5,true)
         RETURNING id,username,display_name,role,status,certificate_date,created_at`,
        [row.username, row.displayName, defaultPassword, row.role, row.certificateDate],
      );
      created.push({ ...result.rows[0], defaultPassword });
    }
    await client.query(
      `INSERT INTO audit_logs(user_id,action,entity_type,entity_id,detail,ip_address)
       VALUES($1,'batch_import','user','batch',$2,$3)`,
      [req.user!.id, JSON.stringify({ count: created.length, usernames: created.map(user => user.username) }), req.ip || null],
    );
    await client.query('COMMIT');
    res.status(201).json({ created: created.length, users: created });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.post('/api/users', auth, asyncRoute(async (req, res) => {
  if (req.user!.role !== 'admin') return res.status(403).json({ message: '仅管理员可新增用户' });
  const input = z.object({ username: z.string().regex(/^[A-Za-z0-9_]{3,20}$/), displayName: z.string().min(2), role: z.enum(['admin','manager','evaluator','reviewer']), certificateDate: z.string().optional().nullable(), certificateFileName: z.string().max(255).optional().nullable(), certificateFileData: z.string().max(8_000_000).optional().nullable() }).parse(req.body);
  const defaultPassword = defaultPasswordForUsername(input.username);
  const result = await pool.query(
    `INSERT INTO users(username,display_name,password_hash,role,status,certificate_date,certificate_file_name,certificate_file_path,must_change_password)
     VALUES($1,$2,crypt($3,gen_salt('bf')),$4,'pending',$5,$6,$7,true)
     RETURNING id,username,display_name,role,status,certificate_date,certificate_file_name,created_at`,
    [input.username, input.displayName, defaultPassword, input.role, input.certificateDate || null, input.certificateFileName || null, input.certificateFileData || null],
  );
  res.status(201).json({ user: result.rows[0], defaultPassword });
}));

app.put('/api/users/:id', auth, asyncRoute(async (req, res) => {
  if (req.user!.role !== 'admin') return res.status(403).json({ message: '仅管理员可编辑用户' });
  const input = z.object({ displayName: z.string().min(2), role: z.enum(['admin','manager','evaluator','reviewer']), certificateDate: z.string().optional().nullable(), certificateFileName: z.string().max(255).optional().nullable(), certificateFileData: z.string().max(8_000_000).optional().nullable() }).parse(req.body);
  const result = await pool.query(
    `UPDATE users SET display_name=$1,role=$2,certificate_date=$3,certificate_file_name=$4,
      certificate_file_path=COALESCE($5,certificate_file_path),updated_at=now() WHERE id=$6
      RETURNING id,username,display_name,role,status,certificate_date,certificate_file_name,certificate_file_path,created_at`,
    [input.displayName, input.role, input.certificateDate || null, input.certificateFileName || null, input.certificateFileData || null, req.params.id],
  );
  if (!result.rows[0]) return res.status(404).json({ message: '用户不存在' });
  res.json(result.rows[0]);
}));

app.post('/api/users/:id/reset-password', auth, asyncRoute(async (req, res) => {
  if (req.user!.role !== 'admin') return res.status(403).json({ message: '仅管理员可重置密码' });
  const found = await pool.query('SELECT username FROM users WHERE id=$1', [req.params.id]);
  if (!found.rows[0]) return res.status(404).json({ message: '用户不存在' });
  const defaultPassword = defaultPasswordForUsername(found.rows[0].username);
  await pool.query(`UPDATE users SET password_hash=crypt($1,gen_salt('bf')),must_change_password=true,status='pending',updated_at=now() WHERE id=$2`, [defaultPassword, req.params.id]);
  res.json({ reset: true, defaultPassword });
}));

app.patch('/api/users/:id/status', auth, asyncRoute(async (req, res) => {
  if (req.user!.role !== 'admin') return res.status(403).json({ message: '仅管理员可修改状态' });
  const input = z.object({ status: z.enum(['active','pending','disabled']) }).parse(req.body);
  const result = await pool.query('UPDATE users SET status=$1,updated_at=now() WHERE id=$2 RETURNING id,status', [input.status, req.params.id]);
  res.json(result.rows[0]);
}));

app.get('/api/settings/institution', auth, asyncRoute(async (_req, res) => {
  const result = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key='institution'`);
  res.json(result.rows[0]?.setting_value || defaultInstitution);
}));

app.put('/api/settings/institution', auth, asyncRoute(async (req, res) => {
  if (req.user!.role !== 'admin') return res.status(403).json({ message: '仅管理员可修改测评机构信息' });
  const input = z.object({
    name: z.string().min(2), address: z.string(), postalCode: z.string(), contact: z.string(), title: z.string(),
    department: z.string(), telephone: z.string(), mobile: z.string(), email: z.string(),
  }).parse(req.body);
  await pool.query(`UPDATE system_settings SET setting_value=$1,updated_by=$2,updated_at=now() WHERE setting_key='institution'`, [input, req.user!.id]);
  res.json(input);
}));

const riskTemplateSchema = z.object({
  id: z.string().min(1).max(100),
  layer: z.string().min(1).max(100),
  unit: z.string().min(1).max(200),
  result: z.string().min(1).max(40),
  threat: z.string().max(100),
  analysis: z.string().max(5000),
  advice: z.string().max(5000),
  defaultLevel: z.enum(['高', '中', '低']),
  version: z.number().int().min(1).max(9999),
  enabled: z.boolean(),
});

app.get('/api/settings/risk-templates', auth, asyncRoute(async (_req, res) => {
  const result = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key='risk_templates'`);
  res.json(result.rows[0]?.setting_value || defaultRiskTemplates);
}));

app.put('/api/settings/risk-templates', auth, asyncRoute(async (req, res) => {
  if (req.user!.role !== 'admin') return res.status(403).json({ message: '仅管理员可维护风险模板' });
  const input = z.array(riskTemplateSchema).max(500).parse(req.body);
  await pool.query(
    `INSERT INTO system_settings(setting_key,setting_value,updated_by,updated_at) VALUES('risk_templates',$1,$2,now())
     ON CONFLICT(setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_by=EXCLUDED.updated_by,updated_at=now()`,
    [JSON.stringify(input), req.user!.id],
  );
  res.json(input);
}));

app.post('/api/settings/risk-templates/import', auth, asyncRoute(async (req, res) => {
  if (req.user!.role !== 'admin') return res.status(403).json({ message: '仅管理员可导入风险模板' });
  const input = z.object({ name: z.string().min(1), dataBase64: z.string().min(1) }).parse(req.body);
  if (!/\.xlsx$/i.test(input.name)) return res.status(400).json({ message: '请选择 .xlsx 风险模板文件' });
  const rows = await parseRiskTemplateWorkbook(Buffer.from(input.dataBase64, 'base64'));
  res.json(rows);
}));

app.post('/api/settings/risk-templates/export', auth, asyncRoute(async (req, res) => {
  const input = z.array(riskTemplateSchema).max(500).parse(req.body);
  const workbook = await buildRiskTemplateWorkbook(input);
  res.json({ name: '风险模板导入模板.xlsx', dataBase64: workbook.toString('base64') });
}));

async function listRawTemplates(dir = rawTemplateRoot, prefix = ''): Promise<Array<{ path: string; size: number }>> {
  const result: Array<{ path: string; size: number }> = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await listRawTemplates(full, nextPrefix));
    else if (entry.isFile()) result.push({ path: nextPrefix, size: (await fs.stat(full)).size });
  }
  return result;
}

app.get('/api/templates', auth, asyncRoute(async (_req, res) => {
  let report: { name: string; size: number; updatedAt: string } | null = null;
  try {
    const stat = await fs.stat(defaultReportTemplate);
    let name = 'default-report-template.docx';
    try { name = JSON.parse(await fs.readFile(path.join(path.dirname(defaultReportTemplate), 'metadata.json'), 'utf8')).originalName || name; } catch { /* use physical file name */ }
    report = { name, size: stat.size, updatedAt: stat.mtime.toISOString() };
  } catch { /* no default template yet */ }
  let report2: typeof report = null;
  try {
    const stat = await fs.stat(levelTwoReportTemplate);
    const meta = JSON.parse(await fs.readFile(path.join(path.dirname(levelTwoReportTemplate), 'metadata.json'), 'utf8'));
    report2 = { name: meta.originalName || '二级报告模板.docx', size: stat.size, updatedAt: stat.mtime.toISOString() };
  } catch { /* Level two has an independent template. */ }
  res.json({ report, report2, rawRecords: await listRawTemplates() });
}));

app.get('/api/templates/report/download', auth, asyncRoute(async (req, res) => {
  const systemLevel = Number(req.query.systemLevel) === 2 ? 2 : 3;
  const templatePath = reportTemplateForLevel(systemLevel);
  const fallbackName = systemLevel === 2 ? '二级报告模板.docx' : '三级报告模板.docx';
  let name = fallbackName;
  try {
    const metadata = JSON.parse(await fs.readFile(path.join(path.dirname(templatePath), 'metadata.json'), 'utf8'));
    name = String(metadata.originalName || fallbackName);
  } catch { /* metadata is optional */ }
  const content = await fs.readFile(templatePath).catch(() => null);
  if (!content) return res.status(404).json({ message: systemLevel === 2 ? '尚未配置二级报告模板' : '尚未配置三级报告模板' });
  res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send(content);
}));

app.get('/api/templates/records/download', auth, asyncRoute(async (_req, res) => {
  const files = await listRawTemplates();
  if (!files.length) return res.status(404).json({ message: '尚未配置原始记录模板' });
  const archive = new JSZip();
  for (const file of files) {
    archive.file(file.path, await fs.readFile(path.join(rawTemplateRoot, ...file.path.split('/'))));
  }
  const content = await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const name = '原始记录模板.zip';
  res.type('application/zip');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send(content);
}));

app.post('/api/templates/report', auth, asyncRoute(async (req, res) => {
  if (req.user!.role !== 'admin') return res.status(403).json({ message: '仅管理员可配置模板' });
  const input = z.object({ systemLevel: z.union([z.literal(2), z.literal(3)]).default(3), name: z.string().min(1).max(255), dataBase64: z.string().min(1) }).parse(req.body);
  if (!input.name.toLowerCase().endsWith('.docx')) return res.status(400).json({ message: '报告模板必须为 DOCX 文件' });
  const templatePath = reportTemplateForLevel(input.systemLevel);
  await fs.mkdir(path.dirname(templatePath), { recursive: true });
  await fs.writeFile(templatePath, Buffer.from(input.dataBase64, 'base64'));
  await fs.writeFile(path.join(path.dirname(templatePath), 'metadata.json'), JSON.stringify({ originalName: input.name, uploadedAt: new Date().toISOString() }, null, 2));
  res.json({ stored: true });
}));

app.post('/api/templates/records', auth, asyncRoute(async (req, res) => {
  if (req.user!.role !== 'admin') return res.status(403).json({ message: '仅管理员可配置模板' });
  const input = z.object({ files: z.array(z.object({ path: z.string().min(1).max(500), dataBase64: z.string() })).min(1).max(1000) }).parse(req.body);
  const relativePaths = normalizeRawTemplateUploadPaths(input.files.map(file => file.path));
  if (!relativePaths.some(relative => relative.toLowerCase().endsWith('.docx'))) {
    return res.status(400).json({ message: '原始记录模板文件夹中必须包含 DOCX 文件' });
  }
  const batchId = randomUUID();
  const templateParent = path.dirname(rawTemplateRoot);
  const stagingRoot = path.join(templateParent, `.records-upload-${batchId}`);
  const backupRoot = path.join(templateParent, `.records-backup-${batchId}`);
  let previousMoved = false;
  try {
    await fs.mkdir(stagingRoot, { recursive: true });
    for (let index = 0; index < input.files.length; index++) {
      const destination = path.join(stagingRoot, ...relativePaths[index].split('/'));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, Buffer.from(input.files[index].dataBase64, 'base64'));
    }
    try {
      await fs.rename(rawTemplateRoot, backupRoot);
      previousMoved = true;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
    try {
      await fs.rename(stagingRoot, rawTemplateRoot);
    } catch (error) {
      if (previousMoved) await fs.rename(backupRoot, rawTemplateRoot);
      throw error;
    }
    if (previousMoved) await fs.rm(backupRoot, { recursive: true, force: true });
    res.json({ stored: input.files.length, replaced: true });
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}));

app.get('/api/templates/records/content', auth, asyncRoute(async (_req, res) => {
  const files = await listRawTemplates();
  const content = await Promise.all(files.map(async file => ({
    path: file.path,
    dataBase64: (await fs.readFile(path.join(rawTemplateRoot, ...file.path.split('/')))).toString('base64'),
  })));
  res.json({ files: content });
}));

app.post('/api/projects/:id/original-records', auth, asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const [projectResult, stagesResult, institutionResult] = await Promise.all([
    pool.query(`SELECT p.*,u.display_name AS owner_name FROM projects p LEFT JOIN users u ON u.id=p.owner_id WHERE p.id=$1`, [projectId]),
    pool.query('SELECT stage_key,data FROM project_stage_records WHERE project_id=$1', [projectId]),
    pool.query(`SELECT setting_value FROM system_settings WHERE setting_key='institution'`),
  ]);
  const project = projectResult.rows[0];
  if (!project) return res.status(404).json({ message: '项目不存在' });
  const onsiteStage = stagesResult.rows.find(stage => stage.stage_key === 'onsite');
  if (onsiteStage?.data) {
    onsiteStage.data = structuredClone(onsiteStage.data);
    onsiteStage.data.onsiteEvidenceGroups = await hydrateEvidenceGroups(projectId, onsiteStage.data.onsiteEvidenceGroups || []);
  }
  const files = await generateRawRecords(rawTemplateRoot, {
    project,
    stages: stagesResult.rows,
    institution: institutionResult.rows[0]?.setting_value || defaultInstitution,
  });
  res.json({
    folderName: safeFileName(`${project.report_code || project.code}${project.system_name || ''}原始记录`),
    files: files.map(file => ({ path: file.path.replace(/\\/g, '/'), dataBase64: file.data.toString('base64') })),
  });
}));

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  if (error instanceof DocxOptimizeError) return res.status(error.status).json({ message: error.message });
  if (typeof error === 'object' && error && 'type' in error && error.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Word 文件超过 150 MiB，系统不会读取该文件。' });
  }
  if (error instanceof z.ZodError) return res.status(400).json({ message: '提交内容校验失败', issues: error.issues });
  if (typeof error === 'object' && error && 'code' in error && error.code === '23505') return res.status(409).json({ message: '编号或用户名已存在' });
  res.status(500).json({ message: '服务器处理失败' });
});

async function recalculateStoredProjectProgress() {
  const projects = await pool.query(`SELECT id FROM projects WHERE status NOT IN ('completed','archived')`);
  for (const project of projects.rows) {
    const stages = await pool.query('SELECT stage_key,data,completion FROM project_stage_records WHERE project_id=$1', [project.id]);
    for (const stage of stages.rows) {
      stage.completion = calculateStageCompletion(stage.stage_key, stage.data || {}, Number(stage.completion || 0));
      await pool.query('UPDATE project_stage_records SET completion=$3 WHERE project_id=$1 AND stage_key=$2',
        [project.id, stage.stage_key, stage.completion]);
    }
    const summary = deriveProjectProgress(stages.rows);
    await pool.query('UPDATE projects SET progress=$2,current_stage=$3,status=$4 WHERE id=$1',
      [project.id, summary.progress, summary.currentStage, summary.status]);
  }
}

ensureRuntimeSchema().then(async () => {
  await recalculateStoredProjectProgress();
  app.listen(port, '127.0.0.1', () => {
    console.log(`BB Miping API listening on http://127.0.0.1:${port}`);
  });
}).catch(error => {
  console.error('Failed to initialize runtime schema', error);
  process.exitCode = 1;
});

