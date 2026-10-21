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
// 移动后必须触发自动保存，否则刷新/重开项目后顺序会被旧快照还原
assert.match(html, /\/保存\|恢复默认\|新增\|添加\|删除\|上移\|下移\|同步系统资产\|清除图片\//,
  '自动保存的按钮点击正则未包含「上移|下移」，移动结果不会落库');

// ---------- 3. 表4-6 行序必须严格等于重要数据表的行序 ----------
// 旧实现「四个单元依次遍历取并集」会把只勾存储类需求的行排到只勾传输类的行之后：DOM 为 [A,B,C] 时得到 [A,C,B]。
for (const relative of ['frontend/src/report-generator.html', 'frontend/public/prototype.html']) {
  const src = await fs.readFile(relative, 'utf8');
  assert.doesNotMatch(src, /unitNames\.forEach\(n => getOnsiteUnitObjects\(t, n\)\.forEach/,
    `${relative} 表4-6 仍在按测评单元遍历取并集，行序会脱离重要数据表`);
  assert.doesNotMatch(src, /dataUnits\.forEach\(name => getOnsiteUnitObjects\(3, name\)\.forEach/,
    `${relative} 报告导出侧表4-6 仍在按测评单元遍历取并集`);
  assert.match(src, /const dataReqValues = unitNames\.map\(n => ONSITE_UNIT_DATA_REQ\[n\]\);/,
    `${relative} 页面表4-6 未按重要数据表行序构建`);
  assert.match(src, /const dataReqKeys = dataUnits\.map\(name => ONSITE_UNIT_DATA_REQ\[name\]\);/,
    `${relative} 导出侧表4-6 未按重要数据表行序构建`);

  const start = src.indexOf('    // 行 = 勾选了四项安全需求之一的重要数据');
  const end = src.indexOf('let html = \'<div class="ua-caption">表4-6', start);
  assert.ok(start > 0 && end > start, `${relative} 未找到表4-6 行序构建片段`);
  const buildRows = new Function('getImportantDataAssets', 'ONSITE_UNIT_DATA_REQ', 'unitNames',
    src.slice(start, end) + '\n    return rows;');

  const ONSITE_UNIT_DATA_REQ = {
    '重要数据传输机密性': '传输机密性',
    '重要数据存储机密性': '存储机密性',
    '重要数据传输完整性': '传输完整性',
    '重要数据存储完整性': '存储完整性'
  };
  const unitNames = Object.keys(ONSITE_UNIT_DATA_REQ);
  // DOM 行序：A 只勾传输机密性，B 只勾存储完整性，C 四项全勾；D 未勾任何需求（不进表）
  const assets = [
    { name: 'A', app: '应用1', reqs: ['传输机密性'] },
    { name: 'B', app: '应用1', reqs: ['存储完整性'] },
    { name: 'C', app: '应用2', reqs: ['传输机密性', '存储完整性'] },
    { name: 'D', app: '应用2', reqs: [] }
  ];
  const rows = buildRows(() => assets, ONSITE_UNIT_DATA_REQ, unitNames);
  assert.deepEqual(rows, ['A-应用1', 'B-应用1', 'C-应用2'],
    `${relative} 表4-6 行序未与重要数据表行序一致（实际：${JSON.stringify(rows)}）`);
  // 移动 B 到首位后，表4-6 行序必须跟着变
  assets.unshift(assets.splice(1, 1)[0]);
  const moved = buildRows(() => assets, ONSITE_UNIT_DATA_REQ, unitNames);
  assert.deepEqual(moved, ['B-应用1', 'A-应用1', 'C-应用2'],
    `${relative} 上移重要数据行后表4-6 行序未同步`);
}

// ---------- 4. 表4-4 应用归属推断（现场测评对象 → 应用行）----------
for (const relative of ['frontend/src/report-generator.html', 'frontend/public/prototype.html']) {
  const src = await fs.readFile(relative, 'utf8');
  const fnStart = src.indexOf('    const inferOwner = name => {');
  const fnEnd = src.indexOf('    };', fnStart) + 5;
  assert.ok(fnStart > 0 && fnEnd > fnStart, `${relative} 未找到归属推断 inferOwner`);
  // 名称归一化直接复用源码实现，保证与页面一致
  const normStart = src.indexOf('  function impNormName(s) {');
  const normEnd = src.indexOf('  }', normStart) + 3;
  assert.ok(normStart > 0, `${relative} 未找到 impNormName`);
  const build = new Function('apps',
    src.slice(normStart, normEnd) + '    const norm = value => impNormName(value);\n' +
    src.slice(fnStart, fnEnd) + '\n    return inferOwner;');

  const apps = ['浙江文旅大脑应用', '浙江文旅数据仓'];
  const infer = build(apps);
  assert.deepEqual(infer('浙江文旅大脑'), ['浙江文旅大脑应用'], `${relative} 对象简写未归属到完整应用名`);
  assert.deepEqual(infer('浙江文旅大脑应用系统'), ['浙江文旅大脑应用'], `${relative} 对象带后缀未归属到应用`);
  assert.deepEqual(infer('浙江文旅数据仓'), ['浙江文旅数据仓'], `${relative} 精确同名未归属`);
  assert.deepEqual(infer('访问控制信息'), [], `${relative} 与应用无关的通用对象不应被归属`);
  assert.deepEqual(infer('文旅'), ['浙江文旅大脑应用'], `${relative} 多候选取最具体（最长）应用名`);
}

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
