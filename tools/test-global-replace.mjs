import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../frontend/public/prototype.html', import.meta.url), 'utf8');
const marker = 'function replaceImplementationText(';
const start = html.indexOf(marker);
assert.ok(start >= 0, '未找到全局替换函数');
const braceStart = html.indexOf('{', start);
let depth = 0;
let end = -1;
for (let index = braceStart; index < html.length; index += 1) {
  if (html[index] === '{') depth += 1;
  else if (html[index] === '}') {
    depth -= 1;
    if (depth === 0) { end = index + 1; break; }
  }
}
assert.ok(end > braceStart, '全局替换函数结构无效');

const context = {};
vm.runInNewContext(html.slice(start, end) + '\nthis.replaceImplementationText = replaceImplementationText;', context);
const counter = { count: 0 };
const source = {
  cryptoKeyTables: {
    symmetric: [{ level: '1', type: '旧算法类型', functionText: '使用旧算法完成保护' }],
  },
  toolData: [{ name: '旧算法检测工具', version: '旧算法版', vendor: '厂商' }],
  fields: [{ type: 'text', value: '旧算法输入值', checked: false }],
  topologyBlocks: [{ type: 'text', content: '拓扑使用旧算法' }],
  image: { type: 'image', dataUrl: 'data:image/png;base64,旧算法' },
};
const result = context.replaceImplementationText(source, '', '旧算法', '新算法', counter);

assert.equal(result.cryptoKeyTables.symmetric[0].type, '新算法类型', '表2-2类型列必须参与替换');
assert.equal(result.cryptoKeyTables.symmetric[0].functionText, '使用新算法完成保护', '表2-2功能列必须参与替换');
assert.equal(result.toolData[0].version, '新算法版', '业务表格版本列必须参与替换');
assert.equal(result.fields[0].type, 'text', '控件内部类型不得替换');
assert.equal(result.fields[0].value, '新算法输入值', '控件值必须参与替换');
assert.equal(result.topologyBlocks[0].type, 'text', '拓扑块内部类型不得替换');
assert.equal(result.topologyBlocks[0].content, '拓扑使用新算法', '拓扑正文必须参与替换');
assert.equal(result.image.dataUrl, source.image.dataUrl, '图片数据不得替换');
assert.equal(counter.count, 6, '替换计数应覆盖所有业务文本');

console.log('PASS: global replace covers table type/version/content while preserving internal types and image data.');
