const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

for (const relative of ['../frontend/public/prototype.html', '../frontend/src/report-generator.html']) {
  const html = fs.readFileSync(path.join(__dirname, relative), 'utf8');
  assert.ok(
    html.includes("['委托证明文件_文件类型','b1-type','政府采购合同']"),
    relative + ' 应为表 B-1 文件类型提供与页面一致的导出默认值'
  );
  assert.ok(
    html.includes('const current = apbVal(key, defaultValue);'),
    relative + ' 应在导出映射中使用字段默认值'
  );
}

console.log('PASS: appendix B-1 file type exports its visible default value.');
