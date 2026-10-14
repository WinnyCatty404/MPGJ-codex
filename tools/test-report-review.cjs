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
for (const section of [2, 5]) {
  assert.equal(engine.analyze({objects:[object('A服务器')],units:[],serverNames:[],databaseNames:[],dataCount:0,
    targets:[{id:'excluded-' + section,layer:2,section,text:'遗漏对象且TLS1.3。',manual:true,coverage:'all'}]}).length,0);
}
function reviewProblems(objects, text, problemUnits = [{item:0,name:'身份鉴别'}], extra = {}) {
  return engine.analyze({objects,units:[],serverNames:objects.map(o=>o.name),databaseNames:[],dataCount:0,
    targets:[{id:'report-sug-prob-2',layer:2,section:5,text,manual:true,coverage:'problems',problemUnits}],...extra});
}
const low = object('A服务器',{item:0,rawScore:0.5});
assert.equal(reviewProblems([low],'1）身份鉴别：A服务器密码应用存在不足。').length,0);
assert.equal(reviewProblems([low],'1）身份鉴别：存在密码应用不足。').filter(f=>f.rule==='C31').length,1);
assert.equal(reviewProblems([low],'1）访问控制：A服务器存在不足。\n2）身份鉴别：存在不足。',
  [{item:1,name:'访问控制'},{item:0,name:'身份鉴别'}]).filter(f=>f.rule==='C31').length,1);
