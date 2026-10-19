import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from 'jszip';
import ts from 'typescript';

const labels = [
  '普通用户-上城区一体化智能化公共数据平台',
  '管理员用户-上城区一体化智能化公共数据平台',
  '浙政钉用户-上城区一体化智能化公共数据平台',
];

for (const file of ['frontend/src/report-generator.html', 'frontend/public/prototype.html']) {
  const html = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    if (match[1].trim()) new Function(match[1]);
  }

  const accessPointSource = html.match(/  function _impParseAccessPoints\(blocks\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(accessPointSource, file + ' 缺少接入点解析函数');
  const parse = new Function(accessPointSource + '\nreturn _impParseAccessPoints;')();
  assert.deepEqual(parse([
    { type: 'p', text: '接入点JA：首先核查普通用户，接入点JB：然后核查管理员用户。' },
    { type: 'p', text: '接入点JC和接入点JD：共同检查。' },
    { type: 'p', text: '在接入点JE：后续内容中，不应误识别。' },
    { type: 'tbl', text: '接入点JF：表格不是接入点描述。' },
  ]), [
    { letter: 'A', desc: '首先核查普通用户，' },
    { letter: 'B', desc: '然后核查管理员用户。' },
    { letter: 'C', desc: '共同检查。' },
    { letter: 'D', desc: '共同检查。' },
  ], file + ' 未正确分割同段多接入点或联合接入点');
  assert.match(html, /const aps = _impParseAccessPoints\(blocks\)/);

  const displaySource = html.match(/  function getOnsiteObjectDisplayName\(t, unitName, objectIndex, objectName\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(displaySource, file + ' 缺少表A-4对象显示名称规则');
  const display = new Function('getAppUserDisplayNames', displaySource + '\nreturn getOnsiteObjectDisplayName;')(() => labels);
  labels.forEach((label, index) => assert.equal(display(3, '身份鉴别', index, ['普通用户', '管理员用户', '浙政钉用户'][index]), label));
  assert.equal(display(3, '访问控制', 0, '业务系统'), '业务系统');
  assert.equal(display(2, '身份鉴别', 0, '设备用户'), '设备用户');
  assert.match(html, /onsiteEsc\(getOnsiteObjectDisplayName\(t, u\.name, objIdx, objName\)\)/);
  assert.match(html, /\[item\.name, getOnsiteObjectDisplayName\(t, item\.name, objIdx, object\), record,/);
}

const template = await JSZip.loadAsync(fs.readFileSync(new URL('../storage/templates/report/default-report-template.docx', import.meta.url)));
const xml = await template.file('word/document.xml').async('string');
const styles = await template.file('word/styles.xml').async('string');
const plainText = block => [...block.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(match => match[1]).join('');
const blocks = [...xml.matchAll(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)];
const captionIndex = blocks.findIndex(block => block[0].startsWith('<w:p') && /^表A-4.*测评结果记录/.test(plainText(block[0]).replace(/\s/g, '')));
assert.ok(captionIndex >= 0, '模板缺少表A-4');
const templateRows = [...blocks[captionIndex + 1][0].matchAll(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g)].slice(2);
const units = templateRows.map(row => plainText(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/.exec(row[0])?.[0] || '').trim()).filter(Boolean);
assert.ok(units.includes('身份鉴别'), '模板表A-4缺少身份鉴别');
const groups = units.map(unit => ({
  unit,
  rows: (unit === '身份鉴别' ? labels : ['其他对象']).map(label => [unit, label, '测试结果', '√', '√', '√', '1.0000', '1.0000']),
}));
const moduleSource = ts.transpileModule(fs.readFileSync(new URL('../backend/src/report-content.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { writeReportContent } = await import('data:text/javascript;base64,' + Buffer.from(moduleSource).toString('base64'));
const output = writeReportContent(xml, styles, { sections: [], tables: [{
  caption: '应用和数据安全测评结果记录', skip: 2, required: true, rows: [], groups,
}] });
labels.forEach(label => assert.equal(output.split(label).length - 1, 1, `表A-4应恰好输出一次 ${label}`));

// 可选的原始文档实测：node tools/test-word-access-points-a4.mjs <样本.docx>
if (process.argv[2]) {
  const html = fs.readFileSync(new URL('../frontend/public/prototype.html', import.meta.url), 'utf8');
  const source = html.match(/  function _impParseAccessPoints\(blocks\) \{[\s\S]*?\n  \}/)[0];
  const parse = new Function(source + '\nreturn _impParseAccessPoints;')();
  const zip = await JSZip.loadAsync(fs.readFileSync(process.argv[2]));
  const xml = await zip.file('word/document.xml').async('string');
  const paragraphs = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map(match => ({
    type: 'p',
    text: [...match[0].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(part => part[1]).join(''),
  }));
  const sameParagraph = paragraphs.find(p => p.text.includes('接入点JA：') && p.text.includes('接入点JB：'));
  assert.ok(sameParagraph, '样本文档中未找到同段落的 JA、JB');
  const points = parse([sameParagraph]);
  assert.deepEqual(points.map(point => point.letter), ['A', 'B']);
  assert.ok(points.every(point => point.desc.length > 0));
  assert.ok(!points[0].desc.includes('接入点JB：'), 'JA 描述包含了 JB 标记');
  console.log('PASS: 样本 Word 的同段落 JA、JB 分别识别。');
}

console.log('PASS: 表A-4三个用户名称与页面一致，同段落接入点导入规则通过回归。');
