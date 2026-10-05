import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from 'jszip';
import { writeTopologyBlocks } from '../backend/dist/report-evidence.js';

const template = fs.readFileSync(new URL('../storage/templates/report/default-report-template.docx', import.meta.url));
const zip = await JSZip.loadAsync(template);
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9V0CIAAAAASUVORK5CYII=';
let xml = await zip.file('word/document.xml').async('string');
xml = await writeTopologyBlocks(xml, zip, [
  { type: 'text', content: '第一段说明' },
  { type: 'image', dataUrl: png, caption: '图 2-1 第一张' },
  { type: 'text', content: '图片后的补充说明' },
  { type: 'image', dataUrl: png, caption: '图 2-2 第二张' },
], undefined, undefined, '测试系统');

const positions = ['第一段说明', '图 2-1 第一张', '图片后的补充说明', '图 2-2 第二张'].map(text => xml.indexOf(text));
assert.ok(positions.every(position => position >= 0), '全部拓扑图文块都应导出');
assert.deepEqual([...positions].sort((a, b) => a - b), positions, '拓扑图文块应按页面中的顺序导出');
assert.ok(zip.file('word/media/bb-topology-1.png'), '第一张拓扑图应写入 Word');
assert.ok(zip.file('word/media/bb-topology-2.png'), '第二张拓扑图应写入 Word');
assert.ok(!xml.includes('{{被测系统情况_拓扑图}}'));
assert.ok(!xml.includes('{{被测系统情况_网络拓扑图及描述_描述}}'));

const legacyZip = await JSZip.loadAsync(template);
let legacyXml = await legacyZip.file('word/document.xml').async('string');
legacyXml = await writeTopologyBlocks(legacyXml, legacyZip, undefined, png, '旧项目拓扑说明', '旧系统');
assert.ok(legacyXml.indexOf('图 2-1 旧系统网络拓扑图') < legacyXml.indexOf('旧项目拓扑说明'), '旧项目应按原来的图片、描述顺序兼容导出');
assert.ok(legacyZip.file('word/media/bb-topology-1.png'));

const levelTwoTemplate = fs.readFileSync(new URL('../storage/templates/report/level-2/default-report-template.docx', import.meta.url));
const levelTwoZip = await JSZip.loadAsync(levelTwoTemplate);
let levelTwoXml = await levelTwoZip.file('word/document.xml').async('string');
levelTwoXml = await writeTopologyBlocks(levelTwoXml, levelTwoZip, [
  { type: 'text', content: '二级系统说明' },
  { type: 'image', dataUrl: png },
], undefined, undefined, '二级测试系统');
assert.ok(levelTwoXml.includes('二级系统说明'));
assert.ok(levelTwoXml.includes('图 2-1 二级测试系统网络拓扑图'));
assert.ok(!levelTwoXml.includes('{{被测系统情况_拓扑图}}'));

console.log('PASS: 网络拓扑支持任意顺序的多段文字和多张图片，并兼容旧项目');
