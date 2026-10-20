// 校验「重要数据」行序调整：① 上移/下移与序号重排；② 结果记录按对象稳定 ID 存储（随对象走，不随位置走）。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const html = await fs.readFile('frontend/src/report-generator.html', 'utf8');

// ---------- 1. 关键机制断言：记录键 = 指标ID + 对象稳定ID（非位置索引） ----------
assert.match(html, /function onsiteKey\(t, itemIdx, objIdx\) \{\s*\n\s*return indicatorIdFor\(t, itemIdx\) \+ '\|' \+ onsiteObjectIdFor\(t, itemIdx, objIdx\);/,
  'onsiteKey 未按「指标ID|对象稳定ID」生成，结果记录会随位置漂移');
assert.match(html, /return \{ id: asset\.id, name: asset\.app \? asset\.name \+ '-' \+ asset\.app : asset\.name \};/,
  '重要数据对象条目未携带行级稳定 ID');
assert.match(html, /if \(!row\.dataset\.assetId\) row\.dataset\.assetId = newAssetRowId\('asset'\);/,
  '重要数据行未绑定行级稳定 assetId');

// ---------- 2. 抽出 moveAssetRow / renumberAssetRows 做行序单测 ----------
function extractFn(name) {
  const start = html.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, '未找到函数 ' + name);
  const end = html.indexOf('\n  function ', start + 1);
  return html.slice(start, end < 0 ? html.length : end);
}

const factory = new Function('document', `
  let toast = '';
  function showToast(msg) { toast = msg; }
  ${extractFn('renumberAssetRows')}
  ${extractFn('moveAssetRow')}
  return { moveAssetRow, renumberAssetRows, getToast: () => toast, resetToast: () => { toast = ''; } };
`);

function makeRow(name) {
  const classes = new Set();
  const row = {
    name,
    dataset: {},
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), has: c => classes.has(c) },
    querySelector() { return null; }
  };
  const cells = [{ textContent: '' }];
  row.cells = cells;
  row.children = cells; // renumberAssetRows 用 tr.children[0] 写序号
  return row;
}

function makeTbody(names) {
  const tbody = {
    children: names.map(makeRow),
    get rows() { return this.children; },
    get lastElementChild() { return this.children[this.children.length - 1] || null; },
    insertBefore(node, ref) {
      const from = this.children.indexOf(node);
      if (from >= 0) this.children.splice(from, 1);
      const to = ref ? this.children.indexOf(ref) : this.children.length;
      this.children.splice(to < 0 ? this.children.length : to, 0, node);
    },
    querySelector(sel) {
      if (sel === ':scope > tr.bb-row-selected') return this.children.find(r => r.classList.has('bb-row-selected')) || null;
      return null;
    }
  };
  tbody.children.forEach((row, i) => { row.cells[0].textContent = i + 1; });
  return tbody;
}

const names = ['A-userinfo-系统A', 'B-orderdata-系统A', 'C-logdata-系统B'];
const tbody = makeTbody(names);
const api = factory({ getElementById: () => tbody });
const order = () => tbody.children.map(r => r.name);
const seq = () => tbody.children.map(r => r.cells[0].textContent);

// 未选中行：提示且不移动
api.resetToast();
api.moveAssetRow('data', -1);
assert.equal(api.getToast(), '请先选中要移动的行', '未选中行未给出提示');
assert.deepEqual(order(), names, '未选中行时不应改变顺序');

// 选中第 2 行上移
tbody.children[1].classList.add('bb-row-selected');
api.moveAssetRow('data', -1);
assert.deepEqual(order(), ['B-orderdata-系统A', 'A-userinfo-系统A', 'C-logdata-系统B'], '上移未正确换位');
assert.deepEqual(seq(), [1, 2, 3], '上移后序号未重排');

// 再次上移：已在首行
api.resetToast();
api.moveAssetRow('data', -1);
assert.equal(api.getToast(), '已是第一行', '首行继续上移未提示');
assert.deepEqual(order(), ['B-orderdata-系统A', 'A-userinfo-系统A', 'C-logdata-系统B'], '首行上移不应改变顺序');

// 选中首行下移两次到底部
tbody.children[0].classList.remove('bb-row-selected');
tbody.children[1].classList.add('bb-row-selected'); // A-userinfo
api.moveAssetRow('data', 1);
assert.deepEqual(order(), ['B-orderdata-系统A', 'C-logdata-系统B', 'A-userinfo-系统A'], '下移未正确换位');
api.resetToast();
api.moveAssetRow('data', 1);
assert.equal(api.getToast(), '已是最后一行', '末行继续下移未提示');
assert.deepEqual(seq(), [1, 2, 3], '多次移动后序号仍应连续');

console.log('PASS: 重要数据行上移/下移换位、序号重排与结果记录按对象稳定ID存储检查通过。');
