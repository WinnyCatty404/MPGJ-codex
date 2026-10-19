import assert from 'node:assert/strict';
import fs from 'node:fs';
import postcss from 'postcss';

const css = postcss.parse(fs.readFileSync(new URL('../frontend/public/dark-theme.css', import.meta.url), 'utf8'));
function value(selector, property) {
  let result;
  css.walkRules(rule => {
    if (!rule.selectors.includes(selector)) return;
    rule.walkDecls(property, decl => { result = decl.value; });
  });
  assert.ok(result, `缺少 ${selector} 的 ${property}`);
  const variable = /^var\((--[^)]+)\)$/.exec(result);
  return variable ? value('html[data-theme="dark"]', variable[1]) : result;
}
function luminance(hex) {
  const normalized = /^#[\da-f]{3}$/i.test(hex)
    ? '#' + [...hex.slice(1)].map(channel => channel + channel).join('') : hex;
  const channels = normalized.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  assert.ok(channels, `测试需要不透明颜色：${hex}`);
  const linear = channels.slice(1).map(channel => {
    const number = parseInt(channel, 16) / 255;
    return number <= 0.04045 ? number / 12.92 : ((number + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
function check(label, foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  assert.ok(contrast >= 4.5, `${label} 对比度 ${contrast.toFixed(2)}:1，低于 4.5:1`);
}

const dark = 'html[data-theme="dark"]';
const surface = value(dark, '--dark-surface');
const template = `${dark} .settings-page`;
const risk = `${dark} .risk-analysis-page`;
check('模板卡片说明', value(`${template} .template-card p`, 'color'), surface);
check('模板卡片英文标签', value(`${template} .template-card small`, 'color'), surface);
for (const selector of ['.template-meta b', '.template-meta span']) {
  check('模板文件信息 ' + selector, value(`${template} ${selector}`, 'color'), value(`${template} .template-meta`, 'background'));
}
check('模板提示', value(`${template} .template-tip`, 'color'), value(`${template} .template-tip`, 'background'));
check('模板提示标签', value(`${template} .template-tip strong`, 'color'), value(`${template} .template-tip strong`, 'background'));
check('风险模板说明', value(`${risk} .risk-template-head p`, 'color'), surface);
check('风险模板英文标签', value(`${risk} .risk-template-head small`, 'color'), surface);
check('风险摘要', value(`${risk} .risk-template-summary span`, 'color'), value(`${risk} .risk-template-summary > div`, 'background'));
check('风险层面标签', value(`${risk} .risk-layer-tabs button`, 'color'), value(`${risk} .risk-layer-tabs`, 'background'));
check('当前风险层面', value(`${risk} .risk-layer-tabs button.active`, 'color'), value(`${risk} .risk-layer-tabs button.active`, 'background'));
check('风险表头', value(`${risk} .risk-template-list-head`, 'color'), value(`${risk} .risk-template-list-head`, 'background'));
for (const selector of ['.risk-template-list-row strong', '.risk-template-list-row p']) {
  check('风险表格 ' + selector, value(`${risk} ${selector}`, 'color'), value(`${risk} .risk-template-list-row`, 'background'));
}
check('风险威胁编码', value(`${risk} .risk-template-list-row code`, 'color'), value(`${risk} .risk-template-list-row code`, 'background'));
for (const kind of ['高', '中', '低']) {
  const selector = `${risk} .risk-level-badge.level-${kind}`;
  check(kind + '风险标签', value(selector, 'color'), value(selector, 'background'));
}

console.log('PASS: 模板设置和风险分析深色模式关键文字对比度均不低于 4.5:1。');
