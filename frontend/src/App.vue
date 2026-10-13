<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, type ObjectDirective } from 'vue';

type Page = 'dashboard' | 'projects' | 'workspace' | 'users' | 'templates' | 'risk-analysis' | 'institution';
const restorablePages: Page[] = ['dashboard', 'projects', 'users', 'templates', 'risk-analysis', 'institution'];
type User = { id: string; username: string; display_name: string; role: string; status: string; certificate_date?: string; certificate_file_name?: string; certificate_file_path?: string; must_change_password?: boolean; last_login_at?: string; created_at?: string };
type ImportedUser = { username: string; display_name: string; defaultPassword: string };
type Project = { id: string; code: string; report_code?: string; system_name: string; org_name: string; assessment_year: number; system_level: number; status: string; current_stage: number; progress: number; start_date?: string; end_date?: string; owner_name?: string; high_risk_count?: number; system_score?: number; stages?: Stage[]; risks?: Risk[]; assets?: Asset[] };
type Stage = { id: string; stage_key: string; title: string; completion: number; data: Record<string, unknown> };
type Risk = { id: string; domain: string; issue_description: string; risk_level: string; status: string };
type Asset = { id: string; category: string; name: string; importance: string; details: Record<string, unknown> };
type PlanningField = { key: string; label: string; placeholder: string; multiline?: boolean };
type PlanningModule = { key: string; title: string; note: string; fields: PlanningField[] };

const apiBase = '/api';
const darkMode = ref(document.documentElement.dataset.theme === 'dark');
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
const copySourceProject = ref<Project | null>(null);
const copyingProject = ref(false);
const projectToDelete = ref<Project | null>(null);
const showUserModal = ref(false);
const editingUserId = ref('');
const certificateFileData = ref('');
const userImporting = ref(false);
const showUserImportResult = ref(false);
const userImportResults = ref<ImportedUser[]>([]);
const showPasswordModal = ref(false);
const passwordForm = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' });
const userFilters = reactive({ search: '', status: '' });
const templateInfo = ref<any>({ report: null, rawRecords: [] });
const riskTemplates = ref<any[]>([]);
const showRiskTemplateModal = ref(false);
const editingRiskTemplateId = ref('');
const activeRiskLayer = ref('物理和环境安全');
const riskTemplateForm = reactive<any>({ layer: '物理和环境安全', unit: '身份鉴别', threat: '', defaultLevel: '中', analysis: '', advice: '', enabled: true, version: 1 });
const riskUnitsByLayer: Record<string, string[]> = {
  '物理和环境安全': ['身份鉴别', '电子门禁记录数据存储完整性', '视频监控记录数据存储完整性'],
  '网络和通信安全': ['身份鉴别', '通信数据完整性', '通信过程中重要数据的机密性', '网络边界访问控制信息的完整性', '安全接入认证'],
  '设备和计算安全': ['身份鉴别', '远程管理通道安全', '系统资源访问控制信息完整性', '重要信息资源安全标记完整性', '日志记录完整性', '重要可执行程序完整性、重要可执行程序来源真实性'],
  '应用和数据安全': ['身份鉴别', '访问控制信息完整性', '重要信息资源安全标记完整性', '重要数据传输机密性', '重要数据存储机密性', '重要数据传输完整性', '重要数据存储完整性', '不可否认性'],
  '管理制度': ['具备密码应用安全管理制度', '密钥管理规则', '建立操作规程', '定期修订安全管理制度', '明确管理制度发布流程', '制度执行过程记录留存'],
  '人员管理': ['了解并遵守密码相关法律法规和密码管理制度', '建立密码应用岗位责任制度', '建立上岗人员培训制度', '定期进行安全岗位人员考核', '建立关键岗位人员保密制度和调离制度'],
  '建设运行': ['制定密码应用方案', '制定密钥安全管理策略', '制定实施方案', '投入运行前进行密码应用安全性评估', '定期开展密码应用安全性评估及攻防对抗演习'],
  '应急处置': ['应急策略', '事件处置', '向有关主管部门上报处置情况'],
};
const riskUnitDefaults: Record<string, { threat: string; level: '高' | '中' | '低' }> = {
  '物理和环境安全|身份鉴别': { threat: 'TP1', level: '中' },
  '物理和环境安全|电子门禁记录数据存储完整性': { threat: 'TP2', level: '中' },
  '物理和环境安全|视频监控记录数据存储完整性': { threat: 'TP2', level: '低' },
  '网络和通信安全|身份鉴别': { threat: 'TN1', level: '中' },
  '网络和通信安全|通信数据完整性': { threat: 'TN2', level: '中' },
  '网络和通信安全|通信过程中重要数据的机密性': { threat: 'TN2', level: '中' },
  '网络和通信安全|网络边界访问控制信息的完整性': { threat: 'TN3', level: '中' },
  '网络和通信安全|安全接入认证': { threat: 'TN1', level: '中' },
  '设备和计算安全|身份鉴别': { threat: 'TD1', level: '中' },
  '设备和计算安全|远程管理通道安全': { threat: 'TD2', level: '中' },
  '设备和计算安全|系统资源访问控制信息完整性': { threat: 'TD3', level: '中' },
  '设备和计算安全|重要信息资源安全标记完整性': { threat: 'TD4', level: '中' },
  '设备和计算安全|日志记录完整性': { threat: 'TD5', level: '中' },
  '设备和计算安全|重要可执行程序完整性、重要可执行程序来源真实性': { threat: 'TD6', level: '中' },
  '应用和数据安全|身份鉴别': { threat: 'TA1', level: '中' },
  '应用和数据安全|访问控制信息完整性': { threat: 'TA2', level: '中' },
  '应用和数据安全|重要信息资源安全标记完整性': { threat: 'TA3', level: '中' },
  '应用和数据安全|重要数据传输机密性': { threat: 'TA4', level: '中' },
  '应用和数据安全|重要数据存储机密性': { threat: 'TA4', level: '中' },
  '应用和数据安全|重要数据传输完整性': { threat: 'TA4', level: '中' },
  '应用和数据安全|重要数据存储完整性': { threat: 'TA4', level: '中' },
  '应用和数据安全|不可否认性': { threat: 'TA6', level: '中' },
  '管理制度|具备密码应用安全管理制度': { threat: 'TK7', level: '中' },
  '管理制度|密钥管理规则': { threat: 'TK3', level: '中' },
  '管理制度|建立操作规程': { threat: 'TK7', level: '低' },
  '管理制度|定期修订安全管理制度': { threat: 'TK7', level: '低' },
  '管理制度|明确管理制度发布流程': { threat: 'TK7', level: '低' },
  '管理制度|制度执行过程记录留存': { threat: 'TK7', level: '低' },
  '人员管理|了解并遵守密码相关法律法规和密码管理制度': { threat: 'TK7', level: '低' },
  '人员管理|建立密码应用岗位责任制度': { threat: 'TK7', level: '低' },
  '人员管理|建立上岗人员培训制度': { threat: 'TK7', level: '低' },
  '人员管理|定期进行安全岗位人员考核': { threat: 'TK7', level: '低' },
  '人员管理|建立关键岗位人员保密制度和调离制度': { threat: 'TK7', level: '低' },
  '建设运行|制定密码应用方案': { threat: 'TK7', level: '低' },
  '建设运行|制定密钥安全管理策略': { threat: 'TK7', level: '低' },
  '建设运行|制定实施方案': { threat: 'TK7', level: '低' },
  '建设运行|投入运行前进行密码应用安全性评估': { threat: 'TK7', level: '低' },
  '建设运行|定期开展密码应用安全性评估及攻防对抗演习': { threat: 'TK7', level: '低' },
  '应急处置|应急策略': { threat: 'TK7', level: '低' },
  '应急处置|事件处置': { threat: 'TK7', level: '低' },
  '应急处置|向有关主管部门上报处置情况': { threat: 'TK7', level: '低' },
};
const importTargetProject = ref<Project | null>(null);
const institutionForm = reactive({ name: '', address: '', postalCode: '', contact: '', title: '', department: '', telephone: '', mobile: '', email: '' });
const activePlanningModule = ref<PlanningModule | null>(null);
const planningForm = reactive<Record<string, string>>({});

