import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
const restorablePages = ['dashboard', 'projects', 'users', 'templates', 'risk-analysis', 'institution'];
const apiBase = '/api';
const token = ref(localStorage.getItem('bb-token') || '');
const currentUser = ref(null);
const page = ref(token.value ? 'dashboard' : 'dashboard');
const loading = ref(false);
const loginError = ref('');
const toast = ref('');
const loginForm = reactive({ username: 'admin', password: 'Admin@123' });
const projects = ref([]);
const users = ref([]);
const selectedProject = ref(null);
const activeStage = ref(0);
const showProjectModal = ref(false);
const editingProjectId = ref('');
const copySourceProject = ref(null);
const copyingProject = ref(false);
const projectToDelete = ref(null);
const showUserModal = ref(false);
const editingUserId = ref('');
const certificateFileData = ref('');
const userImporting = ref(false);
const showUserImportResult = ref(false);
const userImportResults = ref([]);
const showPasswordModal = ref(false);
const passwordForm = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' });
const userFilters = reactive({ search: '', status: '' });
const templateInfo = ref({ report: null, rawRecords: [] });
const riskTemplates = ref([]);
const showRiskTemplateModal = ref(false);
const editingRiskTemplateId = ref('');
const activeRiskLayer = ref('物理和环境安全');
const riskTemplateForm = reactive({ layer: '物理和环境安全', unit: '身份鉴别', threat: '', defaultLevel: '中', analysis: '', advice: '', enabled: true, version: 1 });
const riskUnitsByLayer = {
    '物理和环境安全': ['身份鉴别', '电子门禁记录数据存储完整性', '视频监控记录数据存储完整性'],
    '网络和通信安全': ['身份鉴别', '通信数据完整性', '通信过程中重要数据的机密性', '网络边界访问控制信息的完整性', '安全接入认证'],
    '设备和计算安全': ['身份鉴别', '远程管理通道安全', '系统资源访问控制信息完整性', '重要信息资源安全标记完整性', '日志记录完整性', '重要可执行程序完整性、重要可执行程序来源真实性'],
    '应用和数据安全': ['身份鉴别', '访问控制信息完整性', '重要信息资源安全标记完整性', '重要数据传输机密性', '重要数据存储机密性', '重要数据传输完整性', '重要数据存储完整性', '不可否认性'],
    '管理制度': ['具备密码应用安全管理制度', '密钥管理规则', '建立操作规程', '定期修订安全管理制度', '明确管理制度发布流程', '制度执行过程记录留存'],
    '人员管理': ['了解并遵守密码相关法律法规和密码管理制度', '建立密码应用岗位责任制度', '建立上岗人员培训制度', '定期进行安全岗位人员考核', '建立关键岗位人员保密制度和调离制度'],
    '建设运行': ['制定密码应用方案', '制定密钥安全管理策略', '制定实施方案', '投入运行前进行密码应用安全性评估', '定期开展密码应用安全性评估及攻防对抗演习'],
    '应急处置': ['应急策略', '事件处置', '向有关主管部门上报处置情况'],
};
const riskUnitDefaults = {
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
const importTargetProject = ref(null);
const institutionForm = reactive({ name: '', address: '', postalCode: '', contact: '', title: '', department: '', telephone: '', mobile: '', email: '' });
const activePlanningModule = ref(null);
const planningForm = reactive({});
function resizePlanningTextarea(element) {
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
}
const vAutoResize = {
    mounted: resizePlanningTextarea,
    updated: resizePlanningTextarea,
};
function indentEveryParagraph(value) {
    return String(value || '').replace(/\r\n?/g, '\n').split('\n').map(line => line.trim() ? '\u3000\u3000' + line.replace(/^[ \t\u3000]+/, '') : line).join('\n');
}
function handleParagraphEnter(event) {
    if (event.isComposing)
        return;
    const target = event.target;
    event.preventDefault();
    target.setRangeText('\n\u3000\u3000', target.selectionStart, target.selectionEnd, 'end');
    target.dispatchEvent(new Event('input', { bubbles: true }));
}
function normalizePlanningParagraph(key) {
    planningForm[key] = indentEveryParagraph(planningForm[key] || '');
}
const filters = reactive({ search: '', year: '', level: '', status: '' });
const dashboard = ref({ summary: {}, stages: [], recent: [], risks: [] });
const projectForm = reactive({ code: '', reportCode: '', systemName: '', orgName: '', assessmentYear: 2026, systemLevel: 3, startDate: '', endDate: '' });
const copyForm = reactive({ systemName: '', reportCode: '', assessmentYear: new Date().getFullYear(), startDate: '', endDate: '' });
const userForm = reactive({ username: '', displayName: '', role: 'evaluator', certificateDate: '', certificateFileName: '' });
const stageMeta = [
    { key: 'preparation', short: '项目准备', icon: '01', hint: '单位与项目基础资料' },
    { key: 'planning', short: '方案编制', icon: '02', hint: '资产、对象、指标和计划' },
    { key: 'onsite', short: '现场测评', icon: '03', hint: '逐项记录与证据核验' },
    { key: 'reporting', short: '报告编制', icon: '04', hint: '风险、评分与报告生成' },
    { key: 'review', short: '报告导出', icon: '05', hint: '导出 Word 与 PDF 正式报告' },
];
const statusMap = { draft: '草稿', in_progress: '实施中', reviewing: '审核中', completed: '已完成', archived: '已归档', active: '正常', pending: '待改密', disabled: '已禁用' };
const roleMap = { admin: '系统管理员', manager: '项目负责人', evaluator: '测评人员', reviewer: '审核人员' };
const domainCards = [
    ['物理和环境安全', '3 / 3', '完成'], ['网络和通信安全', '4 / 5', '进行中'], ['设备和计算安全', '5 / 7', '进行中'],
    ['应用和数据安全', '6 / 8', '进行中'], ['管理制度', '6 / 6', '完成'], ['人员管理', '4 / 5', '待补充'],
    ['建设运行', '3 / 5', '待补充'], ['应急处置', '2 / 3', '待补充'],
];
const planningModules = [
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
function getPlanningValues() {
    const value = selectedStage.value?.data?.planningModules;
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}
function isPlanningModuleComplete(moduleKey) {
    return Object.values(getPlanningValues()[moduleKey] || {}).some(value => String(value || '').trim());
}
function openPlanningEditor(module) {
    activePlanningModule.value = module;
    Object.keys(planningForm).forEach(key => delete planningForm[key]);
    const saved = getPlanningValues()[module.key] || {};
    module.fields.forEach(field => { planningForm[field.key] = field.multiline ? indentEveryParagraph(saved[field.key] || '') : (saved[field.key] || (module.key === 'previousAssessment' && field.key === 'assessmentCount' ? '1' : '')); });
}
async function savePlanningModule() {
    if (!selectedProject.value || !selectedStage.value || !activePlanningModule.value)
        return;
    const existing = getPlanningValues();
    activePlanningModule.value.fields.filter(field => field.multiline).forEach(field => normalizePlanningParagraph(field.key));
    const planningValues = { ...existing, [activePlanningModule.value.key]: { ...existing[activePlanningModule.value.key], ...planningForm } };
    const completedCount = planningModules.filter(module => Object.values(planningValues[module.key] || {}).some(value => String(value || '').trim())).length;
    const data = { ...selectedStage.value.data, planningModules: planningValues };
    await api(`/projects/${selectedProject.value.id}/stages/planning`, {
        method: 'PUT',
        body: JSON.stringify({ data, completion: Math.round(completedCount / planningModules.length * 100) }),
    });
    selectedProject.value = await api(`/projects/${selectedProject.value.id}`);
    activePlanningModule.value = null;
    notify('方案模块已保存');
}
async function api(path, options = {}) {
    const headers = new Headers(options.headers);
    if (token.value)
        headers.set('Authorization', `Bearer ${token.value}`);
    if (options.body && !(options.body instanceof FormData))
        headers.set('Content-Type', 'application/json');
    const response = await fetch(`${apiBase}${path}`, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (response.status === 401 && path !== '/auth/login')
            logout();
        throw new Error(data.message || '请求失败');
    }
    return data;
}
function notify(message) {
    toast.value = message;
    window.setTimeout(() => { toast.value = ''; }, 2200);
}
async function login() {
    loading.value = true;
    loginError.value = '';
    try {
        const data = await api('/auth/login', { method: 'POST', body: JSON.stringify(loginForm) });
        token.value = data.token;
        currentUser.value = data.user;
        localStorage.setItem('bb-token', data.token);
        await openPage('dashboard');
    }
    catch (error) {
        loginError.value = error.message;
    }
    finally {
        loading.value = false;
    }
}
function logout() {
    token.value = '';
    currentUser.value = null;
    localStorage.removeItem('bb-token');
}
async function openPage(next) {
    page.value = next;
    if (restorablePages.includes(next)) {
        const url = new URL(window.location.href);
        url.searchParams.set('page', next);
        window.history.replaceState(null, '', url);
    }
    if (next === 'dashboard')
        dashboard.value = await api('/dashboard');
    if (next === 'projects')
        await loadProjects();
    if (next === 'users')
        users.value = await api('/users');
    if (next === 'templates')
        templateInfo.value = await api('/templates');
    if (next === 'risk-analysis')
        riskTemplates.value = ensureRiskTemplateCoverage(await api('/settings/risk-templates'));
    if (next === 'institution')
        Object.assign(institutionForm, await api('/settings/institution'));
}
async function loadProjects() {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
    projects.value = await api(`/projects?${query}`);
}
let projectRefreshPromise = null;
function refreshProjectsIfVisible() {
    if (!token.value || page.value !== 'projects' || document.hidden)
        return;
    if (projectRefreshPromise)
        return projectRefreshPromise;
    projectRefreshPromise = loadProjects()
        .catch(error => notify(error.message || '项目列表刷新失败'))
        .finally(() => { projectRefreshPromise = null; });
    return projectRefreshPromise;
}
function handleProjectListFocus() {
    void refreshProjectsIfVisible();
}
function handleProjectListVisibility() {
    if (document.visibilityState === 'visible')
        void refreshProjectsIfVisible();
}
function handleProjectDataUpdated(event) {
    if (event.key === 'bb-project-updated')
        void refreshProjectsIfVisible();
}
async function openProject(project) {
    const link = document.createElement('a');
    link.href = `/prototype.html?project=${encodeURIComponent(project.id)}&step=1`;
    link.target = '_blank';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
}
function importProjectWord(project) {
    importTargetProject.value = project;
    const input = document.getElementById('project-word-import');
    if (!input)
        return;
    input.value = '';
    input.click();
}
async function handleProjectWordImport(event) {
    const input = event.target;
    const file = input.files?.[0];
    const project = importTargetProject.value;
    if (!file || !project)
        return;
    const child = window.open('about:blank', '_blank');
    try {
        notify('正在上传 Word 报告…');
        await api(`/projects/${project.id}/report-template`, {
            method: 'POST',
            body: JSON.stringify({ name: file.name, dataBase64: await fileAsBase64(file) }),
        });
        const url = `/prototype.html?project=${encodeURIComponent(project.id)}&importStored=1`;
        if (child)
            child.location.href = url;
        else
            window.location.href = url;
        notify('上传完成，正在进入项目并解析报告');
    }
    catch (error) {
        if (child)
            child.close();
        notify(error.message);
    }
    finally {
        importTargetProject.value = null;
        input.value = '';
    }
}
function openCopyProjectModal(project) {
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
    if (!project || copyingProject.value)
        return;
    copyingProject.value = true;
    try {
        const copied = await api(`/projects/${project.id}/copy`, { method: 'POST', body: JSON.stringify(copyForm) });
        copySourceProject.value = null;
        notify(`已复制为新项目 ${copied.code}`);
        await loadProjects();
    }
    catch (error) {
        notify(error.message);
    }
    finally {
        copyingProject.value = false;
    }
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
        }
        else {
            notify('项目已创建');
            await loadProjects();
        }
    }
    catch (error) {
        notify(error.message);
    }
}
function openAddProjectModal() {
    editingProjectId.value = '';
    Object.assign(projectForm, { code: '', reportCode: '', systemName: '', orgName: '', assessmentYear: new Date().getFullYear(), systemLevel: 3, startDate: '', endDate: '' });
    showProjectModal.value = true;
}
function openEditProjectModal(project) {
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
    if (!projectToDelete.value)
        return;
    try {
        await api(`/projects/${projectToDelete.value.id}`, { method: 'DELETE' });
        projectToDelete.value = null;
        notify('项目及其关联测评数据已删除');
        await loadProjects();
    }
    catch (error) {
        notify(error.message);
    }
}
async function createUser() {
    try {
        const body = { ...userForm, certificateFileData: certificateFileData.value || null };
        const result = await api(editingUserId.value ? `/users/${editingUserId.value}` : '/users', { method: editingUserId.value ? 'PUT' : 'POST', body: JSON.stringify(body) });
        showUserModal.value = false;
        users.value = await api('/users');
        notify(editingUserId.value ? '用户信息已保存' : `用户已创建，默认密码：${result.defaultPassword}`);
        editingUserId.value = '';
    }
    catch (error) {
        notify(error.message);
    }
}
function downloadBase64File(dataBase64, name, mimeType) {
    const link = document.createElement('a');
    link.href = `data:${mimeType};base64,${dataBase64}`;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
}
async function downloadUserImportTemplate() {
    try {
        const file = await api('/users/import-template');
        downloadBase64File(file.dataBase64, file.name || '用户批量导入模板.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        notify('用户导入模板已下载');
    }
    catch (error) {
        notify(error.message);
    }
}
async function importUsers(event) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file)
        return;
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
    }
    catch (error) {
        notify(error.message);
    }
    finally {
        userImporting.value = false;
        input.value = '';
    }
}
function downloadUserPasswordList() {
    const quote = (value) => `"${String(value || '').replace(/"/g, '""')}"`;
    const rows = [
        ['用户名', '姓名', '初始密码'],
        ...userImportResults.value.map(user => [user.username, user.display_name, user.defaultPassword]),
    ];
    const blob = new Blob(['\ufeff' + rows.map(row => row.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = '批量导入用户初始密码.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
}
function openAddUser() {
    editingUserId.value = '';
    certificateFileData.value = '';
    Object.assign(userForm, { username: '', displayName: '', role: 'evaluator', certificateDate: '', certificateFileName: '' });
    showUserModal.value = true;
}
function editUser(user) {
    editingUserId.value = user.id;
    certificateFileData.value = '';
    Object.assign(userForm, { username: user.username, displayName: user.display_name, role: user.role, certificateDate: user.certificate_date ? String(user.certificate_date).slice(0, 10) : '', certificateFileName: user.certificate_file_name || '' });
    showUserModal.value = true;
}
function fileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}
async function chooseCertificate(event) {
    const file = event.target.files?.[0];
    if (!file)
        return;
    userForm.certificateFileName = file.name;
    certificateFileData.value = `data:${file.type || 'application/octet-stream'};base64,${await fileAsBase64(file)}`;
}
async function resetPassword(user) {
    if (!window.confirm(`确认重置 ${user.display_name} 的密码？`))
        return;
    try {
        const result = await api(`/users/${user.id}/reset-password`, { method: 'POST' });
        notify(`密码已重置：${result.defaultPassword}`);
        users.value = await api('/users');
    }
    catch (error) {
        notify(error.message);
    }
}
async function toggleUser(user) {
    const status = user.status === 'disabled' ? 'active' : 'disabled';
    await api(`/users/${user.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    users.value = await api('/users');
    notify(status === 'disabled' ? '账号已禁用' : '账号已启用');
}
async function changePassword() {
    if (passwordForm.newPassword !== passwordForm.confirmPassword)
        return notify('两次输入的新密码不一致');
    try {
        await api('/auth/change-password', { method: 'POST', body: JSON.stringify(passwordForm) });
        showPasswordModal.value = false;
        Object.assign(passwordForm, { currentPassword: '', newPassword: '', confirmPassword: '' });
        notify('密码修改成功');
    }
    catch (error) {
        notify(error.message);
    }
}
async function saveInstitution() {
    try {
        await api('/settings/institution', { method: 'PUT', body: JSON.stringify(institutionForm) });
        notify('测评机构信息已保存');
    }
    catch (error) {
        notify(error.message);
    }
}
async function uploadReportTemplate(event, systemLevel = 3) {
    const file = event.target.files?.[0];
    if (!file)
        return;
    try {
        await api('/templates/report', { method: 'POST', body: JSON.stringify({ systemLevel, name: file.name, dataBase64: await fileAsBase64(file) }) });
        templateInfo.value = await api('/templates');
        notify(systemLevel === 2 ? '二级报告模板已导入' : '三级报告模板已导入');
    }
    catch (error) {
        notify(error.message);
    }
}
async function downloadStoredTemplate(path, fallbackName) {
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
    }
    catch (error) {
        notify(error.message);
    }
}
function downloadReportTemplate(systemLevel) {
    return downloadStoredTemplate(`/templates/report/download?systemLevel=${systemLevel}`, systemLevel === 2 ? '二级报告模板.docx' : '三级报告模板.docx');
}
function downloadRawTemplate() {
    return downloadStoredTemplate('/templates/records/download', '原始记录模板.zip');
}
async function uploadRawFolder(event) {
    const files = [...(event.target.files || [])];
    if (!files.length)
        return;
    try {
        const payload = await Promise.all(files.map(async (file) => ({ path: file.webkitRelativePath || file.name, dataBase64: await fileAsBase64(file) })));
        await api('/templates/records', { method: 'POST', body: JSON.stringify({ files: payload }) });
        templateInfo.value = await api('/templates');
        notify(`已替换原始记录模板，共 ${files.length} 个文件`);
    }
    catch (error) {
        notify(error.message);
    }
    finally {
        event.target.value = '';
    }
}
function riskUnits(layer) {
    return riskUnitsByLayer[layer] || [];
}
function riskTemplateId(layer, unit) {
    let hash = 2166136261;
    const value = `${layer}|${unit}`;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `risk-unit-${(hash >>> 0).toString(36)}`;
}
function ensureRiskTemplateCoverage(source) {
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
    if (!units.includes(riskTemplateForm.unit))
        riskTemplateForm.unit = units[0] || '';
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
function editRiskTemplate(item) {
    editingRiskTemplateId.value = item.id;
    Object.assign(riskTemplateForm, JSON.parse(JSON.stringify(item)));
    showRiskTemplateModal.value = true;
}
function saveRiskTemplateForm() {
    if (!riskTemplateForm.layer || !riskTemplateForm.unit)
        return notify('请选择安全层面和测评单元');
    if (!riskTemplateForm.analysis.trim() || !riskTemplateForm.advice.trim())
        return notify('风险分析和整改建议均不能为空');
    const duplicate = riskTemplates.value.find(item => item.layer === riskTemplateForm.layer && item.unit === riskTemplateForm.unit && item.id !== editingRiskTemplateId.value);
    const targetId = editingRiskTemplateId.value || duplicate?.id || riskTemplateId(riskTemplateForm.layer, riskTemplateForm.unit);
    const value = { ...JSON.parse(JSON.stringify(riskTemplateForm)), id: targetId, result: '*' };
    const index = riskTemplates.value.findIndex(item => item.id === targetId);
    if (index >= 0)
        riskTemplates.value.splice(index, 1, value);
    else
        riskTemplates.value.push(value);
    riskTemplates.value = ensureRiskTemplateCoverage(riskTemplates.value);
    activeRiskLayer.value = value.layer;
    showRiskTemplateModal.value = false;
}
async function importRiskTemplates(event) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file)
        return;
    try {
        const imported = await api('/settings/risk-templates/import', { method: 'POST', body: JSON.stringify({ name: file.name, dataBase64: await fileAsBase64(file) }) });
        const unknown = imported.find((item) => !riskUnits(item.layer).includes(item.unit));
        if (unknown)
            throw new Error(`Excel 中存在系统未定义的测评单元：${unknown.layer} / ${unknown.unit}`);
        const merged = ensureRiskTemplateCoverage(riskTemplates.value);
        imported.forEach((item) => {
            const current = merged.find(template => template.layer === item.layer && template.unit === item.unit);
            if (!current)
                return;
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
        const analysisCount = imported.filter((item) => String(item.analysis || '').trim()).length;
        const adviceCount = imported.filter((item) => String(item.advice || '').trim()).length;
        const threatCount = imported.filter((item) => String(item.threat || '').trim()).length;
        notify(`已导入${imported.length}条：威胁${threatCount}条、风险分析${analysisCount}条、整改建议${adviceCount}条${analysisCount || adviceCount ? '' : '；Excel后两列为空，已保留系统原内容'}`);
    }
    catch (error) {
        notify(error.message);
    }
    finally {
        input.value = '';
    }
}
async function exportRiskTemplates() {
    try {
        const rows = ensureRiskTemplateCoverage(riskTemplates.value);
        const file = await api('/settings/risk-templates/export', { method: 'POST', body: JSON.stringify(rows) });
        const link = document.createElement('a');
        link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${file.dataBase64}`;
        link.download = file.name || '风险模板导入模板.xlsx';
        document.body.appendChild(link);
        link.click();
        link.remove();
        notify('风险模板 Excel 已导出');
    }
    catch (error) {
        notify(error.message);
    }
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
    }
    catch (error) {
        notify(error.message);
    }
}
async function saveStage() {
    if (!selectedProject.value || !selectedStage.value)
        return;
    const completion = selectedStage.value.stage_key === 'planning'
        ? Math.round(planningModules.filter(module => isPlanningModuleComplete(module.key)).length / planningModules.length * 100)
        : Math.max(selectedStage.value.completion, 60);
    await api(`/projects/${selectedProject.value.id}/stages/${selectedStage.value.stage_key}`, {
        method: 'PUT', body: JSON.stringify({ data: selectedStage.value.data || {}, completion }),
    });
    selectedProject.value = await api(`/projects/${selectedProject.value.id}`);
    notify('阶段内容已保存');
}
function fmtDate(value) {
    if (!value)
        return '—';
    const text = String(value).trim();
    let match = /^(\d{4})年(\d{1,2})月(?:(\d{1,2})日)?$/.exec(text);
    if (match)
        return `${match[1]}年${String(match[2]).padStart(2, '0')}月${String(match[3] || '1').padStart(2, '0')}日`;
    if (/T/.test(text)) {
        const timed = new Date(text);
        if (!Number.isNaN(timed.getTime()))
            return `${timed.getFullYear()}年${String(timed.getMonth() + 1).padStart(2, '0')}月${String(timed.getDate()).padStart(2, '0')}日`;
    }
    match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
    if (match)
        return `${match[1]}年${String(match[2]).padStart(2, '0')}月${String(match[3]).padStart(2, '0')}日`;
    return text;
}
onMounted(async () => {
    window.addEventListener('focus', handleProjectListFocus);
    window.addEventListener('storage', handleProjectDataUpdated);
    document.addEventListener('visibilitychange', handleProjectListVisibility);
    if (!token.value)
        return;
    try {
        currentUser.value = await api('/auth/me');
        const requestedPage = new URLSearchParams(window.location.search).get('page');
        const adminOnlyPages = ['templates', 'risk-analysis', 'institution'];
        const canRestore = requestedPage && restorablePages.includes(requestedPage)
            && (!adminOnlyPages.includes(requestedPage) || currentUser.value?.role === 'admin');
        await openPage(canRestore ? requestedPage : 'dashboard');
    }
    catch {
        logout();
    }
});
onBeforeUnmount(() => {
    window.removeEventListener('focus', handleProjectListFocus);
    window.removeEventListener('storage', handleProjectDataUpdated);
    document.removeEventListener('visibilitychange', handleProjectListVisibility);
});
const __VLS_ctx = {
    ...{},
    ...{},
};
let __VLS_components;
let __VLS_intrinsics;
let __VLS_directives;
if (!__VLS_ctx.token) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "login-shell" },
    });
    /** @type {__VLS_StyleScopedClasses['login-shell']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "login-brand" },
    });
    /** @type {__VLS_StyleScopedClasses['login-brand']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "brand-mark large" },
    });
    /** @type {__VLS_StyleScopedClasses['brand-mark']} */ ;
    /** @type {__VLS_StyleScopedClasses['large']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "eyebrow" },
    });
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h1, __VLS_intrinsics.h1)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.br)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.em, __VLS_intrinsics.em)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "login-features" },
    });
    /** @type {__VLS_StyleScopedClasses['login-features']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "login-panel" },
    });
    /** @type {__VLS_StyleScopedClasses['login-panel']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.form, __VLS_intrinsics.form)({
        ...{ onSubmit: (__VLS_ctx.login) },
        ...{ class: "login-card" },
    });
    /** @type {__VLS_StyleScopedClasses['login-card']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "mobile-logo" },
    });
    /** @type {__VLS_StyleScopedClasses['mobile-logo']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "brand-mark" },
    });
    /** @type {__VLS_StyleScopedClasses['brand-mark']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        autocomplete: "username",
        placeholder: "请输入用户名",
    });
    (__VLS_ctx.loginForm.username);
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        type: "password",
        autocomplete: "current-password",
        placeholder: "请输入密码",
    });
    (__VLS_ctx.loginForm.password);
    if (__VLS_ctx.loginError) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "form-error" },
        });
        /** @type {__VLS_StyleScopedClasses['form-error']} */ ;
        (__VLS_ctx.loginError);
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ class: "primary wide" },
        disabled: (__VLS_ctx.loading),
    });
    /** @type {__VLS_StyleScopedClasses['primary']} */ ;
    /** @type {__VLS_StyleScopedClasses['wide']} */ ;
    (__VLS_ctx.loading ? '正在登录…' : '登录系统');
}
else {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "app-shell" },
    });
    /** @type {__VLS_StyleScopedClasses['app-shell']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        ...{ onChange: (__VLS_ctx.handleProjectWordImport) },
        id: "project-word-import",
        type: "file",
        accept: ".docx",
        ...{ style: {} },
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.aside, __VLS_intrinsics.aside)({
        ...{ class: "sidebar" },
    });
    /** @type {__VLS_StyleScopedClasses['sidebar']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "side-brand" },
    });
    /** @type {__VLS_StyleScopedClasses['side-brand']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "brand-mark" },
    });
    /** @type {__VLS_StyleScopedClasses['brand-mark']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.nav, __VLS_intrinsics.nav)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!!(!__VLS_ctx.token))
                    throw 0;
                return (__VLS_ctx.openPage('dashboard'));
                // @ts-ignore
                [token, login, loginForm, loginForm, loginError, loginError, loading, loading, handleProjectWordImport, openPage,];
            } },
        ...{ class: ({ active: __VLS_ctx.page === 'dashboard' }) },
    });
    /** @type {__VLS_StyleScopedClasses['active']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!!(!__VLS_ctx.token))
                    throw 0;
                return (__VLS_ctx.openPage('projects'));
                // @ts-ignore
                [openPage, page,];
            } },
        ...{ class: ({ active: __VLS_ctx.page === 'projects' || __VLS_ctx.page === 'workspace' }) },
    });
    /** @type {__VLS_StyleScopedClasses['active']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!!(!__VLS_ctx.token))
                    throw 0;
                return (__VLS_ctx.openPage('users'));
                // @ts-ignore
                [openPage, page, page,];
            } },
        ...{ class: ({ active: __VLS_ctx.page === 'users' }) },
    });
    /** @type {__VLS_StyleScopedClasses['active']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    if (__VLS_ctx.currentUser?.role === 'admin') {
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    if (!!(!__VLS_ctx.token))
                        throw 0;
                    if (!(__VLS_ctx.currentUser?.role === 'admin'))
                        throw 0;
                    return (__VLS_ctx.openPage('institution'));
                    // @ts-ignore
                    [openPage, page, currentUser,];
                } },
            ...{ class: ({ active: __VLS_ctx.page === 'institution' }) },
        });
        /** @type {__VLS_StyleScopedClasses['active']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    }
    if (__VLS_ctx.currentUser?.role === 'admin') {
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    if (!!(!__VLS_ctx.token))
                        throw 0;
                    if (!(__VLS_ctx.currentUser?.role === 'admin'))
                        throw 0;
                    return (__VLS_ctx.openPage('templates'));
                    // @ts-ignore
                    [openPage, page, currentUser,];
                } },
            ...{ class: ({ active: __VLS_ctx.page === 'templates' }) },
        });
        /** @type {__VLS_StyleScopedClasses['active']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    }
    if (__VLS_ctx.currentUser?.role === 'admin') {
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    if (!!(!__VLS_ctx.token))
                        throw 0;
                    if (!(__VLS_ctx.currentUser?.role === 'admin'))
                        throw 0;
                    return (__VLS_ctx.openPage('risk-analysis'));
                    // @ts-ignore
                    [openPage, page, currentUser,];
                } },
            ...{ class: ({ active: __VLS_ctx.page === 'risk-analysis' }) },
        });
        /** @type {__VLS_StyleScopedClasses['active']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "side-bottom" },
    });
    /** @type {__VLS_StyleScopedClasses['side-bottom']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.main, __VLS_intrinsics.main)({
        ...{ class: "main" },
    });
    /** @type {__VLS_StyleScopedClasses['main']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.header, __VLS_intrinsics.header)({
        ...{ class: "topbar" },
    });
    /** @type {__VLS_StyleScopedClasses['topbar']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
    (__VLS_ctx.page === 'dashboard' ? '工作台' : __VLS_ctx.page === 'projects' ? '项目管理' : __VLS_ctx.page === 'users' ? '用户管理' : __VLS_ctx.page === 'templates' ? '模板设置' : __VLS_ctx.page === 'risk-analysis' ? '风险分析' : __VLS_ctx.page === 'institution' ? '测评机构管理' : __VLS_ctx.selectedProject?.system_name);
    if (__VLS_ctx.page === 'workspace') {
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "top-code" },
        });
        /** @type {__VLS_StyleScopedClasses['top-code']} */ ;
        (__VLS_ctx.selectedProject?.code);
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "top-actions" },
    });
    /** @type {__VLS_StyleScopedClasses['top-actions']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!!(!__VLS_ctx.token))
                    throw 0;
                return (__VLS_ctx.showPasswordModal = true);
                // @ts-ignore
                [page, page, page, page, page, page, page, page, selectedProject, selectedProject, showPasswordModal,];
            } },
        ...{ class: "text-btn" },
    });
    /** @type {__VLS_StyleScopedClasses['text-btn']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ class: "icon-btn" },
        title: "通知",
    });
    /** @type {__VLS_StyleScopedClasses['icon-btn']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "dot" },
    });
    /** @type {__VLS_StyleScopedClasses['dot']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "avatar" },
    });
    /** @type {__VLS_StyleScopedClasses['avatar']} */ ;
    (__VLS_ctx.currentUser?.display_name?.slice(0, 1));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "user-block" },
    });
    /** @type {__VLS_StyleScopedClasses['user-block']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
    (__VLS_ctx.currentUser?.display_name);
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    (__VLS_ctx.roleMap[__VLS_ctx.currentUser?.role || '']);
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (__VLS_ctx.logout) },
        ...{ class: "logout" },
    });
    /** @type {__VLS_StyleScopedClasses['logout']} */ ;
    if (__VLS_ctx.page === 'dashboard') {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "content dashboard" },
        });
        /** @type {__VLS_StyleScopedClasses['content']} */ ;
        /** @type {__VLS_StyleScopedClasses['dashboard']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "welcome-row" },
        });
        /** @type {__VLS_StyleScopedClasses['welcome-row']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        (new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }));
        __VLS_asFunctionalElement1(__VLS_intrinsics.h1, __VLS_intrinsics.h1)({});
        (__VLS_ctx.currentUser?.display_name);
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (__VLS_ctx.openAddProjectModal) },
            ...{ class: "primary" },
        });
        /** @type {__VLS_StyleScopedClasses['primary']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "metric-grid" },
        });
        /** @type {__VLS_StyleScopedClasses['metric-grid']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "metric-icon blue" },
        });
        /** @type {__VLS_StyleScopedClasses['metric-icon']} */ ;
        /** @type {__VLS_StyleScopedClasses['blue']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        (__VLS_ctx.dashboard.summary.total || 0);
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "metric-icon cyan" },
        });
        /** @type {__VLS_StyleScopedClasses['metric-icon']} */ ;
        /** @type {__VLS_StyleScopedClasses['cyan']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        (__VLS_ctx.dashboard.summary.in_progress || 0);
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "metric-icon amber" },
        });
        /** @type {__VLS_StyleScopedClasses['metric-icon']} */ ;
        /** @type {__VLS_StyleScopedClasses['amber']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        (__VLS_ctx.dashboard.summary.reviewing || 0);
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "metric-icon green" },
        });
        /** @type {__VLS_StyleScopedClasses['metric-icon']} */ ;
        /** @type {__VLS_StyleScopedClasses['green']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        (__VLS_ctx.dashboard.summary.completed || 0);
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "dashboard-grid" },
        });
        /** @type {__VLS_StyleScopedClasses['dashboard-grid']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
            ...{ class: "panel project-panel" },
        });
        /** @type {__VLS_StyleScopedClasses['panel']} */ ;
        /** @type {__VLS_StyleScopedClasses['project-panel']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "panel-head" },
        });
        /** @type {__VLS_StyleScopedClasses['panel-head']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    if (!!(!__VLS_ctx.token))
                        throw 0;
                    if (!(__VLS_ctx.page === 'dashboard'))
                        throw 0;
                    return (__VLS_ctx.openPage('projects'));
                    // @ts-ignore
                    [openPage, page, currentUser, currentUser, currentUser, currentUser, roleMap, logout, openAddProjectModal, dashboard, dashboard, dashboard, dashboard,];
                } },
            ...{ class: "text-btn" },
        });
        /** @type {__VLS_StyleScopedClasses['text-btn']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "compact-table" },
        });
        /** @type {__VLS_StyleScopedClasses['compact-table']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "tr th" },
        });
        /** @type {__VLS_StyleScopedClasses['tr']} */ ;
        /** @type {__VLS_StyleScopedClasses['th']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        for (const [p] of __VLS_vFor((__VLS_ctx.dashboard.recent))) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        if (!!(!__VLS_ctx.token))
                            throw 0;
                        if (!(__VLS_ctx.page === 'dashboard'))
                            throw 0;
                        return (__VLS_ctx.openProject(p));
                        // @ts-ignore
                        [dashboard, openProject,];
                    } },
                key: (p.id),
                ...{ class: "tr" },
            });
            /** @type {__VLS_StyleScopedClasses['tr']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
            (p.system_name);
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            (p.code);
            (p.org_name);
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({
                ...{ class: "status-pill" },
                ...{ class: (p.status) },
            });
            /** @type {__VLS_StyleScopedClasses['status-pill']} */ ;
            (__VLS_ctx.statusMap[p.status]);
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "progress" },
            });
            /** @type {__VLS_StyleScopedClasses['progress']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({
                ...{ style: ({ width: p.progress + '%' }) },
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            (p.progress);
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            (p.owner_name || '未分配');
            // @ts-ignore
            [statusMap,];
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.aside, __VLS_intrinsics.aside)({
            ...{ class: "panel focus-panel" },
        });
        /** @type {__VLS_StyleScopedClasses['panel']} */ ;
        /** @type {__VLS_StyleScopedClasses['focus-panel']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "panel-head" },
        });
        /** @type {__VLS_StyleScopedClasses['panel-head']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "stage-bars" },
        });
        /** @type {__VLS_StyleScopedClasses['stage-bars']} */ ;
        for (const [stage, i] of __VLS_vFor((__VLS_ctx.stageMeta))) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                key: (stage.key),
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            (stage.short);
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({
                ...{ style: ({ width: Math.min(100, ((__VLS_ctx.dashboard.stages.find((s) => s.current_stage === i + 1)?.count || 0) / Math.max(1, __VLS_ctx.dashboard.summary.total)) * 100) + '%' }) },
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
            (__VLS_ctx.dashboard.stages.find((s) => s.current_stage === i + 1)?.count || 0);
            // @ts-ignore
            [dashboard, dashboard, dashboard, stageMeta,];
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "risk-callout" },
        });
        /** @type {__VLS_StyleScopedClasses['risk-callout']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    }
    else if (__VLS_ctx.page === 'projects') {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "content list-page" },
        });
        /** @type {__VLS_StyleScopedClasses['content']} */ ;
        /** @type {__VLS_StyleScopedClasses['list-page']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "page-title" },
        });
        /** @type {__VLS_StyleScopedClasses['page-title']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.h1, __VLS_intrinsics.h1)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (__VLS_ctx.openAddProjectModal) },
            ...{ class: "primary" },
        });
        /** @type {__VLS_StyleScopedClasses['primary']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "panel filter-panel" },
        });
        /** @type {__VLS_StyleScopedClasses['panel']} */ ;
        /** @type {__VLS_StyleScopedClasses['filter-panel']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "search" },
        });
        /** @type {__VLS_StyleScopedClasses['search']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
            ...{ onKeyup: (__VLS_ctx.loadProjects) },
            placeholder: "搜索项目编号、报告编号、系统或单位",
        });
        (__VLS_ctx.filters.search);
        __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
            ...{ onChange: (__VLS_ctx.loadProjects) },
            value: (__VLS_ctx.filters.year),
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
            value: "",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
            ...{ onChange: (__VLS_ctx.loadProjects) },
            value: (__VLS_ctx.filters.level),
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
            value: "",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
            value: "2",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
            value: "3",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
            value: "4",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
            ...{ onChange: (__VLS_ctx.loadProjects) },
            value: (__VLS_ctx.filters.status),
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
            value: "",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
            value: "draft",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
            value: "in_progress",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
            value: "reviewing",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
            value: "completed",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (__VLS_ctx.loadProjects) },
            ...{ class: "secondary" },
        });
        /** @type {__VLS_StyleScopedClasses['secondary']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "panel data-table project-table" },
        });
        /** @type {__VLS_StyleScopedClasses['panel']} */ ;
        /** @type {__VLS_StyleScopedClasses['data-table']} */ ;
        /** @type {__VLS_StyleScopedClasses['project-table']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "table-head" },
        });
        /** @type {__VLS_StyleScopedClasses['table-head']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        for (const [p] of __VLS_vFor((__VLS_ctx.visibleProjects))) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                key: (p.id),
                ...{ class: "table-row project-row" },
            });
            /** @type {__VLS_StyleScopedClasses['table-row']} */ ;
            /** @type {__VLS_StyleScopedClasses['project-row']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
            (p.system_name);
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            (p.code);
            if (p.report_code) {
                (p.report_code);
            }
            __VLS_asFunctionalElement1(__VLS_intrinsics.br)({});
            (p.org_name);
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
            (p.assessment_year);
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
            (p.system_level);
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({
                ...{ class: "status-pill" },
                ...{ class: (p.status) },
            });
            /** @type {__VLS_StyleScopedClasses['status-pill']} */ ;
            (__VLS_ctx.statusMap[p.status]);
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            (__VLS_ctx.stageMeta[p.current_stage - 1]?.short);
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
            (p.system_score ?? '—');
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "progress" },
            });
            /** @type {__VLS_StyleScopedClasses['progress']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({
                ...{ style: ({ width: p.progress + '%' }) },
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            (p.progress);
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: "project-actions" },
            });
            /** @type {__VLS_StyleScopedClasses['project-actions']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        if (!!(!__VLS_ctx.token))
                            throw 0;
                        if (!!(__VLS_ctx.page === 'dashboard'))
                            throw 0;
                        if (!(__VLS_ctx.page === 'projects'))
                            throw 0;
                        return (__VLS_ctx.openProject(p));
                        // @ts-ignore
                        [page, openAddProjectModal, openProject, statusMap, stageMeta, loadProjects, loadProjects, loadProjects, loadProjects, loadProjects, filters, filters, filters, filters, visibleProjects,];
                    } },
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
                ...{ onClick: (...[$event]) => {
                        if (!!(!__VLS_ctx.token))
                            throw 0;
                        if (!!(__VLS_ctx.page === 'dashboard'))
                            throw 0;
                        if (!(__VLS_ctx.page === 'projects'))
                            throw 0;
                        return (__VLS_ctx.importTargetProject = p);
                        // @ts-ignore
                        [importTargetProject,];
                    } },
                ...{ class: "project-action-label" },
                for: "project-word-import",
            });
            /** @type {__VLS_StyleScopedClasses['project-action-label']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        if (!!(!__VLS_ctx.token))
                            throw 0;
                        if (!!(__VLS_ctx.page === 'dashboard'))
                            throw 0;
                        if (!(__VLS_ctx.page === 'projects'))
                            throw 0;
                        return (__VLS_ctx.openCopyProjectModal(p));
                        // @ts-ignore
                        [openCopyProjectModal,];
                    } },
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        if (!!(!__VLS_ctx.token))
                            throw 0;
                        if (!!(__VLS_ctx.page === 'dashboard'))
                            throw 0;
                        if (!(__VLS_ctx.page === 'projects'))
                            throw 0;
                        return (__VLS_ctx.openEditProjectModal(p));
                        // @ts-ignore
                        [openEditProjectModal,];
                    } },
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        if (!!(!__VLS_ctx.token))
                            throw 0;
                        if (!!(__VLS_ctx.page === 'dashboard'))
                            throw 0;
                        if (!(__VLS_ctx.page === 'projects'))
                            throw 0;
                        return (__VLS_ctx.projectToDelete = p);
                        // @ts-ignore
                        [projectToDelete,];
                    } },
                ...{ class: "danger" },
            });
            /** @type {__VLS_StyleScopedClasses['danger']} */ ;
            // @ts-ignore
            [];
        }
    }
    else if (__VLS_ctx.page === 'workspace' && __VLS_ctx.selectedProject) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workspace" },
        });
        /** @type {__VLS_StyleScopedClasses['workspace']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "project-strip" },
        });
        /** @type {__VLS_StyleScopedClasses['project-strip']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    if (!!(!__VLS_ctx.token))
                        throw 0;
                    if (!!(__VLS_ctx.page === 'dashboard'))
                        throw 0;
                    if (!!(__VLS_ctx.page === 'projects'))
                        throw 0;
                    if (!(__VLS_ctx.page === 'workspace' && __VLS_ctx.selectedProject))
                        throw 0;
                    return (__VLS_ctx.openPage('projects'));
                    // @ts-ignore
                    [openPage, page, selectedProject,];
                } },
            ...{ class: "back-btn" },
        });
        /** @type {__VLS_StyleScopedClasses['back-btn']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "project-identity" },
        });
        /** @type {__VLS_StyleScopedClasses['project-identity']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        (__VLS_ctx.selectedProject.code);
        (__VLS_ctx.selectedProject.system_level);
        __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
        (__VLS_ctx.selectedProject.system_name);
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (__VLS_ctx.selectedProject.org_name);
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "project-kpis" },
        });
        /** @type {__VLS_StyleScopedClasses['project-kpis']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
        (__VLS_ctx.selectedProject.progress);
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({
            ...{ class: "danger-text" },
        });
        /** @type {__VLS_StyleScopedClasses['danger-text']} */ ;
        (__VLS_ctx.selectedProject.risks?.filter(r => r.risk_level === 'high').length || 0);
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
        (__VLS_ctx.fmtDate(__VLS_ctx.selectedProject.end_date));
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ class: "secondary" },
        });
        /** @type {__VLS_StyleScopedClasses['secondary']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "stage-nav" },
        });
        /** @type {__VLS_StyleScopedClasses['stage-nav']} */ ;
        for (const [stage, i] of __VLS_vFor((__VLS_ctx.stageMeta))) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        if (!!(!__VLS_ctx.token))
                            throw 0;
                        if (!!(__VLS_ctx.page === 'dashboard'))
                            throw 0;
                        if (!!(__VLS_ctx.page === 'projects'))
                            throw 0;
                        if (!(__VLS_ctx.page === 'workspace' && __VLS_ctx.selectedProject))
                            throw 0;
                        return (__VLS_ctx.activeStage = i);
                        // @ts-ignore
                        [selectedProject, selectedProject, selectedProject, selectedProject, selectedProject, selectedProject, selectedProject, stageMeta, fmtDate, activeStage,];
                    } },
                key: (stage.key),
                ...{ class: ({ active: __VLS_ctx.activeStage === i, done: (__VLS_ctx.selectedProject.stages?.find(s => s.stage_key === stage.key)?.completion || 0) >= 100 }) },
            });
            /** @type {__VLS_StyleScopedClasses['active']} */ ;
            /** @type {__VLS_StyleScopedClasses['done']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({});
            ((__VLS_ctx.selectedProject.stages?.find(s => s.stage_key === stage.key)?.completion || 0) >= 100 ? '✓' : stage.icon);
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
            (stage.short);
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            (stage.hint);
            __VLS_asFunctionalElement1(__VLS_intrinsics.em, __VLS_intrinsics.em)({});
            (__VLS_ctx.selectedProject.stages?.find(s => s.stage_key === stage.key)?.completion || 0);
            // @ts-ignore
            [selectedProject, selectedProject, selectedProject, activeStage,];
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workspace-grid" },
        });
        /** @type {__VLS_StyleScopedClasses['workspace-grid']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "work-main panel" },
        });
        /** @type {__VLS_StyleScopedClasses['work-main']} */ ;
        /** @type {__VLS_StyleScopedClasses['panel']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "work-head" },
        });
        /** @type {__VLS_StyleScopedClasses['work-head']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        (__VLS_ctx.activeStage + 1);
        __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
        (__VLS_ctx.stageMeta[__VLS_ctx.activeStage].short);
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (__VLS_ctx.stageMeta[__VLS_ctx.activeStage].hint);
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (__VLS_ctx.saveStage) },
            ...{ class: "primary" },
        });
        /** @type {__VLS_StyleScopedClasses['primary']} */ ;
        if (__VLS_ctx.activeStage === 0) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "section-title" },
            });
            /** @type {__VLS_StyleScopedClasses['section-title']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "form-grid" },
            });
            /** @type {__VLS_StyleScopedClasses['form-grid']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
                ...{ class: "span-2" },
            });
            /** @type {__VLS_StyleScopedClasses['span-2']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
                value: (__VLS_ctx.selectedProject.org_name),
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
                placeholder: "请输入 6 位邮编",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
                ...{ class: "span-2" },
            });
            /** @type {__VLS_StyleScopedClasses['span-2']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
                placeholder: "请输入详细通信地址",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
                placeholder: "如：省密码管理局",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
                placeholder: "姓名",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
                placeholder: "职务或职称",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
                placeholder: "11 位手机号码",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "section-title" },
            });
            /** @type {__VLS_StyleScopedClasses['section-title']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "info-grid" },
            });
            /** @type {__VLS_StyleScopedClasses['info-grid']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
            (__VLS_ctx.selectedProject.system_name);
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
            (__VLS_ctx.selectedProject.system_level);
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
            (__VLS_ctx.fmtDate(__VLS_ctx.selectedProject.start_date));
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
            (__VLS_ctx.fmtDate(__VLS_ctx.selectedProject.end_date));
        }
        else if (__VLS_ctx.activeStage === 1) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "section-title" },
            });
            /** @type {__VLS_StyleScopedClasses['section-title']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "module-grid" },
            });
            /** @type {__VLS_StyleScopedClasses['module-grid']} */ ;
            for (const [module] of __VLS_vFor((__VLS_ctx.planningModules))) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
                    key: (module.key),
                    ...{ class: ({ complete: __VLS_ctx.isPlanningModuleComplete(module.key) }) },
                });
                /** @type {__VLS_StyleScopedClasses['complete']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({});
                (__VLS_ctx.isPlanningModuleComplete(module.key) ? '✓' : '·');
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
                __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
                (module.title);
                __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
                (__VLS_ctx.isPlanningModuleComplete(module.key) ? '已填写，可继续修改' : module.note);
                __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                    ...{ onClick: (...[$event]) => {
                            if (!!(!__VLS_ctx.token))
                                throw 0;
                            if (!!(__VLS_ctx.page === 'dashboard'))
                                throw 0;
                            if (!!(__VLS_ctx.page === 'projects'))
                                throw 0;
                            if (!(__VLS_ctx.page === 'workspace' && __VLS_ctx.selectedProject))
                                throw 0;
                            if (!!(__VLS_ctx.activeStage === 0))
                                throw 0;
                            if (!(__VLS_ctx.activeStage === 1))
                                throw 0;
                            return (__VLS_ctx.openPlanningEditor(module));
                            // @ts-ignore
                            [selectedProject, selectedProject, selectedProject, selectedProject, selectedProject, stageMeta, stageMeta, fmtDate, fmtDate, activeStage, activeStage, activeStage, activeStage, activeStage, saveStage, planningModules, isPlanningModuleComplete, isPlanningModuleComplete, isPlanningModuleComplete, openPlanningEditor,];
                        } },
                    type: "button",
                });
                (__VLS_ctx.isPlanningModuleComplete(module.key) ? '修改' : '编辑');
                // @ts-ignore
                [isPlanningModuleComplete,];
            }
        }
        else if (__VLS_ctx.activeStage === 2) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "section-title" },
            });
            /** @type {__VLS_StyleScopedClasses['section-title']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "domain-grid" },
            });
            /** @type {__VLS_StyleScopedClasses['domain-grid']} */ ;
            for (const [d, i] of __VLS_vFor((__VLS_ctx.domainCards))) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
                    key: (d[0]),
                });
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
                __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
                (String(i + 1).padStart(2, '0'));
                __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({
                    ...{ class: ({ 'warn': d[2] !== '完成' }) },
                });
                /** @type {__VLS_StyleScopedClasses['warn']} */ ;
                (d[2] === '完成' ? '✓' : '!');
                __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
                (d[0]);
                __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
                (d[1]);
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                    ...{ class: "mini-progress" },
                });
                /** @type {__VLS_StyleScopedClasses['mini-progress']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({
                    ...{ style: ({ width: d[2] === '完成' ? '100%' : d[2] === '进行中' ? '70%' : '35%' }) },
                });
                __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({});
                // @ts-ignore
                [activeStage, domainCards,];
            }
        }
        else if (__VLS_ctx.activeStage === 3) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "report-layout" },
            });
            /** @type {__VLS_StyleScopedClasses['report-layout']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "section-title" },
            });
            /** @type {__VLS_StyleScopedClasses['section-title']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "check-list" },
            });
            /** @type {__VLS_StyleScopedClasses['check-list']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({
                ...{ class: "danger-text" },
            });
            /** @type {__VLS_StyleScopedClasses['danger-text']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "score-card" },
            });
            /** @type {__VLS_StyleScopedClasses['score-card']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ class: "primary wide" },
            });
            /** @type {__VLS_StyleScopedClasses['primary']} */ ;
            /** @type {__VLS_StyleScopedClasses['wide']} */ ;
        }
        else {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "section-title" },
            });
            /** @type {__VLS_StyleScopedClasses['section-title']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "review-flow" },
            });
            /** @type {__VLS_StyleScopedClasses['review-flow']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
                ...{ class: "done" },
            });
            /** @type {__VLS_StyleScopedClasses['done']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
                ...{ class: "active" },
            });
            /** @type {__VLS_StyleScopedClasses['active']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.aside, __VLS_intrinsics.aside)({
            ...{ class: "work-aside" },
        });
        /** @type {__VLS_StyleScopedClasses['work-aside']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "panel" },
        });
        /** @type {__VLS_StyleScopedClasses['panel']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "aside-head" },
        });
        /** @type {__VLS_StyleScopedClasses['aside-head']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
        (__VLS_ctx.selectedStage?.completion || 0);
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "ring" },
            ...{ style: ({ '--p': (__VLS_ctx.selectedStage?.completion || 0) * 3.6 + 'deg' }) },
        });
        /** @type {__VLS_StyleScopedClasses['ring']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        (__VLS_ctx.selectedStage?.completion || 0);
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.ul, __VLS_intrinsics.ul)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.li, __VLS_intrinsics.li)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({
            ...{ class: "ok" },
        });
        /** @type {__VLS_StyleScopedClasses['ok']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.li, __VLS_intrinsics.li)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({
            ...{ class: "ok" },
        });
        /** @type {__VLS_StyleScopedClasses['ok']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.li, __VLS_intrinsics.li)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "panel issue-panel" },
        });
        /** @type {__VLS_StyleScopedClasses['panel']} */ ;
        /** @type {__VLS_StyleScopedClasses['issue-panel']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "aside-head" },
        });
        /** @type {__VLS_StyleScopedClasses['aside-head']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({
            ...{ class: "high" },
        });
        /** @type {__VLS_StyleScopedClasses['high']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({
            ...{ class: "mid" },
        });
        /** @type {__VLS_StyleScopedClasses['mid']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    }
    else if (__VLS_ctx.page === 'users') {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "content list-page" },
        });
        /** @type {__VLS_StyleScopedClasses['content']} */ ;
        /** @type {__VLS_StyleScopedClasses['list-page']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "page-title" },
        });
        /** @type {__VLS_StyleScopedClasses['page-title']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.h1, __VLS_intrinsics.h1)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        if (__VLS_ctx.currentUser?.role === 'admin') {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "user-page-actions" },
            });
            /** @type {__VLS_StyleScopedClasses['user-page-actions']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (__VLS_ctx.downloadUserImportTemplate) },
                ...{ class: "secondary" },
            });
            /** @type {__VLS_StyleScopedClasses['secondary']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
                ...{ class: "primary upload-button" },
                ...{ class: ({ disabled: __VLS_ctx.userImporting }) },
            });
            /** @type {__VLS_StyleScopedClasses['primary']} */ ;
            /** @type {__VLS_StyleScopedClasses['upload-button']} */ ;
            /** @type {__VLS_StyleScopedClasses['disabled']} */ ;
            (__VLS_ctx.userImporting ? '正在导入…' : '批量导入用户');
            __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
                ...{ onChange: (__VLS_ctx.importUsers) },
                type: "file",
                accept: ".xlsx",
                disabled: (__VLS_ctx.userImporting),
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (__VLS_ctx.openAddUser) },
                ...{ class: "primary" },
            });
            /** @type {__VLS_StyleScopedClasses['primary']} */ ;
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "metric-grid user-metrics" },
        });
        /** @type {__VLS_StyleScopedClasses['metric-grid']} */ ;
        /** @type {__VLS_StyleScopedClasses['user-metrics']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "metric-icon blue" },
        });
        /** @type {__VLS_StyleScopedClasses['metric-icon']} */ ;
        /** @type {__VLS_StyleScopedClasses['blue']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        (__VLS_ctx.users.length);
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "metric-icon green" },
        });
        /** @type {__VLS_StyleScopedClasses['metric-icon']} */ ;
        /** @type {__VLS_StyleScopedClasses['green']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        (__VLS_ctx.users.filter(u => u.status === 'active').length);
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "metric-icon amber" },
        });
        /** @type {__VLS_StyleScopedClasses['metric-icon']} */ ;
        /** @type {__VLS_StyleScopedClasses['amber']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        (__VLS_ctx.users.filter(u => u.status === 'pending').length);
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "metric-icon amber" },
        });
        /** @type {__VLS_StyleScopedClasses['metric-icon']} */ ;
        /** @type {__VLS_StyleScopedClasses['amber']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        (__VLS_ctx.users.filter(u => u.status === 'disabled').length);
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "panel filter-panel" },
        });
        /** @type {__VLS_StyleScopedClasses['panel']} */ ;
        /** @type {__VLS_StyleScopedClasses['filter-panel']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "search" },
        });
        /** @type {__VLS_StyleScopedClasses['search']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
            placeholder: "搜索用户名或姓名",
        });
        (__VLS_ctx.userFilters.search);
        __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
            value: (__VLS_ctx.userFilters.status),
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
            value: "",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
            value: "active",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
            value: "pending",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
            value: "disabled",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "panel data-table user-table detailed" },
        });
        /** @type {__VLS_StyleScopedClasses['panel']} */ ;
        /** @type {__VLS_StyleScopedClasses['data-table']} */ ;
        /** @type {__VLS_StyleScopedClasses['user-table']} */ ;
        /** @type {__VLS_StyleScopedClasses['detailed']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "table-head" },
        });
        /** @type {__VLS_StyleScopedClasses['table-head']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        for (const [u, index] of __VLS_vFor((__VLS_ctx.visibleUsers))) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                key: (u.id),
                ...{ class: "table-row" },
            });
            /** @type {__VLS_StyleScopedClasses['table-row']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            (index + 1);
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: "user-cell" },
            });
            /** @type {__VLS_StyleScopedClasses['user-cell']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({});
            (u.display_name.slice(0, 1));
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
            (u.username);
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            (u.display_name);
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            (__VLS_ctx.fmtDate(u.certificate_date));
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            if (u.certificate_file_path) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.a, __VLS_intrinsics.a)({
                    href: (u.certificate_file_path),
                    target: "_blank",
                });
                (u.certificate_file_name || '查看证书');
            }
            else {
                __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            }
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({
                ...{ class: "status-pill" },
                ...{ class: (u.status) },
            });
            /** @type {__VLS_StyleScopedClasses['status-pill']} */ ;
            (__VLS_ctx.statusMap[u.status]);
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            (__VLS_ctx.fmtDate(u.created_at));
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: "user-actions" },
            });
            /** @type {__VLS_StyleScopedClasses['user-actions']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        if (!!(!__VLS_ctx.token))
                            throw 0;
                        if (!!(__VLS_ctx.page === 'dashboard'))
                            throw 0;
                        if (!!(__VLS_ctx.page === 'projects'))
                            throw 0;
                        if (!!(__VLS_ctx.page === 'workspace' && __VLS_ctx.selectedProject))
                            throw 0;
                        if (!(__VLS_ctx.page === 'users'))
                            throw 0;
                        return (__VLS_ctx.editUser(u));
                        // @ts-ignore
                        [page, currentUser, statusMap, fmtDate, fmtDate, activeStage, selectedStage, selectedStage, selectedStage, downloadUserImportTemplate, userImporting, userImporting, userImporting, importUsers, openAddUser, users, users, users, users, userFilters, userFilters, visibleUsers, editUser,];
                    } },
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        if (!!(!__VLS_ctx.token))
                            throw 0;
                        if (!!(__VLS_ctx.page === 'dashboard'))
                            throw 0;
                        if (!!(__VLS_ctx.page === 'projects'))
                            throw 0;
                        if (!!(__VLS_ctx.page === 'workspace' && __VLS_ctx.selectedProject))
                            throw 0;
                        if (!(__VLS_ctx.page === 'users'))
                            throw 0;
                        return (__VLS_ctx.resetPassword(u));
                        // @ts-ignore
                        [resetPassword,];
                    } },
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        if (!!(!__VLS_ctx.token))
                            throw 0;
                        if (!!(__VLS_ctx.page === 'dashboard'))
                            throw 0;
                        if (!!(__VLS_ctx.page === 'projects'))
                            throw 0;
                        if (!!(__VLS_ctx.page === 'workspace' && __VLS_ctx.selectedProject))
                            throw 0;
                        if (!(__VLS_ctx.page === 'users'))
                            throw 0;
                        return (__VLS_ctx.toggleUser(u));
                        // @ts-ignore
                        [toggleUser,];
                    } },
            });
            (u.status === 'disabled' ? '启用' : '禁用');
            // @ts-ignore
            [];
        }
    }
    else if (__VLS_ctx.page === 'institution') {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "content settings-page" },
        });
        /** @type {__VLS_StyleScopedClasses['content']} */ ;
        /** @type {__VLS_StyleScopedClasses['settings-page']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "page-title" },
        });
        /** @type {__VLS_StyleScopedClasses['page-title']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.h1, __VLS_intrinsics.h1)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (__VLS_ctx.saveInstitution) },
            ...{ class: "primary" },
        });
        /** @type {__VLS_StyleScopedClasses['primary']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "panel settings-card" },
        });
        /** @type {__VLS_StyleScopedClasses['panel']} */ ;
        /** @type {__VLS_StyleScopedClasses['settings-card']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "section-title" },
        });
        /** @type {__VLS_StyleScopedClasses['section-title']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "form-grid institution-grid" },
        });
        /** @type {__VLS_StyleScopedClasses['form-grid']} */ ;
        /** @type {__VLS_StyleScopedClasses['institution-grid']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
            ...{ class: "span-2" },
        });
        /** @type {__VLS_StyleScopedClasses['span-2']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.input)({});
        (__VLS_ctx.institutionForm.name);
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.input)({});
        (__VLS_ctx.institutionForm.postalCode);
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
            ...{ class: "span-2" },
        });
        /** @type {__VLS_StyleScopedClasses['span-2']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.input)({});
        (__VLS_ctx.institutionForm.address);
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.input)({});
        (__VLS_ctx.institutionForm.department);
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.input)({});
        (__VLS_ctx.institutionForm.contact);
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.input)({});
        (__VLS_ctx.institutionForm.title);
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.input)({});
        (__VLS_ctx.institutionForm.telephone);
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.input)({});
        (__VLS_ctx.institutionForm.mobile);
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.input)({});
        (__VLS_ctx.institutionForm.email);
    }
    else if (__VLS_ctx.page === 'templates') {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "content settings-page" },
        });
        /** @type {__VLS_StyleScopedClasses['content']} */ ;
        /** @type {__VLS_StyleScopedClasses['settings-page']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "page-title" },
        });
        /** @type {__VLS_StyleScopedClasses['page-title']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.h1, __VLS_intrinsics.h1)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "template-grid" },
        });
        /** @type {__VLS_StyleScopedClasses['template-grid']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
            ...{ class: "panel template-card" },
        });
        /** @type {__VLS_StyleScopedClasses['panel']} */ ;
        /** @type {__VLS_StyleScopedClasses['template-card']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "template-icon" },
        });
        /** @type {__VLS_StyleScopedClasses['template-icon']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "template-meta" },
        });
        /** @type {__VLS_StyleScopedClasses['template-meta']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
        (__VLS_ctx.templateInfo.report?.name || '尚未配置');
        if (__VLS_ctx.templateInfo.report) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            (Math.round(__VLS_ctx.templateInfo.report.size / 1024 / 1024 * 10) / 10);
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "template-actions" },
        });
        /** @type {__VLS_StyleScopedClasses['template-actions']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
            ...{ class: "primary upload-button" },
        });
        /** @type {__VLS_StyleScopedClasses['primary']} */ ;
        /** @type {__VLS_StyleScopedClasses['upload-button']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
            ...{ onChange: (...[$event]) => {
                    if (!!(!__VLS_ctx.token))
                        throw 0;
                    if (!!(__VLS_ctx.page === 'dashboard'))
                        throw 0;
                    if (!!(__VLS_ctx.page === 'projects'))
                        throw 0;
                    if (!!(__VLS_ctx.page === 'workspace' && __VLS_ctx.selectedProject))
                        throw 0;
                    if (!!(__VLS_ctx.page === 'users'))
                        throw 0;
                    if (!!(__VLS_ctx.page === 'institution'))
                        throw 0;
                    if (!(__VLS_ctx.page === 'templates'))
                        throw 0;
                    return (__VLS_ctx.uploadReportTemplate($event, 3));
                    // @ts-ignore
                    [page, page, saveInstitution, institutionForm, institutionForm, institutionForm, institutionForm, institutionForm, institutionForm, institutionForm, institutionForm, institutionForm, templateInfo, templateInfo, templateInfo, uploadReportTemplate,];
                } },
            type: "file",
            accept: ".docx",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    if (!!(!__VLS_ctx.token))
                        throw 0;
                    if (!!(__VLS_ctx.page === 'dashboard'))
                        throw 0;
                    if (!!(__VLS_ctx.page === 'projects'))
                        throw 0;
                    if (!!(__VLS_ctx.page === 'workspace' && __VLS_ctx.selectedProject))
                        throw 0;
                    if (!!(__VLS_ctx.page === 'users'))
                        throw 0;
                    if (!!(__VLS_ctx.page === 'institution'))
                        throw 0;
                    if (!(__VLS_ctx.page === 'templates'))
                        throw 0;
                    return (__VLS_ctx.downloadReportTemplate(3));
                    // @ts-ignore
                    [downloadReportTemplate,];
                } },
            ...{ class: "secondary" },
            disabled: (!__VLS_ctx.templateInfo.report),
        });
        /** @type {__VLS_StyleScopedClasses['secondary']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
            ...{ class: "panel template-card" },
        });
        /** @type {__VLS_StyleScopedClasses['panel']} */ ;
        /** @type {__VLS_StyleScopedClasses['template-card']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "template-icon" },
        });
        /** @type {__VLS_StyleScopedClasses['template-icon']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "template-meta" },
        });
        /** @type {__VLS_StyleScopedClasses['template-meta']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
        (__VLS_ctx.templateInfo.report2?.name || '尚未配置');
        if (__VLS_ctx.templateInfo.report2) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            (Math.round(__VLS_ctx.templateInfo.report2.size / 1024 / 1024 * 10) / 10);
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "template-actions" },
        });
        /** @type {__VLS_StyleScopedClasses['template-actions']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
            ...{ class: "primary upload-button" },
        });
        /** @type {__VLS_StyleScopedClasses['primary']} */ ;
        /** @type {__VLS_StyleScopedClasses['upload-button']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
            ...{ onChange: (...[$event]) => {
                    if (!!(!__VLS_ctx.token))
                        throw 0;
                    if (!!(__VLS_ctx.page === 'dashboard'))
                        throw 0;
                    if (!!(__VLS_ctx.page === 'projects'))
                        throw 0;
                    if (!!(__VLS_ctx.page === 'workspace' && __VLS_ctx.selectedProject))
                        throw 0;
                    if (!!(__VLS_ctx.page === 'users'))
                        throw 0;
                    if (!!(__VLS_ctx.page === 'institution'))
                        throw 0;
                    if (!(__VLS_ctx.page === 'templates'))
                        throw 0;
                    return (__VLS_ctx.uploadReportTemplate($event, 2));
                    // @ts-ignore
                    [templateInfo, templateInfo, templateInfo, templateInfo, uploadReportTemplate,];
                } },
            type: "file",
            accept: ".docx",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    if (!!(!__VLS_ctx.token))
                        throw 0;
                    if (!!(__VLS_ctx.page === 'dashboard'))
                        throw 0;
                    if (!!(__VLS_ctx.page === 'projects'))
                        throw 0;
                    if (!!(__VLS_ctx.page === 'workspace' && __VLS_ctx.selectedProject))
                        throw 0;
                    if (!!(__VLS_ctx.page === 'users'))
                        throw 0;
                    if (!!(__VLS_ctx.page === 'institution'))
                        throw 0;
                    if (!(__VLS_ctx.page === 'templates'))
                        throw 0;
                    return (__VLS_ctx.downloadReportTemplate(2));
                    // @ts-ignore
                    [downloadReportTemplate,];
                } },
            ...{ class: "secondary" },
            disabled: (!__VLS_ctx.templateInfo.report2),
        });
        /** @type {__VLS_StyleScopedClasses['secondary']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
            ...{ class: "panel template-card" },
        });
        /** @type {__VLS_StyleScopedClasses['panel']} */ ;
        /** @type {__VLS_StyleScopedClasses['template-card']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "template-icon folder" },
        });
        /** @type {__VLS_StyleScopedClasses['template-icon']} */ ;
        /** @type {__VLS_StyleScopedClasses['folder']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "template-meta" },
        });
        /** @type {__VLS_StyleScopedClasses['template-meta']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
        (__VLS_ctx.templateInfo.rawRecords?.length || 0);
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        (__VLS_ctx.templateInfo.rawRecords?.slice(0, 3).map((f) => f.path).join('、') || '尚未导入文件夹');
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "template-actions" },
        });
        /** @type {__VLS_StyleScopedClasses['template-actions']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
            ...{ class: "primary upload-button" },
        });
        /** @type {__VLS_StyleScopedClasses['primary']} */ ;
        /** @type {__VLS_StyleScopedClasses['upload-button']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
            ...{ onChange: (__VLS_ctx.uploadRawFolder) },
            type: "file",
            webkitdirectory: true,
            multiple: true,
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (__VLS_ctx.downloadRawTemplate) },
            ...{ class: "secondary" },
            disabled: (!__VLS_ctx.templateInfo.rawRecords?.length),
        });
        /** @type {__VLS_StyleScopedClasses['secondary']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "template-tip" },
        });
        /** @type {__VLS_StyleScopedClasses['template-tip']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    }
    else if (__VLS_ctx.page === 'risk-analysis') {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "content settings-page risk-analysis-page" },
        });
        /** @type {__VLS_StyleScopedClasses['content']} */ ;
        /** @type {__VLS_StyleScopedClasses['settings-page']} */ ;
        /** @type {__VLS_StyleScopedClasses['risk-analysis-page']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "page-title" },
        });
        /** @type {__VLS_StyleScopedClasses['page-title']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.h1, __VLS_intrinsics.h1)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "panel risk-template-panel" },
        });
        /** @type {__VLS_StyleScopedClasses['panel']} */ ;
        /** @type {__VLS_StyleScopedClasses['risk-template-panel']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "risk-template-head" },
        });
        /** @type {__VLS_StyleScopedClasses['risk-template-head']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "risk-template-actions" },
        });
        /** @type {__VLS_StyleScopedClasses['risk-template-actions']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
            ...{ class: "primary upload-button" },
        });
        /** @type {__VLS_StyleScopedClasses['primary']} */ ;
        /** @type {__VLS_StyleScopedClasses['upload-button']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
            ...{ onChange: (__VLS_ctx.importRiskTemplates) },
            type: "file",
            accept: ".xlsx",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (__VLS_ctx.exportRiskTemplates) },
            ...{ class: "secondary" },
        });
        /** @type {__VLS_StyleScopedClasses['secondary']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (__VLS_ctx.openAddRiskTemplate) },
            ...{ class: "secondary" },
        });
        /** @type {__VLS_StyleScopedClasses['secondary']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (__VLS_ctx.saveRiskTemplates) },
            ...{ class: "secondary" },
        });
        /** @type {__VLS_StyleScopedClasses['secondary']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "risk-template-summary" },
        });
        /** @type {__VLS_StyleScopedClasses['risk-template-summary']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        (__VLS_ctx.riskTemplateTotal);
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        (__VLS_ctx.riskTemplateCompleteCount);
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        (__VLS_ctx.riskTemplateTotal - __VLS_ctx.riskTemplateCompleteCount);
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "risk-layer-tabs" },
        });
        /** @type {__VLS_StyleScopedClasses['risk-layer-tabs']} */ ;
        for (const [layer] of __VLS_vFor((__VLS_ctx.riskLayers))) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        if (!!(!__VLS_ctx.token))
                            throw 0;
                        if (!!(__VLS_ctx.page === 'dashboard'))
                            throw 0;
                        if (!!(__VLS_ctx.page === 'projects'))
                            throw 0;
                        if (!!(__VLS_ctx.page === 'workspace' && __VLS_ctx.selectedProject))
                            throw 0;
                        if (!!(__VLS_ctx.page === 'users'))
                            throw 0;
                        if (!!(__VLS_ctx.page === 'institution'))
                            throw 0;
                        if (!!(__VLS_ctx.page === 'templates'))
                            throw 0;
                        if (!(__VLS_ctx.page === 'risk-analysis'))
                            throw 0;
                        return (__VLS_ctx.activeRiskLayer = layer);
                        // @ts-ignore
                        [page, templateInfo, templateInfo, templateInfo, templateInfo, uploadRawFolder, downloadRawTemplate, importRiskTemplates, exportRiskTemplates, openAddRiskTemplate, saveRiskTemplates, riskTemplateTotal, riskTemplateTotal, riskTemplateCompleteCount, riskTemplateCompleteCount, riskLayers, activeRiskLayer,];
                    } },
                key: (layer),
                ...{ class: ({ active: __VLS_ctx.activeRiskLayer === layer }) },
            });
            /** @type {__VLS_StyleScopedClasses['active']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            (layer);
            __VLS_asFunctionalElement1(__VLS_intrinsics.em, __VLS_intrinsics.em)({});
            (__VLS_ctx.riskTemplates.filter(item => item.layer === layer).length);
            (__VLS_ctx.riskUnits(layer).length);
            // @ts-ignore
            [activeRiskLayer, riskTemplates, riskUnits,];
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "risk-template-table" },
        });
        /** @type {__VLS_StyleScopedClasses['risk-template-table']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "risk-template-list-head" },
        });
        /** @type {__VLS_StyleScopedClasses['risk-template-list-head']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        for (const [item] of __VLS_vFor((__VLS_ctx.visibleRiskTemplates))) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
                key: (item.id),
                ...{ class: "risk-template-list-row" },
            });
            /** @type {__VLS_StyleScopedClasses['risk-template-list-row']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            (item.unit);
            __VLS_asFunctionalElement1(__VLS_intrinsics.code, __VLS_intrinsics.code)({});
            (item.threat || '未填写');
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: (['risk-level-badge', `level-${item.defaultLevel}`]) },
            });
            /** @type {__VLS_StyleScopedClasses['risk-level-badge']} */ ;
            (item.defaultLevel);
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
            (item.analysis || '未填写风险分析');
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
            (item.advice || '未填写整改建议');
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: (['risk-status', item.analysis && item.advice ? 'complete' : 'pending']) },
            });
            /** @type {__VLS_StyleScopedClasses['risk-status']} */ ;
            (item.analysis && item.advice ? '完整' : '待完善');
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: "risk-row-actions" },
            });
            /** @type {__VLS_StyleScopedClasses['risk-row-actions']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        if (!!(!__VLS_ctx.token))
                            throw 0;
                        if (!!(__VLS_ctx.page === 'dashboard'))
                            throw 0;
                        if (!!(__VLS_ctx.page === 'projects'))
                            throw 0;
                        if (!!(__VLS_ctx.page === 'workspace' && __VLS_ctx.selectedProject))
                            throw 0;
                        if (!!(__VLS_ctx.page === 'users'))
                            throw 0;
                        if (!!(__VLS_ctx.page === 'institution'))
                            throw 0;
                        if (!!(__VLS_ctx.page === 'templates'))
                            throw 0;
                        if (!(__VLS_ctx.page === 'risk-analysis'))
                            throw 0;
                        return (__VLS_ctx.editRiskTemplate(item));
                        // @ts-ignore
                        [visibleRiskTemplates, editRiskTemplate,];
                    } },
                ...{ class: "secondary" },
            });
            /** @type {__VLS_StyleScopedClasses['secondary']} */ ;
            // @ts-ignore
            [];
        }
    }
}
if (__VLS_ctx.showRiskTemplateModal) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.showRiskTemplateModal))
                    throw 0;
                return (__VLS_ctx.showRiskTemplateModal = false);
                // @ts-ignore
                [showRiskTemplateModal, showRiskTemplateModal,];
            } },
        ...{ class: "modal-mask" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-mask']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.form, __VLS_intrinsics.form)({
        ...{ onSubmit: (__VLS_ctx.saveRiskTemplateForm) },
        ...{ class: "modal risk-template-modal" },
    });
    /** @type {__VLS_StyleScopedClasses['modal']} */ ;
    /** @type {__VLS_StyleScopedClasses['risk-template-modal']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "modal-head" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-head']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
    (__VLS_ctx.editingRiskTemplateId ? '编辑风险模板' : '新增风险模板');
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.showRiskTemplateModal))
                    throw 0;
                return (__VLS_ctx.showRiskTemplateModal = false);
                // @ts-ignore
                [showRiskTemplateModal, saveRiskTemplateForm, editingRiskTemplateId,];
            } },
        type: "button",
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "risk-template-modal-grid" },
    });
    /** @type {__VLS_StyleScopedClasses['risk-template-modal-grid']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
        ...{ onChange: (__VLS_ctx.changeRiskTemplateLayer) },
        value: (__VLS_ctx.riskTemplateForm.layer),
        disabled: (!!__VLS_ctx.editingRiskTemplateId),
    });
    for (const [layer] of __VLS_vFor((__VLS_ctx.riskLayers))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
            key: (layer),
            value: (layer),
        });
        (layer);
        // @ts-ignore
        [riskLayers, editingRiskTemplateId, changeRiskTemplateLayer, riskTemplateForm,];
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
        ...{ onChange: (__VLS_ctx.changeRiskTemplateLayer) },
        value: (__VLS_ctx.riskTemplateForm.unit),
        disabled: (!!__VLS_ctx.editingRiskTemplateId),
    });
    for (const [unit] of __VLS_vFor((__VLS_ctx.riskUnits(__VLS_ctx.riskTemplateForm.layer)))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
            key: (unit),
            value: (unit),
        });
        (unit);
        // @ts-ignore
        [riskUnits, editingRiskTemplateId, changeRiskTemplateLayer, riskTemplateForm, riskTemplateForm,];
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        placeholder: "如 TP1、TN2",
    });
    (__VLS_ctx.riskTemplateForm.threat);
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
        value: (__VLS_ctx.riskTemplateForm.defaultLevel),
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
        ...{ class: "span-2" },
    });
    /** @type {__VLS_StyleScopedClasses['span-2']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.textarea, __VLS_intrinsics.textarea)({
        value: (__VLS_ctx.riskTemplateForm.analysis),
        rows: "6",
        required: true,
        placeholder: "支持 {系统名称}、{安全层面}、{测评单元} 占位符",
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
        ...{ class: "span-2" },
    });
    /** @type {__VLS_StyleScopedClasses['span-2']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.textarea, __VLS_intrinsics.textarea)({
        value: (__VLS_ctx.riskTemplateForm.advice),
        rows: "6",
        required: true,
        placeholder: "请输入该测评单元对应的整改建议",
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
        ...{ class: "risk-enabled" },
    });
    /** @type {__VLS_StyleScopedClasses['risk-enabled']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        type: "checkbox",
    });
    (__VLS_ctx.riskTemplateForm.enabled);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "modal-foot" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-foot']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.showRiskTemplateModal))
                    throw 0;
                return (__VLS_ctx.showRiskTemplateModal = false);
                // @ts-ignore
                [showRiskTemplateModal, riskTemplateForm, riskTemplateForm, riskTemplateForm, riskTemplateForm, riskTemplateForm,];
            } },
        type: "button",
        ...{ class: "secondary" },
    });
    /** @type {__VLS_StyleScopedClasses['secondary']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ class: "primary" },
    });
    /** @type {__VLS_StyleScopedClasses['primary']} */ ;
}
if (__VLS_ctx.activePlanningModule) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.activePlanningModule))
                    throw 0;
                return (__VLS_ctx.activePlanningModule = null);
                // @ts-ignore
                [activePlanningModule, activePlanningModule,];
            } },
        ...{ class: "modal-mask" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-mask']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.form, __VLS_intrinsics.form)({
        ...{ onSubmit: (__VLS_ctx.savePlanningModule) },
        ...{ class: "modal planning-modal" },
    });
    /** @type {__VLS_StyleScopedClasses['modal']} */ ;
    /** @type {__VLS_StyleScopedClasses['planning-modal']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "modal-head" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-head']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
    (__VLS_ctx.activePlanningModule.title);
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    (__VLS_ctx.activePlanningModule.note);
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.activePlanningModule))
                    throw 0;
                return (__VLS_ctx.activePlanningModule = null);
                // @ts-ignore
                [activePlanningModule, activePlanningModule, activePlanningModule, savePlanningModule,];
            } },
        type: "button",
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "planning-form" },
    });
    /** @type {__VLS_StyleScopedClasses['planning-form']} */ ;
    for (const [field] of __VLS_vFor((__VLS_ctx.activePlanningModule.fields))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
            key: (field.key),
        });
        __VLS_asFunctionalDirective(__VLS_directives.vShow, {})(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.activePlanningModule.key !== 'previousAssessment' || field.key === 'assessmentCount' || field.key === 'assessmentContent' || Number(__VLS_ctx.planningForm.assessmentCount || 1) > 1), }, null, null);
        (field.label);
        if (field.multiline) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.textarea, __VLS_intrinsics.textarea)({
                ...{ onKeydown: (__VLS_ctx.handleParagraphEnter) },
                ...{ onBlur: (...[$event]) => {
                        if (!(__VLS_ctx.activePlanningModule))
                            throw 0;
                        if (!(field.multiline))
                            throw 0;
                        return (__VLS_ctx.normalizePlanningParagraph(field.key));
                        // @ts-ignore
                        [activePlanningModule, activePlanningModule, planningForm, handleParagraphEnter, normalizePlanningParagraph,];
                    } },
                value: (__VLS_ctx.planningForm[field.key]),
                placeholder: (field.placeholder),
                rows: "4",
            });
            __VLS_asFunctionalDirective(__VLS_directives.vAutoResize, {})(null, { ...__VLS_directiveBindingRestFields, }, null, null);
        }
        else {
            __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
                type: (field.key === 'assessmentCount' ? 'number' : 'text'),
                min: (field.key === 'assessmentCount' ? 1 : undefined),
                step: (field.key === 'assessmentCount' ? 1 : undefined),
                placeholder: (field.placeholder),
            });
            (__VLS_ctx.planningForm[field.key]);
        }
        // @ts-ignore
        [planningForm, planningForm, vAutoResize,];
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "modal-foot" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-foot']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.activePlanningModule))
                    throw 0;
                return (__VLS_ctx.activePlanningModule = null);
                // @ts-ignore
                [activePlanningModule,];
            } },
        type: "button",
        ...{ class: "secondary" },
    });
    /** @type {__VLS_StyleScopedClasses['secondary']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ class: "primary" },
    });
    /** @type {__VLS_StyleScopedClasses['primary']} */ ;
}
if (__VLS_ctx.showProjectModal) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "modal-mask" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-mask']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.form, __VLS_intrinsics.form)({
        ...{ onSubmit: (__VLS_ctx.createProject) },
        ...{ class: "modal" },
    });
    /** @type {__VLS_StyleScopedClasses['modal']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "modal-head" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-head']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
    (__VLS_ctx.editingProjectId ? '编辑密评项目' : '新建密评项目');
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.showProjectModal))
                    throw 0;
                return (__VLS_ctx.showProjectModal = false);
                // @ts-ignore
                [showProjectModal, showProjectModal, createProject, editingProjectId,];
            } },
        type: "button",
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "form-grid" },
    });
    /** @type {__VLS_StyleScopedClasses['form-grid']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        value: (__VLS_ctx.editingProjectId ? __VLS_ctx.projectForm.code : `MP-${__VLS_ctx.projectForm.assessmentYear}-自动编号`),
        readonly: true,
        ...{ class: "readonly-input" },
    });
    /** @type {__VLS_StyleScopedClasses['readonly-input']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        placeholder: "可稍后补充或从Word导入",
    });
    (__VLS_ctx.projectForm.reportCode);
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
        ...{ class: "span-2" },
    });
    /** @type {__VLS_StyleScopedClasses['span-2']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        required: true,
        placeholder: "请输入被测系统全称",
    });
    (__VLS_ctx.projectForm.systemName);
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
        ...{ class: "span-2" },
    });
    /** @type {__VLS_StyleScopedClasses['span-2']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        required: true,
        placeholder: "请输入责任单位全称",
    });
    (__VLS_ctx.projectForm.orgName);
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        type: "number",
    });
    (__VLS_ctx.projectForm.assessmentYear);
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
        value: (__VLS_ctx.projectForm.systemLevel),
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
        value: (2),
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
        value: (3),
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        type: "date",
    });
    (__VLS_ctx.projectForm.startDate);
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        type: "date",
    });
    (__VLS_ctx.projectForm.endDate);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "modal-foot" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-foot']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.showProjectModal))
                    throw 0;
                return (__VLS_ctx.showProjectModal = false);
                // @ts-ignore
                [showProjectModal, editingProjectId, projectForm, projectForm, projectForm, projectForm, projectForm, projectForm, projectForm, projectForm, projectForm,];
            } },
        type: "button",
        ...{ class: "secondary" },
    });
    /** @type {__VLS_StyleScopedClasses['secondary']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ class: "primary" },
    });
    /** @type {__VLS_StyleScopedClasses['primary']} */ ;
    (__VLS_ctx.editingProjectId ? '保存修改' : '创建并进入项目');
}
if (__VLS_ctx.copySourceProject) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "modal-mask" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-mask']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.form, __VLS_intrinsics.form)({
        ...{ onSubmit: (__VLS_ctx.copyProject) },
        ...{ class: "modal small" },
        'aria-busy': (__VLS_ctx.copyingProject),
    });
    /** @type {__VLS_StyleScopedClasses['modal']} */ ;
    /** @type {__VLS_StyleScopedClasses['small']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "modal-head" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-head']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.copySourceProject))
                    throw 0;
                return (__VLS_ctx.copySourceProject = null);
                // @ts-ignore
                [editingProjectId, copySourceProject, copySourceProject, copyProject, copyingProject,];
            } },
        type: "button",
        disabled: (__VLS_ctx.copyingProject),
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "form-grid" },
    });
    /** @type {__VLS_StyleScopedClasses['form-grid']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
        ...{ class: "span-2" },
    });
    /** @type {__VLS_StyleScopedClasses['span-2']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        disabled: (__VLS_ctx.copyingProject),
        required: true,
        placeholder: "请输入被测系统全称",
    });
    (__VLS_ctx.copyForm.systemName);
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        disabled: (__VLS_ctx.copyingProject),
        placeholder: "请输入新报告编号",
    });
    (__VLS_ctx.copyForm.reportCode);
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        disabled: (__VLS_ctx.copyingProject),
        type: "number",
        min: "2000",
        max: "2100",
        required: true,
    });
    (__VLS_ctx.copyForm.assessmentYear);
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        disabled: (__VLS_ctx.copyingProject),
        type: "date",
        required: true,
    });
    (__VLS_ctx.copyForm.startDate);
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        disabled: (__VLS_ctx.copyingProject),
        type: "date",
        required: true,
    });
    (__VLS_ctx.copyForm.endDate);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "modal-foot" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-foot']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.copySourceProject))
                    throw 0;
                return (__VLS_ctx.copySourceProject = null);
                // @ts-ignore
                [copySourceProject, copyingProject, copyingProject, copyingProject, copyingProject, copyingProject, copyingProject, copyForm, copyForm, copyForm, copyForm, copyForm,];
            } },
        type: "button",
        ...{ class: "secondary" },
        disabled: (__VLS_ctx.copyingProject),
    });
    /** @type {__VLS_StyleScopedClasses['secondary']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ class: "primary" },
        disabled: (__VLS_ctx.copyingProject),
    });
    /** @type {__VLS_StyleScopedClasses['primary']} */ ;
    (__VLS_ctx.copyingProject ? '正在复制…' : '确认复制');
}
if (__VLS_ctx.projectToDelete) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.projectToDelete))
                    throw 0;
                return (__VLS_ctx.projectToDelete = null);
                // @ts-ignore
                [projectToDelete, projectToDelete, copyingProject, copyingProject, copyingProject,];
            } },
        ...{ class: "modal-mask" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-mask']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "modal confirm-dialog" },
    });
    /** @type {__VLS_StyleScopedClasses['modal']} */ ;
    /** @type {__VLS_StyleScopedClasses['confirm-dialog']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "confirm-symbol" },
    });
    /** @type {__VLS_StyleScopedClasses['confirm-symbol']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    (__VLS_ctx.projectToDelete.system_name);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "modal-foot" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-foot']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.projectToDelete))
                    throw 0;
                return (__VLS_ctx.projectToDelete = null);
                // @ts-ignore
                [projectToDelete, projectToDelete,];
            } },
        ...{ class: "secondary" },
    });
    /** @type {__VLS_StyleScopedClasses['secondary']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (__VLS_ctx.deleteProject) },
        ...{ class: "primary danger-button" },
    });
    /** @type {__VLS_StyleScopedClasses['primary']} */ ;
    /** @type {__VLS_StyleScopedClasses['danger-button']} */ ;
}
if (__VLS_ctx.showUserModal) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.showUserModal))
                    throw 0;
                return (__VLS_ctx.showUserModal = false);
                // @ts-ignore
                [deleteProject, showUserModal, showUserModal,];
            } },
        ...{ class: "modal-mask" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-mask']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.form, __VLS_intrinsics.form)({
        ...{ onSubmit: (__VLS_ctx.createUser) },
        ...{ class: "modal small" },
    });
    /** @type {__VLS_StyleScopedClasses['modal']} */ ;
    /** @type {__VLS_StyleScopedClasses['small']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "modal-head" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-head']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
    (__VLS_ctx.editingUserId ? '编辑用户信息' : '添加系统用户');
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.showUserModal))
                    throw 0;
                return (__VLS_ctx.showUserModal = false);
                // @ts-ignore
                [showUserModal, createUser, editingUserId,];
            } },
        type: "button",
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "form-grid" },
    });
    /** @type {__VLS_StyleScopedClasses['form-grid']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        required: true,
        readonly: (!!__VLS_ctx.editingUserId),
        placeholder: "英文、数字或下划线",
    });
    (__VLS_ctx.userForm.username);
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        required: true,
        placeholder: "真实姓名",
    });
    (__VLS_ctx.userForm.displayName);
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
        value: (__VLS_ctx.userForm.role),
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
        value: "evaluator",
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
        value: "manager",
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
        value: "reviewer",
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
        value: "admin",
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        type: "date",
    });
    (__VLS_ctx.userForm.certificateDate);
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
        ...{ class: "span-2" },
    });
    /** @type {__VLS_StyleScopedClasses['span-2']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        ...{ onChange: (__VLS_ctx.chooseCertificate) },
        type: "file",
        accept: "image/*,.pdf",
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    (__VLS_ctx.userForm.certificateFileName || '支持图片或 PDF');
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "modal-foot" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-foot']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.showUserModal))
                    throw 0;
                return (__VLS_ctx.showUserModal = false);
                // @ts-ignore
                [showUserModal, editingUserId, userForm, userForm, userForm, userForm, userForm, chooseCertificate,];
            } },
        type: "button",
        ...{ class: "secondary" },
    });
    /** @type {__VLS_StyleScopedClasses['secondary']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ class: "primary" },
    });
    /** @type {__VLS_StyleScopedClasses['primary']} */ ;
    (__VLS_ctx.editingUserId ? '保存修改' : '确认添加');
}
if (__VLS_ctx.showUserImportResult) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.showUserImportResult))
                    throw 0;
                return (__VLS_ctx.showUserImportResult = false);
                // @ts-ignore
                [editingUserId, showUserImportResult, showUserImportResult,];
            } },
        ...{ class: "modal-mask" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-mask']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "modal user-import-result-modal" },
    });
    /** @type {__VLS_StyleScopedClasses['modal']} */ ;
    /** @type {__VLS_StyleScopedClasses['user-import-result-modal']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "modal-head" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-head']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
    (__VLS_ctx.userImportResults.length);
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.showUserImportResult))
                    throw 0;
                return (__VLS_ctx.showUserImportResult = false);
                // @ts-ignore
                [showUserImportResult, userImportResults,];
            } },
        type: "button",
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "user-import-result-table" },
    });
    /** @type {__VLS_StyleScopedClasses['user-import-result-table']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "result-head" },
    });
    /** @type {__VLS_StyleScopedClasses['result-head']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    for (const [user] of __VLS_vFor((__VLS_ctx.userImportResults))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            key: (user.username),
            ...{ class: "result-row" },
        });
        /** @type {__VLS_StyleScopedClasses['result-row']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
        (user.username);
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        (user.display_name);
        __VLS_asFunctionalElement1(__VLS_intrinsics.code, __VLS_intrinsics.code)({});
        (user.defaultPassword);
        // @ts-ignore
        [userImportResults,];
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "modal-foot" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-foot']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.showUserImportResult))
                    throw 0;
                return (__VLS_ctx.showUserImportResult = false);
                // @ts-ignore
                [showUserImportResult,];
            } },
        ...{ class: "secondary" },
    });
    /** @type {__VLS_StyleScopedClasses['secondary']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (__VLS_ctx.downloadUserPasswordList) },
        ...{ class: "primary" },
    });
    /** @type {__VLS_StyleScopedClasses['primary']} */ ;
}
if (__VLS_ctx.showPasswordModal) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.showPasswordModal))
                    throw 0;
                return (__VLS_ctx.showPasswordModal = false);
                // @ts-ignore
                [showPasswordModal, showPasswordModal, downloadUserPasswordList,];
            } },
        ...{ class: "modal-mask" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-mask']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.form, __VLS_intrinsics.form)({
        ...{ onSubmit: (__VLS_ctx.changePassword) },
        ...{ class: "modal small" },
    });
    /** @type {__VLS_StyleScopedClasses['modal']} */ ;
    /** @type {__VLS_StyleScopedClasses['small']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "modal-head" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-head']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.showPasswordModal))
                    throw 0;
                return (__VLS_ctx.showPasswordModal = false);
                // @ts-ignore
                [showPasswordModal, changePassword,];
            } },
        type: "button",
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "form-grid password-grid" },
    });
    /** @type {__VLS_StyleScopedClasses['form-grid']} */ ;
    /** @type {__VLS_StyleScopedClasses['password-grid']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
        ...{ class: "span-2" },
    });
    /** @type {__VLS_StyleScopedClasses['span-2']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        type: "password",
        required: true,
        autocomplete: "current-password",
    });
    (__VLS_ctx.passwordForm.currentPassword);
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        type: "password",
        minlength: "8",
        required: true,
        autocomplete: "new-password",
    });
    (__VLS_ctx.passwordForm.newPassword);
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        type: "password",
        minlength: "8",
        required: true,
        autocomplete: "new-password",
    });
    (__VLS_ctx.passwordForm.confirmPassword);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "modal-foot" },
    });
    /** @type {__VLS_StyleScopedClasses['modal-foot']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.showPasswordModal))
                    throw 0;
                return (__VLS_ctx.showPasswordModal = false);
                // @ts-ignore
                [showPasswordModal, passwordForm, passwordForm, passwordForm,];
            } },
        type: "button",
        ...{ class: "secondary" },
    });
    /** @type {__VLS_StyleScopedClasses['secondary']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ class: "primary" },
    });
    /** @type {__VLS_StyleScopedClasses['primary']} */ ;
}
let __VLS_0;
/** @ts-ignore @type { | typeof __VLS_components.transition | typeof __VLS_components.Transition | typeof __VLS_components.transition | typeof __VLS_components.Transition} */
transition;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent1(__VLS_0, new __VLS_0({
    name: "toast",
}));
const __VLS_2 = __VLS_1({
    name: "toast",
}, ...__VLS_functionalComponentArgsRest(__VLS_1));
const { default: __VLS_5 } = __VLS_3.slots;
if (__VLS_ctx.toast) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "toast" },
    });
    /** @type {__VLS_StyleScopedClasses['toast']} */ ;
    (__VLS_ctx.toast);
}
// @ts-ignore
[toast, toast,];
var __VLS_3;
// @ts-ignore
[];
const __VLS_export = (await import('vue')).defineComponent({});
export default {};
