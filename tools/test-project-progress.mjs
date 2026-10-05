import assert from 'node:assert/strict';
import { calculateStageCompletion, deriveProjectProgress } from '../backend/dist/project-progress.js';

const field = (id, value = '', checked = false) => ({ id, value, checked });

assert.equal(calculateStageCompletion('preparation', { fields: [
  field('prep-org-name', '单位'), field('prep-zipcode', '310000'), field('prep-address', '地址'),
] }), 50);

const planning = {
  fields: [
    field('mi-sys-name', '测试系统'), field('plan-sys-intro', '简介'), field('plan-eval-purpose', '目的'),
    field('plan-basis-standard', '标准'), field('plan-business-situation', '业务'), field('plan-topology-desc', '拓扑'),
    field('plan-crypto-physical', '密码应用'), field('plan-phase-1-content', '项目准备'),
    field('indicator-applicable-0-0', 'on', true),
  ],
  assets: { env: [[{ value: '机房' }]] },
  objData: { 1: [{ object: '中心机房' }] },
  toolData: [{ name: '测评工具' }],
  previousAssessment: { count: '1' },
};
assert.equal(calculateStageCompletion('planning', planning), 100);

assert.equal(calculateStageCompletion('onsite', { onsiteRecords: {
  a: { record: '已核查', D: '√', A: '√', K: '√' },
  b: { record: '', D: '√', A: '√', K: '√' },
} }), 50);

assert.equal(calculateStageCompletion('reporting', {
  exportContent: { tables: [{}] }, templateValues: { 系统名称: '测试系统' }, systemScore: 82.6,
}), 100);
assert.equal(calculateStageCompletion('review', {}), 0);
assert.equal(calculateStageCompletion('review', { lastExportAt: '2026-10-02T00:00:00.000Z' }), 100);

assert.deepEqual(deriveProjectProgress([
  { stage_key: 'preparation', completion: 100 },
  { stage_key: 'planning', completion: 92 },
  { stage_key: 'onsite', completion: 50 },
  { stage_key: 'reporting', completion: 100 },
  { stage_key: 'review', completion: 0 },
]), { progress: 68, currentStage: 2, status: 'in_progress' });

assert.deepEqual(deriveProjectProgress([
  { stage_key: 'preparation', completion: 100 },
  { stage_key: 'planning', completion: 100 },
  { stage_key: 'onsite', completion: 100 },
  { stage_key: 'reporting', completion: 100 },
  { stage_key: 'review', completion: 100 },
]), { progress: 100, currentStage: 5, status: 'completed' });

console.log('PASS: project progress follows actual stage content and successful report export.');
