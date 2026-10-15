const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname, '../frontend/public/asset-bulk-paste.js'), 'utf8');
const context = { module: { exports: {} } };
vm.runInNewContext(script, context);
const { schemas, parseGrid, isExcelGrid, prepare, appendRecords, onPaste } = context.module.exports;

const grid = parseGrid('设备名称\t用途\n"服务器\n甲"\t"运行""核心""业务"\n服务器乙\t备份\n');
assert.deepEqual(JSON.parse(JSON.stringify(grid)), [['设备名称', '用途'], ['服务器\n甲', '运行"核心"业务'], ['服务器乙', '备份']]);
assert.equal(isExcelGrid('一行\n两行', '', parseGrid('一行\n两行')), false, '单格多段文字保持原生粘贴');
assert.equal(isExcelGrid('一行\n两行', '<table><tr><td>一行</td></tr><tr><td>两行</td></tr></table>', parseGrid('一行\n两行')), true);
assert.equal(isExcelGrid('一格', '<table><tr><td>一格</td></tr></table>', parseGrid('一格')), false);

const full = prepare('server', '序号\t设备名称\t生产厂商\t型号\t操作系统版本\t是否为虚拟设备\t用途\t数量\t重要程度\t是否测评\n1\t服务器甲\t厂商甲\tM1\tLinux\t否\t业务\t2\t高\t是\n2\t服务器乙\t厂商乙\tM2\tLinux\t是\t备份\t1\t中\t否');
assert.equal(full.records.length, 2);
assert.equal(full.records[0].name, '服务器甲');
assert.equal(full.records[0].assessed, true);
assert.equal(full.records[1].assessed, false);
assert.equal(full.records[1].quantity, '1');

const partial = prepare('network', '用途\t设备名称\n边界防护\t防火墙甲\n访问控制\t防火墙乙');
assert.equal(partial.records[0].name, '防火墙甲');
assert.equal(partial.records[0].purpose, '边界防护');
assert.equal(partial.records[0].assessed, false);

const positional = prepare('db', '数据库甲\tV1\t机房\n数据库乙\tV2\t云平台');
assert.equal(positional.records[1].name, '数据库乙');
assert.equal(positional.records[1].location, '云平台');
assert.equal(positional.records[1].importance, '');

const serials = prepare('app', '1\t平台甲\t1.0\n2\t平台乙\t2.0');
assert.equal(serials.records[0].name, '平台甲');
assert.equal(serials.records[1].version, '2.0');

const data = prepare('data', '数据\t数据描述\t安全需求\n订单数据\t订单和支付信息\t传输机密性、存储完整性');
assert.equal(data.records[0].description, '订单和支付信息');
assert.equal(data.records[0].requirements, '传输机密性、存储完整性');
const personnel = prepare('person', '姓名\t岗位/角色\t职责说明\t联系方式\n张三\t管理员\t管理系统\t13800000000');
assert.equal(personnel.records[0].role, '管理员');
const appUsers = prepare('appUser', '应用用户名称\t所属应用\n平台管理员\t平台甲');
assert.equal(appUsers.records[0].application, '平台甲');

for (const type of Object.keys(schemas)) {
  const title = schemas[type][0].headers[0];
  assert.equal(prepare(type, title + '\n新对象').records[0].name, '新对象', type + ' 支持 Excel 单列多行');
}
assert.throws(() => prepare('server', '设备名称\t未知列\t型号\n服务器甲\tX\tM1'), /表头列无法识别/);
assert.throws(() => prepare('server', '设备名称\t内部编号\n服务器甲\tA01'), /表头列无法识别/);
assert.throws(() => prepare('app', '应用名称\t是否测评\n平台甲\t不确定'), /是否测评.*无法识别/);
assert.throws(() => prepare('doc', '文档甲\t内容甲\t额外值'), /列数多于/);
assert.throws(() => prepare('db', '数据库管理系统名称\t版本\n\tV1'), /缺少名称/);

