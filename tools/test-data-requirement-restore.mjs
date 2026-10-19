import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const defaults = ['传输机密性', '存储机密性', '传输完整性', '存储完整性'];

for (const file of ['frontend/public/prototype.html', 'frontend/src/report-generator.html']) {
  const html = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    if (match[1].trim()) new Function(match[1]);
  }
  function slice(start, end) {
    const first = html.indexOf(start);
    const last = html.indexOf(end, first);
    assert.ok(first >= 0 && last > first, file + ' 缺少安全需求相关逻辑：' + start);
    return html.slice(first, last);
  }

  const marks = [];
  const context = vm.createContext({
    onsiteEsc: value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;'),
    window: { bbMarkProjectDirty: (...args) => marks.push(args) },
    assetTypes: ['data'],
    captureRowValues: tbody => tbody ? tbody.rows.map(() => []) : [],
    fillRowValues() {},
    newAssetRowId: () => 'test-asset-id',
  });
  vm.runInContext(slice('  const DATA_REQ_DEFAULTS =', '  // Word 单元格中的安全需求'), context);
  vm.runInContext(slice('  function removeDataReq(', '  function updateCryptoLayerUi('), context);

  class MockCell {
    constructor(requirements) { this.innerHTML = vm.runInContext(`getDataReqChips(${JSON.stringify(requirements)})`, context); }
    set innerHTML(value) {
      this.markup = value;
      this.chips = [...value.matchAll(/<span class="req-chip" data-req="([^"]+)"/g)].map(match => ({
        getAttribute: () => match[1],
        closest: selector => selector === '.req-cell' ? this : null,
      }));
    }
    get innerHTML() { return this.markup; }
    querySelectorAll(selector) { return selector === '.req-chip' ? this.chips : []; }
    names() { return this.chips.map(chip => chip.getAttribute('data-req')); }
    options() { return [...this.markup.matchAll(/<button type="button" data-req="([^"]+)"/g)].map(match => match[1]); }
  }
  const cells = [new MockCell(defaults), new MockCell(['存储完整性', '自定义要求'])];
  const rows = cells.map((cell, index) => ({
    dataset: { assetId: 'data-' + index },
    cells: [null, { querySelector: () => ({ value: index ? '日志数据' : '个人信息' }) }, null,
      { querySelector: () => ({ value: '业务平台' }) }, null, cell],
    querySelectorAll: selector => cell.querySelectorAll(selector),
  }));
  const body = { rows, children: rows };
  context.document = { getElementById: id => id === 'asset-tbody-data' ? body : null };
  vm.runInContext(slice('  const ONSITE_UNIT_DATA_REQ =', '  function getOnsiteUnitObjectEntries('), context);
  vm.runInContext(slice('  function captureAssets()', '  function snapshot(step)'), context);
  const call = expression => vm.runInContext(expression, context);
  const onsite = unit => Array.from(call(`getOnsiteUnitObjects(3, ${JSON.stringify(unit)})`));
  const remove = (cell, index) => {
    const chip = cell.chips[index];
    assert.ok(chip);
    call('removeDataReq')({ closest: selector => selector === '.req-chip' ? chip : null });
  };
  const add = (cell, name) => call('addDataReq')({
    closest: selector => selector === '.req-cell' ? cell : null,
    getAttribute: () => name,
  });

  assert.deepEqual(cells[0].options(), [], file + ' 全部需求存在时不应显示添加入口');
  assert.deepEqual(onsite('重要数据传输机密性'), ['个人信息-业务平台']);
  remove(cells[0], 0);
  assert.deepEqual(cells[0].options(), ['传输机密性']);
  assert.deepEqual(onsite('重要数据传输机密性'), []);
  assert.deepEqual(cells[1].names(), ['存储完整性', '自定义要求'], file + ' 删除不得影响其他行');
  assert.deepEqual(marks.at(-1), [2, true, 350], file + ' 删除应触发第二步自动保存');
  add(cells[0], '传输机密性');
  assert.deepEqual(onsite('重要数据传输机密性'), ['个人信息-业务平台']);
  assert.deepEqual(cells[0].options(), []);
  const markCount = marks.length;
  add(cells[0], '传输机密性');
  add(cells[0], '非法需求');
  assert.equal(marks.length, markCount, file + ' 重复或非法添加不应保存');
  assert.equal(cells[0].names().filter(name => name === '传输机密性').length, 1);

  while (cells[0].chips.length) remove(cells[0], 0);
  assert.deepEqual(cells[0].options(), defaults, file + ' 全部删除后应提供四项标准需求');
  add(cells[0], '存储机密性');
  add(cells[0], '传输完整性');
  const saved = call('captureAssets()');
  assert.deepEqual(JSON.parse(JSON.stringify(saved.dataRequirements)), [
    ['存储机密性', '传输完整性'], ['存储完整性', '自定义要求'],
  ]);
  cells[0].innerHTML = call('getDataReqChips([])');
  cells[1].innerHTML = call('getDataReqChips([])');
  call('restoreAssets')(saved);
  assert.deepEqual(cells[0].names(), ['存储机密性', '传输完整性'], file + ' 刷新恢复丢失第一行需求');
  assert.deepEqual(cells[1].names(), ['存储完整性', '自定义要求'], file + ' 刷新恢复丢失第二行需求');
  assert.deepEqual(onsite('重要数据传输完整性'), ['个人信息-业务平台']);
  assert.deepEqual(onsite('重要数据存储完整性'), ['日志数据-业务平台']);
  add(cells[0], '传输机密性');
  add(cells[0], '存储完整性');
  assert.deepEqual(cells[0].options(), []);
  assert.deepEqual(cells[1].options(), ['传输机密性', '存储机密性', '传输完整性']);
  assert.ok(marks.every(args => args[0] === 2), file + ' 添加和删除只能保存第二步');
  assert.doesNotMatch(cells[0].innerHTML, /<select\b/, file + ' 添加入口不得改变资产行快照控件顺序');
}

console.log('PASS: 安全需求逐项恢复、全部删空、去重、行间隔离、快照恢复和现场测评映射。');
