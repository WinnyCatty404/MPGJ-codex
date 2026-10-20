import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

function captureLabeledValue(text, label, nextLabels) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const next = nextLabels.map(item => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const match = new RegExp(escaped + '[：:]\\s*([\\s\\S]*?)(?=\\s*(?:' + next + ')[：:]|$)').exec(text);
  return match ? match[1].trim() : '';
}

// 网络安全等级测评情况仍按已选状态截取（该逻辑未改动）
const assessment = '□已测评\n测评机构名称：\n测评时间：\n测评结论：☑正在测评\n测评机构名称：浙江省电子信息产品检验研究院□未测评';
const selected = /[□☐☑✓✔]\s*正在测评/.exec(assessment);
assert.ok(selected, '应识别正在测评的勾选状态');
const afterSelected = assessment.slice(selected.index + selected[0].length);
const nextStatus = /[□☐☑✓✔]\s*(?:已测评|正在测评|未测评)/.exec(afterSelected);
const selectedText = nextStatus ? afterSelected.slice(0, nextStatus.index) : afterSelected;
assert.equal(captureLabeledValue(selectedText, '测评机构名称', ['测评时间', '测评结论']), '浙江省电子信息产品检验研究院');

// 电子邮件：按 Word 原始行列位置读取，同行重复值不得被整表去重丢弃
function cellAtPos(rows, label) {
  const want = String(label == null ? '' : label).trim();
  if (!want) return '';
  const fieldLabels = ['单位名称', '单位地址', '邮政编码', '所属省部密码管理部门', '系统名称',
    '姓名', '职务/职称', '所属部门', '办公电话', '移动电话', '电子邮件'];
  for (const row of rows) {
    const cells = row.map(c => String(c == null ? '' : c).trim());
    for (let ci = 0; ci < cells.length; ci++) {
      if (cells[ci] !== want) continue;
      for (let vi = ci + 1; vi < cells.length; vi++) {
        if (cells[vi] === '' || cells[vi] === want) continue;
        if (fieldLabels.indexOf(cells[vi]) >= 0) break;
        return cells[vi];
      }
    }
  }
  return '';
}
const biRows = [
  ['联系人', '姓名', '张三', '职务/职称', '工程师'],
  ['', '办公电话', '/', '移动电话', '13800000000'],
  ['', '电子邮件', '/', '所属部门', '运维部']
];
assert.equal(cellAtPos(biRows, '姓名'), '张三');
assert.equal(cellAtPos(biRows, '办公电话'), '/');
assert.equal(cellAtPos(biRows, '电子邮件'), '/', '重复值 / 必须按行列位置如实回填，不能错取到下一节标题');
// 合并单元格展开后标签格重复（用户实测：输入框被写入“电子邮件”本身）
const biRowsDoubled = [
  ['联系人', '姓名', '李少辉', '职务/职称', '工作人员'],
  ['联系人', '所属部门', '数据资源科', '办公电话', '/'],
  ['联系人', '移动电话', '13123937800', '电子邮件', '电子邮件', '/']
];
assert.equal(cellAtPos(biRowsDoubled, '电子邮件'), '/', '标签格重复时应跳过同标签格取到真实值');
// 值缺失：撞到下一个字段标签应止住，不把字段名写进输入框
assert.equal(cellAtPos([['电子邮件', '电子邮件', '移动电话', '13123937800']], '电子邮件'), '');

// 云平台：逐格定位标签，只取标签后、复选框符号/其他字段标签之前的内容
const CLOUD_LABELS = ['云平台名称', '密评机构名称', '评估时间', '评估结论', '云平台已评估', '云平台正在评估', '云平台未评估'];
function cloudValueFromCells(cells, label) {
  let ci = -1;
  for (let k = 0; k < cells.length; k++) { if (cells[k].indexOf(label) >= 0) { ci = k; break; } }
  if (ci < 0) return '';
  let v = cells[ci].slice(cells[ci].indexOf(label) + label.length).replace(/^[\s\u3000：:]+/, '');
  if (!v) {
    for (let j = ci + 1; j < cells.length; j++) { if (cells[j].trim()) { v = cells[j]; break; } }
  }
  const noise = new RegExp('[☑□☐]|' + CLOUD_LABELS.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'));
  const m = noise.exec(v);
  if (m) v = v.slice(0, m.index);
  return v.replace(/^[\s\u3000：:]+|[\s\u3000：:]+$/g, '').trim();
}
// 复现用户截图中的错误形态：状态复选框格夹在名称与机构之间，结论后还有重复的复选框/标签格
const cloudCells = [
  '系统是否依赖不在本系统范围内的云平台运行', '是 ☑',
  '云平台名称：浙江新型算力中心平台', '☑云平台已评估□云平台正在评估□云平台未评估',
  '密评机构名称：浙江东安检测技术有限公司', '评估时间：2025年12月05日', '评估结论：基本符合',
  '☑云平台已评估□云平台正在评估□云平台未评估', '密评机构名称：'
];
assert.equal(cloudValueFromCells(cloudCells, '云平台名称'), '浙江新型算力中心平台');
assert.equal(cloudValueFromCells(cloudCells, '密评机构名称'), '浙江东安检测技术有限公司');
assert.equal(cloudValueFromCells(cloudCells, '评估时间'), '2025年12月05日');
assert.equal(cloudValueFromCells(cloudCells, '评估结论'), '基本符合');
// 标签单独成格 / 值与复选框同格 两种形态也要正确
assert.equal(cloudValueFromCells(['云平台名称：', '浙江新型算力中心平台'], '云平台名称'), '浙江新型算力中心平台');
assert.equal(cloudValueFromCells(['云平台名称：浙江新型算力中心平台☑云平台已评估'], '云平台名称'), '浙江新型算力中心平台');

for (const relative of ['frontend/src/report-generator.html', 'frontend/public/prototype.html']) {
  const html = await fs.readFile(relative, 'utf8');
  assert.match(html, /const selectedText = nextStatus \? afterSelected\.slice\(0, nextStatus\.index\) : afterSelected;/, `${relative} 未按已选测评状态截取内容`);
  assert.match(html, /function cellAtPos\(label\)/, `${relative} 未提供按行列位置读取的 cellAtPos`);
  assert.match(html, /'prep-contact-email': cellAtPos\('电子邮件'\)/, `${relative} 电子邮件未改为按位置读取`);
  assert.match(html, /const cloudValue = function \(label\) \{/, `${relative} 云平台取值未改为逐格定位`);
  assert.match(html, /cloudValue\('云平台名称'\)/, `${relative} 云平台名称未按新签名取值`);
  assert.match(html, /cloudValue\('评估结论'\)/, `${relative} 云平台结论未按新签名取值（不得再跨行抓取）`);
  assert.match(html, /data\.systemScore = totals && totals\.total != null \? totals\.total : null;/, `${relative} 未在现场阶段保存实时评分`);
}

const server = await fs.readFile('backend/src/server.ts', 'utf8');
assert.match(server, /stage_key='onsite'/, '项目列表未优先读取现场阶段评分');
console.log('PASS: Word 基本信息的电子邮件按位读取、云平台逐格取值及项目列表实时评分检查通过。');
