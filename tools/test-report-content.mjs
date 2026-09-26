import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from 'jszip';
const { writeReportContent } = await import(process.env.REPORT_CONTENT_MODULE || '../backend/dist/report-content.js');
const p = t => `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${t}</w:t></w:r></w:p>`;
const cell = t => `<w:tc><w:tcPr><w:tcW w:w="2000"/></w:tcPr>${p(t)}</w:tc>`;
const table = `<w:tbl><w:tblPr/><w:tblGrid/><w:tr>${cell('序号')}${cell('姓名')}</w:tr><w:tr>${cell('1')}${cell('旧姓名')}</w:tr></w:tbl>`;
const xml = `<w:document><w:body>${p('表2-12 人员')}${table}<w:p><w:pPr><w:pStyle w:val="h2"/></w:pPr><w:r><w:t>承载的业务情况</w:t></w:r></w:p>${p('旧业务内容')}<w:sectPr/></w:body></w:document>`;
const styles = '<w:styles><w:style w:styleId="h2"><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style></w:styles>';
const content = { tables:[{caption:'人员',skip:1,rows:[['1','新姓名 & 测试']]}],sections:[{heading:'承载的业务情况',text:'新的业务内容\n第二段'}] };
const output = writeReportContent(xml, styles, content);
assert.ok(output.includes('新姓名 &amp; 测试'));
assert.ok(output.includes('新的业务内容'));
assert.ok(!output.includes('旧姓名'));
assert.ok(!output.includes('旧业务内容'));
assert.equal((output.match(/<w:tr>/g)||[]).length,2);
assert.equal((output.match(/<w:tc>/g)||[]).length,4);
assert.ok(output.includes('<w:tcW w:w="2000"/>'));
const assetTable = `<w:tbl><w:tblPr/><w:tblGrid/><w:tr>${['序号','物理环境名称','物理位置','重要程度'].map(cell).join('')}</w:tr><w:tr>${Array(4).fill('').map(cell).join('')}</w:tr></w:tbl>`;
const assetXml = `<w:document><w:body>${p('表 2-3 物理环境')}${assetTable}</w:body></w:document>`;
const assetContent = { tables:[{caption:'物理环境',skip:1,rows:[['1','机房甲','位置甲','重要'],['2','机房乙','位置乙','重要']]}], sections:[] };
const expanded = writeReportContent(assetXml, '', assetContent);
assert.equal((expanded.match(/<w:tr>/g)||[]).length, 3);
assert.equal((expanded.match(/<w:tc>/g)||[]).length, 12);
for (const value of ['机房甲','位置甲','机房乙','位置乙']) assert.ok(expanded.includes(value));
assert.equal((writeReportContent(assetXml, '', {...assetContent,tables:[{...assetContent.tables[0],rows:[]}]}).match(/<w:tr>/g)||[]).length, 1);
const summaryCell = `<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>${p('单元测评结果')}</w:tc>`;
const userTable = `<w:tbl><w:tblPr/><w:tblGrid/><w:tr>${['序号','应用用户','身份鉴别'].map(cell).join('')}</w:tr><w:tr>${['','旧用户',''].map(cell).join('')}</w:tr><w:tr>${summaryCell}${cell('旧结果')}</w:tr></w:tbl>`;
const userXml = `<w:document><w:body>${p('表4-5 应用和数据安全身份鉴别测评结果汇总')}${userTable}</w:body></w:document>`;
const userContent = {tables:[{caption:'应用和数据安全身份鉴别测评结果汇总',skip:1,repeat:true,rows:[['1','用户甲','符合'],['2','用户乙','不符合']],footerRows:[[null,null,'部分符合']]}],sections:[]};
const userOutput = writeReportContent(userXml, '', userContent);
assert.equal((userOutput.match(/<w:tr>/g)||[]).length, 4);
for (const value of ['用户甲','用户乙','部分符合']) assert.ok(userOutput.includes(value));
assert.ok(!userOutput.includes('旧用户'));
assert.ok(!userOutput.includes('旧结果'));
assert.ok(userOutput.includes('单元测评结果'));
assert.throws(()=>writeReportContent(xml.replace('表2-12 人员','表2-12 其他表'),styles,{...content,tables:[{caption:'其他表',skip:1,rows:[]}]}), /行数/);
const zip = await JSZip.loadAsync(fs.readFileSync(new URL('../storage/templates/report/default-report-template.docx', import.meta.url)));
const templateXml = await zip.file('word/document.xml').async('string');
const originalStyles = await zip.file('word/styles.xml').async('string');
const matrix = {caption:'物理和环境安全测评结果汇总',skip:2,repeat:true,
  rows:[['1','机房甲','符合','符合','符合'],['2','机房乙','不符合','符合','符合']],
  footerRows:[[null,null,'部分符合','符合','符合']]};
