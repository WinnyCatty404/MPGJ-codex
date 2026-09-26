const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const html = fs.readFileSync(require('node:path').join(__dirname, '../frontend/public/prototype.html'), 'utf8');
const slice = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));
(async () => {
  const zip = await JSZip.loadAsync(fs.readFileSync(process.argv[2]));
  const c = vm.createContext({ console, document: { getElementById: () => null }, sec: x => x, add: (...x) => console.log(x.slice(1).join(' ')), dataRows210: [], onsiteRecords: {}, onsiteImportedObjects: {} });
  vm.runInContext(slice('  function _impXmlUnescape(', '  // 标题级别：'), c);
  c.blocks = c._impExtractBlocks(await zip.file('word/document.xml').async('string'));
  vm.runInContext(slice('  let _impLvlMap =', '  // ===== 导入工具函数'), c);
  c._impBuildLvlMap(await zip.file('word/styles.xml').async('string'));
  vm.runInContext(slice('    function grabZone(name)', '    function setEl('), c);
  for (const name of ['承载的业务情况', '网络拓扑图及描述']) {
    const paragraphs = c.grabZone(name);
    assert.ok(paragraphs.length > 0, name);
    console.log(`${name}: ${paragraphs.length} paragraphs (${paragraphs.join('\n').length} characters)`);
  }
  vm.runInContext(slice('  const evaluationIndicatorLevels =', '  function renderIndicatorTables('), c);
  vm.runInContext(slice('  const ONSITE_LAYERS =', '  function onsiteEsc('), c);
  vm.runInContext(slice('  function onsiteKey(', '  // 读取本层面对象列表'), c);
  vm.runInContext(slice('  const ONSITE_UNIT_DATA_REQ =', '  function getOnsiteUnitObjects('), c);
  vm.runInContext(slice('  function impNormName(', '  let importTargetProjectId'), c);
  vm.runInContext(slice('    let lastCap =', '    // ============ 1. 被测单位'), c);
  const basicTable = vm.runInContext("findT(/^被测信息系统基本信息表$/)", c);
  const cloudRow = basicTable.rows.find(row => row.some(cell => String(cell).includes('系统是否依赖不在本系统范围内的云平台运行')));
  assert.ok(cloudRow, '应找到云平台合并单元格行');
  const cloudText = cloudRow.join('\n');
  assert.match(cloudText, /云平台名称[：:]\s*华通杭州市政务专用云平台/);
  assert.match(cloudText, /密评机构名称[：:]\s*浙江东安检测技术有限公司/);
  assert.match(cloudText, /评估时间[：:]\s*2022年12月23日/);
  assert.match(cloudText, /评估结论[：:]\s*基本符合/);
  console.log('Cloud platform import: merged-cell name, status, organization, date and conclusion source located');
  const assetBodies = {};
  for (const type of ['env','security','crypto','server','network','db','app','doc','person']) {
    assetBodies[type] = { innerHTML: '', insertAdjacentHTML(_, value) { this.innerHTML += value; } };
  }
  c.assetTypeNames = Object.fromEntries(Object.keys(assetBodies).map(type => [type, type]));
  c.getAssetRowHtml = () => '';
  c.onsiteEsc = value => String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  c.s2 = 'assets';
  c.document.getElementById = id => id.startsWith('asset-tbody-') ? assetBodies[id.slice('asset-tbody-'.length)] : null;
  vm.runInContext(slice('    const ASSET_MAP = [', '    // 应用用户（表4-5'), c);
  const cryptoRows = [...assetBodies.crypto.innerHTML.matchAll(/<tr>(.*?)<\/tr>/g)];
  assert.equal(cryptoRows.length, 3);
  cryptoRows.forEach(row => assert.equal((row[1].match(/type="text"/g) || []).length, 6, '密码产品必须映射6个源数据列'));
  const docRows = [...assetBodies.doc.innerHTML.matchAll(/<tr>(.*?)<\/tr>/g)];
  assert.equal(docRows.length, 10);
  docRows.forEach(row => {
    assert.equal((row[1].match(/type="text"/g) || []).length, 2);
    assert.ok(!/type="checkbox"/.test(row[1]), '安全管理文档不应有是否测评列');
  });
  console.log('Asset import: password products mapped to 6 columns; management documents mapped to 2 columns without checkbox');
  const assetTable = vm.runInContext("findTN('重要数据')", c);
  c.dataRows210 = assetTable.rows.slice(1).filter(r => r[1]).map(r => ({ data:r[1].trim(),desc:r[2].trim(),app:r[3].trim(),pos:r[4].trim(),reqs:r[5].trim() }));
  c.DATA_REQ_DEFAULTS = ['传输机密性','存储机密性','传输完整性','存储完整性'];
  c.onsiteEsc = value => String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const assetBody = { innerHTML: '', insertAdjacentHTML(_, html) { this.innerHTML += html; } };
  c.document.getElementById = id => id === 'asset-tbody-data' ? assetBody : null;
  vm.runInContext(slice("    const s3 = sec('步骤3", "    add(s3, '证据截图不导入"), c);
  const assetRows = [...assetBody.innerHTML.matchAll(/<tr>(.*?)<\/tr>/g)];
  assert.equal(assetRows.length, c.dataRows210.length);
  assetRows.forEach((row, i) => {
    const values = [...row[1].matchAll(/value="([^"]*)"/g)].map(m => m[1]);
    assert.deepEqual(values, ['data','desc','app','pos'].map(key => c.onsiteEsc(c.dataRows210[i][key])));
  });
  console.log(`Important data: ${assetRows.length} rows including application verified against source`);
  const result = vm.runInContext('({ records: onsiteRecords, objects: onsiteImportedObjects, layers: ONSITE_LAYERS, levels: evaluationIndicatorLevels, pairs: aUnitPairs, find: findAppendixTable })', c);
  c.getOnsiteUnitObjects = (t, name) => result.objects[t + '|' + name] || [];
  vm.runInContext(slice('  function buildUaObjectRows(', '  function renderReportUnitAnalysis('), c);
  const units = result.levels[6].items.map((item, itemIdx) => ({item,itemIdx}));
  const summaryRows = c.buildUaObjectRows(6, units);
  assert.equal(summaryRows.length, 2, 'Construction summary should have two object groups');
  for (const row of summaryRows) assert.equal(Object.keys(row.positions).length, units.length);
  assert.notEqual(summaryRows[0].positions[3], summaryRows[1].positions[3]);
  console.log('Construction summary: 2 rows, all 10 source result positions retained');
  c.reportRiskStore = {};
  c.reportImportedRiskRows = [];
  c.getRawUnitScore = () => 0;
  c.reportClassify = () => '不符合';
  c.defaultThreatFor = () => '';
  c.appendixBData = {};
  c.apbFormatDate = value => String(value || '');
  c.s4 = 'risk';
  vm.runInContext(slice("    const riskT = findTN('风险分析');", '    // 单元测评·结果分析'), c);
  const riskRows = vm.runInContext("findTN('风险分析').rows.filter(r => /^\\d+$/.test(r[0]))", c);
  let lastRiskLayer = '';
  riskRows.forEach(row => {
    if (row[1]) lastRiskLayer = row[1];
    const importedLayer = c.impNormName(lastRiskLayer).replace(/层面$/, '');
    const layerIndex = result.layers.findIndex(layer => c.impNormName(layer.name).replace(/层面$/, '') === importedLayer);
    const separator = row[2].search(/[：:]/);
    const unitText = separator > 0 ? row[2].slice(0, separator) : row[2];
    if (layerIndex < 0 || c.impMatchUnitItem(layerIndex, unitText) < 0) console.log('UNMATCHED RISK:', lastRiskLayer, unitText);
  });
  riskRows.forEach(row => {
    const separator = row[2].search(/[：:]/);
    const desc = separator > 0 ? row[2].slice(separator + 1).trim() : row[2].trim();
    if (!c.reportImportedRiskRows.some(imported => imported.desc === desc)) console.log('MISSING IMPORTED RISK DESC:', row[1], row[2]);
  });
  assert.equal(c.reportImportedRiskRows.length, riskRows.length, 'Every source risk row must remain independent');
  riskRows.forEach((row, i) => {
    const separator = row[2].search(/[：:]/);
    assert.equal(c.reportImportedRiskRows[i].desc, row[2].slice(separator + 1).trim());
    assert.equal(c.reportImportedRiskRows[i].analysis, row[4].trim());
    assert.equal(c.reportImportedRiskRows[i].threat, row[3].trim());
  });
  console.log(`Risk import: ${riskRows.length} independent source rows verified`);
  let checked = 0;
  for (let t = 0; t < 8; t++) {
    const table = result.find(t);
    assert.ok(table, `Missing appendix ${t + 1}`);
    const counts = {};
    for (const p of result.pairs(table)) {
      const unit = c.impMatchUnitItem(t, p.unit);
      assert.ok(unit >= 0, p.unit);
      const name = result.levels[t].items[unit].name;
      const index = counts[unit] || 0;
      counts[unit] = index + 1;
      assert.equal(result.objects[t + '|' + name][index], p.obj);
      const record = result.records[t + '|' + unit + '|' + index];
      assert.equal(record.record, p.record);
      if (t < 4) for (const [field, value] of [['D',p.c3],['A',p.c4],['K',p.c5]]) assert.equal(record[field], c.impDak(value));
      else assert.equal(record.result, c.impMgmtResult(p.c3));
      checked++;
    }
  }
  assert.equal(Object.keys(result.records).length, checked, 'No row overwritten');
  const names = ['重要个人信息（团队管理）', '重要个人信息（嗨游小程序）', '重要业务数据（嗨游小程序）'];
  names.forEach((name, i) => assert.equal(c.impMatchObjIdx(names, name), i));
  assert.equal(c.impMatchObjIdx(names, '重要个人信息'), -1);
  assert.equal(c.impMatchObjIdx(['相同名称', '相同名称'], '相同名称'), -1);
  const restored = JSON.parse(JSON.stringify({ onsiteRecords: result.records, onsiteImportedObjects: result.objects }));
  assert.equal(Object.keys(restored.onsiteRecords).length, checked);
  console.log(`PASS: ${checked} source rows individually compared (object, record, D/A/K or result); zero overwrites; snapshot JSON round-trip passed.`);
})().catch(e => { console.error(e); process.exitCode = 1; });
