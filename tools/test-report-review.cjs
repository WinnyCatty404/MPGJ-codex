const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync('frontend/public/report-review-engine.js', 'utf8'), context);
const engine = context.BBReportReviewEngine;
const object = (name, extra = {}) => ({ key: name, name, layer: 2, unit: '身份鉴别', applicable: true,
  record: name + '采用TLS1.2和AES128。', result: '符合', ...extra });
function run(objects, text, extra = {}) {
  return engine.analyze({ objects, units: [], serverNames: objects.map(o => o.name), databaseNames: [], dataCount: 0,
    targets: [{ id: 'test', layer: 2, section: 4, text, manual: true, coverage: 'all' }], ...extra });
}
assert.equal(run([object('A服务器'), object('B服务器'), object('C服务器')], '服务器采用TLS1.2。').filter(f => f.rule === 'C29').length, 0);
assert.equal(run([object('A服务器'), object('B服务器')], '服务器。').filter(f => f.rule === 'C29').length, 2);
assert.equal(run([object('A服务器'), object('B服务器'), object('C服务器')], 'A服务器、B服务器。').filter(f => f.rule === 'C29').length, 1);
assert.equal(run([object('数据库A'), object('数据库B'), object('数据库C')], '数据库。', { serverNames: [], databaseNames: ['数据库A', '数据库B', '数据库C'] }).filter(f => f.rule === 'C29').length, 0);
assert.equal(run([object('A服务器')], 'A服务器使用TLSv1.3、AES256。').filter(f => ['C06','C07'].includes(f.rule)).length, 2);
assert.equal(run([object('A服务器')], 'A服务器使用TLSv1.2、AES_128_GCM。').filter(f => ['C06','C07'].includes(f.rule)).length, 0);
assert.equal(run([object('A服务器'), object('B服务器',{record:'B服务器采用AES256。'})], 'A服务器采用AES128。B服务器采用AES256。').filter(f => f.rule === 'C07').length, 0);
assert.equal(run([object('A服务器',{result:'不符合'}), object('B服务器'), object('C服务器')], '服务器均符合。').filter(f => f.rule === 'C30').length, 1);
const data = [object('手机号',{layer:3,isData:true}),object('口令',{layer:3,isData:true}),object('业务数据',{layer:3,isData:true})];
const target = { id:'data',layer:3,section:4,text:'重要数据。',manual:true,coverage:'all' };
assert.equal(engine.analyze({objects:data,units:[],serverNames:[],databaseNames:[],dataCount:3,targets:[target]}).filter(f=>f.rule==='C29').length,0);
assert.equal(engine.analyze({objects:data,units:[],serverNames:[],databaseNames:[],dataCount:2,targets:[target]}).filter(f=>f.rule==='C29').length,3);
assert.equal(engine.analyze({objects:[object('A服务器')],units:[],serverNames:[],databaseNames:[],dataCount:0,targets:[{id:'auto',layer:2,text:'',manual:false,coverage:'all'}]}).length,0);
const unitInput = {objects:[object('A服务器',{result:'不符合'})],units:[{layer:2,name:'身份鉴别',result:'不符合'}],serverNames:[],databaseNames:[],dataCount:0,
  targets:[{id:'unit',layer:2,section:0,text:'身份鉴别测评指标中，A服务器采用口令。故该指标部分符合。',manual:true,coverage:'all'}]};
assert.equal(engine.analyze(unitInput).filter(f=>f.rule==='C03').length,1);
for(const path of ['frontend/public/prototype.html','frontend/src/report-generator.html']) {
  const html=fs.readFileSync(path,'utf8');
  for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) if(match[1].trim()) new vm.Script(match[1]);
  assert(html.includes('report-panel-7')); assert(html.includes('data.reportReview = clone(reportReviewState)'));
  assert(html.includes('src="/report-review.js"'));
}
new vm.Script(fs.readFileSync('frontend/public/report-review.js','utf8'));
console.log('PASS: 合并阈值、遗漏对象、重要数据计数、参数差异、结论差异、自动字段边界、两份页面脚本语法');
// 页签适配集成：审核/状态保存/定位/局部复核后状态失效。
async function integration() {
  let saves=0, located=0;
  const panel={innerHTML:'',querySelectorAll:()=>[]};
  const sandbox={console, setTimeout, document:{head:{appendChild(){}},createElement:()=>({}),getElementById:id=>id==='report-panel-7'?panel:null},
    onsiteEsc:s=>String(s).replace(/</g,'&lt;'),ONSITE_LAYERS:Array.from({length:8},(_,i)=>({name:'层面'+i})),
    evaluationIndicatorLevels:Array.from({length:8},(_,i)=>({items:i===2?[{name:'身份鉴别'}]:[]})),objData:{},
    getOnsiteObjectEntries:t=>t===2?[{id:'obj',name:'A服务器'}]:[],getOnsiteUnitObjectEntries:t=>t===2?[{id:'obj',name:'A服务器'}]:[],
    getOnsiteRec:()=>({record:'A服务器采用TLS1.2。'}),getObjectCls:()=> '部分符合',getRawUnitScore:()=>0.25,reportClassify:()=> '部分符合',
    isOnsiteUnitApplicable:()=>true,onsiteKey:()=> 'ind|obj',ONSITE_UNIT_DATA_REQ:{},reportTexts:{'report-overall-2':'A服务器采用TLS1.3。'},
    buildLayerAnalysisText:()=>'',buildLayerOverallText:()=>'',buildSugProblemText:()=>'',buildSugAdviceText:()=>'',buildConclusionSentence:()=>'',
    getReportTextVal:(id,auto)=>sandbox.reportTexts[id]??auto,getRiskRows:()=>[],reportRiskStore:{},reportFixes:{},
    switchReportTab:()=>sandbox.renderReportReview(),showToast(){},switchStep(){},switchOnsiteTab(){},expandOnsiteRecord:()=>located++,
    bbPersistProjectStage:async()=>saves++};
  sandbox.window=sandbox;
  const ctx=vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('frontend/public/report-review-engine.js','utf8'),ctx);
  vm.runInContext(fs.readFileSync('frontend/public/report-review.js','utf8'),ctx);
  await sandbox.runReportReview(null);
  assert(panel.innerHTML.includes('TLS版本可能不一致'));
  const get=()=>vm.runInContext('reportReviewState',ctx);
  const finding=get().findings[0];
  await sandbox.setReviewStatus(finding.id,'合理差异');
  assert.equal(get().findings[0].status,'合理差异'); assert(saves>=2);
  sandbox.locateReviewSource(finding.id);assert.equal(located,1);
  await sandbox.runReportReview(4);assert.equal(get().findings[0].status,'合理差异');
  sandbox.reportTexts['report-overall-2']='A服务器采用TLS1.2。';
  await sandbox.runReportReview(4);assert.equal(get().findings.length,0);
  console.log('PASS: 审核页对照、阶段保存、处理状态、现场定位、局部复核更新');
}
integration().catch(error=>{console.error(error);process.exitCode=1;});
