import assert from 'node:assert/strict';
import fs from 'node:fs';

for (const file of ['frontend/public/prototype.html', 'frontend/src/report-generator.html']) {
  const html = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  assert.match(html, /是，投入运行时间：<input type="text" id="mi-operation-date"/,
    file + ' 缺少投入运行时间输入框');
  assert.match(html, /\['系统投入运行情况','系统是否已投入运行'\]/,
    file + ' 未将投入运行整行映射到 Word 字段');
  assert.match(html, /fillLineFirst\(\/投入运行时间\//,
    file + ' 缺少 Word 投入运行时间定向回填');
  assert.match(html, /\/投入运行时间\[：:]\\s\*\(\[\^☑□\\n\]\+\)\//,
    file + ' 的投入运行时间提取规则缺失');
}

const sample = '☑是，投入运行时间：2023年6月\n□否，目前情况：建设中';
assert.equal((/投入运行时间[：:]\s*([^☑□\n]+)/.exec(sample) || [])[1]?.trim(), '2023年6月');

console.log('PASS: operation date is exported with the checked row and restored from Word.');
