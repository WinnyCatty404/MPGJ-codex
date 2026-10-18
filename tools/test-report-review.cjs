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
    targets:[{id:'report-sug-prob-' + (objects[0]?.layer ?? 2),layer:objects[0]?.layer ?? 2,
      section:5,text,manual:true,coverage:'problems',problemUnits}],...extra});
}
const low = object('A服务器',{item:0,rawScore:0.5});
assert.equal(reviewProblems([low],'1）身份鉴别：A服务器密码应用存在不足。').length,0);
const accessRoom = object('上城区信息机房',{layer:0,unit:'电子门禁记录数据存储完整性',rawScore:0});
const accessDescription = '1）上城区信息机房的电子门禁未采用密码技术对进出机房人员进行身份鉴别。' +
  '2）上城区信息机房的电子门禁记录数据未采用密码技术进行存储完整性防护。' +
  '3）上城区信息机房的视频图像监控记录数据未采用密码技术进行存储完整性防护。';
assert.equal(reviewProblems([accessRoom],accessDescription,[{item:0,name:'身份鉴别'},
  {item:1,name:'电子门禁记录数据存储完整性'},{item:2,name:'视频监控记录数据存储完整性'}])
  .filter(f=>f.rule==='C31').length,0,'同一编号条目拆开表述指标名时应能对应现场低分对象');
assert.equal(reviewProblems([accessRoom],
  '1）上城区信息机房的视频监控记录数据未采用密码技术进行存储完整性防护。',
  [{item:1,name:'电子门禁记录数据存储完整性'}]).filter(f=>f.rule==='C31'&&f.type==='无法核对').length,1,
  '视频监控记录不能代替电子门禁记录');
assert.equal(reviewProblems([accessRoom],
  '1）电子门禁记录数据未采用密码技术进行存储完整性防护。',
  [{item:1,name:'电子门禁记录数据存储完整性'}]).filter(f=>f.rule==='C31'&&f.type==='覆盖检查').length,1,
  '对应指标条目存在但未写对象时仍应提示');
const videoRoom = object('上城区信息机房',{layer:0,unit:'视频监控记录数据存储完整性',rawScore:0});
assert.equal(reviewProblems([videoRoom],
  '1）上城区信息机房的视频音像监控记录数据未采用密码技术进行存储完整性防护。',
  [{item:2,name:videoRoom.unit}]).filter(f=>f.rule==='C31').length,0,'视频音像监控应对应视频监控指标');
const privateChannel = object('上城区一体化智能化公共数据平台非国密访问通道',
  {layer:1,unit:'通信过程中重要数据的机密性',rawScore:0});
const nationalChannel = object('上城区一体化智能化公共数据平台国密访问通道',
  {layer:1,unit:'通信过程中重要数据的机密性',rawScore:0});
assert.equal(reviewProblems([privateChannel],
  '1）上城区一体化智能化公共数据平台非国密访问通道的数据传输使用AES算法保护机密性。',
  [{item:2,name:privateChannel.unit}]).filter(f=>f.rule==='C31').length,0,'数据传输机密性应对应通信中的数据机密性');
assert.equal(reviewProblems([nationalChannel,privateChannel],
  '1）上城区一体化智能化公共数据平台非国密访问通道的数据传输使用AES算法保护机密性。',
  [{item:2,name:nationalChannel.unit}]).filter(f=>f.rule==='C31'&&f.object.name===nationalChannel.name).length,1,
  '非国密通道不能证明国密通道已在问题描述中出现');
const boundaryUnit='网络边界访问控制信息的完整性';
assert.equal(reviewProblems([
  {...nationalChannel,unit:boundaryUnit}, {...privateChannel,unit:boundaryUnit}],
  '1）上城区一体化智能化公共数据平台非国密访问通道、国密访问通道的边界访问控制信息未采用密码技术保证完整性。',
  [{item:3,name:boundaryUnit}]).filter(f=>f.rule==='C31').length,0,
  '同一前缀并列列举的国密通道应识别为独立对象');
