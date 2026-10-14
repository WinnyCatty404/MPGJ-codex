import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from 'jszip';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateRawRecords } from '../backend/dist/raw-records.js';

const templateRoot = fileURLToPath(new URL('../storage/templates/records/', import.meta.url));
const layers = ['物理和环境安全', '网络和通信安全', '设备和计算安全', '应用和数据安全',
  '管理制度', '人员管理', '建设运行', '应急处置'];

function source(level) {
  const tables = layers.map((name, index) => ({
    caption: `${name}测评结果记录`,
    groups: [{ unit: `单元${index + 1}`, rows: index < 4
      ? [[`单元${index + 1}`, `对象${index + 1}`, `第${index + 1}层现场记录正文`, '√', '√', '√', '1.0000', '1.0000']]
      : [[`单元${index + 1}`, `对象${index + 1}`, `第${index + 1}层现场记录正文`, '符合', '1.0000']] }],
  }));
  return {
    project: { code: `TEST-L${level}`, report_code: `TEST-L${level}`, system_name: `测试${level}级系统`, org_name: '测试单位', system_level: level },
    stages: [
      { stage_key: 'planning', data: { fields: [], assets: {
        crypto: [[{ value: '密码产品甲' }], [{ value: '密码产品乙' }]],
        server: [[{ value: '服务器甲' }]],
        network: [[{ value: '网络设备甲' }], [{ value: '安全设备乙' }]],
        security: [[{ value: '不应出现在授权书的物理安防设施' }]],
        db: [[{ value: '数据库甲' }]],
        app: [[{ value: '业务应用甲' }]],
      }, toolData: [] } },
      { stage_key: 'reporting', data: { templateValues: {}, exportContent: { tables } } },
    ],
    institution: { name: '测试机构', contact: '监督员' },
  };
}

const textOf = xml => [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(match => match[1]).join('');

for (const level of [2, 3]) {
  const files = await generateRawRecords(templateRoot, source(level));
  assert.ok(files.length >= 14, `等级${level}应生成完整原始记录`);

  const authorization = files.find(file => file.path.startsWith('4-现场测评授权书'));
  assert.ok(authorization, `等级${level}缺少现场测评授权书`);
  const authorizationZip = await JSZip.loadAsync(authorization.data);
  const authorizationText = textOf(await authorizationZip.file('word/document.xml').async('string'));
  const expectedDevices = ['密码产品甲', '密码产品乙', '服务器甲', '网络设备甲', '安全设备乙', '数据库甲', '业务应用甲'];
  let previousPosition = -1;
  for (const device of expectedDevices) {
    const position = authorizationText.indexOf(device);
    assert.ok(position > previousPosition, `授权书应按资产类别及表格行顺序列出${device}`);
    previousPosition = position;
  }
  assert.doesNotMatch(authorizationText, /不应出现在授权书的物理安防设施/);

  const quality = files.find(file => file.path.startsWith('11-质量监督记录表'));
  assert.ok(quality, `等级${level}缺少质量监督记录表`);
  const qualityZip = await JSZip.loadAsync(quality.data);
  const qualityText = textOf(await qualityZip.file('word/document.xml').async('string'));
  assert.match(qualityText, new RegExp(`商用密码应用安全性评估（${level === 2 ? '二' : '三'}级）作业指导书`));

  const basic = files.find(file => file.path.startsWith('1-系统基本情况调查表'));
  assert.ok(basic, `等级${level}缺少系统基本情况调查表`);
  const basicZip = await JSZip.loadAsync(basic.data);
  for (const name of Object.keys(basicZip.files).filter(name => /^word\/(document|styles|header\d*|footer\d*)\.xml$/.test(name))) {
    const xml = await basicZip.file(name).async('string');
    for (const font of xml.matchAll(/<w:rFonts\b([^>]*)\/>/g)) {
      assert.match(font[1], /w:ascii="Times New Roman"/);
      assert.match(font[1], /w:hAnsi="Times New Roman"/);
      assert.match(font[1], /w:eastAsia="宋体"/);
    }
  }

  for (let index = 0; index < layers.length; index++) {
    const onsite = files.find(file => file.path.endsWith(`${index + 1}-${layers[index]}.docx`));
    assert.ok(onsite, `等级${level}缺少第${index + 1}层现场核查表`);
    const onsiteZip = await JSZip.loadAsync(onsite.data);
    const onsiteText = textOf(await onsiteZip.file('word/document.xml').async('string'));
    assert.match(onsiteText, new RegExp(`第${index + 1}层现场记录正文`));
    assert.match(onsiteText, /现场测评记录/);
    assert.doesNotMatch(onsiteText, /暂无现场测评记录/);
  }
  if (process.env.RAW_RECORD_TEST_OUT) {
    for (const file of files.filter(item => item.path.startsWith('1-系统基本情况调查表')
      || item.path.startsWith('11-质量监督记录表')
      || item.path.endsWith('1-物理和环境安全.docx')
      || item.path.endsWith('5-管理制度.docx'))) {
      const target = path.join(process.env.RAW_RECORD_TEST_OUT, `level-${level}`, file.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.data);
    }
  }
}

console.log('PASS: level-specific quality template, bilingual fonts, and all eight onsite record tables verified.');