const correction = {caption:'测评结果修正',skip:1,repeat:true,
  rows:[['1','应用和数据安全','传输机密性','数据甲','不符合/0','部分符合/0.5','原因甲'],
    ['2','应用和数据安全','传输完整性','数据乙','不符合/0','部分符合/0.5','原因乙']]};
const risk = {caption:'风险分析',skip:2,repeat:true,
  rows:[['1','应用和数据安全','问题甲','TN1','分析甲','1','0','0'],
    ['2','应用和数据安全','问题乙','TN2','分析乙','0','1','0']],
  footerRows:[[null,null,null,null,null,'1','1','0']]};
const unitTables = [
  ['网络和通信安全测评结果汇总',2,7],['设备和计算安全测评结果汇总',2,8],
  ['应用和数据安全测评结果汇总',2,10],['管理制度测评结果汇总',2,8],
  ['人员管理测评结果汇总',2,7],['建设运行测评结果汇总',2,7],
  ['应急处置测评结果汇总',2,5],
  ['应用和数据安全身份鉴别测评结果汇总',1,3],
  ['应用和数据安全重要数据测评结果汇总',1,6],
  ['应用和数据安全不可否认性测评结果汇总',1,3]
].map(([caption,skip,columns]) => ({caption,skip,repeat:true,
  rows:[['1','对象甲',...Array(columns-2).fill('符合')],['2','对象乙',...Array(columns-2).fill('不符合')]],
  footerRows:[[null,null,...Array(columns-2).fill('部分符合')]]}));