function resizePlanningTextarea(element: HTMLTextAreaElement) {
  element.style.height = 'auto';
  element.style.height = `${element.scrollHeight}px`;
}

const vAutoResize: ObjectDirective<HTMLTextAreaElement> = {
  mounted: resizePlanningTextarea,
  updated: resizePlanningTextarea,
};

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
const copyForm = reactive({ systemName: '', reportCode: '', assessmentYear: new Date().getFullYear(), startDate: '', endDate: '' });
const userForm = reactive({ username: '', displayName: '', role: 'evaluator', certificateDate: '', certificateFileName: '' });

function toggleTheme() {
  const themeApi = (window as typeof window & { bbTheme?: { toggle: () => string } }).bbTheme;
  const next = themeApi?.toggle() || (darkMode.value ? 'light' : 'dark');
  if (!themeApi) {
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    localStorage.setItem('bb-theme', next);
  }
  darkMode.value = next === 'dark';
}

function handleThemeChange(event: Event) {
  darkMode.value = (event as CustomEvent<{ theme?: string }>).detail?.theme === 'dark';
}

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
const riskLayers = computed(() => Object.keys(riskUnitsByLayer));
const visibleRiskTemplates = computed(() => riskTemplates.value.filter(item => item.layer === activeRiskLayer.value));
const riskTemplateTotal = computed(() => Object.values(riskUnitsByLayer).reduce((sum, units) => sum + units.length, 0));
const riskTemplateCompleteCount = computed(() => riskTemplates.value.filter(item => item.analysis?.trim() && item.advice?.trim()).length);
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
  if (restorablePages.includes(next)) {
    const url = new URL(window.location.href);
    url.searchParams.set('page', next);
    window.history.replaceState(null, '', url);
  }
  if (next === 'dashboard') dashboard.value = await api('/dashboard');
  if (next === 'projects') await loadProjects();
  if (next === 'users') users.value = await api('/users');
  if (next === 'templates') templateInfo.value = await api('/templates');
  if (next === 'risk-analysis') riskTemplates.value = ensureRiskTemplateCoverage(await api('/settings/risk-templates'));
  if (next === 'institution') Object.assign(institutionForm, await api('/settings/institution'));
}

async function loadProjects() {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
  projects.value = await api(`/projects?${query}`);
}

let projectRefreshPromise: Promise<void> | null = null;

