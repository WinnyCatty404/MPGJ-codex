type JsonRecord = Record<string, any>;

function dateParts(value: unknown) {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(value || '').trim());
  if (!match) return null;
  const year = match[1];
  const month = Number(match[2]);
  const day = Number(match[3]);
  return {
    iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    cn: `${year}年${String(month).padStart(2, '0')}月${String(day).padStart(2, '0')}日`,
    cnLoose: `${year}年${month}月${day}日`,
  };
}

function replaceText(value: string, replacements: Array<[string, string]>) {
  const active = replacements.filter(([from, to]) => from && from !== to && value.includes(from));
  if (!active.length) return value;
  const tokens = active.map((_, index) => `\u0000BB_PROJECT_DATE_${index}\u0000`);
  active.forEach(([from], index) => { value = value.split(from).join(tokens[index]); });
  active.forEach(([, to], index) => { value = value.split(tokens[index]).join(to); });
  return value;
}

function replaceDeep(value: any, replacements: Array<[string, string]>, key = ''): any {
  if (typeof value === 'string') {
    if (key === 'src' || key === 'dataUrl' || /^data:(?:image|application)\//i.test(value)) return value;
    return replaceText(value, replacements);
  }
  if (Array.isArray(value)) return value.map(item => replaceDeep(item, replacements));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) =>
      [childKey, replaceDeep(child, replacements, childKey)]));
  }
  return value;
}

function dateReplacements(oldValue: unknown, newValue: unknown, placeholder: string): Array<[string, string]> {
  const oldDate = dateParts(oldValue);
  const newDate = dateParts(newValue);
  const target = newDate || { iso: '', cn: placeholder, cnLoose: placeholder };
  if (!oldDate) return [[placeholder, target.cn]];
  return [
    [oldDate.iso, target.iso],
    [oldDate.cn, target.cn],
    [oldDate.cnLoose, target.cnLoose],
  ];
}

function setField(data: JsonRecord, id: string, value: string) {
  const field = Array.isArray(data.fields) ? data.fields.find((item: any) => item?.id === id) : null;
  if (field) field.value = value;
}

export function syncProjectDatesInStageData(data: JsonRecord | null | undefined, oldStart: unknown,
  newStart: unknown, oldEnd: unknown, newEnd: unknown): JsonRecord {
  const start = dateParts(newStart);
  const end = dateParts(newEnd);
  const replacements = [
    ...dateReplacements(oldStart, newStart, '{测评开始日期}'),
    ...dateReplacements(oldEnd, newEnd, '{测评结束日期}'),
  ];
  const synced = replaceDeep(data || {}, replacements);

  // 测评计划中的项目边界日期始终以项目管理中最后保存的日期为准。
  setField(synced, 'plan-phase-1-start', start?.iso || '');
  setField(synced, 'plan-phase-4-end', end?.iso || '');

  const values = synced.templateValues;
  if (values && typeof values === 'object') {
    for (const key of ['测评准备阶段开始日期', '测评准备阶段开始时间', '测评开始时间']) {
      if (Object.prototype.hasOwnProperty.call(values, key)) values[key] = start?.cn || '';
    }
    for (const key of ['分析与报告编制阶段结束时间', '分析与报告编制结束日期', '测评结束时间', '结束时间']) {
      if (Object.prototype.hasOwnProperty.call(values, key)) values[key] = end?.cn || '';
    }
  }
  synced.projectDates = { startDate: start?.iso || '', endDate: end?.iso || '' };
  return synced;
}

export function replaceProjectTextInStageData(data: JsonRecord | null | undefined,
  oldValue: unknown, newValue: unknown): JsonRecord {
  const from = String(oldValue || '').trim();
  const to = String(newValue || '').trim();
  if (!from || from === to) return data || {};
  return replaceDeep(data || {}, [[from, to]]);
}
