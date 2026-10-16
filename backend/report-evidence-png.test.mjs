import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import JSZip from 'jszip';
import { optimizeAppendixPng, writeAppendixBImages, writeReportEvidence } from './dist/report-evidence.js';

async function samePixels(before, after) {
  const [original, optimized] = await Promise.all([
    sharp(before).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(after).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  assert.equal(original.info.width, optimized.info.width);
  assert.equal(original.info.height, optimized.info.height);
  assert.deepEqual(original.data, optimized.data);
}

test('附录 PNG 无损优化不改变不透明截图像素，并仅在缩小时采用', async () => {
  const pixels = Buffer.alloc(800 * 400 * 4, 255);
  for (let index = 0; index < pixels.length; index += 4) pixels[index] = (index / 4) % 31;
  const before = await sharp(pixels, { raw: { width: 800, height: 400, channels: 4 } })
    .png({ compressionLevel: 0 }).toBuffer();
  const after = await optimizeAppendixPng(before);
  assert.ok(after.length < before.length);
  await samePixels(before, after);
  assert.deepEqual(await optimizeAppendixPng(after), after);
});

test('透明截图与非 PNG 图片保持像素和原格式', async () => {
  const pixels = Buffer.alloc(250 * 180 * 4, 0);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = 80;
    pixels[index + 1] = 120;
    pixels[index + 2] = 190;
    pixels[index + 3] = index % 8 ? 255 : 90;
  }
  const before = await sharp(pixels, { raw: { width: 250, height: 180, channels: 4 } })
    .png({ compressionLevel: 0 }).toBuffer();
  const after = await optimizeAppendixPng(before);
  assert.ok(after.length < before.length);
  await samePixels(before, after);
  const jpeg = await sharp(pixels, { raw: { width: 250, height: 180, channels: 4 } })
    .jpeg().toBuffer();
  assert.equal(await optimizeAppendixPng(jpeg), jpeg);
});

test('无效图片不影响报告导出', async () => {
  const invalid = Buffer.from('not an image');
  assert.equal(await optimizeAppendixPng(invalid), invalid);
});

test('正式报告附录 A、B 接入优化且不改变图题和顺序', async () => {
  const pixels = Buffer.alloc(480 * 240 * 4, 255);
  const original = await sharp(pixels, { raw: { width: 480, height: 240, channels: 4 } })
    .png({ compressionLevel: 0 }).toBuffer();
  const dataUrl = `data:image/png;base64,${original.toString('base64')}`;
  const zip = new JSZip();
  zip.file('word/_rels/document.xml.rels', '<Relationships></Relationships>');
  zip.file('[Content_Types].xml', '<Types></Types>');
  const layers = ['物理和环境安全', '网络和通信安全', '设备和计算安全', '应用和数据安全',
    '管理制度', '人员管理', '建设运行', '应急处置'];
  let xml = layers.map((layer, index) => `<w:p><w:r><w:t>表A-${index + 1}${layer}测评结果记录</w:t></w:r></w:p>` +
    '<w:tbl></w:tbl><w:p><w:r><w:t>{{证据截图列表}}</w:t></w:r></w:p>').join('');
  xml += '<w:p><w:r><w:t>{{委托证明文件照片列表}}</w:t></w:r></w:p>';
  xml = await writeReportEvidence(xml, zip, {}, [{ layer: 0, no: '图A-1.1', name: '测试证据',
    images: [{ dataUrl }, { dataUrl }] }]);
  xml = await writeAppendixBImages(xml, zip, { 'b1-file': [dataUrl] });
  const first = await zip.file('word/media/bb-evidence-1-1-1.png').async('nodebuffer');
  const second = await zip.file('word/media/bb-evidence-1-1-2.png').async('nodebuffer');
  const appendixB = await zip.file('word/media/bb-appendix-b1-file-1.png').async('nodebuffer');
  for (const image of [first, second, appendixB]) {
    assert.ok(image.length < original.length);
    await samePixels(original, image);
  }
  assert.ok(xml.includes('图A-1.1 测试证据'));
  assert.ok(xml.indexOf('rId1') < xml.indexOf('rId2'));
  assert.ok(xml.includes('rId3'));
});