function refreshProjectsIfVisible() {
  if (!token.value || page.value !== 'projects' || document.hidden) return;
  if (projectRefreshPromise) return projectRefreshPromise;
  projectRefreshPromise = loadProjects()
    .catch(error => notify((error as Error).message || '项目列表刷新失败'))
    .finally(() => { projectRefreshPromise = null; });
  return projectRefreshPromise;
}

function handleProjectListFocus() {
  void refreshProjectsIfVisible();
}

function handleProjectListVisibility() {
  if (document.visibilityState === 'visible') void refreshProjectsIfVisible();
}

function handleProjectDataUpdated(event: StorageEvent) {
  if (event.key === 'bb-project-updated') void refreshProjectsIfVisible();
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

function openCopyProjectModal(project: Project) {
  copySourceProject.value = project;
  Object.assign(copyForm, {
    systemName: project.system_name,
    reportCode: project.report_code || '',
    assessmentYear: project.assessment_year,
    startDate: project.start_date ? String(project.start_date).slice(0, 10) : '',
    endDate: project.end_date ? String(project.end_date).slice(0, 10) : '',
  });
}

async function copyProject() {
  const project = copySourceProject.value;
  if (!project || copyingProject.value) return;
  copyingProject.value = true;
  try {
    const copied = await api(`/projects/${project.id}/copy`, { method: 'POST', body: JSON.stringify(copyForm) });
    copySourceProject.value = null;
    notify(`已复制为新项目 ${copied.code}`);
    await loadProjects();
  } catch (error) { notify((error as Error).message); }
  finally { copyingProject.value = false; }
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

function downloadBase64File(dataBase64: string, name: string, mimeType: string) {
  const link = document.createElement('a');
  link.href = `data:${mimeType};base64,${dataBase64}`;
  link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
}

async function downloadUserImportTemplate() {
  try {
    const file = await api('/users/import-template');
    downloadBase64File(file.dataBase64, file.name || '用户批量导入模板.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    notify('用户导入模板已下载');
  } catch (error) { notify((error as Error).message); }
}

async function importUsers(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  userImporting.value = true;
  try {
    const result = await api('/users/import', {
      method: 'POST',
      body: JSON.stringify({ name: file.name, dataBase64: await fileAsBase64(file) }),
    });
    users.value = await api('/users');
    userImportResults.value = result.users || [];
    showUserImportResult.value = true;
    notify(`已成功导入 ${result.created} 名用户`);
  } catch (error) { notify((error as Error).message); }
  finally { userImporting.value = false; input.value = ''; }
}

function downloadUserPasswordList() {
  const quote = (value: string) => `"${String(value || '').replace(/"/g, '""')}"`;
  const rows = [
    ['用户名', '姓名', '初始密码'],
    ...userImportResults.value.map(user => [user.username, user.display_name, user.defaultPassword]),
  ];
  const blob = new Blob(['\ufeff' + rows.map(row => row.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = '批量导入用户初始密码.csv';
  document.body.appendChild(link); link.click(); link.remove();
  URL.revokeObjectURL(link.href);
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

async function uploadReportTemplate(event: Event, systemLevel = 3) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    await api('/templates/report', { method: 'POST', body: JSON.stringify({ systemLevel, name: file.name, dataBase64: await fileAsBase64(file) }) });
    templateInfo.value = await api('/templates');
    notify(systemLevel === 2 ? '二级报告模板已导入' : '三级报告模板已导入');
  } catch (error) { notify((error as Error).message); }
}

async function downloadStoredTemplate(path: string, fallbackName: string) {
  try {
    const response = await fetch(`${apiBase}${path}`, {
      headers: token.value ? { Authorization: `Bearer ${token.value}` } : {},
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || '模板下载失败');
    }
    const disposition = response.headers.get('Content-Disposition') || '';
    const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
    const fileName = encodedName ? decodeURIComponent(encodedName) : fallbackName;
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    notify(`${fileName} 已下载`);
  } catch (error) { notify((error as Error).message); }
}

function downloadReportTemplate(systemLevel: 2 | 3) {
  return downloadStoredTemplate(`/templates/report/download?systemLevel=${systemLevel}`, systemLevel === 2 ? '二级报告模板.docx' : '三级报告模板.docx');
}

function downloadRawTemplate() {
  return downloadStoredTemplate('/templates/records/download', '原始记录模板.zip');
}

async function uploadRawFolder(event: Event) {
  const files = [...((event.target as HTMLInputElement).files || [])];
  if (!files.length) return;
  try {
    const payload = await Promise.all(files.map(async file => ({ path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name, dataBase64: await fileAsBase64(file) })));
    await api('/templates/records', { method: 'POST', body: JSON.stringify({ files: payload }) });
    templateInfo.value = await api('/templates');
    notify(`已替换原始记录模板，共 ${files.length} 个文件`);
  } catch (error) { notify((error as Error).message); }
  finally { (event.target as HTMLInputElement).value = ''; }
}

function riskUnits(layer: string) {
  return riskUnitsByLayer[layer] || [];
}

function riskTemplateId(layer: string, unit: string) {
  let hash = 2166136261;
  const value = `${layer}|${unit}`;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `risk-unit-${(hash >>> 0).toString(36)}`;
}

function ensureRiskTemplateCoverage(source: any[]) {
  const normalized = (Array.isArray(source) ? source : []).map(item => ({
    ...item,
    unit: item.unit === '重要程序和文件完整性' ? '重要可执行程序完整性、重要可执行程序来源真实性' : item.unit,
  }));
  return Object.entries(riskUnitsByLayer).flatMap(([layer, units]) => {
    const layerFallback = normalized.find(item => item.layer === layer && item.unit === '*');
    return units.map(unit => {
      const found = normalized.find(item => item.layer === layer && item.unit === unit);
      const base = found || layerFallback || {};
      const defaults = riskUnitDefaults[`${layer}|${unit}`] || { threat: '', level: layer.includes('安全') ? '中' : '低' };
      return {
        id: found?.id || riskTemplateId(layer, unit), layer, unit, result: '*',
        threat: found?.threat || defaults.threat,
        analysis: found?.analysis || layerFallback?.analysis || `“${unit}”测评单元未完全满足密码应用要求，可能导致相关安全需求无法得到有效保障。`,
        advice: found?.advice || layerFallback?.advice || `建议按照相关标准要求，对“${unit}”测评单元存在的问题进行整改，并留存实施和验证记录。`,
        defaultLevel: found?.defaultLevel || defaults.level,
        version: Number(base.version || 1), enabled: base.enabled !== false,
      };
    });
  });
}

function changeRiskTemplateLayer() {
  const units = riskUnits(riskTemplateForm.layer);
  if (!units.includes(riskTemplateForm.unit)) riskTemplateForm.unit = units[0] || '';
  const defaults = riskUnitDefaults[`${riskTemplateForm.layer}|${riskTemplateForm.unit}`];
  if (defaults) {
    riskTemplateForm.threat = defaults.threat;
    riskTemplateForm.defaultLevel = defaults.level;
  }
  if (!editingRiskTemplateId.value) {
    riskTemplateForm.analysis = '';
    riskTemplateForm.advice = '';
  }
}

function openAddRiskTemplate() {
  const missing = riskLayers.value.flatMap(layer => riskUnits(layer).map(unit => ({ layer, unit })))
    .find(candidate => !riskTemplates.value.some(item => item.layer === candidate.layer && item.unit === candidate.unit));
  const candidate = missing || { layer: activeRiskLayer.value, unit: riskUnits(activeRiskLayer.value)[0] };
  editingRiskTemplateId.value = '';
  const defaults = riskUnitDefaults[`${candidate.layer}|${candidate.unit}`] || { threat: '', level: '中' };
  Object.assign(riskTemplateForm, { layer: candidate.layer, unit: candidate.unit, threat: defaults.threat, defaultLevel: defaults.level, analysis: '', advice: '', enabled: true, version: 1 });
  showRiskTemplateModal.value = true;
}

function editRiskTemplate(item: any) {
  editingRiskTemplateId.value = item.id;
  Object.assign(riskTemplateForm, JSON.parse(JSON.stringify(item)));
  showRiskTemplateModal.value = true;
}

function saveRiskTemplateForm() {
  if (!riskTemplateForm.layer || !riskTemplateForm.unit) return notify('请选择安全层面和测评单元');
  if (!riskTemplateForm.analysis.trim() || !riskTemplateForm.advice.trim()) return notify('风险分析和整改建议均不能为空');
  const duplicate = riskTemplates.value.find(item => item.layer === riskTemplateForm.layer && item.unit === riskTemplateForm.unit && item.id !== editingRiskTemplateId.value);
  const targetId = editingRiskTemplateId.value || duplicate?.id || riskTemplateId(riskTemplateForm.layer, riskTemplateForm.unit);
  const value = { ...JSON.parse(JSON.stringify(riskTemplateForm)), id: targetId, result: '*' };
  const index = riskTemplates.value.findIndex(item => item.id === targetId);
  if (index >= 0) riskTemplates.value.splice(index, 1, value);
  else riskTemplates.value.push(value);
  riskTemplates.value = ensureRiskTemplateCoverage(riskTemplates.value);
  activeRiskLayer.value = value.layer;
  showRiskTemplateModal.value = false;
}

async function importRiskTemplates(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const imported = await api('/settings/risk-templates/import', { method: 'POST', body: JSON.stringify({ name: file.name, dataBase64: await fileAsBase64(file) }) });
    const unknown = imported.find((item: any) => !riskUnits(item.layer).includes(item.unit));
    if (unknown) throw new Error(`Excel 中存在系统未定义的测评单元：${unknown.layer} / ${unknown.unit}`);
    const merged = ensureRiskTemplateCoverage(riskTemplates.value);
    imported.forEach((item: any) => {
      const current = merged.find(template => template.layer === item.layer && template.unit === item.unit);
      if (!current) return;
      current.threat = item.threat || current.threat;
      current.defaultLevel = item.defaultLevel || current.defaultLevel;
      current.analysis = item.analysis || current.analysis;
      current.advice = item.advice || current.advice;
      current.enabled = true;
      current.version = Math.max(Number(current.version || 1), Number(item.version || 1));
    });
    riskTemplates.value = ensureRiskTemplateCoverage(merged);
    riskTemplates.value = await api('/settings/risk-templates', { method: 'PUT', body: JSON.stringify(riskTemplates.value) });
    riskTemplates.value = ensureRiskTemplateCoverage(riskTemplates.value);
    const analysisCount = imported.filter((item: any) => String(item.analysis || '').trim()).length;
    const adviceCount = imported.filter((item: any) => String(item.advice || '').trim()).length;
    const threatCount = imported.filter((item: any) => String(item.threat || '').trim()).length;
    notify(`已导入${imported.length}条：威胁${threatCount}条、风险分析${analysisCount}条、整改建议${adviceCount}条${analysisCount || adviceCount ? '' : '；Excel后两列为空，已保留系统原内容'}`);
  } catch (error) { notify((error as Error).message); }
  finally { input.value = ''; }
}

async function exportRiskTemplates() {
  try {
    const rows = ensureRiskTemplateCoverage(riskTemplates.value);
    const file = await api('/settings/risk-templates/export', { method: 'POST', body: JSON.stringify(rows) });
    const link = document.createElement('a');
    link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${file.dataBase64}`;
    link.download = file.name || '风险模板导入模板.xlsx';
    document.body.appendChild(link); link.click(); link.remove();
    notify('风险模板 Excel 已导出');
  } catch (error) { notify((error as Error).message); }
}

async function saveRiskTemplates() {
  try {
    const rows = ensureRiskTemplateCoverage(riskTemplates.value);
    const incomplete = rows.find(item => !item.analysis.trim() || !item.advice.trim());
    if (incomplete) {
      activeRiskLayer.value = incomplete.layer;
      return notify(`${incomplete.unit}缺少风险分析或整改建议`);
    }
    riskTemplates.value = await api('/settings/risk-templates', { method: 'PUT', body: JSON.stringify(rows) });
    riskTemplates.value = ensureRiskTemplateCoverage(riskTemplates.value);
    notify('风险模板库已保存');
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
  window.addEventListener('focus', handleProjectListFocus);
  window.addEventListener('storage', handleProjectDataUpdated);
  window.addEventListener('bb-theme-change', handleThemeChange);
  document.addEventListener('visibilitychange', handleProjectListVisibility);
  if (!token.value) return;
  try {
    currentUser.value = await api('/auth/me');
    const requestedPage = new URLSearchParams(window.location.search).get('page') as Page | null;
    const adminOnlyPages: Page[] = ['templates', 'risk-analysis', 'institution'];
    const canRestore = requestedPage && restorablePages.includes(requestedPage)
      && (!adminOnlyPages.includes(requestedPage) || currentUser.value?.role === 'admin');
    await openPage(canRestore ? requestedPage : 'dashboard');
  }
  catch { logout(); }
});

onBeforeUnmount(() => {
  window.removeEventListener('focus', handleProjectListFocus);
  window.removeEventListener('storage', handleProjectDataUpdated);
  window.removeEventListener('bb-theme-change', handleThemeChange);
  document.removeEventListener('visibilitychange', handleProjectListVisibility);
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
        <button v-if="currentUser?.role==='admin'" :class="{active:page==='risk-analysis'}" @click="openPage('risk-analysis')"><i>⚠</i><span>风险分析</span></button>
      </nav>
      <div class="side-bottom"><button><i>?</i><span>使用帮助</span></button><button><i>⚙</i><span>系统设置</span></button></div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div><b>{{ page==='dashboard'?'工作台':page==='projects'?'项目管理':page==='users'?'用户管理':page==='templates'?'模板设置':page==='risk-analysis'?'风险分析':page==='institution'?'测评机构管理':selectedProject?.system_name }}</b><span v-if="page==='workspace'" class="top-code">{{ selectedProject?.code }}</span></div>
        <div class="top-actions"><button class="text-btn" @click="showPasswordModal=true">修改密码</button><button class="theme-toggle" type="button" :aria-pressed="darkMode" @click="toggleTheme">{{ darkMode ? '浅色模式' : '深色模式' }}</button><button class="icon-btn" title="通知">◔<span class="dot"></span></button><div class="avatar">{{ currentUser?.display_name?.slice(0,1) }}</div><div class="user-block"><b>{{ currentUser?.display_name }}</b><small>{{ roleMap[currentUser?.role || ''] }}</small></div><button class="logout" @click="logout">退出</button></div>
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
        <section class="panel data-table project-table"><div class="table-head"><span>项目</span><span>年度</span><span>等级</span><span>当前阶段</span><span>系统评分</span><span>进度</span><span>操作</span></div><div v-for="p in visibleProjects" :key="p.id" class="table-row project-row"><span><b>{{ p.system_name }}</b><small>{{ p.code }}<template v-if="p.report_code"> · {{ p.report_code }}</template><br>{{ p.org_name }}</small></span><span><b>{{ p.assessment_year }}</b></span><span><b>{{ p.system_level }}级</b></span><span><i class="status-pill" :class="p.status">{{ statusMap[p.status] }}</i><small>{{ stageMeta[p.current_stage-1]?.short }}</small></span><span><b>{{ p.system_score ?? '—' }}</b><small>满分 100</small></span><span><div class="progress"><i :style="{width:p.progress+'%'}"></i></div><small>{{ p.progress }}%</small></span><span class="project-actions"><button @click="openProject(p)">实施</button><label class="project-action-label" for="project-word-import" @click.stop="importTargetProject=p">导入Word</label><button @click="openCopyProjectModal(p)">复制</button><button @click="openEditProjectModal(p)">编辑</button><button class="danger" @click="projectToDelete=p">删除</button></span></div></section>
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
        <section class="page-title"><div><small>账号、状态与密评资质</small><h1>用户管理</h1><p>支持通过 Excel 批量创建账号；密评证书请在导入后通过“管理”手动添加。</p></div><div v-if="currentUser?.role==='admin'" class="user-page-actions"><button class="secondary" @click="downloadUserImportTemplate">下载导入模板</button><label class="primary upload-button" :class="{disabled:userImporting}">{{ userImporting ? '正在导入…' : '批量导入用户' }}<input type="file" accept=".xlsx" :disabled="userImporting" @change="importUsers" /></label><button class="primary" @click="openAddUser">＋ 添加用户</button></div></section>
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
        <section class="template-grid">
          <article class="panel template-card">
            <div class="template-icon">W</div>
            <div><small>WORD REPORT</small><h2>三级报告模板</h2><p>导出时保留模板原有目录、分页、页眉页脚和表格，只替换模板中已有字段。</p><div class="template-meta"><b>{{ templateInfo.report?.name || '尚未配置' }}</b><span v-if="templateInfo.report">{{ Math.round(templateInfo.report.size/1024/1024*10)/10 }} MB · 已配置默认模板</span></div></div>
            <div class="template-actions"><label class="primary upload-button">导入三级报告模板<input type="file" accept=".docx" @change="uploadReportTemplate($event, 3)" /></label><button class="secondary" :disabled="!templateInfo.report" @click="downloadReportTemplate(3)">下载当前模板</button></div>
          </article>
          <article class="panel template-card">
            <div class="template-icon">W</div>
            <div><small>WORD REPORT</small><h2>二级报告模板</h2><p>导出时保留模板原有目录、分页、页眉页脚和表格，只替换模板中已有字段。</p><div class="template-meta"><b>{{ templateInfo.report2?.name || '尚未配置' }}</b><span v-if="templateInfo.report2">{{ Math.round(templateInfo.report2.size/1024/1024*10)/10 }} MB · 已配置默认模板</span></div></div>
            <div class="template-actions"><label class="primary upload-button">导入二级报告模板<input type="file" accept=".docx" @change="uploadReportTemplate($event, 2)" /></label><button class="secondary" :disabled="!templateInfo.report2" @click="downloadReportTemplate(2)">下载当前模板</button></div>
          </article>
          <article class="panel template-card">
            <div class="template-icon folder">▰</div>
            <div><small>RAW RECORDS</small><h2>原始记录模板</h2><p>生成时自动写入当前项目的基础信息、人员、日期、资产、工具和风险，并输出到“报告编号+系统名称+原始记录”文件夹。</p><div class="template-meta"><b>{{ templateInfo.rawRecords?.length || 0 }} 个文件</b><span>{{ templateInfo.rawRecords?.slice(0,3).map((f:any)=>f.path).join('、') || '尚未导入文件夹' }}</span></div></div>
            <div class="template-actions"><label class="primary upload-button">导入模板文件夹<input type="file" webkitdirectory multiple @change="uploadRawFolder" /></label><button class="secondary" :disabled="!templateInfo.rawRecords?.length" @click="downloadRawTemplate">下载模板压缩包</button></div>
          </article>
        </section>
        <section class="template-tip"><strong>提示</strong><span>模板支持修改字体、段落、分页、页眉页脚、表格边框等样式；如需新增字段映射，需要通过代码实现。</span></section>
      </div>

      <div v-else-if="page==='risk-analysis'" class="content settings-page risk-analysis-page">
        <section class="page-title"><div><small>RISK ANALYSIS</small><h1>风险分析</h1><p>按安全层面和测评单元维护关联威胁、风险等级、风险分析和整改建议。</p></div></section>
        <section class="panel risk-template-panel">
          <div class="risk-template-head"><div><small>RISK TEMPLATE LIBRARY</small><h2>风险分析与整改建议模板库</h2><p>Excel 列结构：安全层面、测评单元、威胁、风险等级、风险分析、整改建议。</p></div><div class="risk-template-actions"><label class="primary upload-button">导入风险模板<input type="file" accept=".xlsx" @change="importRiskTemplates" /></label><button class="secondary" @click="exportRiskTemplates">导出 Excel</button><button class="secondary" @click="openAddRiskTemplate">＋ 新增模板</button><button class="secondary" @click="saveRiskTemplates">保存模板库</button></div></div>
          <div class="risk-template-summary"><div><strong>{{ riskTemplateTotal }}</strong><span>测评单元</span></div><div><strong>{{ riskTemplateCompleteCount }}</strong><span>已填写分析与建议</span></div><div><strong>{{ riskTemplateTotal-riskTemplateCompleteCount }}</strong><span>待完善</span></div></div>
          <div class="risk-layer-tabs"><button v-for="layer in riskLayers" :key="layer" :class="{active:activeRiskLayer===layer}" @click="activeRiskLayer=layer"><span>{{ layer }}</span><em>{{ riskTemplates.filter(item=>item.layer===layer).length }}/{{ riskUnits(layer).length }}</em></button></div>
          <div class="risk-template-table"><div class="risk-template-list-head"><span>测评单元</span><span>威胁</span><span>风险等级</span><span>风险分析</span><span>整改建议</span><span>状态</span><span>操作</span></div>
            <article v-for="item in visibleRiskTemplates" :key="item.id" class="risk-template-list-row">
              <strong>{{ item.unit }}</strong><code>{{ item.threat || '未填写' }}</code><span :class="['risk-level-badge',`level-${item.defaultLevel}`]">{{ item.defaultLevel }}风险</span><p>{{ item.analysis || '未填写风险分析' }}</p><p>{{ item.advice || '未填写整改建议' }}</p><span :class="['risk-status',item.analysis&&item.advice?'complete':'pending']">{{ item.analysis&&item.advice?'完整':'待完善' }}</span><span class="risk-row-actions"><button class="secondary" @click="editRiskTemplate(item)">编辑</button></span>
            </article>
          </div>
        </section>
      </div>
    </main>
  </div>

  <div v-if="showRiskTemplateModal" class="modal-mask" @click.self="showRiskTemplateModal=false"><form class="modal risk-template-modal" @submit.prevent="saveRiskTemplateForm"><div class="modal-head"><div><small>RISK TEMPLATE</small><h2>{{ editingRiskTemplateId ? '编辑风险模板' : '新增风险模板' }}</h2><p>每个安全层面下的每个测评单元保留一条模板。</p></div><button type="button" @click="showRiskTemplateModal=false">×</button></div><div class="risk-template-modal-grid"><label>安全层面<select v-model="riskTemplateForm.layer" :disabled="!!editingRiskTemplateId" @change="changeRiskTemplateLayer"><option v-for="layer in riskLayers" :key="layer" :value="layer">{{ layer }}</option></select></label><label>测评单元<select v-model="riskTemplateForm.unit" :disabled="!!editingRiskTemplateId" @change="changeRiskTemplateLayer"><option v-for="unit in riskUnits(riskTemplateForm.layer)" :key="unit" :value="unit">{{ unit }}</option></select></label><label>关联威胁<input v-model="riskTemplateForm.threat" placeholder="如 TP1、TN2" /></label><label>默认风险等级<select v-model="riskTemplateForm.defaultLevel"><option>高</option><option>中</option><option>低</option></select></label><label class="span-2">风险分析<textarea v-model="riskTemplateForm.analysis" rows="6" required placeholder="支持 {系统名称}、{安全层面}、{测评单元} 占位符"></textarea></label><label class="span-2">整改建议<textarea v-model="riskTemplateForm.advice" rows="6" required placeholder="请输入该测评单元对应的整改建议"></textarea></label><label class="risk-enabled"><input v-model="riskTemplateForm.enabled" type="checkbox" />启用此模板</label></div><div class="modal-foot"><button type="button" class="secondary" @click="showRiskTemplateModal=false">取消</button><button class="primary">保存模板</button></div></form></div>
  <div v-if="activePlanningModule" class="modal-mask" @click.self="activePlanningModule=null"><form class="modal planning-modal" @submit.prevent="savePlanningModule"><div class="modal-head"><div><small>方案编制</small><h2>{{ activePlanningModule.title }}</h2><p>{{ activePlanningModule.note }}</p></div><button type="button" @click="activePlanningModule=null">×</button></div><div class="planning-form"><label v-for="field in activePlanningModule.fields" v-show="activePlanningModule.key !== 'previousAssessment' || field.key === 'assessmentCount' || field.key === 'assessmentContent' || Number(planningForm.assessmentCount || 1) > 1" :key="field.key">{{ field.label }}<textarea v-if="field.multiline" v-auto-resize v-model="planningForm[field.key]" :placeholder="field.placeholder" rows="4" @keydown.enter="handleParagraphEnter" @blur="normalizePlanningParagraph(field.key)"></textarea><input v-else v-model="planningForm[field.key]" :type="field.key === 'assessmentCount' ? 'number' : 'text'" :min="field.key === 'assessmentCount' ? 1 : undefined" :step="field.key === 'assessmentCount' ? 1 : undefined" :placeholder="field.placeholder" /></label></div><div class="modal-foot"><button type="button" class="secondary" @click="activePlanningModule=null">取消</button><button class="primary">保存模块内容</button></div></form></div>
  <div v-if="showProjectModal" class="modal-mask"><form class="modal" @submit.prevent="createProject"><div class="modal-head"><div><small>PROJECT</small><h2>{{ editingProjectId ? '编辑密评项目' : '新建密评项目' }}</h2></div><button type="button" @click="showProjectModal=false">×</button></div><div class="form-grid"><label>项目编号<input :value="editingProjectId ? projectForm.code : `MP-${projectForm.assessmentYear}-自动编号`" readonly class="readonly-input" /></label><label>报告编号<input v-model="projectForm.reportCode" placeholder="可稍后补充或从Word导入" /></label><label class="span-2">系统名称<input v-model="projectForm.systemName" required placeholder="请输入被测系统全称" /></label><label class="span-2">责任单位<input v-model="projectForm.orgName" required placeholder="请输入责任单位全称" /></label><label>测评年度<input v-model.number="projectForm.assessmentYear" type="number" /></label><label>系统等级<select v-model.number="projectForm.systemLevel"><option :value="2">二级</option><option :value="3">三级</option></select></label><label>开始日期<input v-model="projectForm.startDate" type="date" /></label><label>结束日期<input v-model="projectForm.endDate" type="date" /></label></div><div class="modal-foot"><button type="button" class="secondary" @click="showProjectModal=false">取消</button><button class="primary">{{ editingProjectId ? '保存修改' : '创建并进入项目' }}</button></div></form></div>
  <div v-if="copySourceProject" class="modal-mask"><form class="modal small" :aria-busy="copyingProject" @submit.prevent="copyProject"><div class="modal-head"><div><small>RETEST COPY</small><h2>复制为复测项目</h2><p>保留现场测评记录、8个层面的证据列表及全部证据图片，附录 B 的独立材料将清空。</p></div><button type="button" :disabled="copyingProject" @click="copySourceProject=null">×</button></div><div class="form-grid"><label class="span-2">系统名称<input v-model="copyForm.systemName" :disabled="copyingProject" required placeholder="请输入被测系统全称" /></label><label>报告编号<input v-model="copyForm.reportCode" :disabled="copyingProject" placeholder="请输入新报告编号" /></label><label>测评年度<input v-model.number="copyForm.assessmentYear" :disabled="copyingProject" type="number" min="2000" max="2100" required /></label><label>开始时间<input v-model="copyForm.startDate" :disabled="copyingProject" type="date" required /></label><label>结束时间<input v-model="copyForm.endDate" :disabled="copyingProject" type="date" required /></label></div><div class="modal-foot"><button type="button" class="secondary" :disabled="copyingProject" @click="copySourceProject=null">取消</button><button class="primary" :disabled="copyingProject">{{ copyingProject ? '正在复制…' : '确认复制' }}</button></div></form></div>
  <div v-if="projectToDelete" class="modal-mask" @click.self="projectToDelete=null"><div class="modal confirm-dialog"><div class="confirm-symbol">!</div><h2>确认删除该项目？</h2><p>将删除“{{ projectToDelete.system_name }}”及其阶段数据、资产、测评记录、风险和证据文件记录。此操作不可恢复。</p><div class="modal-foot"><button class="secondary" @click="projectToDelete=null">取消</button><button class="primary danger-button" @click="deleteProject">确认删除</button></div></div></div>
  <div v-if="showUserModal" class="modal-mask" @click.self="showUserModal=false"><form class="modal small" @submit.prevent="createUser"><div class="modal-head"><div><small>USER</small><h2>{{ editingUserId ? '编辑用户信息' : '添加系统用户' }}</h2></div><button type="button" @click="showUserModal=false">×</button></div><div class="form-grid"><label>用户名<input v-model="userForm.username" required :readonly="!!editingUserId" placeholder="英文、数字或下划线" /></label><label>姓名<input v-model="userForm.displayName" required placeholder="真实姓名" /></label><label>系统角色<select v-model="userForm.role"><option value="evaluator">测评人员</option><option value="manager">项目负责人</option><option value="reviewer">审核人员</option><option value="admin">系统管理员</option></select></label><label>密评考试通过时间<input v-model="userForm.certificateDate" type="date" /></label><label class="span-2">密评证书<input type="file" accept="image/*,.pdf" @change="chooseCertificate" /><small>{{ userForm.certificateFileName || '支持图片或 PDF' }}</small></label></div><div class="modal-foot"><button type="button" class="secondary" @click="showUserModal=false">取消</button><button class="primary">{{ editingUserId ? '保存修改' : '确认添加' }}</button></div></form></div>
  <div v-if="showUserImportResult" class="modal-mask" @click.self="showUserImportResult=false"><div class="modal user-import-result-modal"><div class="modal-head"><div><small>IMPORT COMPLETE</small><h2>成功导入 {{ userImportResults.length }} 名用户</h2><p>所有账号首次登录均需修改密码，请妥善保存以下初始密码。</p></div><button type="button" @click="showUserImportResult=false">×</button></div><div class="user-import-result-table"><div class="result-head"><span>用户名</span><span>姓名</span><span>初始密码</span></div><div v-for="user in userImportResults" :key="user.username" class="result-row"><b>{{ user.username }}</b><span>{{ user.display_name }}</span><code>{{ user.defaultPassword }}</code></div></div><div class="modal-foot"><button class="secondary" @click="showUserImportResult=false">关闭</button><button class="primary" @click="downloadUserPasswordList">下载初始密码清单</button></div></div></div>
  <div v-if="showPasswordModal" class="modal-mask" @click.self="showPasswordModal=false"><form class="modal small" @submit.prevent="changePassword"><div class="modal-head"><div><small>ACCOUNT SECURITY</small><h2>修改账户密码</h2></div><button type="button" @click="showPasswordModal=false">×</button></div><div class="form-grid password-grid"><label class="span-2">当前密码<input v-model="passwordForm.currentPassword" type="password" required autocomplete="current-password" /></label><label>新密码<input v-model="passwordForm.newPassword" type="password" minlength="8" required autocomplete="new-password" /></label><label>确认新密码<input v-model="passwordForm.confirmPassword" type="password" minlength="8" required autocomplete="new-password" /></label></div><div class="modal-foot"><button type="button" class="secondary" @click="showPasswordModal=false">取消</button><button class="primary">确认修改</button></div></form></div>
  <transition name="toast"><div v-if="toast" class="toast">✓ {{ toast }}</div></transition>
</template>