assert.equal(reviewProblems([object('A服务器',{rawScore:1})],'1）身份鉴别：存在不足。').filter(f=>f.rule==='C31').length,0);
assert.equal(reviewProblems([object('A服务器',{rawScore:'NA'})],'1）身份鉴别：存在不足。').filter(f=>f.rule==='C31').length,0);
assert.equal(reviewProblems([object('A服务器',{rawScore:null})],'1）身份鉴别：存在不足。').filter(f=>f.rule==='C31').length,0);
for (const marker of ['1 身份鉴别：A服务器。','1）身份鉴别：A服务器。','1、身份鉴别：A服务器。','1. 身份鉴别：A服务器。']) {
  assert.equal(reviewProblems([low],marker).length,0,marker);
}
assert.equal(reviewProblems([low],'1）身份鉴别：A服务器使用TLS1.2、AES_256_GCM。').length,0);
assert.equal(reviewProblems([low],'1）身份鉴别：A服务器。\n1.2版本已记录。').filter(f=>f.rule==='C32').length,0);
assert.equal(reviewProblems([low],'1）身份鉴别：A服务器。\n2）访问控制：B服务器。').filter(f=>f.rule==='C32').length,1);
const unnumbered = reviewProblems([low],'身份鉴别：A服务器存在不足。');
assert.equal(unnumbered.filter(f=>f.rule==='C32'&&f.type==='无法核对').length,1);
assert.equal(unnumbered.filter(f=>f.rule==='C31').length,0);
assert.equal(reviewProblems([low],'1）存在不足。').filter(f=>f.rule==='C31'&&f.type==='无法核对').length,1);
const polluted = object('浙政钉扫码通道',{layer:0,aliases:['z','上城区一体化智能化公共数据平台']});
const otherChannel = object('上城区一体化智能化公共数据平台国密访问通道',{layer:0});
assert.equal(engine.analyze({objects:[polluted,otherChannel],units:[],serverNames:[],databaseNames:[],dataCount:0,
  targets:[{id:'report-overall-0',layer:0,section:4,text:'上城区一体化智能化公共数据平台采用国密访问通道。',manual:true,coverage:'all'}]})
  .filter(f=>f.rule==='C29'&&f.object.name==='浙政钉扫码通道').length,1);
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
    getOnsiteRec:()=>({record:'A服务器采用TLS1.2。'}),getObjectCls:()=> '部分符合',getRawUnitScore:()=>0.25,
    getReportObjectScore:()=>0.5,getLayerProblemUnits:t=>t===2?[{itemIdx:0,name:'身份鉴别'}]:[],reportClassify:()=> '部分符合',
    isOnsiteUnitApplicable:()=>true,onsiteKey:()=> 'ind|obj',ONSITE_UNIT_DATA_REQ:{},reportTexts:{'report-overall-2':'A服务器采用TLS1.3。'},
    buildLayerAnalysisText:()=>'',buildLayerOverallText:()=>'',buildSugProblemText:t=>t===2?'1）身份鉴别：A服务器密码应用存在不足。':'无。',
    buildSugAdviceText:()=>'',buildConclusionSentence:()=>'',
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
  assert(get().findings.every(x=>x.target.section!==2 && (x.target.section!==5 || ['C31','C32'].includes(x.rule))));
  await sandbox.setReviewStatus(finding.id,'合理差异');
  assert.equal(get().findings.length,0);
  assert.equal(get().accepted.length,1);
  assert(panel.innerHTML.includes('已确认合理差异（1'));
  assert(saves>=2);
  await sandbox.runReportReview(null);assert.equal(get().findings.length,0);
  const saved=JSON.parse(JSON.stringify(get()));
  vm.runInContext('reportReviewState = ' + JSON.stringify(saved),ctx);
  sandbox.bbNormalizeReportReviewState();
  await sandbox.runReportReview(null);assert.equal(get().findings.length,0);
  await sandbox.restoreAcceptedReview(finding.id);
  assert.equal(get().accepted.length,0);
  assert(get().findings.some(x=>x.id===finding.id));
  sandbox.locateReviewSource(finding.id);assert.equal(located,1);
  await sandbox.setReviewStatus(finding.id,'合理差异');
  sandbox.reportTexts['report-overall-2']='A服务器采用TLS1.3，现场核查补充。';
  await sandbox.runReportReview(null);
  assert.equal(get().accepted.length,0);
  assert(get().findings.some(x=>x.id===finding.id));
  vm.runInContext('reportReviewState = ' + JSON.stringify({findings:[{...get().findings[0],status:'合理差异'},
    {...get().findings[0],id:'old-risk',target:{section:2}}],ranAt:'',scope:null,signature:''}),ctx);
  sandbox.bbNormalizeReportReviewState();
  assert.equal(get().findings.length,0);
  assert.equal(get().accepted.length,1);
  vm.runInContext('reportReviewState = {findings:[],accepted:[],ranAt:"",scope:null,signature:""}',ctx);
  sandbox.reportTexts['report-sug-prob-2']='1）身份鉴别：存在不足。';
  await sandbox.runReportReview(null);
  const omitted=get().findings.find(x=>x.rule==='C31');
  assert(omitted);
  await sandbox.setReviewStatus(omitted.id,'合理差异');
  await sandbox.runReportReview(null);
  assert(!get().findings.some(x=>x.id===omitted.id));
  const savedSuggestion=JSON.parse(JSON.stringify(get()));
  vm.runInContext('reportReviewState = ' + JSON.stringify(savedSuggestion),ctx);
  await sandbox.runReportReview(null);
  assert(!get().findings.some(x=>x.id===omitted.id));
  sandbox.reportTexts['report-sug-prob-2']='1）身份鉴别：缺少说明。';
  await sandbox.runReportReview(null);
  assert(get().findings.some(x=>x.id===omitted.id));
  assert(!get().accepted.some(x=>x.id===omitted.id));
  sandbox.reportTexts['report-sug-prob-2']='1）身份鉴别：A服务器存在不足。\n2）访问控制：其他问题。';
  await sandbox.runReportReview(null);
  const counted=get().findings.find(x=>x.rule==='C32');
  assert(counted);
  await sandbox.setReviewStatus(counted.id,'合理差异');
  await sandbox.runReportReview(null);
  assert(!get().findings.some(x=>x.id===counted.id));
  vm.runInContext('reportReviewState = ' + JSON.stringify(JSON.parse(JSON.stringify(get()))),ctx);
  await sandbox.runReportReview(null);
  assert(!get().findings.some(x=>x.id===counted.id));
  sandbox.getLayerProblemUnits=t=>t===2?[{itemIdx:0,name:'身份鉴别'},{itemIdx:1,name:'访问控制'}]:[];
  await sandbox.runReportReview(null);
  assert(!get().accepted.some(x=>x.id===counted.id));
  console.log('PASS: 风险与改进建议排除、合理差异持久化和失效、问题描述与计数审核');
}
integration().catch(error=>{console.error(error);process.exitCode=1;});
