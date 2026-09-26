import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from 'jszip';
import { writeReportContent } from '../backend/dist/report-content.js';
import { writeReportEvidence } from '../backend/dist/report-evidence.js';

const names = ['物理和环境安全', '网络和通信安全', '设备和计算安全', '应用和数据安全', '管理制度', '人员管理', '建设运行', '应急处置'];
const zip = await JSZip.loadAsync(fs.readFileSync(new URL('../storage/templates/report/default-report-template.docx', import.meta.url)));
let xml = await zip.file('word/document.xml').async('string');
const styles = await zip.file('word/styles.xml').async('string');
const text = block => [...block.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(match => match[1]).join('');
const blocks = [...xml.matchAll(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)];
const patches = names.map((name, layer) => {
  const caption = new RegExp(`^表A-\\s*${layer + 1}.*测评结果记录`);
  const index = blocks.findIndex(block => block[0].startsWith('<w:p') && caption.test(text(block[0]).replace(/\s/g, '')));
  assert.ok(index >= 0, name);
  const skip = layer < 4 ? 2 : 1;
  const rows = [...blocks[index + 1][0].matchAll(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g)];
  const units = rows.slice(skip).map(row => {
    const firstCell = /<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/.exec(row[0]);
    return firstCell ? text(firstCell[0]).trim() : '';
  }).filter(Boolean);
  const groups = units.map((unit, unitIndex) => ({
    unit,
    rows: Array.from({ length: unitIndex === 0 ? 2 : 1 }, (_, objectIndex) => layer < 4
      ? [unit, `对象${layer}-${unitIndex}-${objectIndex}`, `新结果${layer}-${unitIndex}-${objectIndex}`, '√', '√', '√', '1.0000', '1.0000']
      : [unit, `对象${layer}-${unitIndex}-${objectIndex}`, `新结果${layer}-${unitIndex}-${objectIndex}`, '符合(1.0)', '1.0000']),
  }));
  return { caption: name + '测评结果记录', rows: [], groups, skip, required: true };
});

xml = writeReportContent(xml, styles, { tables: patches, sections: [] });
const updatedBlocks = [...xml.matchAll(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)];
for (let layer = 0; layer < 8; layer++) {
  assert.ok(xml.includes(`对象${layer}-0-0`));
  assert.ok(xml.includes(`对象${layer}-0-1`));
  assert.ok(xml.includes(`新结果${layer}-0-1`));
  const caption = new RegExp(`^表A-\\s*${layer + 1}.*测评结果记录`);
  const index = updatedBlocks.findIndex(block => block[0].startsWith('<w:p') && caption.test(text(block[0]).replace(/\s/g, '')));
  const dataRows = [...updatedBlocks[index + 1][0].matchAll(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g)].slice(layer < 4 ? 2 : 1);
  assert.equal(dataRows.length, patches[layer].groups.length + 1);
  for (const [rowIndex, mergeType] of [[0, 'restart'], [1, 'continue']]) {
    const cells = [...dataRows[rowIndex][0].matchAll(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g)];
    assert.ok(cells[0][0].includes(`<w:vMerge w:val="${mergeType}"/>`));
    assert.ok(cells.at(-1)[0].includes(`<w:vMerge w:val="${mergeType}"/>`));
  }
}
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9V0CIAAAAASUVORK5CYII=';
const beforeEvidenceXml = xml;
xml = await writeReportEvidence(xml, zip, {
  '0|0|0': { evidence: [{ no: '图A-1.1', name: '测试截图', dataUrl: png }] },
  '7|0|0': { evidence: [{ no: '图A-8.1', name: '应急截图', dataUrl: png }] },
});
assert.ok(xml.includes('图A-1.1 测试截图'));
assert.ok(xml.includes('图A-8.1 应急截图'));
assert.ok(!xml.includes('门禁控制器实物图'));
assert.ok(!xml.includes('密码安全事件上报'));
assert.ok(xml.includes('<w:vMerge w:val="restart"/>'));
assert.ok(xml.includes('<w:vMerge w:val="continue"/>'));
assert.equal((xml.match(/<w:sectPr\b/g) || []).length, (await zip.file('word/document.xml').async('string')).match(/<w:sectPr\b/g).length);
assert.ok(zip.file('word/media/bb-evidence-1-1.png'));
assert.ok(zip.file('word/media/bb-evidence-8-1.png'));
const rels = await zip.file('word/_rels/document.xml.rels').async('string');
assert.ok(rels.includes('bb-evidence-1-1.png'));
assert.ok(rels.includes('bb-evidence-8-1.png'));
zip.file('word/document.xml', xml);
const reopened = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }));
assert.ok(await reopened.file('word/document.xml').async('string'));
// 新模板在表后使用双花括号占位符；图片应插入该段落，不能删除周边正文。
const placeholderZip = await JSZip.loadAsync(fs.readFileSync(new URL('../storage/templates/report/default-report-template.docx', import.meta.url)));
const firstCaption = updatedBlocks.findIndex(block => block[0].startsWith('<w:p') && /^表A-1/.test(text(block[0]).replace(/\s/g, '')));
assert.ok(firstCaption >= 0);
const firstTable = updatedBlocks[firstCaption + 1];
const insertionPoint = firstTable.index + firstTable[0].length;
const slot = '<w:p><w:r><w:t>{{证据截图列表}}</w:t></w:r></w:p>';
const placeholderXml = beforeEvidenceXml.slice(0, insertionPoint) + slot + beforeEvidenceXml.slice(insertionPoint);
const placeholderResult = await writeReportEvidence(placeholderXml, placeholderZip, {
  '0|0|0': { evidence: [{ no: '图A-1.1', name: '双括号测试', dataUrl: png }] },
});
assert.ok(placeholderResult.includes('图A-1.1 双括号测试'));
assert.ok(!placeholderResult.includes('{{证据截图列表}}'));
assert.ok(placeholderResult.includes('门禁控制器实物图'), '占位符模式不得删除表后的其他内容');
assert.ok(placeholderZip.file('word/media/bb-evidence-1-1.png'));
const duplicateXml = placeholderXml.slice(0, insertionPoint) + slot + placeholderXml.slice(insertionPoint);
await assert.rejects(writeReportEvidence(duplicateXml, placeholderZip, {}), /只能有一个/);
console.log('PASS: eight onsite tables expand; old screenshot regions and {{证据截图列表}} placeholders both write images.');
