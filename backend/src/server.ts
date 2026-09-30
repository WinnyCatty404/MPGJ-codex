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
import { writeAppendixBImages, writePlanningImages, writeReportEvidence } from './report-evidence.js';
import { allowLatinWordWrap, formatAppendixBHeadings, formatFigureOneOne, formatLatinFonts, formatReportTables, normalizeBasicInfoTemplateValues, normalizeCheckboxLabelSpacing, prepareLevelTwoTemplate, replaceReportSlots, specializeReportTemplate, unresolvedReportSlots } from './report-template.js';
import { generatePreviousAssessment } from './previous-assessment.js';
import { generateRawRecords } from './raw-records.js';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const { Pool } = pg;
const port = Number(process.env.PORT || 3100);
const jwtSecret = process.env.JWT_SECRET || 'development-only-change-me';
const execFileAsync = promisify(execFile);
const storageRoot = fileURLToPath(new URL('../../storage/', import.meta.url));
const defaultReportTemplate = path.join(storageRoot, 'templates', 'report', 'default-report-template.docx');
const levelTwoReportTemplate = path.join(storageRoot, 'templates', 'report', 'level-2', 'default-report-template.docx');
const reportTemplateForLevel = (level: number) => level === 2 ? levelTwoReportTemplate : defaultReportTemplate;
const rawTemplateRoot = path.join(storageRoot, 'templates', 'records');
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://bb_miping_app:BbMiping-App-2026!@127.0.0.1:54328/bb_miping',
});

type AuthRequest = Request & { user?: { id: string; username: string; role: string } };

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

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || '未命名';
}

