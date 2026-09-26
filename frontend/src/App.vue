<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';

type Page = 'dashboard' | 'projects' | 'workspace' | 'users' | 'templates' | 'institution';
type User = { id: string; username: string; display_name: string; role: string; status: string; certificate_date?: string; certificate_file_name?: string; certificate_file_path?: string; must_change_password?: boolean; last_login_at?: string; created_at?: string };
type Project = { id: string; code: string; report_code?: string; system_name: string; org_name: string; assessment_year: number; system_level: number; status: string; current_stage: number; progress: number; start_date?: string; end_date?: string; owner_name?: string; high_risk_count?: number; system_score?: number; stages?: Stage[]; risks?: Risk[]; assets?: Asset[] };
type Stage = { id: string; stage_key: string; title: string; completion: number; data: Record<string, unknown> };
type Risk = { id: string; domain: string; issue_description: string; risk_level: string; status: string };
type Asset = { id: string; category: string; name: string; importance: string; details: Record<string, unknown> };
type PlanningField = { key: string; label: string; placeholder: string; multiline?: boolean };
type PlanningModule = { key: string; title: string; note: string; fields: PlanningField[] };

const apiBase = '/api';
const token = ref(localStorage.getItem('bb-token') || '');
const currentUser = ref<User | null>(null);
const page = ref<Page>(token.value ? 'dashboard' : 'dashboard');
const loading = ref(false);
const loginError = ref('');
const toast = ref('');
const loginForm = reactive({ username: 'admin', password: 'Admin@123' });
const projects = ref<Project[]>([]);
const users = ref<User[]>([]);
const selectedProject = ref<Project | null>(null);
const activeStage = ref(0);
const showProjectModal = ref(false);
const editingProjectId = ref('');
const projectToDelete = ref<Project | null>(null);
const showUserModal = ref(false);
const editingUserId = ref('');
const certificateFileData = ref('');
const showPasswordModal = ref(false);
const passwordForm = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' });
const userFilters = reactive({ search: '', status: '' });
const templateInfo = ref<any>({ report: null, rawRecords: [] });
const importTargetProject = ref<Project | null>(null);
const institutionForm = reactive({ name: '', address: '', postalCode: '', contact: '', title: '', department: '', telephone: '', mobile: '', email: '' });
const activePlanningModule = ref<PlanningModule | null>(null);
const planningForm = reactive<Record<string, string>>({});

function indentEveryParagraph(value: string) {
  return String(value || '').replace(/\r\n?/g, '\n').split('\n').map(line =>
    line.trim() ? '\u3000\u3000' + line.replace(/^[ \t\u3000]+/, '') : line,
  ).join('\n');
}
function handleParagraphEnter(event: KeyboardEvent) {
  if (event.isComposing) return;
  const target = event.target as HTMLTextAreaElement;
  event.preventDefault();
  target.setRangeText('\n\u3000\u3000', target.selectionStart, target.selectionEnd, 'end');
  target.dispatchEvent(new Event('input', { bubbles: true }));
}
function normalizePlanningParagraph(key: string) {
  planningForm[key] = indentEveryParagraph(planningForm[key] || '');
}
const filters = reactive({ search: '', year: '', level: '', status: '' });
const dashboard = ref<any>({ summary: {}, stages: [], recent: [], risks: [] });
const projectForm = reactive({ code: '', reportCode: '', systemName: '', orgName: '', assessmentYear: 2026, systemLevel: 3, startDate: '', endDate: '' });
const userForm = reactive({ username: '', displayName: '', role: 'evaluator', certificateDate: '', certificateFileName: '' });

const stageMeta = [
  { key: 'preparation', short: '项目准备', icon: '01', hint: '单位与项目基础资料' },
  { key: 'planning', short: '方案编制', icon: '02', hint: '资产、对象、指标和计划' },
  { key: 'onsite', short: '现场测评', icon: '03', hint: '逐项记录与证据核验' },
  { key: 'reporting', short: '报告编制', icon: '04', hint: '风险、评分与报告生成' },
  { key: 'review', short: '报告导出', icon: '05', hint: '导出 Word 与 PDF 正式报告' },
];

const statusMap: Record<string, string> = { draft: '草稿', in_progress: '实施中', reviewing: '审核中', completed: '已完成', archived: '已归档', active: '正常', pending: '待改密', disabled: '已禁用' };
const roleMap: Record<string, string> = { admin: '系统管理员', manager: '项目负责人', evaluator: '测评人员', reviewer: '审核人员' };
const domainCards = [
  ['物理和环境安全', '3 / 3', '完成'], ['网络和通信安全', '4 / 5', '进行中'], ['设备和计算安全', '5 / 7', '进行中'],
  ['应用和数据安全', '6 / 8', '进行中'], ['管理制度', '6 / 6', '完成'], ['人员管理', '4 / 5', '待补充'],
  ['建设运行', '3 / 5', '待补充'], ['应急处置', '2 / 3', '待补充'],
];

