const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const relative of ['../frontend/public/prototype.html', '../frontend/src/report-generator.html']) {
  const html = fs.readFileSync(path.join(__dirname, relative), 'utf8');
  const start = html.indexOf('  function onsiteClipboardImageFiles(');
  const handler = html.indexOf('  // 全局 Ctrl+V：结果描述框中粘贴图片时自动建立证据组', start);
  assert.ok(start >= 0 && handler > start, relative + ' 应包含剪贴板图片和目标解析函数');
  const context = vm.createContext({
    activeOnsiteEvidenceGroupId: 'old-group',
    onsiteRecordEditorTarget: { key: 'old-key', element: {} },
    locateOnsiteRecordKey: key => key === 'new-key' ? { t: 2, itemIdx: 3, objIdx: 4 } : null,
    document: { body: { contains: element => !!element?.connected } }
  });
  vm.runInContext(html.slice(start, handler), context);

  const itemImage = { name: 'clipboard.png', type: 'image/png', size: 12, lastModified: 1 };
  const fileOnlyImage = { name: 'evidence.jpg', type: '', size: 34, lastModified: 2 };
  const textFile = { name: 'notes.txt', type: 'text/plain', size: 5, lastModified: 3 };
  context.clipboard = {
    items: [{ kind: 'file', type: 'image/png', getAsFile: () => itemImage }],
    files: [itemImage, fileOnlyImage, textFile]
  };
  assert.deepEqual(
    Array.from(vm.runInContext('onsiteClipboardImageFiles(clipboard)', context), file => file.name),
    ['clipboard.png', 'evidence.jpg'],
    relative + ' 应合并 items/files、去重并过滤非图片'
  );
  context.clipboard = { items: [], files: [fileOnlyImage] };
  assert.deepEqual(
    Array.from(vm.runInContext('onsiteClipboardImageFiles(clipboard)', context), file => file.name),
    ['evidence.jpg'],
    relative + ' 应支持仅在 clipboardData.files 中出现的图片'
  );

  const editor = {
    connected: true,
    closest: selector => selector === 'textarea[data-onsite-record-key]' ? editor : null,
    getAttribute: name => name === 'data-onsite-record-key' ? 'new-key' : null
  };
  context.event = { target: editor };
  const target = vm.runInContext('resolveOnsitePasteTarget(event)', context);
  assert.equal(target.key, 'new-key', relative + ' 应以本次触发粘贴的编辑框覆盖旧焦点');
  assert.equal(target.element, editor);
  assert.equal(context.activeOnsiteEvidenceGroupId, '', relative + ' 切换编辑框时应结束旧证据组');
}

console.log('PASS: onsite evidence paste accepts clipboard items and file-only image sources.');