const ding = object('浙政钉扫码通道',{layer:1,unit:'身份鉴别',rawScore:0});
assert.equal(reviewProblems([ding],
  '1）浙政钉访问通道使用RSA证书进行身份鉴别，未采用商用密码。').filter(f=>f.rule==='C31').length,0,
  '唯一通道简称应可对应原对象');
assert.equal(reviewProblems([ding,object('浙政钉国密访问通道',{layer:1,unit:'身份鉴别',rawScore:1})],
  '1）浙政钉访问通道使用RSA证书进行身份鉴别，未采用商用密码。').filter(f=>f.rule==='C31'&&f.object.name===ding.name).length,1,
  '多个同前缀通道时不应使用冲突泛称');
for (const [unit, issue] of [
  ['远程管理通道安全','应用服务器使用HTTPS协议，密码套件未采用国家商用密码算法。'],
  ['重要可执行程序完整性、重要可执行程序来源真实性','应用服务器未采用密码技术保证重要可执行程序的完整性和重要可执行程序来源真实性。']
]) {
  const server = object('应用服务器',{unit,rawScore:0});
  assert.equal(reviewProblems([server],'1）'+issue,[{item:0,name:unit}]).filter(f=>f.rule==='C31').length,0,unit);
}
const policy = object('《密码应用安全管理制度汇编》',{layer:4,unit:'定期修订安全管理制度',rawScore:0});
assert.equal(reviewProblems([policy],
  '1）明确本单位商用密码安全管理制度定期进行修订和更新，但未提供修订记录。',
  [{item:0,name:policy.unit}]).filter(f=>f.rule==='C31').length,0,'单一制度对象不必重复文件全名');
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
assert.equal(reviewProblems([low],'　1）身份鉴别：A服务器。').filter(f=>f.rule==='C32').length,0);
assert.equal(reviewProblems([low],'1）身份鉴别：A服务器。2）访问控制：B服务器。',
  [{item:0,name:'身份鉴别'},{item:1,name:'访问控制'}]).filter(f=>f.rule==='C32').length,0);
assert.equal(reviewProblems([low],'1）身份鉴别：A服务器。3）访问控制：B服务器。',
  [{item:0,name:'身份鉴别'},{item:1,name:'访问控制'}]).filter(f=>f.rule==='C32').length,1,
  '应按最后一个编号判断问题项数量，而非只数编号条目');
const unnumbered = reviewProblems([low],'身份鉴别：A服务器存在不足。');
assert.equal(unnumbered.filter(f=>f.rule==='C32'&&f.type==='无法核对').length,1);
assert.equal(unnumbered.filter(f=>f.rule==='C31').length,0);
assert.equal(reviewProblems([low],'1）存在不足。').filter(f=>f.rule==='C31'&&f.type==='无法核对').length,1);
const polluted = object('浙政钉扫码通道',{layer:0,aliases:['z','上城区一体化智能化公共数据平台']});
const otherChannel = object('上城区一体化智能化公共数据平台国密访问通道',{layer:0});
assert.equal(engine.analyze({objects:[polluted,otherChannel],units:[],serverNames:[],databaseNames:[],dataCount:0,
  targets:[{id:'report-overall-0',layer:0,section:4,text:'上城区一体化智能化公共数据平台采用国密访问通道。',manual:true,coverage:'all'}]})
  .filter(f=>f.rule==='C29'&&f.object.name==='浙政钉扫码通道').length,1);
const cryptoTarget = text => ({ id:'plan-crypto-device',layer:2,section:8,text,manual:true,coverage:'all' });
const cryptoInput = text => ({objects:[object('A服务器')],units:[],serverNames:[],databaseNames:[],dataCount:0,targets:[cryptoTarget(text)]});
assert.equal(engine.analyze(cryptoInput('未描述服务器')).filter(f=>f.rule==='C33').length,1);
assert.equal(engine.analyze(cryptoInput('A服务器采用TLS1.2和AES128。')).filter(f=>f.rule==='C33').length,0);
assert.equal(engine.analyze(cryptoInput('A服务器采用TLS1.3和AES256。')).filter(f=>['C06','C07'].includes(f.rule)).length,2);