const planningModules: PlanningModule[] = [
  { key: 'overview', title: '系统及测评情况简介', note: '描述系统基本情况、测评背景与目的', fields: [
    { key: 'systemIntro', label: '系统简介', placeholder: '请输入系统建设背景、主要用途、服务范围等', multiline: true },
    { key: 'assessmentIntro', label: '测评情况简介', placeholder: '请输入本次测评范围、参与单位及总体安排', multiline: true },
    { key: 'assessmentPurpose', label: '测评目的', placeholder: '请输入本次密评的主要目的', multiline: true },
  ] },
  { key: 'basis', title: '测评依据', note: '维护法律法规、标准规范与项目文件', fields: [
    { key: 'laws', label: '法律法规和政策文件', placeholder: '每行填写一项依据', multiline: true },
    { key: 'standards', label: '标准规范', placeholder: '如 GB/T 39786—2021 等', multiline: true },
    { key: 'projectDocuments', label: '项目相关文件', placeholder: '方案、合同、定级备案等文件', multiline: true },
  ] },
  { key: 'systemProfile', title: '被测系统情况', note: '维护业务、网络、密码应用和边界说明', fields: [
    { key: 'businessDescription', label: '业务情况', placeholder: '描述系统承载的主要业务', multiline: true },
    { key: 'networkBoundary', label: '网络结构与边界', placeholder: '描述网络区域、边界及连接关系', multiline: true },
    { key: 'cryptoApplication', label: '密码应用情况', placeholder: '描述密码产品、算法和应用场景', multiline: true },
  ] },
  { key: 'assets', title: '系统资产', note: '汇总十类系统资产，详细清单可逐步扩展', fields: [
    { key: 'assetScope', label: '资产范围说明', placeholder: '说明资产识别边界和口径', multiline: true },
    { key: 'assetSummary', label: '资产汇总', placeholder: '填写物理环境、密码产品、服务器、网络设备、数据库、应用、数据、文档和人员等资产概况', multiline: true },
    { key: 'importantAssets', label: '重要资产说明', placeholder: '说明非常重要或关键资产及理由', multiline: true },
  ] },
  { key: 'schedule', title: '测评计划', note: '维护各阶段日期、任务和责任人员', fields: [
    { key: 'preparationPlan', label: '项目准备安排', placeholder: '日期、工作内容和责任人', multiline: true },
    { key: 'onsitePlan', label: '现场测评安排', placeholder: '日期、地点、工作内容和参与人员', multiline: true },
    { key: 'reportPlan', label: '报告编制与审核安排', placeholder: '计划完成时间和审核安排', multiline: true },
  ] },
  { key: 'objects', title: '测评对象与测评方式', note: '确定测评对象、抽样范围和验证方式', fields: [
    { key: 'assessmentObjects', label: '测评对象', placeholder: '每行填写一个测评对象', multiline: true },
    { key: 'samplingRule', label: '抽样原则', placeholder: '说明抽样数量、范围及代表性', multiline: true },
    { key: 'assessmentMethods', label: '测评方式', placeholder: '访谈、检查、测试等方式及对应对象', multiline: true },
  ] },
  { key: 'indicators', title: '测评指标', note: '确定适用指标及不适用项理由', fields: [
    { key: 'indicatorBasis', label: '指标选择依据', placeholder: '说明系统等级与指标选择依据', multiline: true },
    { key: 'applicableIndicators', label: '适用指标说明', placeholder: '填写本项目适用指标范围', multiline: true },
    { key: 'notApplicableReason', label: '不适用指标及理由', placeholder: '逐项说明不适用原因', multiline: true },
  ] },
  { key: 'methodsTools', title: '测评方法及工具', note: '记录测评方法、工具和接入点', fields: [
    { key: 'methods', label: '测评方法', placeholder: '访谈、文档审查、配置检查、技术测试等', multiline: true },
    { key: 'tools', label: '测评工具', placeholder: '工具名称、版本、用途', multiline: true },
    { key: 'accessPoints', label: '工具接入点', placeholder: '接入位置、地址、方式及安全措施', multiline: true },
  ] },
  { key: 'previousAssessment', title: '前次测评情况', note: '记录历史测评结论和整改情况', fields: [
    { key: 'assessmentCount', label: '测评次数', placeholder: '请输入本次是第几次测评' },
    { key: 'assessmentDate', label: '前次测评时间', placeholder: '如 2025年7月' },
    { key: 'assessmentOrg', label: '前次测评机构', placeholder: '请输入测评机构名称' },
    { key: 'conclusion', label: '评估结论', placeholder: '如 基本符合' },
    { key: 'score', label: '综合得分', placeholder: '如 82.6' },
    { key: 'assessmentContent', label: '主要问题与整改情况', placeholder: '说明前次发现问题及整改结果', multiline: true },
  ] },
];

const visibleProjects = computed(() => projects.value);
const visibleUsers = computed(() => users.value.filter(user => {
  const search = userFilters.search.trim().toLowerCase();
  return (!search || user.username.toLowerCase().includes(search) || user.display_name.toLowerCase().includes(search))
    && (!userFilters.status || user.status === userFilters.status);
}));
const selectedStage = computed(() => selectedProject.value?.stages?.find(s => s.stage_key === stageMeta[activeStage.value].key));

function getPlanningValues(): Record<string, Record<string, string>> {
  const value = selectedStage.value?.data?.planningModules;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, Record<string, string>>
    : {};
}

function isPlanningModuleComplete(moduleKey: string) {
  return Object.values(getPlanningValues()[moduleKey] || {}).some(value => String(value || '').trim());
}

function openPlanningEditor(module: PlanningModule) {
  activePlanningModule.value = module;
  Object.keys(planningForm).forEach(key => delete planningForm[key]);
  const saved = getPlanningValues()[module.key] || {};
  module.fields.forEach(field => { planningForm[field.key] = field.multiline ? indentEveryParagraph(saved[field.key] || '') : (saved[field.key] || (module.key === 'previousAssessment' && field.key === 'assessmentCount' ? '1' : '')); });
}

async function savePlanningModule() {
  if (!selectedProject.value || !selectedStage.value || !activePlanningModule.value) return;
  const existing = getPlanningValues();
  activePlanningModule.value.fields.filter(field => field.multiline).forEach(field => normalizePlanningParagraph(field.key));
  const planningValues = { ...existing, [activePlanningModule.value.key]: { ...existing[activePlanningModule.value.key], ...planningForm } };
  const completedCount = planningModules.filter(module =>
    Object.values(planningValues[module.key] || {}).some(value => String(value || '').trim()),
  ).length;
  const data = { ...selectedStage.value.data, planningModules: planningValues };
  await api(`/projects/${selectedProject.value.id}/stages/planning`, {
    method: 'PUT',
    body: JSON.stringify({ data, completion: Math.round(completedCount / planningModules.length * 100) }),
  });
  selectedProject.value = await api(`/projects/${selectedProject.value.id}`);
  activePlanningModule.value = null;
  notify('方案模块已保存');
}

