import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../backend/dist/server.js', import.meta.url), 'utf8');
const start = source.indexOf('function xmlEscape(');
const end = source.indexOf('function throwIfExportBindingsIncomplete(', start);
assert.ok(start >= 0 && end > start);
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context);
const xml = '<w:p><w:r><w:t>{{报告编号}}</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>{{系</w:t></w:r><w:r><w:t>统名称}}</w:t></w:r></w:p>';
const result = vm.runInContext('replaceTextInXml(xml, replacements)', Object.assign(context, {
  xml,
  replacements: {
    '{报告编号}': '单括号报告号', '{{报告编号}}': 'MP-2026-001',
    '{系统名称}': '单括号系统名', '{{系统名称}}': '测试系统'
  }
}));
assert.ok(result.includes('MP-2026-001'));
assert.ok(result.includes('测试系统'));
assert.ok(!result.includes('{{') && !result.includes('单括号'));
console.log('PASS: split-run {{}} Word placeholders replace without leftover braces.');
