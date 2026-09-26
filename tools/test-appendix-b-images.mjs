import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from 'jszip';
import { writeAppendixBImages } from '../backend/dist/report-evidence.js';

const template = fs.readFileSync(new URL('../storage/templates/report/default-report-template.docx', import.meta.url));
const zip = await JSZip.loadAsync(template);
const keys = ['委托证明文件照片列表', '差旅票证照片列表', '住宿账单照片列表', '住宿发票照片列表',
  '现场照片列表', '现场测评授权书照片列表', '密评报告评审照片列表'];
const xml = '<w:document><w:body>' + keys.map(name => {
  const token = `{{${name}}}`;
  const runs = name === '密评报告评审照片列表'
    ? `<w:r><w:t>${token.slice(0, 6)}</w:t></w:r><w:r><w:t>${token.slice(6)}</w:t></w:r>`
    : `<w:r><w:t>${token}</w:t></w:r>`;
  return `<w:tbl><w:tr><w:tc><w:p>${runs}</w:p></w:tc></w:tr></w:tbl>`;
}).join('') + '</w:body></w:document>';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9V0CIAAAAASUVORK5CYII=';
const output = await writeAppendixBImages(xml, zip, {
  'b1-file': [png, png],
  'b2-travel': [png, png],
  'b2-bill': [png, png],
  'b2-invoice': [png, png],
  'b3-photo': [png, png, png],
  'b4-auth': png, // 旧项目的单张数据
  b6: [png, png],
});
assert.equal((output.match(/<w:drawing>/g) || []).length, 14);
assert.ok(!output.includes('{{'));
for (const name of keys) assert.ok(!output.includes(`{{${name}}}`));
for (const file of ['bb-appendix-b1-file-2.png','bb-appendix-b2-travel-2.png',
  'bb-appendix-b2-bill-2.png','bb-appendix-b2-invoice-2.png','bb-appendix-b3-photo-3.png',
  'bb-appendix-b4-auth-1.png','bb-appendix-b6-2.png']) assert.ok(zip.file(`word/media/${file}`));
const rels = await zip.file('word/_rels/document.xml.rels').async('string');
assert.ok(rels.includes('bb-appendix-b6-2.png'));
zip.file('word/document.xml', output);
const reopened = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }));
assert.ok((await reopened.file('word/document.xml').async('string')).includes('<w:drawing>'));
const missingZip = await JSZip.loadAsync(template);
await assert.rejects(writeAppendixBImages('<w:document><w:body/></w:document>', missingZip, { b6: [png] }), /缺少.*照片列表/);
console.log('PASS: appendix B image-list placeholders write multiple images and accept legacy single image.');
