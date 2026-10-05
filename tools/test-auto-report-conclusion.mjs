import assert from 'node:assert/strict';
import fs from 'node:fs';

const prefix = '通过对测试系统的物理和环境安全、网络和通信安全、设备和计算安全、应用和数据安全、管理制度、人员管理、建设运行和应急处置等方面的测评，';
for (const file of ['frontend/public/prototype.html', 'frontend/src/report-generator.html']) {
  const html = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const source = /function buildConclusionSentence\(\) \{[\s\S]*?\n  \}/.exec(html)?.[0];
  assert.ok(source, file + ' 缺少自动评估结论函数');
  const make = (level, total, conclusion) => new Function('getReportTotalScore', 'getReportConclusion', 'document', 'assessmentLevel',
    source + '; return buildConclusionSentence;')(
      () => ({ total }),
      () => conclusion,
      { getElementById: id => id === 'mi-sys-name' ? { value: '测试系统' } : null },
      () => level,
    )();
  assert.equal(make(2, 82.6, '基本符合'), prefix + '该系统综合得分为82.6分，系统密码应用面临中风险，基本符合GB/T 39786—2021《信息安全技术 信息系统密码应用基本要求》的第二级别要求。');
  assert.equal(make(3, 82.6, '基本符合'), prefix + '该系统综合得分为82.6分，系统密码应用面临中风险，基本符合GB/T 39786—2021《信息安全技术 信息系统密码应用基本要求》的第三级别要求。');
  assert.equal(make(3, 52.4, '不符合'), prefix + '该系统综合得分为52.4分，系统密码应用面临高风险，不符合GB/T 39786—2021《信息安全技术 信息系统密码应用基本要求》的第三级别要求。');

  const importStart = html.indexOf('function applyWordImport(');
  const importEnd = html.indexOf('// 初始化测评对象表格', importStart);
  const importSource = html.slice(importStart, importEnd);
  assert.ok(importStart >= 0 && importEnd > importStart, file + ' 无法定位Word导入流程');
  assert.doesNotMatch(importSource, /reportTexts\s*\[\s*['"]report-conclusion-text['"]\s*\]\s*=/,
    file + ' 仍从Word导入评估结论正文');
  assert.match(importSource, /评估结论正文与「测评结果及量化评估」不导入/);
}

console.log('PASS: report conclusion is not imported and auto-generates with score plus level 2/3 wording.');