// 第5—8层面：按测评单元和结果记录审核，不再要求复写对象名称。
const managementObjects = [
  {key:'m1',name:'制度文档A',layer:4,item:0,index:0,unit:'定期修订安全管理制度',applicable:true,
    record:'已制定密码应用安全管理制度，并按照年度计划定期修订，留存发布审批记录。',result:'符合',rawScore:1},
  {key:'m2',name:'修订记录B',layer:4,item:0,index:1,unit:'定期修订安全管理制度',applicable:true,
    record:'未提供最近一次制度修订记录。',result:'不符合',rawScore:0}
];
const managementExpectations = managementObjects.map((o,i)=>({key:'record|4|0|'+i,layer:4,item:0,unit:o.unit,
  record:o.record,problem:o.result==='不符合',sources:[{...o,problem:o.result==='不符合'}]}));
function managementReview(targets, expectations=managementExpectations, objects=managementObjects) {
  return engine.analyze({objects,units:[{layer:4,name:'定期修订安全管理制度',result:'不符合'}],recordExpectations:expectations,
    serverNames:[],databaseNames:[],dataCount:0,targets});
}
const managementBase = {layer:4,manual:true,sourceMode:'manual'};
let findings = managementReview([{...managementBase,id:'report-ua-text-4',section:0,kind:'unitAnalysis',coverage:'all',
  text:'定期修订安全管理制度测评指标中，已制定密码应用安全管理制度并定期修订，留存发布审批记录；未提供最近一次制度修订记录。故该指标不符合。'}]);
assert.equal(findings.filter(f=>['C29','C31','C34','C35','C36'].includes(f.rule)).length,0,
  '管理层面合理简写不应要求对象名称，也不应提示结果记录遗漏');
findings = managementReview([{...managementBase,id:'report-overall-4',section:4,kind:'overall',coverage:'all',
  text:'定期修订安全管理制度测评指标中，已制定密码应用安全管理制度并定期修订。'}]);
assert(findings.some(f=>['C34','C36'].includes(f.rule)&&f.baseline.includes('未提供最近一次制度修订记录')),
  '总体评价遗漏一条不同结果记录时应提示');
findings = managementReview([{...managementBase,id:'report-sug-prob-4',section:5,kind:'problem',coverage:'problems',
  problemUnits:[{item:0,name:'定期修订安全管理制度'}],text:'1）定期修订安全管理制度：未提供最近一次制度修订记录。'}]);
assert(!findings.some(f=>['C29','C31','C34','C35','C36'].includes(f.rule)), '问题描述只需覆盖问题对象记录');
assert.equal(engine.recordCoverage('已制定密码应用安全管理制度。','未制定密码应用安全管理制度。',[]).status,'conflict');
assert.equal(engine.recordCoverage('已制定密码应用安全管理制度，并定期修订。','制度已制定并修订。',[]).status,'uncertain');
assert.equal(engine.recordCoverage('未提供制度修订记录。','本项符合要求。',[]).status,'missing');
const emptyExpectation=[{key:'record-empty|4|0',layer:4,item:0,unit:'定期修订安全管理制度',record:'',problem:true,sources:[managementObjects[1]]}];
findings=managementReview([
  {...managementBase,id:'report-ua-text-4',section:0,kind:'unitAnalysis',text:''},
  {...managementBase,id:'report-overall-4',section:4,kind:'overall',text:''},
  {...managementBase,id:'report-sug-prob-4',section:5,kind:'problem',problemUnits:[{item:0,name:'定期修订安全管理制度'}],text:'1）定期修订安全管理制度：无。'}
],emptyExpectation,[{...managementObjects[1],record:''}]);
assert.equal(findings.filter(f=>f.rule==='C28').length,1,'同一管理单元全部记录为空时只提示一次');

const adviceTarget = text => ({...managementBase,id:'report-sug-adv-4',section:5,kind:'advice',text,
  problemUnits:[{item:0,name:'定期修订安全管理制度',adviceBaseline:'建议完善密码应用安全管理制度，明确修订及执行记录留存要求。'}]});
assert.equal(managementReview([adviceTarget('1）针对「定期修订安全管理制度」：建议完善密码应用安全管理制度，定期修订并留存记录。')])
  .filter(f=>['C37','C38','C39'].includes(f.rule)).length,0,'具体且方向正确的建议应通过');
