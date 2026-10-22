// 报告审核 · 图件传入检查（规则 C40）回归测试
// 用例：图2-1/图2-2（拓扑图片块）、图3-1（工具接入示意图）缺失时给出“图片未传入”提示。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = vm.createContext({});
vm.runInContext(fs.readFileSync('frontend/public/report-review-engine.js', 'utf8'), context);
const engine = context.BBReportReviewEngine;

const baseInput = {
  objects: [], units: [], targets: [], recordExpectations: [],
  serverNames: [], databaseNames: [], dataCount: 0
};
const figure = (key, name, present, extra = {}) => ({
  key, name, section: 2, layer: -1, path: '测试路径', hint: name + ' 位置',
  present, text: present ? '已传入' : '', targetId: 'figure-target-' + key, ...extra
});

function run(figures, extra = {}) {
  return engine.analyze({ ...baseInput, ...extra, figures });
}

// 1. 三张图都缺失 → 三条 C40，标题均含“图片未传入”和对应图号
const allMissing = run([
  figure('plan-figure-topology-prepared', '图2-1', false),
  figure('plan-figure-topology-deployed', '图2-2', false),
  figure('plan-figure-access-tool', '图3-1', false)
]);
const c40 = allMissing.filter(f => f.rule === 'C40');
assert.equal(c40.length, 3, '三张图缺失应各报一条');
assert.equal(c40.map(f => f.object.name).sort().join(','), '图2-1,图2-2,图3-1');
c40.forEach(f => {
  assert.ok(f.title.startsWith('图片未传入：'), '标题应包含“图片未传入”');
  assert.equal(f.type, '证据不足', '缺图为证据不足，不判为内容冲突');
  assert.ok(f.reason.includes(f.object.name), '审核依据应带图号');
  assert.ok(f.reason.includes('测试路径'), '审核依据应带应为位置');
});

// 2. 全部齐全 → 不产生 C40
assert.equal(run([
  figure('plan-figure-topology-prepared', '图2-1', true),
  figure('plan-figure-topology-deployed', '图2-2', true),
  figure('plan-figure-access-tool', '图3-1', true)
]).filter(f => f.rule === 'C40').length, 0);

// 3. 部分缺失 → 只报缺失的那一张
const onlyAccessMissing = run([
  figure('plan-figure-topology-prepared', '图2-1', true),
  figure('plan-figure-topology-deployed', '图2-2', true),
  figure('plan-figure-access-tool', '图3-1', false)
]).filter(f => f.rule === 'C40');
assert.equal(onlyAccessMissing.length, 1);
assert.equal(onlyAccessMissing[0].object.name, '图3-1');

// 4. 未传 figures 时引擎不报错也不产生 C40（老数据兼容）
assert.equal(engine.analyze({ ...baseInput }).filter(f => f.rule === 'C40').length, 0);

// 5. 图件结论只依赖是否传入：截图内容变化不应影响 id，传入后不再提示
const missingKey = c40[0].object.key;
assert.equal(run([figure(missingKey, '图2-1', false)]).filter(f => f.rule === 'C40')[0].object.key, missingKey);

// 6. 图件检查结果 id 稳定（同输入两次分析 id 相同）
const a = run([figure('plan-figure-access-tool', '图3-1', false)]).filter(f => f.rule === 'C40')[0];
const b = run([figure('plan-figure-access-tool', '图3-1', false)]).filter(f => f.rule === 'C40')[0];
assert.equal(a.id, b.id);

// ---- 页面对接：report-review.js 中的图件判定与过滤 ----
const pageSource = fs.readFileSync('frontend/public/report-review.js', 'utf8');
const engineSource = fs.readFileSync('frontend/public/report-review-engine.js', 'utf8');

// 7. 引擎侧图件检查在章节过滤之前执行（否则 section 2 会被 excludedSections 过滤掉）
assert.ok(engineSource.indexOf('analyzeFigures(input.figures)') > 0 &&
  engineSource.indexOf('analyzeFigures(input.figures)') < engineSource.indexOf('for (const target of input.targets)'),
  '图件检查应先于章节遍历执行');

// 8. 页面侧 C40 在 excludedSections 之前放行
assert.ok(/if \(finding\.rule === 'C40'\) return finding\.object\?\.key !== 'plan-figure-none';\s*\n\s*if \(excludedSections\.has\(finding\.target\?\.section\)\)/m.test(pageSource),
  'validFinding 必须先放行 C40 再做章节过滤');
assert.ok(/if \(item\.rule === 'C40'\) return item\.objectKey !== 'plan-figure-none';\s*\n\s*if \(excludedSections\.has\(item\.targetSection\)\)/m.test(pageSource),
  'validAccepted 必须先放行 C40 再做章节过滤');

// 9. 只审其它章节时，仍能进入图片检查（零文本占位目标）
assert.ok(pageSource.includes("id: 'plan-figure-none'"), '缺少图片时应补零文本占位目标');
assert.ok(pageSource.includes("figures.some(figure => !figure.present)"), '仅在缺图时补占位目标，避免图片齐全时误报“内容已变化”');

// 10. 图件位置的数据来源
assert.ok(pageSource.includes("blocks.filter(block => block && block.type === 'image' && block.dataUrl)"), '图2-1/图2-2 取自拓扑图片块');
assert.ok(pageSource.includes("document.getElementById('access-image')"), '图3-1 取自工具接入示意图');
assert.ok(pageSource.includes("AREA_IMAGE_IDS = new Set(['access-image'])"), '接入示意图识别仅限工具接入图片，避免密码模块图片误认为已传入');

// 11. 缺陷：图片清单提示、定位入口存在，且定位走第二步对应页面
assert.ok(pageSource.includes('function onsiteFigureOutline'), '应有缺图清单提示');
assert.ok(pageSource.includes("switchPlanTab(4)") && pageSource.includes("switchMethodSubTab(2)"), '图3-1 定位到测评方法及工具—测评接入点');
assert.ok(pageSource.includes("switchPlanTab(11)"), '图2-1/图2-2 定位到网络拓扑图及描述');

console.log('test-report-figures: OK (11 组断言)');