const events = [];
const messages = [];
let activeTable;
function mockRow(type) {
  const cells = [{ textContent: '' }];
  for (const column of schemas[type]) {
    const editor = column.key === 'requirements' ? null : { value: '', checked: false };
    cells.push({ editor, innerHTML: '', querySelector: () => editor });
  }
  return {
    cells,
    querySelectorAll(selector) {
      return selector.includes('checkbox')
        ? (type === 'appUser' ? [] : cells.filter((cell, index) => index && schemas[type][index - 1].key === 'assessed').map(cell => cell.editor))
        : cells.filter((cell, index) => index && schemas[type][index - 1].key !== 'assessed' && schemas[type][index - 1].key !== 'requirements').map(cell => cell.editor);
    },
    replaceWith(next) {
      const index = this.parent.rows.indexOf(this);
      this.parent.rows[index] = next;
      next.parent = this.parent;
    }
  };
}
function mockTable(type, initialNames) {
  const table = { rows: [], appendChild(row) { row.parent = this; this.rows.push(row); } };
  initialNames.forEach(name => {
    const row = mockRow(type);
    row.cells[1].editor.value = name;
    table.appendChild(row);
  });
  return table;
}
context.document = {
  createElement() {
    return {
      set innerHTML(markup) { this.firstElementChild = mockRow(JSON.parse(markup).type); }
    };
  },
  dispatchEvent(event) { events.push(event.type); }
};
context.Event = class { constructor(type) { this.type = type; } };
context.getAssetRowHtml = type => JSON.stringify({ type });
context.getAppUserRowHtml = () => JSON.stringify({ type: 'appUser' });
context.getDataReqChips = requirements => requirements.join('|');
context.parseImportedDataReqs = value => String(value).split('、').filter(Boolean);
context.renumberAssetRows = () => activeTable.rows.forEach((row, index) => { row.cells[0].textContent = index + 1; });
context.enhanceAssetEditors = () => {};
context.showToast = message => messages.push(message);

activeTable = mockTable('server', ['已有服务器']);
appendRecords('server', activeTable, full.records);
assert.equal(activeTable.rows.length, 3);
assert.equal(activeTable.rows[0].cells[1].editor.value, '已有服务器', '已有资产不覆盖');
assert.equal(activeTable.rows[1].cells[1].editor.value, '服务器甲');
assert.equal(activeTable.rows[1].cells[9].editor.checked, true);
assert.equal(activeTable.rows[2].cells[0].textContent, 3);

activeTable = mockTable('data', ['']);
appendRecords('data', activeTable, data.records);
assert.equal(activeTable.rows.length, 1, '复用默认空白行');
assert.equal(activeTable.rows[0].cells[5].innerHTML, '传输机密性|存储完整性');

activeTable = mockTable('person', Array(6).fill(''));
activeTable.rows.forEach((row, index) => { row.cells[2].editor.value = '固定岗位' + index; });
appendRecords('person', activeTable, personnel.records);
assert.equal(activeTable.rows.length, 7, '人员固定六行不被替换');
assert.equal(activeTable.rows[0].cells[2].editor.value, '固定岗位0');
assert.equal(activeTable.rows[6].cells[1].editor.value, '张三');

activeTable = mockTable('appUser', ['']);
appendRecords('appUser', activeTable, appUsers.records);
assert.equal(activeTable.rows.length, 1);
assert.equal(activeTable.rows[0].cells[2].editor.value, '平台甲');
assert.equal(events.length, 4, '每次成功粘贴都触发已有自动保存事件');
assert.match(messages.at(-1), /已追加 1 条应用用户/);

function pasteEvent(table, type, text, html = '') {
  table.id = type === 'appUser' ? 'app-user-tbody' : 'asset-tbody-' + type;
  const target = {
    closest(selector) { return selector === 'tbody' ? table : this; },
    readOnly: false,
    disabled: false
  };
  return {
    target,
    clipboardData: { getData(format) { return format === 'text/plain' ? text : html; } },
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; }
  };
}
activeTable = mockTable('app', ['已有应用']);
let event = pasteEvent(activeTable, 'app', '应用名称\t版本\n新平台\tV1');
onPaste(event);
assert.equal(event.prevented, true);
assert.equal(activeTable.rows.length, 2);
assert.equal(activeTable.rows[0].cells[1].editor.value, '已有应用');

event = pasteEvent(activeTable, 'app', '普通单格内容');
onPaste(event);
assert.equal(event.prevented, false, '单格文字由浏览器正常粘贴');
assert.equal(activeTable.rows.length, 2);

event = pasteEvent(activeTable, 'app', '应用名称\t未知列\n错误行\t值');
onPaste(event);
assert.equal(event.prevented, true);
assert.equal(activeTable.rows.length, 2, '坏表头整批拒绝，不留下半行');

activeTable = mockTable('doc', ['']);
event = pasteEvent(activeTable, 'doc', '文档甲\n文档乙', '<table><tr><td>文档甲</td></tr><tr><td>文档乙</td></tr></table>');
onPaste(event);
assert.equal(activeTable.rows.length, 2, 'Excel 单列多行追加');
assert.equal(activeTable.rows[1].cells[1].editor.value, '文档乙');

for (const page of ['frontend/public/prototype.html', 'frontend/src/report-generator.html']) {
  const source = fs.readFileSync(path.join(__dirname, '..', page), 'utf8');
  assert.match(source, /<script src="\/asset-bulk-paste\.js"><\/script>/);
  assert.match(source, /从 Excel 复制多行单元格/);
  assert.match(source, /function captureAssets\(\)/, '继续使用现有资产快照保存');
}
console.log('PASS: Excel 剪贴板解析、全资产分类列映射、特殊字段与页面接入');