async function api(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (token.value) headers.set('Authorization', `Bearer ${token.value}`);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${apiBase}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login') logout();
    throw new Error(data.message || '请求失败');
  }
  return data;
}

function notify(message: string) {
  toast.value = message;
  window.setTimeout(() => { toast.value = ''; }, 2200);
}

async function login() {
  loading.value = true; loginError.value = '';
  try {
    const data = await api('/auth/login', { method: 'POST', body: JSON.stringify(loginForm) });
    token.value = data.token; currentUser.value = data.user;
    localStorage.setItem('bb-token', data.token);
    await openPage('dashboard');
  } catch (error) { loginError.value = (error as Error).message; }
  finally { loading.value = false; }
}

function logout() {
  token.value = ''; currentUser.value = null; localStorage.removeItem('bb-token');
}

async function openPage(next: Page) {
  page.value = next;
  if (next === 'dashboard') dashboard.value = await api('/dashboard');
  if (next === 'projects') await loadProjects();
  if (next === 'users') users.value = await api('/users');
  if (next === 'templates') templateInfo.value = await api('/templates');
  if (next === 'institution') Object.assign(institutionForm, await api('/settings/institution'));
}

async function loadProjects() {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
  projects.value = await api(`/projects?${query}`);
}

async function openProject(project: Project) {
  const link = document.createElement('a');
  link.href = `/prototype.html?project=${encodeURIComponent(project.id)}&step=1`;
  link.target = '_blank';
  link.rel = 'noopener';
  document.body.appendChild(link); link.click(); link.remove();
}

function importProjectWord(project: Project) {
  importTargetProject.value = project;
  const input = document.getElementById('project-word-import') as HTMLInputElement | null;
  if (!input) return;
  input.value = '';
  input.click();
}

async function handleProjectWordImport(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  const project = importTargetProject.value;
  if (!file || !project) return;
  const child = window.open('about:blank', '_blank');
  try {
    notify('正在上传 Word 报告…');
    await api(`/projects/${project.id}/report-template`, {
      method: 'POST',
      body: JSON.stringify({ name: file.name, dataBase64: await fileAsBase64(file) }),
    });
    const url = `/prototype.html?project=${encodeURIComponent(project.id)}&importStored=1`;
    if (child) child.location.href = url;
    else window.location.href = url;
    notify('上传完成，正在进入项目并解析报告');
  } catch (error) {
    if (child) child.close();
    notify((error as Error).message);
  } finally {
    importTargetProject.value = null;
    input.value = '';
  }
}

async function copyProject(project: Project) {
  try {
    const copied = await api(`/projects/${project.id}/copy`, { method: 'POST' });
    notify(`已复制为新项目 ${copied.code}`);
    await loadProjects();
  } catch (error) { notify((error as Error).message); }
}

async function createProject() {
  try {
    const path = editingProjectId.value ? `/projects/${editingProjectId.value}` : '/projects';
    const saved = await api(path, { method: editingProjectId.value ? 'PUT' : 'POST', body: JSON.stringify(projectForm) });
    showProjectModal.value = false;
    if (editingProjectId.value) {
      editingProjectId.value = '';
      notify('项目已更新');
      await loadProjects();
    } else {
      notify('项目已创建');
      await loadProjects();
    }
  } catch (error) { notify((error as Error).message); }
}

function openAddProjectModal() {
  editingProjectId.value = '';
  Object.assign(projectForm, { code: '', reportCode: '', systemName: '', orgName: '', assessmentYear: new Date().getFullYear(), systemLevel: 3, startDate: '', endDate: '' });
  showProjectModal.value = true;
}

function openEditProjectModal(project: Project) {
  editingProjectId.value = project.id;
  Object.assign(projectForm, {
    code: project.code,
    reportCode: project.report_code || '',
    systemName: project.system_name,
    orgName: project.org_name,
    assessmentYear: project.assessment_year,
    systemLevel: project.system_level,
    startDate: project.start_date ? String(project.start_date).slice(0, 10) : '',
    endDate: project.end_date ? String(project.end_date).slice(0, 10) : '',
  });
  showProjectModal.value = true;
}

async function deleteProject() {
  if (!projectToDelete.value) return;
  try {
    await api(`/projects/${projectToDelete.value.id}`, { method: 'DELETE' });
    projectToDelete.value = null;
    notify('项目及其关联测评数据已删除');
    await loadProjects();
  } catch (error) { notify((error as Error).message); }
}

async function createUser() {
  try {
    const body = { ...userForm, certificateFileData: certificateFileData.value || null };
    const result = await api(editingUserId.value ? `/users/${editingUserId.value}` : '/users', { method: editingUserId.value ? 'PUT' : 'POST', body: JSON.stringify(body) });
    showUserModal.value = false; users.value = await api('/users');
    notify(editingUserId.value ? '用户信息已保存' : `用户已创建，默认密码：${result.defaultPassword}`);
    editingUserId.value = '';
  } catch (error) { notify((error as Error).message); }
}

function openAddUser() {
  editingUserId.value = ''; certificateFileData.value = '';
  Object.assign(userForm, { username: '', displayName: '', role: 'evaluator', certificateDate: '', certificateFileName: '' });
  showUserModal.value = true;
}

function editUser(user: User) {
  editingUserId.value = user.id; certificateFileData.value = '';
  Object.assign(userForm, { username: user.username, displayName: user.display_name, role: user.role, certificateDate: user.certificate_date ? String(user.certificate_date).slice(0, 10) : '', certificateFileName: user.certificate_file_name || '' });
  showUserModal.value = true;
}

function fileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function chooseCertificate(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  userForm.certificateFileName = file.name;
  certificateFileData.value = `data:${file.type || 'application/octet-stream'};base64,${await fileAsBase64(file)}`;
}

async function resetPassword(user: User) {
  if (!window.confirm(`确认重置 ${user.display_name} 的密码？`)) return;
  try {
    const result = await api(`/users/${user.id}/reset-password`, { method: 'POST' });
    notify(`密码已重置：${result.defaultPassword}`);
    users.value = await api('/users');
  } catch (error) { notify((error as Error).message); }
}