function safeRelativePath(value: string) {
  const normalized = value.replace(/\\/g, '/').split('/').filter(part => part && part !== '.');
  if (!normalized.length || normalized.some(part => part === '..')) throw new Error('模板路径无效');
  return normalized.join('/');
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
  for (const name of Object.keys(values)) values[name] = normalizeCheckboxLabelSpacing(values[name]);
  const replacements = Object.fromEntries(Object.entries(values).map(([name, value]) => [`{{${name}}}`, value]));
  replacements['{{报告编号}}}'] = values['报告编号']; // 兼容封面多写的一个右花括号。
  const planningImages = Object.fromEntries((stageData.planning?.images || []).map((image: { id: string; src: string }) => [image.id, image.src]));
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
      xml = await writePlanningImages(xml, zip, planningImages);
      xml = await writeReportEvidence(xml, zip, stageData.onsite?.onsiteRecords || {});
      xml = await writeAppendixBImages(xml, zip, stageData.reporting?.appendixBImages || {});
    }
    xml = replaceReportSlots(xml, replacements);
    if (name === 'word/document.xml') {
      xml = formatAppendixBHeadings(xml);
      xml = formatFigureOneOne(xml);
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
      timeout: 180000,
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
      timeout: 180000,
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

app.get('/api/health', asyncRoute(async (_req, res) => {
  const result = await pool.query('SELECT current_database() AS database, now() AS time');
  res.json({ ok: true, ...result.rows[0] });
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

app.post('/api/projects', auth, asyncRoute(async (req, res) => {
  const input = z.object({
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
      [projectCode, input.reportCode || null, input.systemName, input.orgName, input.assessmentYear, input.systemLevel, input.startDate || null, input.endDate || null, req.user!.id],
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
  const result = await pool.query(
    `UPDATE projects SET report_code=$1,system_name=$2,org_name=$3,assessment_year=$4,
      system_level=$5,start_date=$6,end_date=$7,updated_at=now() WHERE id=$8 RETURNING *`,
    [input.reportCode || null, input.systemName, input.orgName, input.assessmentYear,
      input.systemLevel, input.startDate || null, input.endDate || null, req.params.id],
  );
  if (!result.rows[0]) return res.status(404).json({ message: '项目不存在' });
  res.json(result.rows[0]);
}));

app.delete('/api/projects/:id', auth, asyncRoute(async (req, res) => {
  const result = await pool.query('DELETE FROM projects WHERE id=$1 RETURNING id,system_name', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ message: '项目不存在' });
  res.json({ deleted: true, project: result.rows[0] });
}));

app.post('/api/projects/:id/copy', auth, asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sourceResult = await client.query('SELECT * FROM projects WHERE id=$1 FOR SHARE', [projectId]);
    const source = sourceResult.rows[0];
    if (!source) { await client.query('ROLLBACK'); return res.status(404).json({ message: '项目不存在' }); }
    await client.query('SELECT pg_advisory_xact_lock($1)', [900000 + source.assessment_year]);
    const sequence = await client.query(
      `SELECT COALESCE(MAX((regexp_match(code, '^MP-' || $1 || '-([0-9]+)$'))[1]::int),0)+1 AS next_no
       FROM projects WHERE code ~ ('^MP-' || $1 || '-[0-9]+$')`,
      [String(source.assessment_year)],
    );
    const code = `MP-${source.assessment_year}-${String(sequence.rows[0].next_no).padStart(3, '0')}`;
    const copied = await client.query(
      `INSERT INTO projects(code,report_code,system_name,org_name,assessment_year,system_level,status,current_stage,progress,start_date,end_date,owner_id,created_by)
       SELECT $1,report_code,system_name,org_name,assessment_year,system_level,status,current_stage,progress,start_date,end_date,owner_id,$2
       FROM projects WHERE id=$3 RETURNING *`,
      [code, req.user!.id, projectId],
    );
    const newId = copied.rows[0].id;
    await client.query(`INSERT INTO project_stage_records(project_id,stage_key,title,data,completion,updated_by)
      SELECT $1,stage_key,title,data,completion,$2 FROM project_stage_records WHERE project_id=$3`, [newId, req.user!.id, projectId]);
    await client.query(`INSERT INTO project_members(project_id,user_id,member_role) SELECT $1,user_id,member_role FROM project_members WHERE project_id=$2`, [newId, projectId]);
    await client.query(`INSERT INTO asset_items(project_id,category,name,importance,details,sort_order) SELECT $1,category,name,importance,details,sort_order FROM asset_items WHERE project_id=$2`, [newId, projectId]);
    await client.query(`INSERT INTO assessment_records(project_id,domain,indicator_code,indicator_name,target_name,applicable,result,score,evidence,analysis,risk_level,updated_by) SELECT $1,domain,indicator_code,indicator_name,target_name,applicable,result,score,evidence,analysis,risk_level,$3 FROM assessment_records WHERE project_id=$2`, [newId, projectId, req.user!.id]);
    await client.query(`INSERT INTO risks(project_id,domain,issue_description,threat_code,risk_analysis,risk_level,recommendation,status) SELECT $1,domain,issue_description,threat_code,risk_analysis,risk_level,recommendation,status FROM risks WHERE project_id=$2`, [newId, projectId]);
    await client.query(`INSERT INTO evidence_files(project_id,stage_key,evidence_type,original_name,storage_path,mime_type,file_size,uploaded_by) SELECT $1,stage_key,evidence_type,original_name,storage_path,mime_type,file_size,$3 FROM evidence_files WHERE project_id=$2`, [newId, projectId, req.user!.id]);
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

app.put('/api/projects/:id/stages/:stageKey', auth, asyncRoute(async (req, res) => {
  const input = z.object({ data: z.record(z.string(), z.unknown()), completion: z.number().int().min(0).max(100) }).parse(req.body);
  const result = await pool.query(
    `UPDATE project_stage_records SET data=$1, completion=$2, updated_by=$3, updated_at=now()
     WHERE project_id=$4 AND stage_key=$5 RETURNING *`,
    [input.data, input.completion, req.user!.id, req.params.id, req.params.stageKey],
  );
  await pool.query(
    `UPDATE projects SET progress=(SELECT round(avg(completion)) FROM project_stage_records WHERE project_id=$1), updated_at=now() WHERE id=$1`,
    [req.params.id],
  );
  res.json(result.rows[0]);
}));

app.get('/api/users', auth, asyncRoute(async (_req, res) => {
  const result = await pool.query(`SELECT id, username, display_name, role, status, certificate_date, certificate_no,
    certificate_file_name, certificate_file_path, must_change_password, last_login_at, created_at FROM users ORDER BY created_at`);
  res.json(result.rows);
}));

app.post('/api/users', auth, asyncRoute(async (req, res) => {
  if (req.user!.role !== 'admin') return res.status(403).json({ message: '仅管理员可新增用户' });
  const input = z.object({ username: z.string().regex(/^[A-Za-z0-9_]{3,20}$/), displayName: z.string().min(2), role: z.enum(['admin','manager','evaluator','reviewer']), certificateDate: z.string().optional().nullable(), certificateFileName: z.string().max(255).optional().nullable(), certificateFileData: z.string().max(8_000_000).optional().nullable() }).parse(req.body);
  const defaultPassword = `${input.username.slice(-4)}@Pwd${String(new Date().getFullYear()).slice(-2)}`;
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
  const defaultPassword = `${found.rows[0].username.slice(-4)}@Pwd${String(new Date().getFullYear()).slice(-2)}`;
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
  await fs.mkdir(rawTemplateRoot, { recursive: true });
  for (const file of input.files) {
    const relative = safeRelativePath(file.path);
    const destination = path.join(rawTemplateRoot, ...relative.split('/'));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, Buffer.from(file.dataBase64, 'base64'));
  }
  res.json({ stored: input.files.length });
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
  const files = await generateRawRecords(rawTemplateRoot, {
    project,
    stages: stagesResult.rows,
    institution: institutionResult.rows[0]?.setting_value || defaultInstitution,
  });
  res.json({
    folderName: safeFileName(`${project.report_code || project.code}原始记录`),
    files: files.map(file => ({ path: file.path.replace(/\\/g, '/'), dataBase64: file.data.toString('base64') })),
  });
}));

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  if (error instanceof z.ZodError) return res.status(400).json({ message: '提交内容校验失败', issues: error.issues });
  if (typeof error === 'object' && error && 'code' in error && error.code === '23505') return res.status(409).json({ message: '编号或用户名已存在' });
  res.status(500).json({ message: '服务器处理失败' });
});

ensureRuntimeSchema().then(() => {
  app.listen(port, '127.0.0.1', () => {
    console.log(`BB Miping API listening on http://127.0.0.1:${port}`);
  });
}).catch(error => {
  console.error('Failed to initialize runtime schema', error);
  process.exitCode = 1;
});

