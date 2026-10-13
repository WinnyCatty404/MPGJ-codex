import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from 'jszip';
import sharp from 'sharp';
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
// 1800px 截图已满足 13cm 报告图片的高清需求，应原样保留 PNG，不能再降为 1400px JPEG。
const hdPngBytes = await sharp({
  create: { width: 1800, height: 1000, channels: 3, background: { r: 248, g: 250, b: 252 } },
}).png().toBuffer();
const hdPng = 'data:image/png;base64,' + hdPngBytes.toString('base64');
const widePngBytes = await sharp({
  create: { width: 1600, height: 900, channels: 3, background: { r: 235, g: 240, b: 245 } },
}).png().toBuffer();
const widePng = 'data:image/png;base64,' + widePngBytes.toString('base64');
const tallPngBytes = await sharp({
  create: { width: 500, height: 1800, channels: 3, background: { r: 245, g: 247, b: 250 } },
}).png().toBuffer();
const tallPng = 'data:image/png;base64,' + tallPngBytes.toString('base64');
// 该比例会产生非整数 EMU 高度，用于防止将小数 cx/cy 写入 DOCX。
const fractionalPngBytes = await sharp({
  create: { width: 1379, height: 800, channels: 3, background: { r: 242, g: 246, b: 250 } },
}).png().toBuffer();
const fractionalPng = 'data:image/png;base64,' + fractionalPngBytes.toString('base64');
const beforeEvidenceXml = xml;
xml = await writeReportEvidence(xml, zip, {
  '0|0|0': { evidence: [{ no: '图A-1.1', name: '测试截图', dataUrl: png }] },
  '1|0|0': { evidence: [{ no: '图A-2.1', name: '高清截图', dataUrl: hdPng }] },
  '7|0|0': { evidence: [{ no: '图A-8.1', name: '应急截图', dataUrl: tallPng }] },
}, [
  { layer: 2, no: '图A-3.1', name: '多张并排测试', images: [widePng, widePng, widePng].map(dataUrl => ({ dataUrl })) },
  { layer: 3, no: '图A-4.1', name: '非整数比例测试', images: [{ dataUrl: fractionalPng }] },
]);
assert.ok(xml.includes('图A-1.1 测试截图'));
assert.ok(xml.includes('图A-8.1 应急截图'));
const evidenceParagraphs = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map(match => match[0]);
const multiImageRows = evidenceParagraphs.filter(paragraph =>
  paragraph.includes('<w:drawing>') && paragraph.includes('图A-3.1 多张并排测试'));
assert.deepEqual(multiImageRows.map(paragraph => (paragraph.match(/<w:drawing>/g) || []).length), [2, 1],
  '三张宽图应按原比例排成两张一行、末张单独一行');
assert.ok(multiImageRows.every(paragraph => paragraph.includes('<w:ind w:left="0" w:right="0" w:firstLine="0" w:firstLineChars="0"/>')),
  '图片行不能继承正文首行缩进');
assert.ok(!multiImageRows[0].includes('<w:keepNext/>'), '前一行允许跨页');
assert.ok(multiImageRows[1].includes('<w:keepNext/>'), '最后一行必须与图题同页');
assert.equal(evidenceParagraphs[evidenceParagraphs.indexOf(multiImageRows[1]) + 1].includes('图A-3.1 多张并排测试'), true,
  '图题应在最后一行图片后另起一段');
for (const paragraph of multiImageRows) {
  const widths = [...paragraph.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)].map(match => Number(match[1]));
  assert.ok(widths.reduce((sum, width) => sum + width, 0) <= 13 * 360000,
    '同一行图片总宽度不能超过报告可用宽度');
}
const drawingExtents = [...xml.matchAll(/<(?:wp:extent|a:ext)\b[^>]*\bcx="([^"]+)"[^>]*\bcy="([^"]+)"/g)];
assert.ok(drawingExtents.length > 0, '应生成图片尺寸属性');
assert.ok(drawingExtents.every(match => /^\d+$/.test(match[1]) && /^\d+$/.test(match[2])),
  'DOCX 图片的 cx/cy 必须为整数，否则 Microsoft Word 会拒绝打开文件');
assert.ok(!xml.includes('门禁控制器实物图'));
assert.ok(!xml.includes('密码安全事件上报'));
assert.ok(xml.includes('<w:vMerge w:val="restart"/>'));
assert.ok(xml.includes('<w:vMerge w:val="continue"/>'));
assert.ok(xml.includes('<w:keepNext/>'), '证据图片段落必须与后续图题保持同页');
assert.ok(xml.includes('cy="4320000"'), '超高证据图片必须按比例限制为最高12cm');
assert.equal((xml.match(/<w:sectPr\b/g) || []).length, (await zip.file('word/document.xml').async('string')).match(/<w:sectPr\b/g).length);
assert.ok(zip.file('word/media/bb-evidence-1-1-1.png'));
assert.deepEqual(await zip.file('word/media/bb-evidence-2-1-1.png').async('nodebuffer'), hdPngBytes);
assert.ok(zip.file('word/media/bb-evidence-8-1-1.png'));
const rels = await zip.file('word/_rels/document.xml.rels').async('string');
assert.ok(rels.includes('bb-evidence-1-1-1.png'));
assert.ok(rels.includes('bb-evidence-8-1-1.png'));
zip.file('word/document.xml', xml);
const reopened = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }));
assert.ok(await reopened.file('word/document.xml').async('string'));
// 新模板已经在各现场测评表后提供双花括号占位符；图片应写入现有段落，不能删除周边正文。
const placeholderZip = await JSZip.loadAsync(fs.readFileSync(new URL('../storage/templates/report/default-report-template.docx', import.meta.url)));
const placeholderXml = beforeEvidenceXml;
const placeholderParagraphs = [...placeholderXml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)]
  .filter(match => text(match[0]).trim() === '{{证据截图列表}}');
assert.equal(placeholderParagraphs.length, 8, '报告模板的8个现场测评表后应各有一个证据截图占位符');
const placeholderResult = await writeReportEvidence(placeholderXml, placeholderZip, {
  '0|0|0': { evidence: [{ no: '图A-1.1', name: '双括号测试', dataUrl: png }] },
});
assert.ok(placeholderResult.includes('图A-1.1 双括号测试'));
assert.ok(!placeholderResult.includes('{{证据截图列表}}'));
assert.ok(placeholderResult.includes('网络和通信安全'), '占位符模式不得删除下一层面的正文');
assert.ok(placeholderZip.file('word/media/bb-evidence-1-1-1.png'));
const firstPlaceholder = placeholderParagraphs[0];
const duplicateXml = placeholderXml.slice(0, firstPlaceholder.index) + firstPlaceholder[0]
  + placeholderXml.slice(firstPlaceholder.index);
const duplicateZip = await JSZip.loadAsync(fs.readFileSync(new URL('../storage/templates/report/default-report-template.docx', import.meta.url)));
await assert.rejects(writeReportEvidence(duplicateXml, duplicateZip, {}), /只能有一个/);
console.log('PASS: eight onsite tables expand; old screenshot regions and {{证据截图列表}} placeholders both write images.');
