import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from 'jszip';
import sharp from 'sharp';
import { formatReportTables, normalizeBasicInfoTemplateValues, normalizeCheckboxLabelSpacing, replaceReportSlots, specializeReportTemplate, unresolvedReportSlots } from '../backend/dist/report-template.js';
import { writePlanningImages, writeAppendixBImages, writeReportEvidence } from '../backend/dist/report-evidence.js';

const template = new URL('../storage/templates/report/default-report-template.docx', import.meta.url);
const zip = await JSZip.loadAsync(fs.readFileSync(template));
const exportCode = fs.readFileSync(new URL('../backend/src/server.ts', import.meta.url), 'utf8');
assert.match(exportCode, /fs\.readFile\(defaultReportTemplate\)/, '导出应读取“模板设置”上传的当前模板');
let xml = await zip.file('word/document.xml').async('string');
assert.ok(xml.includes('TOC'), '模板应包含可更新的目录域');
const initial = unresolvedReportSlots(xml);
const mappingCode = fs.readFileSync(new URL('../frontend/public/prototype.html',import.meta.url),'utf8')
  + fs.readFileSync(new URL('../backend/src/server.ts',import.meta.url),'utf8')
  + fs.readFileSync(new URL('../backend/src/report-evidence.ts',import.meta.url),'utf8');
const dynamicLayerSlot = slot => /^(单元测评结果分析_.+·结果分析|总体评价_.+_(描述|测评结果)|安全问题及改进建议_.+_(问题描述|改进建议))$/.test(slot);
const missingNames = initial.filter(slot => !mappingCode.includes(slot) && !dynamicLayerSlot(slot));
assert.deepEqual(missingNames, [], '模板字段缺少代码映射');
assert.ok(initial.includes('等保已定级备案情况'));
assert.ok(initial.includes('被测系统情况_拓扑图'));
assert.ok(initial.includes('密评报告评审记录照片列表'));
assert.ok(mappingCode.includes("put('总体评价_评估结论', conclusionText)"), '总体评价完整结论缺少字段映射');
const fragmented = '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>报告编号：</w:t></w:r><w:r><w:t>{{报</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>告编号}}</w:t></w:r></w:p>';
const replacedFragment = replaceReportSlots(fragmented, { '{{报告编号}}': '新编号-01' });
assert.ok(replacedFragment.includes('报告编号：') && replacedFragment.includes('新编号-01'));
assert.ok(replacedFragment.includes('<w:b/>') && replacedFragment.includes('<w:i/>'));
assert.ok(!replacedFragment.includes('{{'));
const overallConclusion = replaceReportSlots('<w:p><w:r><w:t>{{总体评价_评估结论}}</w:t></w:r></w:p>', {
  '{{总体评价_评估结论}}': '通过对测试系统进行测评，该系统基本符合第三级别要求。',
});
assert.ok(overallConclusion.includes('该系统基本符合第三级别要求'));
assert.ok(!overallConclusion.includes('{{总体评价_评估结论}}'));
const formattingFixture = '<w:sdt><w:sdtContent><w:p><w:r><w:instrText>TOC</w:instrText></w:r></w:p></w:sdtContent></w:sdt>' +
  '<w:p><w:r><w:t>表 2-4 物理安防设施</w:t></w:r></w:p><w:tbl>' +
  '<w:tr><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>表头</w:t></w:r></w:p></w:tc></w:tr>' +
  '<w:tr><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>正文</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
const formattedFixture = formatReportTables(formattingFixture);
const fixtureRuns = [...formattedFixture.matchAll(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g)].map(match => match[0]);
const headerRun = fixtureRuns.find(run => run.includes('表头'));
const bodyRun = fixtureRuns.find(run => run.includes('正文'));
assert.ok(headerRun?.includes('<w:b/>') && headerRun.includes('<w:sz w:val="21"/>'), '表头应保留加粗并使用五号字');
assert.ok(bodyRun?.includes('<w:b w:val="0"/>') && bodyRun.includes('<w:sz w:val="21"/>'), '正文应取消加粗并使用五号字');
assert.equal((formattedFixture.match(/<w:sz w:val="21"\/>/g) || []).length, 2, '表头和正文都应使用五号字');
const normalizedBasicInfo = normalizeBasicInfoTemplateValues({
  '等保已定级备案情况': '☑已定级备案\n  \n备案证明编号：123\r\n\r\n☑是',
  '系统使用的密码算法情况': '分组算法：☑SM4\n\n非对称算法：☑SM2',
  '评估结论正文': '第一段\n\n第二段',
});
assert.equal(normalizedBasicInfo['等保已定级备案情况'], '☑已定级备案\n备案证明编号：123\n☑是');
assert.equal(normalizedBasicInfo['系统使用的密码算法情况'], '分组算法：☑SM4\n非对称算法：☑SM2');
assert.equal(normalizedBasicInfo['评估结论正文'], '第一段\n\n第二段');
const normalizedCell = replaceReportSlots('<w:p><w:r><w:t>{{等保已定级备案情况}}</w:t></w:r></w:p>', {
  '{{等保已定级备案情况}}': normalizedBasicInfo['等保已定级备案情况'],
});
assert.equal((normalizedCell.match(/<w:br\/>/g) || []).length, 2, '三行基本信息之间只应有两次换行');
assert.equal(normalizeCheckboxLabelSpacing('☑ 云平台已评估 □\u00a0云平台正在评估 □\u3000云平台未评估'),
  '☑云平台已评估 □云平台正在评估 □云平台未评估');
