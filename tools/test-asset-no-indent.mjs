// 校验系统资产五列「取消首行缩进」：页面不再写入缩进空格、历史缩进被剥离、Word 导出同样不缩进。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const html = await fs.readFile('frontend/src/report-generator.html', 'utf8');

function extractFn(name) {
  const start = html.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, '未找到函数 ' + name);
  const end = html.indexOf('\n  function ', start + 1);
  return html.slice(start, end < 0 ? html.length : end);
}

// ---------- 1. 选择器清单断言 ----------
const noIndentBlock = /const assetNoIndentSelector = \[([\s\S]*?)\]\.join\(','\);/.exec(html);
assert.ok(noIndentBlock, '未找到 assetNoIndentSelector 清单');
const noIndentCols = noIndentBlock[1];
[
  ['#asset-tbody-data td:nth-child(3) textarea', '重要数据·数据描述'],
  ['#asset-tbody-crypto td:nth-child(7) textarea', '密码产品·用途'],
  ['#asset-tbody-server td:nth-child(7) textarea', '服务器/存储设备·用途'],
  ['#asset-tbody-network td:nth-child(5) textarea', '网络及安全设备·用途（包括涉及的密码技术）'],
  ['#asset-tbody-person td:nth-child(4) textarea', '人员·职责说明']
].forEach(([selector, label]) => {
  assert.ok(noIndentCols.includes(selector), `${label} 未列入不缩进清单`);
});

// 这五列必须已从「缩进清单」中移除（否则会被补回缩进）
const indentBlock = /const paragraphTextareaSelector = \[([\s\S]*?)\]\.join\(','\);/.exec(html);
assert.ok(indentBlock, '未找到 paragraphTextareaSelector 清单');
[
  '#asset-tbody-data td:nth-child(3) textarea',
  '#asset-tbody-crypto td:nth-child(7) textarea',
  '#asset-tbody-server td:nth-child(7) textarea',
  '#asset-tbody-network td:nth-child(5) textarea',
  '#asset-tbody-person td:nth-child(4) textarea'
].forEach(selector => {
  assert.ok(!indentBlock[1].includes(selector), `${selector} 仍在缩进清单中，会被补回缩进`);
});
// 其它说明列应保留缩进行为
assert.ok(indentBlock[1].includes('#asset-tbody-doc td:nth-child(3) textarea'), '安全管理文档·描述不应取消缩进');
assert.ok(indentBlock[1].includes('#asset-tbody-app td:nth-child(5) textarea'), '关键业务应用·描述不应取消缩进');

// ---------- 2. 剥离函数行为 ----------
const strip = new Function('value', extractFn('stripParagraphIndent').replace('function stripParagraphIndent', 'return function') + ';')(null);
assert.equal(strip('\u3000\u3000第一段\n\u3000\u3000第二段'), '第一段\n第二段', '未剥离全角缩进');
assert.equal(strip('  前导空格内容'), '前导空格内容', '未剥离半角空格');
assert.equal(strip('\u3000第一段\n\n\u3000第二段'), '第一段\n\n第二段', '空行应保留、非空行去缩进');
assert.equal(strip('无需缩进'), '无需缩进', '普通内容不应被改变');
assert.equal(strip(''), '', '空值应返回空串');

// ---------- 3. 事件处理器已接入不缩进分支 ----------
assert.match(html, /if \(el\.matches\(assetNoIndentSelector\)\) return;/, '回车未跳过不缩进列');
assert.match(html, /function normalizeNoIndentTextarea\(el\)/, '缺少不缩进列的归一化函数');
assert.match(html, /root\.querySelectorAll\(assetNoIndentSelector\)\.forEach\(normalizeNoIndentTextarea\);/, '归一化未覆盖不缩进列');
assert.match(html, /if \(el\.matches\(assetNoIndentSelector\)\) \{[\s\S]{0,200}?stripParagraphIndent\(el\.value\)/, 'focusout 未剥离不缩进列的历史缩进');

// ---------- 4. 导出侧不缩进 ----------
assert.match(html, /const noIndentHeaders = \{[\s\S]*?data: \['数据描述'\][\s\S]*?person: \['职责说明'\]/, '导出侧未登记不缩进的表头列');
assert.match(html, /return noIndentCols\.indexOf\(originalCol\) >= 0 \? stripParagraphIndent\(raw\) : raw;/, '导出取数未对不缩进列做剥离');

console.log('PASS: 重要数据·数据描述等五列的页面与Word导出首行缩进取消检查通过。');
