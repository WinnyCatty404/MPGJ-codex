const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync(path.join(__dirname, '../frontend/public/prototype.html'), 'utf8');
const start = html.indexOf('  function indentEveryParagraph(');
const end = html.indexOf('  function normalizeParagraphTextarea(', start);
assert.ok(start >= 0 && end > start);
const context = vm.createContext({});
vm.runInContext(html.slice(start, end), context);
const indent = context.indentEveryParagraph;

assert.equal(indent('第一段\n第二段\n第三段'), '　　第一段\n　　第二段\n　　第三段');
assert.equal(indent('首段自动换行，但不应在视觉折行处另加缩进。'), '　　首段自动换行，但不应在视觉折行处另加缩进。');
assert.equal(indent('第一段\n\n  第二段'), '　　第一段\n\n　　第二段');
assert.equal(indent(indent('第一段\n第二段')), '　　第一段\n　　第二段');
assert.equal(indent(''), '');
console.log('PASS: each actual paragraph has exactly two ideographic spaces; blank lines and idempotence preserved.');