assert.equal(normalizeCheckboxLabelSpacing('☑ 已测评\n测评机构名称：浙江省 电子信息产品检验研究院'),
  '☑已测评\n测评机构名称：浙江省 电子信息产品检验研究院');
xml = specializeReportTemplate(xml, {
  '等保未定级情况': '□未定级，本次按第三级要求测评',
  '所属省部密码管理部门': '浙江省自定义部门',
  '评估结论正文': '新录入的完整结论',
  'B9备案系统名称': '新备案名称',
  'B1委托单位': '新委托单位',
});
assert.ok(xml.includes('新录入的完整结论'));
const rowText = block => [...block.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(match => match[1]).join('');
const conclusionRowBefore = [...xml.matchAll(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g)]
  .map(match => match[0]).find(row => rowText(row).includes('评估结论{{评估结论}}综合得分'));
assert.ok(conclusionRowBefore, '结论表格中的占位符应保留给结论等级');
const conclusionXml = replaceReportSlots(xml, { '{{评估结论}}': '基本符合' });
const conclusionRowAfter = [...conclusionXml.matchAll(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g)]
  .map(match => match[0]).find(row => rowText(row).includes('评估结论基本符合综合得分'));
assert.ok(conclusionRowAfter, '结论表格必须写入页面显示的“基本符合”');
assert.ok(!conclusionRowAfter.includes('新录入的完整结论'), '结论正文不可覆盖表格中的结论等级');
assert.ok(xml.includes('新备案名称'));
assert.ok(xml.includes('新委托单位'));
assert.ok(xml.includes('□未定级'));
xml = await writePlanningImages(xml, zip, {});
xml = await writeReportEvidence(xml, zip, {});
const largePhoto = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#b7c8d9' } }).jpeg().toBuffer();
const smallPhoto = await sharp({ create: { width: 100, height: 50, channels: 3, background: '#b7c8d9' } }).jpeg().toBuffer();
xml = await writeAppendixBImages(xml, zip, { 'b1-file': [largePhoto, smallPhoto].map(photo => `data:image/jpeg;base64,${photo.toString('base64')}`) });
const compressed = await zip.file('word/media/bb-appendix-b1-file-1.jpg').async('nodebuffer');
const dimensions = await sharp(compressed).metadata();
assert.ok(Math.max(dimensions.width, dimensions.height) <= 1400);
assert.ok(xml.includes('wp:extent') && xml.includes('委托证明文件照片列表'));
const imageExtent = index => {
  const match = new RegExp(`<wp:extent cx="(\\d+)" cy="(\\d+)"/><wp:docPr[^>]*name="委托证明文件照片列表 ${index}"`).exec(xml);
  assert.ok(match, `第${index}张照片缺少 Word 尺寸`);
  return { width: Number(match[1]), height: Number(match[2]) };
};
const largeExtent = imageExtent(1);
assert.ok(largeExtent.width <= 3 * 914400 && largeExtent.height <= 3 * 914400, '导出照片最长边不得超过3英寸');
assert.ok(Math.abs(largeExtent.width / largeExtent.height - 3) < 0.01, '图片应等比例缩放');
assert.deepEqual(imageExtent(2), { width: 100 * 9525, height: 50 * 9525 }, '小图不应放大');
const remaining = unresolvedReportSlots(xml);
for (const slot of ['被测系统情况_拓扑图', '工具接入示意图', '证据截图列表',
  '委托证明文件照片列表', '现场授权测评书照片列表', '密评报告评审记录照片列表',
  '密评人员考核成绩证明照片1', '定级备案证明', '测评方案评审记录扫描件/照片',
  '测评方案确认记录扫描件/照片', '风险告知书照片']) {
  assert.ok(!remaining.includes(slot), `Image placeholder remains: ${slot}`);
}
const reopened = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }));
assert.ok(reopened.file('word/document.xml'));
console.log('PASS: new template context and image placeholders bind without touching source document.');
