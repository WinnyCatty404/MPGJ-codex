import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from 'jszip';
import { writePlanningImages, writeTopologyBlocks } from '../backend/dist/report-evidence.js';

const template = fs.readFileSync(new URL('../storage/templates/report/default-report-template.docx', import.meta.url));
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9V0CIAAAAASUVORK5CYII=';

async function render(images, captions = {}) {
  const zip = await JSZip.loadAsync(template);
  let xml = await zip.file('word/document.xml').async('string');
  xml = await writeTopologyBlocks(xml, zip, [
    { type: 'image', dataUrl: png },
    { type: 'text', content: '拓扑说明' },
    { type: 'image', dataUrl: png },
  ], undefined, undefined, '测试系统');
  return writePlanningImages(xml, zip, images, 2, captions);
}

const complete = await render({
  'device-crypto-image': png,
  'application-crypto-image': png,
});
assert.match(complete, /图 2-3 设备和计算安全密码应用情况/);
assert.match(complete, /图 2-4 应用和数据安全密码应用情况/);
assert.doesNotMatch(complete, /图 2-2设备和计算安全密码应用情况/);

const applicationOnly = await render({ 'application-crypto-image': png });
assert.doesNotMatch(applicationOnly, /图\s*2[-－—]\s*\d+\s*设备和计算安全密码应用情况/);
assert.match(applicationOnly, /图 2-3 应用和数据安全密码应用情况/);

const allLayers = await render({
  'physical-crypto-image': png,
  'network-crypto-image': png,
  'device-crypto-image': png,
  'application-crypto-image': png,
}, { 'physical-crypto-image': '自定义物理图片名称', 'application-crypto-image': '自定义应用图片名称' });
for (const [number, name] of [
  [3, '自定义物理图片名称'], [4, '网络和通信安全密码应用情况'],
  [5, '设备和计算安全密码应用情况'], [6, '自定义应用图片名称'],
]) assert.match(allLayers, new RegExp(`图 2-${number} ${name}`));
const paragraphTexts = [...allLayers.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)]
  .map(match => [...match[0].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(part => part[1]).join(''));
assert.ok(paragraphTexts.includes('{{被测系统情况_密码应用情况_物理和环境安全}}'),
  '物理层面的文字占位符仍应保留给后续正文写入');

console.log('PASS: 密码应用概况图片按拓扑图实际数量连续编号');
