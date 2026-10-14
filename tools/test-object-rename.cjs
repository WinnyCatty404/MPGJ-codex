const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const box = { innerHTML: '' };
const saved = [];
const rows = [
  { key: 'import|1', t: 3, unit: '身份鉴别', desc: '平台，采用密码技术。', analysis: '平台，存在风险。' }
];
const context = vm.createContext({
  document: {
    head: { appendChild() {} },
    createElement: () => ({ textContent: '' }),
    getElementById: id => id === 'object-rename-review' ? box : null
  },
  window: { bbPersistProjectStage: async step => { saved.push(step); } },
  ONSITE_LAYERS: [
    { name: '物理和环境安全', objLayer: 1 },
    { name: '网络和通信安全', objLayer: 2 },
    { name: '设备和计算安全', objLayer: 3 },
    { name: '应用和数据安全', objLayer: 4 }
  ],
  objData: {
    1: [], 2: [{ objectId: 'network', object: '平台' }], 3: [],
    4: [{ objectId: 'app', object: '平台1' }, { objectId: 'other', object: '平台非国密通道' }]
  },
  pendingObjectRenames: [{ objectId: 'app', layer: 4, oldNames: ['平台'], next: '平台1' }],
  onsiteRecords: { 'record|app': { record: '平台，平台非国密通道，平台其他通道。' } },
  locateOnsiteRecordKey: key => key === 'record|app' ? { t: 3, itemIdx: 0, objIdx: 0, unitName: '身份鉴别' } : null,
  getOnsiteUnitObjects: () => ['平台1'],
  reportTexts: { 'report-ua-text-3': '平台，结果符合。', 'report-ua-text-1': '平台，网络描述。' },
  reportRiskStore: {},
  reportImportedRiskRows: [{ key: 'import|1', t: 3, desc: '平台，采用密码技术。', analysis: '平台，存在风险。' }],
  getRiskRows: () => rows.map(row => ({ ...row, ...(context.reportRiskStore[row.key] || {}) })),
  showToast() {}
});
vm.runInContext(fs.readFileSync('frontend/public/object-rename-review.js', 'utf8'), context);
const review = context.window.BBObjectRename;
review.refresh();
assert.match(box.innerHTML, /对象改名待处理/);
assert.match(box.innerHTML, /rename-review-count">5 处/);
review.open();
assert.match(box.innerHTML, /平台非国密通道/);
assert.match(box.innerHTML, /名称嵌在更长文字中/);
assert.match(box.innerHTML, /rename-layer-badge/);
assert.match(box.innerHTML, /rename-mark-before">平台<\/mark>/);
assert.match(box.innerHTML, /rename-mark-after">平台1<\/mark>/);
review.apply();
assert.equal(context.onsiteRecords['record|app'].record, '平台1，平台非国密通道，平台其他通道。');
assert.equal(context.reportTexts['report-ua-text-3'], '平台1，结果符合。');
assert.equal(context.reportTexts['report-ua-text-1'], '平台，网络描述。');
assert.equal(context.reportRiskStore['import|1'].desc, '平台1，采用密码技术。');
assert.equal(context.reportRiskStore['import|1'].analysis, '平台1，存在风险。');
assert.equal(context.reportImportedRiskRows[0].desc, '平台1，采用密码技术。');
assert.equal(context.pendingObjectRenames.length, 1);
review.dismissAll();
assert.equal(context.onsiteRecords['record|app'].record, '平台1，平台非国密通道，平台其他通道。');
assert.equal(context.pendingObjectRenames.length, 0);
context.pendingObjectRenames.push({ objectId: 'app', layer: 4, oldNames: ['平台'], next: '平台1' });
context.onsiteRecords = {};
rows.length = 0;
context.reportTexts = { 'report-overall-3': '平台，原描述。' };
review.refresh();
review.open();
context.reportTexts['report-overall-3'] = '平台，人工新描述。';
review.apply();
assert.equal(context.reportTexts['report-overall-3'], '平台，人工新描述。');
review.dismissAll();
context.pendingObjectRenames.push({ objectId: 'app', layer: 4, oldNames: ['平台'], next: '平台1' });
context.locateOnsiteRecordKey = key => key.startsWith('bulk|') ?
  { t: 3, itemIdx: 0, objIdx: 0, unitName: '身份鉴别' } : null;
context.onsiteRecords = Object.fromEntries(Array.from({ length: 55 }, (_, i) => ['bulk|' + i, { record: '平台，记录。' }]));
rows.length = 0;
context.reportTexts = {};
review.refresh();
review.open();
assert.match(box.innerHTML, /第 1 \/ 2 页/);
review.page(1);
assert.match(box.innerHTML, /第 2 \/ 2 页/);
review.apply();
assert.equal(Object.values(context.onsiteRecords).filter(row => row.record === '平台1，记录。').length, 55);
for (const path of ['frontend/public/prototype.html', 'frontend/src/report-generator.html']) {
  const html = fs.readFileSync(path, 'utf8');
  assert.match(html, /<script src="\/object-rename-review.js"><\/script>/);
  assert.match(html, /data.pendingObjectRenames = clone\(pendingObjectRenames\)/);
  assert.match(html, /finishObjectRename\(\$\{layer\},\$\{idx\}/);
  assert.doesNotMatch(html, /replaceObjectNameReferences/);
}
setImmediate(() => {
  assert.ok(saved.includes(2) && saved.includes(3) && saved.includes(4));
  console.log('PASS: 同层面候选、现场/报告/风险、长名称保护、不确定项、跨层面隔离、不修改、阶段保存');
});
