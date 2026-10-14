import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { writeReportEvidence } from '../backend/dist/report-evidence.js';

const [sourcePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !outputPath) {
  throw new Error('用法：node tools/verify-appendix-evidence-layout.mjs 原报告.docx 验证稿.docx');
}

const source = await JSZip.loadAsync(await fs.readFile(sourcePath));
const sourceXml = await source.file('word/document.xml')?.async('string');
const sourceRels = await source.file('word/_rels/document.xml.rels')?.async('string');
assert.ok(sourceXml && sourceRels, '原报告缺少正文或图片关系');
const relationships = new Map([...sourceRels.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*\/>/g)]
  .map(match => [match[1], match[2]]));
const paragraphs = [...sourceXml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map(match => match[0]);
const text = paragraph => [...paragraph.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
  .map(match => match[1]).join('').replace(/&amp;/g, '&');
const appendixStart = paragraphs.findIndex(paragraph => /^附录A测评结果记录$/.test(text(paragraph).trim()));
const appendixEnd = paragraphs.findIndex((paragraph, index) => index > appendixStart && /^附录B/.test(text(paragraph).trim()));
assert.ok(appendixStart >= 0 && appendixEnd > appendixStart, '无法定位原报告附录A');

const groups = [];
let pending = [];
for (const paragraph of paragraphs.slice(appendixStart, appendixEnd)) {
  pending.push(...[...paragraph.matchAll(/<a:blip\b[^>]*\br:embed="([^"]+)"/g)].map(match => match[1]));
  const label = /^(图A[-－](\d+)[.．](\d+))\s*(.*)/.exec(text(paragraph).trim());
  if (!label || !pending.length) continue;
  const images = [];
  for (const id of pending) {
    const target = relationships.get(id);
    assert.ok(target, `未找到 ${id} 的图片关系`);
    const entryName = path.posix.normalize(path.posix.join('word', target.replace(/^\//, '')));
    const bytes = await source.file(entryName)?.async('nodebuffer');
    assert.ok(bytes, `未找到 ${entryName}`);
    const ext = path.posix.extname(entryName).toLowerCase();
    assert.ok(['.png', '.jpg', '.jpeg', '.gif'].includes(ext), `不支持的图片格式 ${ext}`);
    images.push({ dataUrl: `data:image/${ext === '.jpg' ? 'jpeg' : ext.slice(1)};base64,${bytes.toString('base64')}` });
  }
  groups.push({ layer: Number(label[2]) - 1, no: label[1], name: label[4], images });
  pending = [];
}
assert.equal(pending.length, 0, '附录A存在未匹配图题的图片');
assert.ok(groups.length > 0, '附录A没有找到证据截图');

const template = await JSZip.loadAsync(await fs.readFile(new URL('../storage/templates/report/default-report-template.docx', import.meta.url)));
const xml = await template.file('word/document.xml').async('string');
const writtenXml = await writeReportEvidence(xml, template, {}, groups);
template.file('word/document.xml', writtenXml);
const expectedOrder = groups.flatMap(group => group.images.map(() => group.no));
const actualOrder = [...writtenXml.matchAll(/<wp:docPr\b[^>]*\bname="(图A[-－]\d+[.．]\d+)/g)]
  .map(match => match[1]);
assert.deepEqual(actualOrder, expectedOrder, '附录A证据截图顺序与原报告不一致');
let unchanged = 0;
for (let layer = 0; layer < 8; layer++) {
  const layerGroups = groups.filter(group => group.layer === layer)
    .sort((a, b) => Number(/\.(\d+)$/.exec(a.no)?.[1] || 0) - Number(/\.(\d+)$/.exec(b.no)?.[1] || 0));
  for (const [groupIndex, group] of layerGroups.entries()) {
    for (const [imageIndex, image] of group.images.entries()) {
      const [header, payload] = image.dataUrl.split(',', 2);
      const suffix = header.includes('jpeg') ? 'jpg' : header.includes('png') ? 'png' : 'gif';
      const entry = template.file(`word/media/bb-evidence-${layer + 1}-${groupIndex + 1}-${imageIndex + 1}.${suffix}`);
      assert.ok(entry, `${group.no} 第${imageIndex + 1}张图片缺失或格式被改变`);
      assert.ok((await entry.async('nodebuffer')).equals(Buffer.from(payload, 'base64')),
        `${group.no} 第${imageIndex + 1}张图片被重新压缩`);
      unchanged++;
    }
  }
}
await fs.writeFile(outputPath, await template.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(`提取 ${groups.length} 个图号、${unchanged} 张截图，嵌入字节与原报告一致；验证稿：${outputPath}`);