async function toggleUser(user: User) {
  const status = user.status === 'disabled' ? 'active' : 'disabled';
  await api(`/users/${user.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
  users.value = await api('/users');
  notify(status === 'disabled' ? '账号已禁用' : '账号已启用');
}

async function changePassword() {
  if (passwordForm.newPassword !== passwordForm.confirmPassword) return notify('两次输入的新密码不一致');
  try {
    await api('/auth/change-password', { method: 'POST', body: JSON.stringify(passwordForm) });
    showPasswordModal.value = false;
    Object.assign(passwordForm, { currentPassword: '', newPassword: '', confirmPassword: '' });
    notify('密码修改成功');
  } catch (error) { notify((error as Error).message); }
}

async function saveInstitution() {
  try {
    await api('/settings/institution', { method: 'PUT', body: JSON.stringify(institutionForm) });
    notify('测评机构信息已保存');
  } catch (error) { notify((error as Error).message); }
}

async function uploadReportTemplate(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    await api('/templates/report', { method: 'POST', body: JSON.stringify({ name: file.name, dataBase64: await fileAsBase64(file) }) });
    templateInfo.value = await api('/templates');
    notify('默认报告模板已更新');
  } catch (error) { notify((error as Error).message); }
}

async function uploadRawFolder(event: Event) {
  const files = [...((event.target as HTMLInputElement).files || [])];
  if (!files.length) return;
  try {
    const payload = await Promise.all(files.map(async file => ({ path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name, dataBase64: await fileAsBase64(file) })));
    await api('/templates/records', { method: 'POST', body: JSON.stringify({ files: payload }) });
    templateInfo.value = await api('/templates');
    notify(`已导入 ${files.length} 个原始记录模板文件`);
  } catch (error) { notify((error as Error).message); }
}

async function saveStage() {
  if (!selectedProject.value || !selectedStage.value) return;
  const completion = selectedStage.value.stage_key === 'planning'
    ? Math.round(planningModules.filter(module => isPlanningModuleComplete(module.key)).length / planningModules.length * 100)
    : Math.max(selectedStage.value.completion, 60);
  await api(`/projects/${selectedProject.value.id}/stages/${selectedStage.value.stage_key}`, {
    method: 'PUT', body: JSON.stringify({ data: selectedStage.value.data || {}, completion }),
  });
  selectedProject.value = await api(`/projects/${selectedProject.value.id}`);
  notify('阶段内容已保存');
}

function fmtDate(value?: string) {
  if (!value) return '—';
  const text = String(value).trim();
  let match = /^(\d{4})年(\d{1,2})月(?:(\d{1,2})日)?$/.exec(text);
  if (match) return `${match[1]}年${String(match[2]).padStart(2, '0')}月${String(match[3] || '1').padStart(2, '0')}日`;
  if (/T/.test(text)) {
    const timed = new Date(text);
    if (!Number.isNaN(timed.getTime())) return `${timed.getFullYear()}年${String(timed.getMonth() + 1).padStart(2, '0')}月${String(timed.getDate()).padStart(2, '0')}日`;
  }
  match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (match) return `${match[1]}年${String(match[2]).padStart(2, '0')}月${String(match[3]).padStart(2, '0')}日`;
  return text;
}

onMounted(async () => {
  if (!token.value) return;
  try {
    currentUser.value = await api('/auth/me');
    const requestedPage = new URLSearchParams(window.location.search).get('page');
    await openPage(requestedPage === 'projects' ? 'projects' : 'dashboard');
  }
  catch { logout(); }
});
</script>

<template>
  <div v-if="!token" class="login-shell">
    <section class="login-brand">
      <div class="brand-mark large"><span>BB</span></div>
      <div class="eyebrow">COMMERCIAL CRYPTOGRAPHY ASSESSMENT</div>
      <h1>让密评项目<br><em>清晰、可控、可追溯</em></h1>
      <p>覆盖项目准备、方案编制、现场测评、报告编制与成果导出的全流程协同工作台。</p>
      <div class="login-features"><span>五阶段流程</span><span>风险自动汇总</span><span>报告数据同源</span></div>
    </section>
    <section class="login-panel">
      <form class="login-card" @submit.prevent="login">
        <div class="mobile-logo"><div class="brand-mark"><span>BB</span></div> 密评协同管理系统</div>
        <small>欢迎回来</small><h2>登录工作台</h2><p>请输入您的系统账号继续</p>
        <label>用户名<input v-model="loginForm.username" autocomplete="username" placeholder="请输入用户名" /></label>
        <label>密码<input v-model="loginForm.password" type="password" autocomplete="current-password" placeholder="请输入密码" /></label>
        <div v-if="loginError" class="form-error">{{ loginError }}</div>
        <button class="primary wide" :disabled="loading">{{ loading ? '正在登录…' : '登录系统' }}</button>
        <div class="login-tip">演示账号：admin / Admin@123</div>
      </form>
    </section>
  </div>

  <div v-else class="app-shell">
    <input id="project-word-import" type="file" accept=".docx" style="display:none" @change="handleProjectWordImport" />
    <aside class="sidebar">
      <div class="side-brand"><div class="brand-mark"><span>BB</span></div><div><b>密评协同</b><small>管理系统</small></div></div>
      <nav>
        <button :class="{active:page==='dashboard'}" @click="openPage('dashboard')"><i>⌂</i><span>工作台</span></button>
        <button :class="{active:page==='projects'||page==='workspace'}" @click="openPage('projects')"><i>▣</i><span>项目管理</span></button>
        <button :class="{active:page==='users'}" @click="openPage('users')"><i>◎</i><span>用户管理</span></button>
        <button v-if="currentUser?.role==='admin'" :class="{active:page==='institution'}" @click="openPage('institution')"><i>◆</i><span>测评机构</span></button>
        <button v-if="currentUser?.role==='admin'" :class="{active:page==='templates'}" @click="openPage('templates')"><i>▤</i><span>模板设置</span></button>
      </nav>
      <div class="side-bottom"><button><i>?</i><span>使用帮助</span></button><button><i>⚙</i><span>系统设置</span></button></div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div><b>{{ page==='dashboard'?'工作台':page==='projects'?'项目管理':page==='users'?'用户管理':page==='templates'?'模板设置':page==='institution'?'测评机构管理':selectedProject?.system_name }}</b><span v-if="page==='workspace'" class="top-code">{{ selectedProject?.code }}</span></div>
        <div class="top-actions"><button class="text-btn" @click="showPasswordModal=true">修改密码</button><button class="icon-btn" title="通知">◔<span class="dot"></span></button><div class="avatar">{{ currentUser?.display_name?.slice(0,1) }}</div><div class="user-block"><b>{{ currentUser?.display_name }}</b><small>{{ roleMap[currentUser?.role || ''] }}</small></div><button class="logout" @click="logout">退出</button></div>
      </header>

      <div v-if="page==='dashboard'" class="content dashboard">
        <section class="welcome-row"><div><span>{{ new Date().toLocaleDateString('zh-CN', {month:'long',day:'numeric',weekday:'long'}) }}</span><h1>早上好，{{ currentUser?.display_name }}</h1><p>这里汇总了项目进展和需要优先处理的风险。</p></div><button class="primary" @click="openAddProjectModal">＋ 新建项目</button></section>
        <section class="metric-grid">
          <article><div class="metric-icon blue">项</div><div><small>项目总数</small><strong>{{ dashboard.summary.total || 0 }}</strong></div><span>全部在库项目</span></article>
          <article><div class="metric-icon cyan">进</div><div><small>实施中</small><strong>{{ dashboard.summary.in_progress || 0 }}</strong></div><span>需要持续跟进</span></article>
          <article><div class="metric-icon amber">审</div><div><small>审核中</small><strong>{{ dashboard.summary.reviewing || 0 }}</strong></div><span>待完成复核</span></article>
          <article><div class="metric-icon green">✓</div><div><small>已完成</small><strong>{{ dashboard.summary.completed || 0 }}</strong></div><span>已归档成果</span></article>
        </section>
        <section class="dashboard-grid">
          <article class="panel project-panel"><div class="panel-head"><div><h3>最近项目</h3><p>按最后更新时间排序</p></div><button class="text-btn" @click="openPage('projects')">查看全部 →</button></div>
            <div class="compact-table"><div class="tr th"><span>项目 / 责任单位</span><span>阶段</span><span>进度</span><span>负责人</span></div>
              <button v-for="p in dashboard.recent" :key="p.id" class="tr" @click="openProject(p)"><span><b>{{ p.system_name }}</b><small>{{ p.code }} · {{ p.org_name }}</small></span><span><i class="status-pill" :class="p.status">{{ statusMap[p.status] }}</i></span><span><div class="progress"><i :style="{width:p.progress+'%'}"></i></div><small>{{ p.progress }}%</small></span><span>{{ p.owner_name || '未分配' }}</span></button>
            </div>
          </article>
          <aside class="panel focus-panel"><div class="panel-head"><div><h3>流程分布</h3><p>当前项目所在阶段</p></div></div><div class="stage-bars"><div v-for="(stage,i) in stageMeta" :key="stage.key"><span>{{ stage.short }}</span><div><i :style="{width: Math.min(100, ((dashboard.stages.find((s:any)=>s.current_stage===i+1)?.count||0) / Math.max(1,dashboard.summary.total))*100)+'%'}"></i></div><b>{{ dashboard.stages.find((s:any)=>s.current_stage===i+1)?.count||0 }}</b></div></div><div class="risk-callout"><span>!</span><div><b>高风险项需优先处理</b><p>正式导出报告前，应确保高风险项已有明确处置意见和证据。</p></div></div></aside>
        </section>
      </div>

      <div v-else-if="page==='projects'" class="content list-page">
        <section class="page-title"><div><small>项目全生命周期管理</small><h1>项目管理</h1><p>集中管理项目档案、阶段进度、测评数据与报告成果。</p></div><button class="primary" @click="openAddProjectModal">＋ 新建项目</button></section>
        <section class="panel filter-panel"><div class="search"><span>⌕</span><input v-model="filters.search" @keyup.enter="loadProjects" placeholder="搜索项目编号、报告编号、系统或单位" /></div><select v-model="filters.year" @change="loadProjects"><option value="">全部年度</option><option>2026</option><option>2025</option></select><select v-model="filters.level" @change="loadProjects"><option value="">全部等级</option><option value="2">二级</option><option value="3">三级</option><option value="4">四级</option></select><select v-model="filters.status" @change="loadProjects"><option value="">全部状态</option><option value="draft">草稿</option><option value="in_progress">实施中</option><option value="reviewing">审核中</option><option value="completed">已完成</option></select><button class="secondary" @click="loadProjects">查询</button></section>
        <section class="panel data-table project-table"><div class="table-head"><span>项目</span><span>年度</span><span>等级</span><span>当前阶段</span><span>系统评分</span><span>进度</span><span>操作</span></div><div v-for="p in visibleProjects" :key="p.id" class="table-row project-row"><span><b>{{ p.system_name }}</b><small>{{ p.code }}<template v-if="p.report_code"> · {{ p.report_code }}</template><br>{{ p.org_name }}</small></span><span><b>{{ p.assessment_year }}</b></span><span><b>{{ p.system_level }}级</b></span><span><i class="status-pill" :class="p.status">{{ statusMap[p.status] }}</i><small>{{ stageMeta[p.current_stage-1]?.short }}</small></span><span><b>{{ p.system_score ?? '—' }}</b><small>满分 100</small></span><span><div class="progress"><i :style="{width:p.progress+'%'}"></i></div><small>{{ p.progress }}%</small></span><span class="project-actions"><button @click="openProject(p)">实施</button><label class="project-action-label" for="project-word-import" @click.stop="importTargetProject=p">导入Word</label><button @click="copyProject(p)">复制</button><button @click="openEditProjectModal(p)">编辑</button><button class="danger" @click="projectToDelete=p">删除</button></span></div></section>
      </div>

      <div v-else-if="page==='workspace' && selectedProject" class="workspace">
        <section class="project-strip"><button class="back-btn" @click="openPage('projects')">‹</button><div class="project-identity"><small>{{ selectedProject.code }} · {{ selectedProject.system_level }}级系统</small><h2>{{ selectedProject.system_name }}</h2><p>{{ selectedProject.org_name }}</p></div><div class="project-kpis"><span><small>总体进度</small><b>{{ selectedProject.progress }}%</b></span><span><small>高风险</small><b class="danger-text">{{ selectedProject.risks?.filter(r=>r.risk_level==='high').length || 0 }}</b></span><span><small>项目周期</small><b>{{ fmtDate(selectedProject.end_date) }}</b></span></div><button class="secondary">导出报告</button></section>
        <section class="stage-nav"><button v-for="(stage,i) in stageMeta" :key="stage.key" :class="{active:activeStage===i,done:(selectedProject.stages?.find(s=>s.stage_key===stage.key)?.completion||0)>=100}" @click="activeStage=i"><i>{{ (selectedProject.stages?.find(s=>s.stage_key===stage.key)?.completion||0)>=100?'✓':stage.icon }}</i><span><b>{{ stage.short }}</b><small>{{ stage.hint }}</small></span><em>{{ selectedProject.stages?.find(s=>s.stage_key===stage.key)?.completion || 0 }}%</em></button></section>
        <div class="workspace-grid"><section class="work-main panel">
          <div class="work-head"><div><small>阶段 {{ activeStage+1 }} / 5</small><h2>{{ stageMeta[activeStage].short }}</h2><p>{{ stageMeta[activeStage].hint }}</p></div><button class="primary" @click="saveStage">保存本阶段</button></div>
          <template v-if="activeStage===0"><div class="section-title"><span>01</span><div><h3>被测单位基本信息</h3><p>用于报告封面、项目档案及联系信息</p></div></div><div class="form-grid"><label class="span-2">单位名称<input :value="selectedProject.org_name" /></label><label>邮政编码<input placeholder="请输入 6 位邮编" /></label><label class="span-2">单位地址<input placeholder="请输入详细通信地址" /></label><label>密码管理部门<input placeholder="如：省密码管理局" /></label><label>联系人<input placeholder="姓名" /></label><label>职务 / 职称<input placeholder="职务或职称" /></label><label>移动电话<input placeholder="11 位手机号码" /></label></div><div class="section-title"><span>02</span><div><h3>项目基本信息</h3><p>系统名称、级别与测评周期</p></div></div><div class="info-grid"><span><small>系统名称</small><b>{{ selectedProject.system_name }}</b></span><span><small>系统等级</small><b>{{ selectedProject.system_level }}级</b></span><span><small>开始日期</small><b>{{ fmtDate(selectedProject.start_date) }}</b></span><span><small>结束日期</small><b>{{ fmtDate(selectedProject.end_date) }}</b></span></div></template>
          <template v-else-if="activeStage===1"><div class="section-title"><span>01</span><div><h3>测评方案工作清单</h3><p>原型及 Word 模板中的核心模块已统一纳入</p></div></div><div class="module-grid"><article v-for="module in planningModules" :key="module.key" :class="{complete:isPlanningModuleComplete(module.key)}"><i>{{ isPlanningModuleComplete(module.key) ? '✓' : '·' }}</i><div><b>{{ module.title }}</b><small>{{ isPlanningModuleComplete(module.key) ? '已填写，可继续修改' : module.note }}</small></div><button type="button" @click="openPlanningEditor(module)">{{ isPlanningModuleComplete(module.key) ? '修改' : '编辑' }}</button></article></div></template>
          <template v-else-if="activeStage===2"><div class="section-title"><span>01</span><div><h3>八个安全层面</h3><p>按测评对象逐项记录结果、证据与问题</p></div></div><div class="domain-grid"><article v-for="(d,i) in domainCards" :key="d[0]"><div><span>{{ String(i+1).padStart(2,'0') }}</span><i :class="{'warn':d[2]!=='完成'}">{{ d[2]==='完成'?'✓':'!' }}</i></div><b>{{ d[0] }}</b><p>已填写 {{ d[1] }} 个测评单元</p><div class="mini-progress"><i :style="{width:d[2]==='完成'?'100%':d[2]==='进行中'?'70%':'35%'}"></i></div><button>进入记录 →</button></article></div></template>
          <template v-else-if="activeStage===3"><div class="report-layout"><div><div class="section-title"><span>01</span><div><h3>报告数据检查</h3><p>自动聚合现场记录、评分和风险</p></div></div><div class="check-list"><span><i>✓</i>系统资产识别 <b>完整</b></span><span><i>✓</i>单元测评结果 <b>已汇总</b></span><span><i>!</i>风险分析表 <b class="danger-text">1 项待确认</b></span><span><i>✓</i>量化分数计算 <b>82.6 分</b></span><span><i>✓</i>总体评价 <b>已生成</b></span></div></div><div class="score-card"><small>系统综合得分</small><strong>82.6</strong><span>基本符合</span><p>存在 1 项高风险，需形成处置意见后提交审核。</p><button class="primary wide">生成 Word 报告</button></div></div></template>
          <template v-else><div class="section-title"><span>01</span><div><h3>审核与归档</h3><p>完成负责人、审核人和批准人三级复核</p></div></div><div class="review-flow"><article class="done"><i>✓</i><div><b>编制人自查</b><p>张鸿飞 · 2026-09-17 16:20</p></div><span>已通过</span></article><article class="active"><i>2</i><div><b>项目负责人审核</b><p>重点复核高风险项与评价结论</p></div><span>进行中</span></article><article><i>3</i><div><b>技术负责人批准</b><p>审核通过后完成正式归档</p></div><span>等待中</span></article></div></template>
        </section><aside class="work-aside"><section class="panel"><div class="aside-head"><h3>阶段进度</h3><b>{{ selectedStage?.completion || 0 }}%</b></div><div class="ring" :style="{'--p':(selectedStage?.completion||0)*3.6+'deg'}"><span>{{ selectedStage?.completion || 0 }}<small>%</small></span></div><ul><li><i class="ok"></i>基础信息已录入</li><li><i class="ok"></i>必填项校验通过</li><li><i></i>附件材料待补充</li></ul></section><section class="panel issue-panel"><div class="aside-head"><h3>待处理</h3><button>全部</button></div><article><i class="high">高</i><div><b>传输完整性证据不足</b><p>应用和数据安全 · 高风险</p></div></article><article><i class="mid">待</i><div><b>补充现场测评照片</b><p>项目准备 · 材料缺失</p></div></article></section></aside></div>
      </div>

      <div v-else-if="page==='users'" class="content list-page">
        <section class="page-title"><div><small>账号、状态与密评资质</small><h1>用户管理</h1><p>内容与用户体系原型保持一致，集中维护人员资料与账号安全。</p></div><button v-if="currentUser?.role==='admin'" class="primary" @click="openAddUser">＋ 添加用户</button></section>
        <section class="metric-grid user-metrics"><article><div class="metric-icon blue">人</div><div><small>用户总数</small><strong>{{ users.length }}</strong></div></article><article><div class="metric-icon green">✓</div><div><small>正常</small><strong>{{ users.filter(u=>u.status==='active').length }}</strong></div></article><article><div class="metric-icon amber">钥</div><div><small>待改密</small><strong>{{ users.filter(u=>u.status==='pending').length }}</strong></div></article><article><div class="metric-icon amber">停</div><div><small>已禁用</small><strong>{{ users.filter(u=>u.status==='disabled').length }}</strong></div></article></section>
        <section class="panel filter-panel"><div class="search"><span>⌕</span><input v-model="userFilters.search" placeholder="搜索用户名或姓名" /></div><select v-model="userFilters.status"><option value="">全部状态</option><option value="active">正常</option><option value="pending">待改密</option><option value="disabled">已禁用</option></select></section>
        <section class="panel data-table user-table detailed"><div class="table-head"><span>序号</span><span>用户名 / 姓名</span><span>密评考试通过时间</span><span>密评证书</span><span>状态</span><span>创建时间</span><span>操作</span></div><div v-for="(u,index) in visibleUsers" :key="u.id" class="table-row"><span>{{ index+1 }}</span><span class="user-cell"><i>{{ u.display_name.slice(0,1) }}</i><span><b>{{ u.username }}</b><small>{{ u.display_name }}</small></span></span><span>{{ fmtDate(u.certificate_date) }}</span><span><a v-if="u.certificate_file_path" :href="u.certificate_file_path" target="_blank">{{ u.certificate_file_name || '查看证书' }}</a><small v-else>未上传</small></span><span><i class="status-pill" :class="u.status">{{ statusMap[u.status] }}</i></span><span>{{ fmtDate(u.created_at) }}</span><span class="user-actions"><button @click="editUser(u)">管理</button><button @click="resetPassword(u)">重置密码</button><button @click="toggleUser(u)">{{ u.status==='disabled'?'启用':'禁用' }}</button></span></div></section>
      </div>

      <div v-else-if="page==='institution'" class="content settings-page">
        <section class="page-title"><div><small>INSTITUTION</small><h1>测评机构管理</h1><p>此处为唯一编辑入口；项目实施过程只读引用这些内容。</p></div><button class="primary" @click="saveInstitution">保存机构信息</button></section>
        <section class="panel settings-card"><div class="section-title"><span>01</span><div><h3>密码测评机构基本信息</h3><p>默认采用报告模板中的机构资料</p></div></div><div class="form-grid institution-grid"><label class="span-2">机构名称<input v-model="institutionForm.name" /></label><label>邮政编码<input v-model="institutionForm.postalCode" /></label><label class="span-2">机构地址<input v-model="institutionForm.address" /></label><label>部门<input v-model="institutionForm.department" /></label><label>联系人<input v-model="institutionForm.contact" /></label><label>职务 / 职称<input v-model="institutionForm.title" /></label><label>办公电话<input v-model="institutionForm.telephone" /></label><label>移动电话<input v-model="institutionForm.mobile" /></label><label>电子邮箱<input v-model="institutionForm.email" /></label></div></section>
      </div>

      <div v-else-if="page==='templates'" class="content settings-page">
        <section class="page-title"><div><small>TEMPLATE CENTER</small><h1>模板设置</h1><p>统一维护正式报告模板与原始记录文件夹模板。</p></div></section>
        <section class="template-grid"><article class="panel template-card"><div class="template-icon">W</div><div><small>WORD REPORT</small><h2>报告模板</h2><p>导出时保留模板原有目录、分页、页眉页脚和表格，只替换模板中已有字段。</p><div class="template-meta"><b>{{ templateInfo.report?.name || '尚未配置' }}</b><span v-if="templateInfo.report">{{ Math.round(templateInfo.report.size/1024/1024*10)/10 }} MB · 已配置默认模板</span></div></div><label class="primary upload-button">选择 DOCX 模板<input type="file" accept=".docx" @change="uploadReportTemplate" /></label></article>
          <article class="panel template-card"><div class="template-icon folder">▰</div><div><small>RAW RECORDS</small><h2>原始记录模板</h2><p>按文件夹结构保存，生成时将完整复制到“报告编号+原始记录”文件夹。</p><div class="template-meta"><b>{{ templateInfo.rawRecords?.length || 0 }} 个文件</b><span>{{ templateInfo.rawRecords?.slice(0,3).map((f:any)=>f.path).join('、') || '尚未导入文件夹' }}</span></div></div><label class="primary upload-button">导入模板文件夹<input type="file" webkitdirectory multiple @change="uploadRawFolder" /></label></article></section>
        <section class="panel template-rules"><h3>报告模板字段规则</h3><p>可在需要系统写入的位置使用 <code>{报告编号}</code>、<code>{项目编号}</code>、<code>{系统名称}</code>、<code>{责任单位}</code>、<code>{测评年度}</code>、<code>{系统等级}</code>。系统只替换模板中真实存在的字段。</p><p>表 A-1 至表 A-8 请保留各测评单元名称和一行数据样板；导出时会按测评对象扩行、合并同一单元的名称与得分，并将该层面的证据截图放在表后。</p></section>
      </div>
    </main>
  </div>

  <div v-if="activePlanningModule" class="modal-mask" @click.self="activePlanningModule=null"><form class="modal planning-modal" @submit.prevent="savePlanningModule"><div class="modal-head"><div><small>方案编制</small><h2>{{ activePlanningModule.title }}</h2><p>{{ activePlanningModule.note }}</p></div><button type="button" @click="activePlanningModule=null">×</button></div><div class="planning-form"><label v-for="field in activePlanningModule.fields" v-show="activePlanningModule.key !== 'previousAssessment' || field.key === 'assessmentCount' || field.key === 'assessmentContent' || Number(planningForm.assessmentCount || 1) > 1" :key="field.key">{{ field.label }}<textarea v-if="field.multiline" v-model="planningForm[field.key]" :placeholder="field.placeholder" rows="4" @keydown.enter="handleParagraphEnter" @blur="normalizePlanningParagraph(field.key)"></textarea><input v-else v-model="planningForm[field.key]" :type="field.key === 'assessmentCount' ? 'number' : 'text'" :min="field.key === 'assessmentCount' ? 1 : undefined" :step="field.key === 'assessmentCount' ? 1 : undefined" :placeholder="field.placeholder" /></label></div><div class="modal-foot"><button type="button" class="secondary" @click="activePlanningModule=null">取消</button><button class="primary">保存模块内容</button></div></form></div>
  <div v-if="showProjectModal" class="modal-mask" @click.self="showProjectModal=false"><form class="modal" @submit.prevent="createProject"><div class="modal-head"><div><small>PROJECT</small><h2>{{ editingProjectId ? '编辑密评项目' : '新建密评项目' }}</h2></div><button type="button" @click="showProjectModal=false">×</button></div><div class="form-grid"><label>项目编号<input :value="editingProjectId ? projectForm.code : `MP-${projectForm.assessmentYear}-自动编号`" readonly class="readonly-input" /></label><label>报告编号<input v-model="projectForm.reportCode" placeholder="可稍后补充或从Word导入" /></label><label class="span-2">系统名称<input v-model="projectForm.systemName" required placeholder="请输入被测系统全称" /></label><label class="span-2">责任单位<input v-model="projectForm.orgName" required placeholder="请输入责任单位全称" /></label><label>测评年度<input v-model.number="projectForm.assessmentYear" type="number" /></label><label>系统等级<select v-model.number="projectForm.systemLevel"><option :value="2">二级</option><option :value="3">三级</option></select></label><label>开始日期<input v-model="projectForm.startDate" type="date" /></label><label>结束日期<input v-model="projectForm.endDate" type="date" /></label></div><div class="modal-foot"><button type="button" class="secondary" @click="showProjectModal=false">取消</button><button class="primary">{{ editingProjectId ? '保存修改' : '创建并进入项目' }}</button></div></form></div>
  <div v-if="projectToDelete" class="modal-mask" @click.self="projectToDelete=null"><div class="modal confirm-dialog"><div class="confirm-symbol">!</div><h2>确认删除该项目？</h2><p>将删除“{{ projectToDelete.system_name }}”及其阶段数据、资产、测评记录、风险和证据文件记录。此操作不可恢复。</p><div class="modal-foot"><button class="secondary" @click="projectToDelete=null">取消</button><button class="primary danger-button" @click="deleteProject">确认删除</button></div></div></div>
  <div v-if="showUserModal" class="modal-mask" @click.self="showUserModal=false"><form class="modal small" @submit.prevent="createUser"><div class="modal-head"><div><small>USER</small><h2>{{ editingUserId ? '编辑用户信息' : '添加系统用户' }}</h2></div><button type="button" @click="showUserModal=false">×</button></div><div class="form-grid"><label>用户名<input v-model="userForm.username" required :readonly="!!editingUserId" placeholder="英文、数字或下划线" /></label><label>姓名<input v-model="userForm.displayName" required placeholder="真实姓名" /></label><label>系统角色<select v-model="userForm.role"><option value="evaluator">测评人员</option><option value="manager">项目负责人</option><option value="reviewer">审核人员</option><option value="admin">系统管理员</option></select></label><label>密评考试通过时间<input v-model="userForm.certificateDate" type="date" /></label><label class="span-2">密评证书<input type="file" accept="image/*,.pdf" @change="chooseCertificate" /><small>{{ userForm.certificateFileName || '支持图片或 PDF' }}</small></label></div><div class="modal-foot"><button type="button" class="secondary" @click="showUserModal=false">取消</button><button class="primary">{{ editingUserId ? '保存修改' : '确认添加' }}</button></div></form></div>
  <div v-if="showPasswordModal" class="modal-mask" @click.self="showPasswordModal=false"><form class="modal small" @submit.prevent="changePassword"><div class="modal-head"><div><small>ACCOUNT SECURITY</small><h2>修改账户密码</h2></div><button type="button" @click="showPasswordModal=false">×</button></div><div class="form-grid password-grid"><label class="span-2">当前密码<input v-model="passwordForm.currentPassword" type="password" required autocomplete="current-password" /></label><label>新密码<input v-model="passwordForm.newPassword" type="password" minlength="8" required autocomplete="new-password" /></label><label>确认新密码<input v-model="passwordForm.confirmPassword" type="password" minlength="8" required autocomplete="new-password" /></label></div><div class="modal-foot"><button type="button" class="secondary" @click="showPasswordModal=false">取消</button><button class="primary">确认修改</button></div></form></div>
  <transition name="toast"><div v-if="toast" class="toast">✓ {{ toast }}</div></transition>
</template>