assert(managementReview([adviceTarget('1）针对「定期修订安全管理制度」：加强管理，尽快整改。')]).some(f=>f.rule==='C38'));
assert(managementReview([adviceTarget('1）针对「定期修订安全管理制度」：已经完成制度部署。')]).some(f=>f.rule==='C39'));
assert(managementReview([adviceTarget('1）针对「其他测评单元」：建议完善制度。')]).some(f=>f.rule==='C37'));

const crossUnitExpectations = [
  managementExpectations[0],
  {key:'record|4|1|0',layer:4,item:1,unit:'建立密码人员管理制度',record:'已开展密码人员年度培训。',problem:false,sources:[{...managementObjects[0],item:1,unit:'建立密码人员管理制度'}]}
];
findings = managementReview([{...managementBase,id:'report-overall-4',section:4,kind:'overall',coverage:'all',
  text:'定期修订安全管理制度测评指标中，未提供修订记录。建立密码人员管理制度测评指标中，已制定密码应用安全管理制度，并按照年度计划定期修订，留存发布审批记录；已开展密码人员年度培训。'}],crossUnitExpectations);
assert(findings.some(f=>['C34','C35','C36'].includes(f.rule)&&f.object.unit==='定期修订安全管理制度'),
  '其他测评单元中出现的相同结果记录不得用于补齐当前单元');

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
  let saves=0, located=0, planLocated=0;
  const panel={innerHTML:'',querySelectorAll:()=>[]};
  const cryptoField={value:'A服务器采用TLS1.2。',style:{},scrollIntoView(){planLocated++;},focus(){}};
  const sandbox={console, setTimeout, document:{head:{appendChild(){}},createElement:()=>({}),getElementById:id=>id==='report-panel-7'?panel:(id==='plan-crypto-device'?cryptoField:null)},
    onsiteEsc:s=>String(s).replace(/</g,'&lt;'),ONSITE_LAYERS:Array.from({length:8},(_,i)=>({name:'层面'+i})),
    evaluationIndicatorLevels:Array.from({length:8},(_,i)=>({items:i===2?[{name:'身份鉴别'}]:[]})),objData:{},
    getOnsiteObjectEntries:t=>t===2?[{id:'obj',name:'A服务器'}]:[],getOnsiteUnitObjectEntries:t=>t===2?[{id:'obj',name:'A服务器'}]:[],
    getOnsiteRec:()=>({record:'A服务器采用TLS1.2。'}),getObjectCls:()=> '部分符合',getRawUnitScore:()=>0.25,
    getReportObjectScore:()=>0.5,getLayerProblemUnits:t=>t===2?[{itemIdx:0,name:'身份鉴别'}]:[],reportClassify:()=> '部分符合',
    isOnsiteUnitApplicable:()=>true,onsiteKey:()=> 'ind|obj',ONSITE_UNIT_DATA_REQ:{},reportTexts:{'report-overall-2':'A服务器采用TLS1.3。'},
    reportTextStates:{},findRiskTemplate:()=>({advice:'建议采用密码技术完善身份鉴别。'}),fillRiskTemplateText:value=>value,
    buildLayerAnalysisText:()=>'',buildLayerOverallText:()=>'',buildSugProblemText:t=>t===2?'1）身份鉴别：A服务器密码应用存在不足。':'无。',
    buildSugAdviceText:t=>t===2?'1）针对「身份鉴别」：建议采用密码技术完善身份鉴别。':'无。',buildConclusionSentence:()=>'',
    getReportTextVal:(id,auto)=>sandbox.reportTexts[id]??auto,getRiskRows:()=>[],reportRiskStore:{},reportFixes:{},
    switchReportTab:()=>sandbox.renderReportReview(),showToast(){},switchStep(){},switchPlanTab(){},switchCryptoModule(){},switchCryptoLayer(){},switchOnsiteTab(){},expandOnsiteRecord:()=>located++,
    bbPersistProjectStage:async()=>saves++};
  sandbox.getReportUnitAnalysisText=t=>sandbox.reportTexts['report-ua-text-'+t]??sandbox.buildLayerAnalysisText(t);
  sandbox.getReportOverallText=t=>sandbox.reportTexts['report-overall-'+t]??sandbox.buildLayerOverallText(t);
  sandbox.getReportSuggestionText=(t,kind)=>sandbox.reportTexts['report-sug-'+kind+'-'+t]??
    (kind==='prob'?sandbox.buildSugProblemText(t):sandbox.buildSugAdviceText(t));
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
  cryptoField.value='这里尚未说明对应的测评对象。';
  await sandbox.runReportReview(null);
  const cryptoMissing=get().findings.find(x=>x.rule==='C33');
  assert(cryptoMissing, '第二步密码应用概况应提示遗漏对象');
  await sandbox.locateReviewTarget(cryptoMissing.id);
  assert.equal(planLocated,1, '应定位到第二步对应描述框');
  vm.runInContext('reportReviewState = {findings:[],accepted:[],ranAt:"",scope:null,signature:""}',ctx);
  sandbox.getOnsiteObjectEntries=t=>t===2?[{id:'obj-a',name:'A服务器'},{id:'obj-b',name:'B服务器'}]:[];
  sandbox.getOnsiteUnitObjectEntries=sandbox.getOnsiteObjectEntries;
  sandbox.onsiteKey=(t,i,j)=>'ind|obj-'+j;
  sandbox.getOnsiteRec=(t,i,j)=>({record:(j===0?'A服务器':'B服务器')+'采用TLS1.2。'});
  sandbox.getLayerProblemUnits=t=>t===2?[{itemIdx:0,name:'身份鉴别'}]:[];
  sandbox.reportTexts['report-sug-prob-2']='1）密码应用存在不足。';
  await sandbox.runReportReview(null);
  const unresolved=get().findings.filter(x=>x.rule==='C31'&&x.type==='无法核对');
  assert.equal(unresolved.length,2);
  assert(panel.innerHTML.includes('全部 '+(get().findings.length-1)), '同指标无法定位应合并为一个可见问题');
  const groupId='c31-group-'+sandbox.BBReportReviewEngine.hash('report-sug-prob-2|身份鉴别');
  sandbox.selectReviewFinding(groupId);
  assert(panel.innerHTML.includes('定位A服务器') && panel.innerHTML.includes('定位B服务器'));
  const beforeLocate=located;
  unresolved.forEach(f=>sandbox.locateReviewSource(f.id));
  assert.equal(located,beforeLocate+2,'合并疑点中的现场对象应可分别定位');
  await sandbox.setReviewNote(groupId,'人工核对中');
  assert(unresolved.every(f=>f.note==='人工核对中'));
  await sandbox.setReviewStatus(groupId,'合理差异');
  assert.equal(get().accepted.length,2);
  assert(panel.innerHTML.includes('已确认合理差异（1'));
  await sandbox.runReportReview(null);
  assert(!get().findings.some(x=>x.rule==='C31'));
  vm.runInContext('reportReviewState = ' + JSON.stringify(JSON.parse(JSON.stringify(get()))),ctx);
  await sandbox.runReportReview(null);
  assert(!get().findings.some(x=>x.rule==='C31'), '重新打开后合并确认仍应有效');
  const legacyAccepted=JSON.parse(JSON.stringify(get()));
  legacyAccepted.accepted.forEach(item=>delete item.objectUnit);
  vm.runInContext('reportReviewState = ' + JSON.stringify(legacyAccepted),ctx);
  await sandbox.runReportReview(null);
  assert(!get().findings.some(x=>x.rule==='C31'), '旧版逐对象合理差异确认仍应有效');
  vm.runInContext('reportReviewState = ' + JSON.stringify(JSON.parse(JSON.stringify(legacyAccepted))),ctx);
  sandbox.reportTexts['report-sug-prob-2']='1）密码应用仍存在不足。';
  await sandbox.runReportReview(null);
  assert.equal(get().accepted.length,0, '原文变化后应撤销合并确认');
  assert.equal(get().findings.filter(x=>x.rule==='C31').length,2);
  await sandbox.setReviewStatus(groupId,'合理差异');
  const acceptedGroupId='accepted-group-'+sandbox.BBReportReviewEngine.hash('report-sug-prob-2|身份鉴别');
  await sandbox.restoreAcceptedReview(acceptedGroupId);
  assert.equal(get().accepted.length,0);
  assert.equal(get().findings.filter(x=>x.rule==='C31').length,2);

  // 快照集成：管理类使用最终有效文本和结构化结果记录，不再进入对象覆盖规则。
  vm.runInContext('reportReviewState = {findings:[],accepted:[],ranAt:"",scope:null,signature:""}',ctx);
  sandbox.evaluationIndicatorLevels[4]={items:[{name:'制定密码应用方案',desc:'建设运行管理要求'}]};
  sandbox.getOnsiteObjectEntries=t=>t===4?[{id:'policy',name:'方案文档'}]:[];
  sandbox.getOnsiteUnitObjectEntries=(t)=>t===4?[{id:'policy',name:'方案文档'}]:[];
  sandbox.getOnsiteRec=(t)=>({record:t===4?'未提供有效的密码应用方案。':''});
  sandbox.getObjectCls=t=>t===4?'不符合':'未测评';
  sandbox.getRawUnitScore=t=>t===4?0:null;
  sandbox.getReportObjectScore=t=>t===4?0:null;
  sandbox.getLayerProblemUnits=t=>t===4?[{itemIdx:0,name:'制定密码应用方案',desc:'建设运行管理要求',cls:'不符合'}]:[];
  sandbox.onsiteKey=(t,i,j)=>t+'|'+i+'|'+j;
  sandbox.reportTexts['report-ua-text-4']='制定密码应用方案测评指标中，未提供有效的密码应用方案。故该指标不符合。';
  sandbox.reportTexts['report-overall-4']='制定密码应用方案测评指标中，未提供有效的密码应用方案。';
  sandbox.reportTexts['report-sug-prob-4']='1）制定密码应用方案：未提供有效的密码应用方案。';
  sandbox.reportTexts['report-sug-adv-4']='1）针对「制定密码应用方案」：建议制定并完善密码应用方案，开展密码应用安全性评估。';
  await sandbox.runReportReview(null);
  assert(!get().findings.some(x=>x.object.layer===4&&['C29','C31','C34','C35','C36'].includes(x.rule)),
    '管理类最终文本已覆盖结果记录时不应出现对象或记录遗漏');
  sandbox.reportTexts['report-overall-4']='制定密码应用方案测评指标中，本项符合要求。';
  await sandbox.runReportReview(null);
  const managementFinding=get().findings.find(x=>x.target.id==='report-overall-4'&&['C34','C35','C36'].includes(x.rule));
  assert(managementFinding,
    '管理类总体评价遗漏或改变结果记录时应提示');
  await sandbox.setReviewStatus(managementFinding.id,'合理差异');
  await sandbox.runReportReview(null);
  assert(!get().findings.some(x=>x.id===managementFinding.id),'管理类记录差异确认后原文不变时不应重复提示');
  sandbox.reportTexts['report-overall-4']='制定密码应用方案测评指标中，未提供有效的密码应用方案。';
  await sandbox.runReportReview(null);
  assert(!get().accepted.some(x=>x.id===managementFinding.id),'管理类报告原文变化后应使旧合理差异失效');
  const oldManagement={id:'old-management-object',rule:'C31',objectKey:'4|0|0',objectName:'方案文档',objectUnit:'制定密码应用方案',
    objectLayer:4,targetId:'report-sug-prob-4',targetSection:5,title:'旧版对象遗漏',fingerprint:'old',sourceFingerprint:'old'};
  vm.runInContext('reportReviewState.accepted.push('+JSON.stringify(oldManagement)+')',ctx);
  sandbox.bbNormalizeReportReviewState();
  assert(!get().accepted.some(x=>x.id===oldManagement.id),'第5—8层面旧C29/C31合理差异记录应清理');
  console.log('PASS: 技术层规则回归、管理类记录审核、建议审核、合理差异持久化与失效');
}
integration().catch(error=>{console.error(error);process.exitCode=1;});
