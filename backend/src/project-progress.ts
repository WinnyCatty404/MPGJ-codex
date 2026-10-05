type JsonRecord = Record<string, any>;

export const projectStageOrder = ['preparation', 'planning', 'onsite', 'reporting', 'review'] as const;

function fieldMap(data: JsonRecord) {
  return new Map((Array.isArray(data?.fields) ? data.fields : [])
    .filter((field: JsonRecord) => field?.id)
    .map((field: JsonRecord) => [String(field.id), field]));
}

function value(fields: Map<string, JsonRecord>, id: string) {
  return String(fields.get(id)?.value ?? '').trim();
}

function imagePresent(data: JsonRecord, id: string) {
  return (Array.isArray(data?.images) ? data.images : [])
    .some((image: JsonRecord) => image?.id === id && /^data:image\//.test(String(image.src || '')));
}

function rowsHaveValue(rows: unknown) {
  return Array.isArray(rows) && rows.some(row => Array.isArray(row) && row.some((field: JsonRecord) =>
    String(field?.value ?? '').trim() || field?.checked === true));
}

function planningCompletion(data: JsonRecord) {
  const fields = fieldMap(data);
  const checks: boolean[] = [];
  checks.push(!!value(fields, 'mi-sys-name'));
  checks.push(!!(value(fields, 'plan-sys-intro') || value(fields, 'plan-eval-intro')));
  checks.push(!!value(fields, 'plan-eval-purpose'));
  checks.push(!!(value(fields, 'plan-basis-standard') || (data.currentReferenceStandards || []).length));
  checks.push(!!value(fields, 'plan-business-situation'));
  checks.push(!!(value(fields, 'plan-topology-desc') || imagePresent(data, 'topology-image')));
  checks.push(['physical', 'network', 'device', 'application'].some(layer =>
    !!value(fields, `plan-crypto-${layer}`) || imagePresent(data, `${layer}-crypto-image`)));
  const assets = data.assets || {};
  checks.push(['env', 'security', 'crypto', 'server', 'network', 'db', 'app', 'data', 'doc', 'person']
    .some(type => rowsHaveValue(assets[type])));
  checks.push(['plan-phase-1-content', 'plan-phase-2-content', 'plan-phase-3-content', 'plan-phase-4-content']
    .some(id => !!value(fields, id)));
  checks.push(Object.values(data.objData || {}).some(rows => Array.isArray(rows) && rows.some((row: JsonRecord) => String(row?.object || '').trim())));
  const indicatorFields = [...fields.values()].filter(field => /^indicator-applicable-/.test(String(field.id || '')));
  checks.push(indicatorFields.length > 0 && indicatorFields.every(field => {
    if (field.checked) return true;
    const reasonId = String(field.id).replace('indicator-applicable-', 'indicator-reason-');
    return !!value(fields, reasonId);
  }));
  checks.push((data.toolData || []).some((row: JsonRecord) => String(row?.name || row?.tool || '').trim()) ||
    (data.accessPoints || []).some((row: JsonRecord) => String(row?.desc || '').trim()));
  const previous = data.previousAssessment || {};
  checks.push(String(previous.count || '').trim() === '1' || ['time', 'org', 'conclusion', 'score'].some(key => String(previous[key] || '').trim()));
  return Math.round(checks.filter(Boolean).length / checks.length * 100);
}

function onsiteCompletion(data: JsonRecord) {
  const records = Object.values(data?.onsiteRecords || {}) as JsonRecord[];
  if (!records.length) return 0;
  const complete = records.filter(record => {
    if (!String(record?.record || '').trim()) return false;
    if (String(record?.result || '').trim()) return true;
    return ['D', 'A', 'K'].every(key => String(record?.[key] || '').trim());
  }).length;
  return Math.round(complete / records.length * 100);
}

export function calculateStageCompletion(stageKey: string, data: JsonRecord, previousCompletion = 0) {
  if (stageKey === 'preparation') {
    const fields = fieldMap(data);
    const required = ['prep-org-name', 'prep-zipcode', 'prep-address', 'prep-crypto-gov', 'prep-contact-name', 'prep-contact-mobile'];
    return Math.round(required.filter(id => value(fields, id)).length / required.length * 100);
  }
  if (stageKey === 'planning') return planningCompletion(data);
  if (stageKey === 'onsite') return onsiteCompletion(data);
  if (stageKey === 'reporting') {
    const checks = [
      Array.isArray(data?.exportContent?.tables) && data.exportContent.tables.length > 0,
      data?.templateValues && Object.keys(data.templateValues).length > 0,
      data?.systemScore !== null && data?.systemScore !== undefined && Number.isFinite(Number(data.systemScore)),
    ];
    return Math.round(checks.filter(Boolean).length / checks.length * 100);
  }
  if (stageKey === 'review') return data?.lastExportAt || previousCompletion >= 100 ? 100 : 0;
  return 0;
}

export function deriveProjectProgress(stages: { stage_key: string; completion: number }[]) {
  const values = projectStageOrder.map(key => Math.max(0, Math.min(100,
    Number(stages.find(stage => stage.stage_key === key)?.completion || 0))));
  const progress = Math.round(values.reduce((sum, item) => sum + item, 0) / values.length);
  const firstIncomplete = values.findIndex(item => item < 100);
  return {
    progress,
    currentStage: firstIncomplete < 0 ? projectStageOrder.length : firstIncomplete + 1,
    status: progress === 0 ? 'draft' : (values.every(item => item === 100) ? 'completed' : 'in_progress'),
  };
}
