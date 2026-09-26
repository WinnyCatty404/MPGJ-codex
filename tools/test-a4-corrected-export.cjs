const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../frontend/public/prototype.html'), 'utf8');
const exportStart = html.indexOf('  function collectReportExportContent()');
const sectionStart = html.indexOf('    ONSITE_LAYERS.forEach(function (layer, t) {\n      const groups = [];', exportStart);
const sectionEnd = html.indexOf('    const sections =', sectionStart);
assert.ok(exportStart >= 0 && sectionStart > exportStart && sectionEnd > sectionStart);

const names = ['重要数据传输机密性', '重要数据传输完整性', '重要数据存储完整性'];
const calls = [];
const context = vm.createContext({
  ONSITE_LAYERS: Array.from({ length: 8 }, (_, index) => ({ name: index === 3 ? '应用和数据安全' : `层面${index}` })),
  evaluationIndicatorLevels: Array.from({ length: 8 }, (_, index) => ({ items: index === 3 ? names.map(name => ({ name })) : [] })),
  REPORT_FIX_UNITS: names.slice(0, 2),
  isOnsiteUnitApplicable: () => true,
  getOnsiteUnitObjects: () => ['对象甲', '对象乙'],
  getOnsiteRec: () => ({ record: '现场记录', D: '√', A: '√', K: '√' }),
  getReportUnitScore: (_layer, item) => { calls.push(`corrected-unit-${item}`); return item === 0 ? 0.75 : 0.625; },
  getRawUnitScore: (_layer, item) => { calls.push(`raw-unit-${item}`); return 0.25; },
  getReportObjectScore: (_layer, item, object, applyFix) => { calls.push(`corrected-object-${item}-${object}-${applyFix}`); return object === 0 ? 0.5 : 1; },
  calcOnsiteRowScore: () => 0.25,
  calcOnsiteMgmtRowScore: () => 0.25,
  document: { getElementById: () => null },
  tables: []
});
vm.runInContext(html.slice(sectionStart, sectionEnd), context);
const a4 = context.tables.find(table => table.caption === '应用和数据安全测评结果记录');
assert.ok(a4);
assert.equal(a4.groups[0].rows[0][6], '0.5000');
assert.equal(a4.groups[0].rows[0][7], '0.7500');
assert.equal(a4.groups[1].rows[1][6], '1.0000');
assert.equal(a4.groups[1].rows[1][7], '0.6250');
assert.equal(a4.groups[2].rows[0][6], '0.2500');
assert.equal(a4.groups[2].rows[0][7], '0.2500');
assert.ok(calls.includes('corrected-object-0-0-true'));
assert.ok(calls.includes('corrected-object-1-1-true'));
assert.ok(!calls.some(call => call.startsWith('corrected-object-2')));
console.log('PASS: A-4 transport object and unit scores use corrected results; other units remain raw.');
