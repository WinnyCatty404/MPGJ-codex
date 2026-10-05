import assert from 'node:assert/strict';
import fs from 'node:fs';

for (const file of ['frontend/public/prototype.html', 'frontend/src/report-generator.html']) {
  const html = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const source = /function _impOtherOptions\(text\) \{[\s\S]*?\n  \}/.exec(html)?.[0];
  assert.ok(source, file + ' 缺少“其他”选项解析函数');
  const parse = new Function(source + '; return _impOtherOptions;')();

  assert.deepEqual(parse('□电信  ☑其他 智慧园林'), [
    { checked: true, value: '智慧园林' },
  ]);
  assert.deepEqual(parse('☑其他＿＿政务服务平台＿＿\n'), [
    { checked: true, value: '政务服务平台' },
  ]);
  assert.deepEqual(parse('分组算法：☑SM4 ☑其他 AES-256\n非对称算法：☑SM2 □其他 RSA4096'), [
    { checked: true, value: 'AES-256' },
    { checked: false, value: 'RSA4096' },
  ]);
  assert.deepEqual(parse('□与其他行业系统连接 □与本行业其他单位系统连接\n☑其他 政务外网交换平台\n互联系统名称：统一交换系统'), [
    { checked: true, value: '政务外网交换平台' },
  ]);
  assert.match(html, /const otherOption = key === '其他' \? otherOptions\[otherOptionIndex\+\+\] : null;/);
  assert.match(html, /otherInput\.value = otherOption\.value;/);
}

console.log('PASS: checked “其他” options import their trailing Word text in both report pages.');
