const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../frontend/public/prototype.html'), 'utf8');
const start = html.indexOf('  const PERSON_ASSET_DEFAULTS =');
const end = html.indexOf('  // 新增、导入和历史数据恢复均保留控件顺序及原有属性。', start);
assert.ok(start >= 0 && end > start);
const context = vm.createContext({});
vm.runInContext(html.slice(start, end), context);

const expected = [
  ['密钥管理员', '负责系统密钥管理'],
  ['密钥管理员', '负责系统密钥管理'],
  ['安全审计员', '负责系统安全操作相关审计'],
  ['安全审计员', '负责系统安全操作相关审计'],
  ['密码操作员', '负责执行密码相关操作'],
  ['密码操作员', '负责执行密码相关操作']
];
for (let index = 1; index <= 6; index++) {
  const row = vm.runInContext(`getAssetRowHtml('person', ${index})`, context);
  for (const value of expected[index - 1]) assert.ok(row.includes(`value="${value}" readonly`));
  assert.equal((row.match(/person-fixed/g) || []).length, 2);
}
const extra = vm.runInContext("getAssetRowHtml('person', 7)", context);
assert.equal((extra.match(/person-fixed/g) || []).length, 0);

const rows = [];
const tbody = {
  get children() { return rows; },
  get rows() { return rows; },
  insertAdjacentHTML(_where, rowHtml) {
    const fields = [...rowHtml.matchAll(/<input\b([^>]*)>/g)].map((match) => ({
      value: /value="([^"]*)"/.exec(match[1])?.[1] || '',
      readOnly: /\breadonly\b/.test(match[1]),
      classList: { add() {} }
    }));
    rows.push({ cells: [null, ...fields.map((field) => ({ querySelector: () => field }))] });
  }
};
context.document = { getElementById: (id) => id === 'asset-tbody-person' ? tbody : null };
const normalizeStart = html.indexOf('  function normalizePersonAssetRows()');
const normalizeEnd = html.indexOf('  function addAssetRow(', normalizeStart);
vm.runInContext(html.slice(normalizeStart, normalizeEnd), context);
tbody.insertAdjacentHTML('beforeend', vm.runInContext("getAssetRowHtml('person', 1)", context));
tbody.insertAdjacentHTML('beforeend', vm.runInContext("getAssetRowHtml('person', 2)", context));
rows[0].cells[1].querySelector().value = '张三';
rows[0].cells[2].querySelector().value = '来自旧报告的岗位';
rows[0].cells[4].querySelector().value = '13800000000';
vm.runInContext('normalizePersonAssetRows()', context);
assert.equal(rows.length, 6);
assert.equal(rows[0].cells[1].querySelector().value, '张三');
assert.equal(rows[0].cells[4].querySelector().value, '13800000000');
for (let index = 0; index < 6; index++) {
  for (let offset = 0; offset < 2; offset++) {
    const field = rows[index].cells[offset + 2].querySelector();
    assert.equal(field.value, expected[index][offset]);
    assert.equal(field.readOnly, true);
  }
}
console.log('PASS: 人员六行默认值、只读列及已有姓名和联系方式保留');
