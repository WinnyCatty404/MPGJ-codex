const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../frontend/public/prototype.html'), 'utf8');
const first = html.indexOf('  let appendixBImages = {}');
const firstEnd = html.indexOf('  function apbSave(', first);
const deleteStart = html.indexOf('  function apbDeleteImage(');
const deleteEnd = html.indexOf('  function apbImportImage(', deleteStart);
assert.ok(first >= 0 && firstEnd > first && deleteStart > firstEnd && deleteEnd > deleteStart);
const context = vm.createContext({
  renderAppendixB() {},
  document: { dispatchEvent() {} },
  CustomEvent: class { constructor(type) { this.type = type; } }
});
vm.runInContext(html.slice(first, firstEnd) + html.slice(deleteStart, deleteEnd), context);
vm.runInContext("appendixBImages['b1-file'] = '旧图片'; apbStoreImage('b1-file', '新图片1'); apbStoreImage('b1-file', '新图片2');", context);
assert.deepEqual(Array.from(vm.runInContext("appendixBImages['b1-file']", context)), ['旧图片','新图片1','新图片2']);
vm.runInContext("apbDeleteImage('b1-file', null, 1)", context);
assert.deepEqual(Array.from(vm.runInContext("appendixBImages['b1-file']", context)), ['旧图片','新图片2']);
vm.runInContext("apbStoreImage('b6', '评审图1'); apbStoreImage('b6', '评审图2');", context);
assert.equal(vm.runInContext("appendixBImages['b6'].length", context), 2);
for (const key of ['b2-travel', 'b2-bill', 'b2-invoice']) {
  vm.runInContext(`apbStoreImage('${key}', '票据图1'); apbStoreImage('${key}', '票据图2');`, context);
  assert.equal(vm.runInContext(`appendixBImages['${key}'].length`, context), 2);
}
vm.runInContext("apbStoreImage('b9', '备案图1'); apbStoreImage('b9', '备案图2');", context);
assert.equal(vm.runInContext("appendixBImages['b9']", context), '备案图2');
console.log('PASS: appendix B selected slots append/delete multiple images; legacy single image remains usable.');
