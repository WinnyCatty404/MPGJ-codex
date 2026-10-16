import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from 'jszip';
import ts from 'typescript';

for (const file of ['frontend/src/report-generator.html', 'frontend/public/prototype.html']) {
  const html = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    if (match[1].trim()) new Function(match[1]);
  }
  const start = html.indexOf('function _impIsoDate(');
  const end = html.indexOf('function syncProjectBoundaryText(', start);
  assert.ok(start >= 0 && end > start, file + ' 缺少测评过程日期解析函数');
  const source = html.slice(start, end);
  const parse = new Function('function _impHLevel(style) { return style === "Heading2" ? 2 : 0; }\n' + source + '; return _impParsePhaseSchedule;')();
  const blocks = [
    { type: 'p', text: '1.3 测评过程', style: 'Heading2' },
    { type: 'p', text: '测评准备阶段时间：2026年08月7日-2026年08月09日。' },
    { type: 'p', text: '方案编制阶段时间：2026年8月9日 至 2026年8月12日。' },
    { type: 'p', text: '现场测评阶段时间：2026年8月12日～2026年8月15日。' },
    { type: 'p', text: '分析与报告编制阶段时间：2026年8月15日—2026年8月17日。' },
    { type: 'p', text: '1.4 其他内容', style: 'Heading2' },
    { type: 'p', text: '现场测评阶段时间：2028年1月1日-2028年1月2日。' },
  ];
  const parsed = parse(blocks);
  assert.equal(parsed.ok, true, file + ' 未识别零填充和连接符变体');
  assert.deepEqual(parsed.phases.map(phase => [phase.start, phase.end]), [
    ['2026-08-07', '2026-08-09'], ['2026-08-09', '2026-08-12'],
    ['2026-08-12', '2026-08-15'], ['2026-08-15', '2026-08-17'],
  ]);
  assert.equal(parse(blocks.slice(0, 4)).ok, false, file + ' 缺失阶段时不应部分导入');
  const reversed = structuredClone(blocks);
  reversed[3].text = '现场测评阶段时间：2026年8月14日-2026年8月13日。';
  assert.equal(parse(reversed).ok, false, file + ' 未拒绝倒置日期');
  assert.match(html, /id="plan-member-body"/);
  assert.match(html, /data\.planMembers = clone\(planMembers\)/);
  assert.match(html, /caption: '测评项目组成员', skip: 1, repeat: true/);
  assert.doesNotMatch(html, /id="plan-member-1-name"/);
}

const app = fs.readFileSync(new URL('../frontend/src/App.vue', import.meta.url), 'utf8');
assert.doesNotMatch(app, /projectForm\.startDate|projectForm\.endDate|copyForm\.startDate|copyForm\.endDate/);
assert.match(app, />项目周期</);

const reportContentSource = fs.readFileSync(new URL('../backend/src/report-content.ts', import.meta.url), 'utf8');
const reportContentModule = ts.transpileModule(reportContentSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { writeReportContent } = await import('data:text/javascript;base64,' + Buffer.from(reportContentModule).toString('base64'));
for (const template of ['../storage/templates/report/default-report-template.docx', '../storage/templates/report/level-2/default-report-template.docx']) {
  const zip = await JSZip.loadAsync(fs.readFileSync(new URL(template, import.meta.url)));
  const xml = await zip.file('word/document.xml').async('string');
  const styles = await zip.file('word/styles.xml').async('string');
  const output = writeReportContent(xml, styles, { sections: [], tables: [{
    caption: '测评项目组成员', skip: 1, repeat: true, required: true,
    rows: [
      ['项目负责人', '测试甲', '总体负责', '是'],
      ['测评项目组成员', '测试乙', '现场测评', '是'],
      ['测评项目组成员', '测试丙', '报告编制', '否'],
    ],
  }] });
  for (const name of ['测试甲', '测试乙', '测试丙']) assert.equal(output.split(name).length - 1, 1, template + ' 未按实际人数输出表1-1');
}
console.log('PASS: Word phase dates are atomic, member rows are dynamic, and project modals no longer own dates.');
