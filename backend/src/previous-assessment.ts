type PreviousAssessment = Record<string, unknown>;

function stringValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function fieldValue(fields: unknown, id: string): string {
  if (!Array.isArray(fields)) return '';
  const field = fields.find(item => item && typeof item === 'object' && item.id === id);
  return stringValue(field?.value);
}

export function generatePreviousAssessment(planning: Record<string, unknown>): string | null {
  const modules = planning.planningModules as Record<string, unknown> | undefined;
  const previous = (planning.previousAssessment || modules?.previousAssessment || {}) as PreviousAssessment;
  const fields = planning.fields;
  const countText = stringValue(previous.count ?? previous.assessmentCount) || fieldValue(fields, 'prev-eval-count');
  if (!countText) return null;
  const count = Number(countText);
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('前次测评情况的测评次数必须是正整数');

  const introduction = `本次测评是被测信息系统进行的第 ${count} 次商用密码应用安全性评估`;
  if (count === 1) return introduction + '。';

  const date = stringValue(previous.time ?? previous.assessmentDate) || fieldValue(fields, 'prev-eval-time');
  const org = stringValue(previous.org ?? previous.assessmentOrg) || fieldValue(fields, 'prev-eval-org');
  const legacyScoreConclusion = stringValue(previous.scoreConclusion);
  const conclusion = stringValue(previous.conclusion) || fieldValue(fields, 'prev-eval-conclusion')
    || legacyScoreConclusion.match(/(?:符合|不符合|基本符合|部分符合)/)?.[0] || '';
  const score = stringValue(previous.score) || fieldValue(fields, 'prev-eval-score')
    || legacyScoreConclusion.match(/\d+(?:\.\d+)?\s*分/)?.[0] || '';
  const details = [
    date && `上次评估时间为：${date}`,
    org && `密评机构为：${org}`,
    conclusion && `评估结论为：${conclusion}`,
    score && `综合得分为：${score.replace(/分$/, '')}分`,
  ].filter(Boolean);
  return introduction + (details.length ? '，' + details.join('，') : '') + '。';
}