const updatedTemplate = writeReportContent(templateXml, originalStyles, {tables:[matrix,...unitTables,correction,risk],sections:[]});
function findTable(documentXml, caption) {
  let preceding = '';
  for (const match of documentXml.matchAll(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)) {
    const block = match[0];
    if (block.startsWith('<w:p')) { const value = [...block.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(m => m[1]).join(''); if (value) preceding = value; }
    else if (preceding.includes(caption)) return block;
  }
  throw new Error('Missing table: ' + caption);
}
const matrixResult = findTable(updatedTemplate,'物理和环境安全测评结果汇总');
assert.equal((matrixResult.match(/<w:tr\b/g)||[]).length,5);
assert.ok(matrixResult.includes('机房甲') && matrixResult.includes('机房乙'));
assert.ok(matrixResult.includes('部分符合'));
for (const patch of unitTables) {
  const tableResult = findTable(updatedTemplate, patch.caption);
  assert.equal((tableResult.match(/<w:tr\b/g)||[]).length,patch.skip+3,patch.caption);
  assert.ok(tableResult.includes('对象甲') && tableResult.includes('对象乙'),patch.caption);
}
const correctionResult = findTable(updatedTemplate,'测评结果修正');
assert.equal((correctionResult.match(/<w:tr\b/g)||[]).length,3);
assert.ok(correctionResult.includes('原因甲') && correctionResult.includes('原因乙'));
assert.ok(!correctionResult.includes('<w:vMerge'));
const riskResult = findTable(updatedTemplate,'风险分析');
assert.equal((riskResult.match(/<w:tr\b/g)||[]).length,5);
assert.ok(riskResult.includes('分析甲') && riskResult.includes('分析乙'));
assert.ok(riskResult.includes('统计'));
const riskSummary = `<w:tc><w:tcPr><w:gridSpan w:val="5"/></w:tcPr>${p('统计')}</w:tc>`;
const blankRiskTable = `<w:tbl><w:tblPr/><w:tblGrid/>` +
  `<w:tr>${[cell('序号'),cell('安全层面'),cell('问题描述'),cell('关联威胁'),cell('风险分析'),cell('风险等级')].join('')}</w:tr>` +
  `<w:tr>${Array(5).fill('').map(cell).join('')}${['高','中','低'].map(cell).join('')}</w:tr>` +
  `<w:tr>${Array(8).fill('').map(cell).join('')}</w:tr>` +
  `<w:tr>${riskSummary}${Array(3).fill('').map(cell).join('')}</w:tr></w:tbl>`;
const blankRiskXml = `<w:document><w:body>${p('表 6-1 风险分析')}${blankRiskTable}</w:body></w:document>`;
const blankRiskResult = findTable(writeReportContent(blankRiskXml, '', {tables:[{...risk,required:true}],sections:[]}), '风险分析');
assert.equal((blankRiskResult.match(/<w:tr\b/g)||[]).length, 5);
for (const value of ['问题甲','问题乙','TN1','TN2','分析甲','分析乙']) assert.ok(blankRiskResult.includes(value));
assert.ok(blankRiskResult.includes('<w:gridSpan w:val="5"/>'));
const riskFooter = [...blankRiskResult.matchAll(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g)].at(-1)[0];
assert.deepEqual([...riskFooter.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(match => match[1]), ['统计','1','1','0']);
const zeroRiskResult = findTable(writeReportContent(blankRiskXml, '', {tables:[{...risk,rows:[],footerRows:[[null,null,null,null,null,'0','0','0']]}],sections:[]}), '风险分析');
assert.equal((zeroRiskResult.match(/<w:tr\b/g)||[]).length, 3);
assert.throws(() => writeReportContent('<w:document><w:body/></w:document>', '', {tables:[{...risk,required:true}],sections:[]}), /未找到需要写入的表格/);
const mergedRiskData = blankRiskXml.replace(`<w:tr>${Array(8).fill('').map(cell).join('')}</w:tr>`, `<w:tr>${riskSummary}${Array(3).fill('').map(cell).join('')}</w:tr>`);
assert.throws(() => writeReportContent(mergedRiskData, '', {tables:[risk],sections:[]}), /八个独立单元格/);
const originalQuant = findTable(templateXml, '整体测评结果');
const quantTemplateRows = [...originalQuant.matchAll(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g)];
assert.equal(quantTemplateRows.length, 45);
let quantLayer = '';
const quantRows = quantTemplateRows.slice(2, -2).map((match, index) => {
  const cells = [...match[0].matchAll(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g)]
    .map(cell => [...cell[0].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(text => text[1]).join(''));
  quantLayer = cells[0] || quantLayer;
  return [quantLayer, cells[1], index === 0 ? '0' : '1', '0', index === 0 ? '1' : '0', '0',
    index === 0 ? '0.0000' : '1.0000', quantLayer === '物理和环境安全' ? '0.6667' : '1.0000'];
});
assert.equal(quantRows.length, 41);
quantRows.push([null,null,'40','0','1','0','95.00']);
quantRows.push([null,null,null,null,null,null,null]);
const quantOutput = writeReportContent(templateXml, originalStyles, {
  tables: [{ caption: '整体测评结果', skip: 2, rows: quantRows, required: true }], sections: []
});
const quantResult = findTable(quantOutput, '整体测评结果');
assert.equal((quantResult.match(/<w:tr\b/g)||[]).length, 45);
assert.ok(quantResult.includes('0.6667') && quantResult.includes('95.00'));
assert.ok(quantResult.includes('<w:vMerge'));
assert.ok(!quantResult.includes('0.551'));
assert.throws(() => writeReportContent('<w:document><w:body/></w:document>', originalStyles, {
  tables: [{ caption: '整体测评结果', skip: 2, rows: quantRows, required: true }], sections: []
}), /未找到需要写入的表格/);
console.log('PASS: report tables, including table 5-2, write into the report template.');
