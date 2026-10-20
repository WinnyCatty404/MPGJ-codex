import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

function captureLabeledValue(text, label, nextLabels) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const next = nextLabels.map(item => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const match = new RegExp(escaped + '[：:]\\s*([\\s\\S]*?)(?=\\s*(?:' + next + ')[：:]|$)').exec(text);
  return match ? match[1].trim() : '';
}

const cloud = '云平台名称：浙江新型算力中心平台\n密评机构名称：浙江东安检测技术有限公司 评估时间：2025年12月05日 评估结论：基本符合';
assert.equal(captureLabeledValue(cloud, '云平台名称', ['密评机构名称', '评估时间', '评估结论']), '浙江新型算力中心平台');
assert.equal(captureLabeledValue(cloud, '密评机构名称', ['评估时间', '评估结论']), '浙江东安检测技术有限公司');
assert.equal(captureLabeledValue(cloud, '评估时间', ['评估结论']), '2025年12月05日');
assert.equal(captureLabeledValue(cloud, '评估结论', []), '基本符合');

const assessment = '□已测评\n测评机构名称：\n测评时间：\n测评结论：☑正在测评\n测评机构名称：浙江省电子信息产品检验研究院□未测评';
const selected = /[□☐☑✓✔]\s*正在测评/.exec(assessment);
assert.ok(selected, '应识别正在测评的勾选状态');
const afterSelected = assessment.slice(selected.index + selected[0].length);
const nextStatus = /[□☐☑✓✔]\s*(?:已测评|正在测评|未测评)/.exec(afterSelected);
const selectedText = nextStatus ? afterSelected.slice(0, nextStatus.index) : afterSelected;
assert.equal(captureLabeledValue(selectedText, '测评机构名称', ['测评时间', '测评结论']), '浙江省电子信息产品检验研究院');

for (const relative of ['frontend/src/report-generator.html', 'frontend/public/prototype.html']) {
  const html = await fs.readFile(relative, 'utf8');
  assert.match(html, /const selectedText = nextStatus \? afterSelected\.slice\(0, nextStatus\.index\) : afterSelected;/, `${relative} 未按已选测评状态截取内容`);
  assert.match(html, /cloudValue\('密评机构名称', \['评估时间', '评估结论'\]\)/, `${relative} 未按云平台字段边界解析机构名称`);
  assert.match(html, /data\.systemScore = totals && totals\.total != null \? totals\.total : null;/, `${relative} 未在现场阶段保存实时评分`);
}

const server = await fs.readFile('backend/src/server.ts', 'utf8');
assert.match(server, /stage_key='onsite'/, '项目列表未优先读取现场阶段评分');
console.log('PASS: Word 基本信息的云平台、测评状态定向导入及项目列表实时评分检查通过。');
