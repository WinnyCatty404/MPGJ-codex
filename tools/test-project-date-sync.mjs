import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../backend/src/project-date-sync.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { syncProjectDatesInStageData } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

const saved = {
  fields: [
    { id: 'plan-eval-intro', value: '测评时间为2026年04月01日到2026年06月30日。' },
    { id: 'plan-eval-purpose', value: '于2026年4月1日至2026年6月30日开展测评。' },
    { id: 'plan-phase-1-start', value: '2026-04-01' },
    { id: 'plan-phase-1-end', value: '2026-04-01' },
    { id: 'plan-phase-2-start', value: '2026-06-30' },
    { id: 'plan-phase-4-end', value: '2026-06-30' },
    { id: 'unrelated', value: '其他日期2025年01月01日保持不变。' },
  ],
  exportContent: { sections: [{ heading: '测评目的', text: '2026年04月01日到2026年06月30日' }] },
  templateValues: {
    测评准备阶段开始日期: '2026年04月01日',
    测评开始时间: '2026年04月01日',
    分析与报告编制阶段结束时间: '2026年06月30日',
    测评结束时间: '2026年06月30日',
  },
};

const synced = syncProjectDatesInStageData(saved, '2026-04-01', '2026-05-02', '2026-06-30', '2026-07-03');
assert.equal(synced.fields[0].value, '测评时间为2026年05月02日到2026年07月03日。');
assert.equal(synced.fields[1].value, '于2026年5月2日至2026年7月3日开展测评。');
assert.equal(synced.fields[2].value, '2026-05-02');
assert.equal(synced.fields[3].value, '2026-04-01');
assert.equal(synced.fields[4].value, '2026-06-30');
assert.equal(synced.fields[5].value, '2026-07-03');
assert.equal(synced.fields[6].value, '其他日期2025年01月01日保持不变。');
assert.equal(synced.exportContent.sections[0].text, '2026年05月02日到2026年07月03日');
assert.equal(synced.templateValues.测评准备阶段开始日期, '2026年05月02日');
assert.equal(synced.templateValues.测评开始时间, '2026年05月02日');
assert.equal(synced.templateValues.分析与报告编制阶段结束时间, '2026年07月03日');
assert.equal(synced.templateValues.测评结束时间, '2026年07月03日');
assert.deepEqual(synced.projectDates, { startDate: '2026-05-02', endDate: '2026-07-03' });

const fromPlaceholders = syncProjectDatesInStageData({
  fields: [
    { id: 'plan-eval-intro', value: '{测评开始日期}到{测评结束日期}' },
    { id: 'plan-phase-1-start', value: '' },
    { id: 'plan-phase-4-end', value: '' },
  ],
}, '', '2026-05-02', '', '2026-07-03');
assert.equal(fromPlaceholders.fields[0].value, '2026年05月02日到2026年07月03日');
assert.equal(fromPlaceholders.fields[1].value, '2026-05-02');
assert.equal(fromPlaceholders.fields[2].value, '2026-07-03');

console.log('PASS: derived project dates synchronize boundary text without changing six inner phase dates.');
