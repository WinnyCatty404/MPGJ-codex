// 校验系统资产表「多选 → 批量删除」：切换选中、批量倒序删除、序号重排、人员表固定行保护。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const html = await fs.readFile('frontend/src/report-generator.html', 'utf8');

function extractFn(name) {
  const start = html.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, '未找到函数 ' + name);
  const end = html.indexOf('\n  function ', start + 1);
  return html.slice(start, end < 0 ? html.length : end);
}

const factory = new Function('document', 'PERSON_ASSET_DEFAULTS', `
  let toast = '';
  function showToast(msg) { toast = msg; }
  ${extractFn('renumberAssetRows')}
  ${extractFn('deleteAssetRow')}
  return { deleteAssetRow, getToast: () => toast, resetToast: () => { toast = ''; } };
`);

function makeRow(name, fixed = false) {
  const classes = new Set();
  const row = {
    name,
    fixed,
    dataset: {},
    classList: {
      add: c => classes.add(c),
      remove: c => classes.delete(c),
      has: c => classes.has(c),
      contains: c => classes.has(c),
      toggle: c => (classes.has(c) ? (classes.delete(c), false) : (classes.add(c), true))
    }
  };
  const cells = [{ textContent: '' }];
  row.cells = cells;
  row.children = cells;
  row.remove = function () {
    const parent = this.parent;
    const i = parent.children.indexOf(this);
    if (i >= 0) parent.children.splice(i, 1);
  };
  return row;
}

function makeTbody(names, fixedCount = 0) {
  const tbody = {
    children: names.map((n, i) => makeRow(n, i < fixedCount)),
    dataset: {},
    get rows() { return this.children; },
    get lastElementChild() { return this.children[this.children.length - 1] || null; }
  };
  tbody.children.forEach((row, i) => { row.parent = tbody; row.cells[0].textContent = i + 1; });
  return tbody;
}

const PERSON_ASSET_DEFAULTS = [[1], [2], [3], [4], [5], [6]];
const api = factory({ getElementById: () => current }, PERSON_ASSET_DEFAULTS);
let current;
const names = () => current.children.map(r => r.name);
const seq = () => current.children.map(r => r.cells[0].textContent);
const select = (...idx) => idx.forEach(i => current.children[i].classList.add('bb-row-selected'));

// 1) 未选中任何行：提示且不删除
current = makeTbody(['A', 'B', 'C']);
api.resetToast();
api.deleteAssetRow('server', false);
assert.equal(api.getToast(), '请先选中要删除的行（可点击多行多选）', '未选中行未给出提示');
assert.deepEqual(names(), ['A', 'B', 'C'], '未选中行时不应删除任何行');

// 2) 选中两行（不相邻）批量删除
current = makeTbody(['A', 'B', 'C', 'D', 'E']);
select(1, 3);
api.deleteAssetRow('server', false);
assert.deepEqual(names(), ['A', 'C', 'E'], '批量删除未按预期移除多行');
assert.deepEqual(seq(), [1, 2, 3], '批量删除后序号未重排');

// 3) 选中连续三行 + 全部选中
current = makeTbody(['A', 'B', 'C', 'D']);
select(0, 1, 2, 3);
api.deleteAssetRow('server', false);
assert.deepEqual(names(), [], '全选后未清空');

// 4) 人员表：前六行为默认固定行，选中前六行中的行应被跳过
current = makeTbody(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'], 6);
select(0, 6, 7);
api.resetToast();
api.deleteAssetRow('person', false);
assert.deepEqual(names(), ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'], '人员表固定行未被保护');
assert.equal(api.getToast(), '人员表默认六行不可删除', '人员表未提示固定行不可删除');

// 5) 人员表：仅选中固定行之后的行可正常删除
current = makeTbody(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'], 6);
select(6);
api.deleteAssetRow('person', false);
assert.deepEqual(names(), ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'], '人员表非固定行未删除');

// 6) forceLast（还原历史数据时裁剪尾部）：只删最后一行且不提示
current = makeTbody(['A', 'B', 'C']);
api.resetToast();
api.deleteAssetRow('server', true);
assert.deepEqual(names(), ['A', 'B'], 'forceLast 未删除最后一行');
assert.equal(api.getToast(), '', 'forceLast 不应弹提示');

// 7) 行点击为“切换选中”（可多选），源码断言
assert.match(html, /row\.classList\.toggle\('bb-row-selected'\);/,
  '行点击未改为切换选中（应为可多选）');
assert.match(html, /if \(event\.target\.closest\('input, textarea, select, button, a, label'\)\) return;/,
  '点击输入框等控件时未跳过选中切换');

console.log('PASS: 系统资产表多选批量删除、序号重排与人员表固定行保护检查通过。');
