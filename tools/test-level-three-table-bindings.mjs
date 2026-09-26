import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from 'jszip';
import vm from 'node:vm';
import { writeReportContent } from '../backend/dist/report-content.js';

const zip = await JSZip.loadAsync(fs.readFileSync(new URL('../storage/templates/report/default-report-template.docx', import.meta.url)));
const xml = await zip.file('word/document.xml').async('string');
const styles = await zip.file('word/styles.xml').async('string');
const text = block => [...block.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(m => m[1]).join('');
const normalize = value => value.replace(/\s/g, '').replace(/^表[A-Za-z0-9０-９]+[-—－.]?[A-Za-z0-9０-９]*/, '');
const found = new Map();
let caption = '';
for (const match of xml.matchAll(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)) {
  if (match[0].startsWith('<w:p')) { if (text(match[0]).trim()) caption = text(match[0]).trim(); continue; }
  found.set(normalize(caption), match[0]); caption = '';
}
const specs = [
  ...[['物理环境',4],['物理安防设施',5],['密码产品',7],['服务器/存储设备',9],['网络及安全设备',7],
    ['数据库管理系统',6],['关键业务应用',5],['重要数据',6],['安全管理文档',3],['人员',5]].map(([name, count]) => [name,1,count]),
  ['测评工具',1,5],
  ...[['物理和环境安全',4],['网络和通信安全',4],['设备和计算安全',4],['应用和数据安全',4],['安全管理',5]]
    .map(([name,count]) => [name+'测评对象',1,count]),
  ['密评人员资格情况',1,4],['测评结果修正',1,7],['风险分析',2,8],
  ...['物理和环境安全','网络和通信安全','设备和计算安全','应用和数据安全','管理制度','人员管理','建设运行','应急处置']
    .map(name => [name+'测评结果汇总',2,null]),
  ['应用和数据安全身份鉴别测评结果汇总',1,3],
  ['应用和数据安全重要数据测评结果汇总',1,6],
  ['应用和数据安全不可否认性测评结果汇总',1,3],
];
const patches = specs.map(([name, skip, columns]) => {
  const table = found.get(normalize(name));
  assert.ok(table, `模板缺少 ${name}`);
  const rows = [...table.matchAll(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g)].map(m => m[0]);
  const sample = rows[skip];
  const count = columns ?? [...sample.matchAll(/<w:tc\b[^>]*>/g)].length;
  assert.equal([...sample.matchAll(/<w:tc\b[^>]*>/g)].length, count, `${name} 列数不符`);
  const isSummary = name.endsWith('测评结果汇总');
  return { caption:name, skip, repeat:true, rows:[Array.from({length:count},(_,i)=>i===0?'1':`${name}-${i}`)],
    ...(isSummary ? { footerRows:[Array.from({length:count},(_,i)=>i<2?null:'符合')] } : {}),
    ...(name === '风险分析' ? { footerRows:[[null,null,null,null,null,'0','1','0']] } : {}) };
});
const output = writeReportContent(xml,styles,{tables:patches,sections:[]});
for (const patch of patches) assert.ok(output.includes(`${patch.caption}-1`),`${patch.caption} 未写入`);
const html = fs.readFileSync(new URL('../frontend/public/prototype.html',import.meta.url),'utf8');
for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
  if (match[1].trim()) new vm.Script(match[1]);
}
const indicatorSource = html.split('const evaluationIndicatorLevels = ')[1]?.split('\n  function renderIndicatorTables()')[0];
assert.ok(indicatorSource);
const levels = new Function(`return ${indicatorSource.trim().replace(/;\s*$/, '')}`)();
const aPatches = levels.map((layer,index) => ({
  caption:layer.name+'测评结果记录', skip:index<4?2:1, required:true,
  rows:[], groups:layer.items.map(item=>({unit:item.name,rows:[index<4
    ? [item.name,'测试对象','新测评结果','1','1','1','1.0000','1.0000']
    : [item.name,'测试对象','新测评结果','符合','1.0000']]}))
}));
const aOutput = writeReportContent(xml,styles,{tables:aPatches,sections:[]});
assert.equal((aOutput.match(/新测评结果/g)||[]).length,levels.reduce((sum,layer)=>sum+layer.items.length,0));
const quantRows = levels.flatMap(layer=>layer.items.map(item=>[layer.name,item.name,'1','0','0','0','1.0000','1.0000']));
quantRows.push([null,null,'41','0','0','0','100.00']);
quantRows.push([null,null,null,null,null,null,null]);
const quantOutput = writeReportContent(xml,styles,{tables:[{caption:'整体测评结果',skip:2,rows:quantRows,required:true}],sections:[]});
assert.ok(quantOutput.includes('100.00'));
const combined = writeReportContent(xml,styles,{tables:[...patches,...aPatches,{caption:'整体测评结果',skip:2,rows:quantRows,required:true}],sections:[]});
assert.ok(combined.includes('100.00') && combined.includes('新测评结果'));
console.log(`PASS: ${patches.length}个三级模板表格、表A-1～A-8和表5-2映射通过。`);
export { combined };
