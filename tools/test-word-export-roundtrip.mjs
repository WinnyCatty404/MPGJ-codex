import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import sharp from 'sharp';
import { combined } from './test-level-three-table-bindings.mjs';
import { formatReportTables, replaceReportSlots, specializeReportTemplate, unresolvedReportSlots } from '../backend/dist/report-template.js';
import { writePlanningImages, writeAppendixBImages, writeReportEvidence, writeTopologyBlocks } from '../backend/dist/report-evidence.js';

const template = fs.readFileSync(new URL('../storage/templates/report/default-report-template.docx', import.meta.url));
const zip = await JSZip.loadAsync(template);
let xml = combined;
const slots = unresolvedReportSlots(xml);
const values = Object.fromEntries(slots.map(slot => [slot, '测试值']));
Object.assign(values, {
  '系统名称': '导出链路测试系统', '报告编号': 'QA-2026-001', '系统等级': '三级',
  '等保未定级情况': '未定级测试', '所属省部密码管理部门': '测试管理部门',
  'B9备案系统名称': '导出链路测试系统', 'B1委托单位': '测试单位',
  '评估结论正文': '根据当前项目测评结果生成的结论。',
});
xml = specializeReportTemplate(xml, values);
const photo = await sharp({create:{width:3000,height:2000,channels:3,background:'#b7c8d9'}}).jpeg().toBuffer();
const image = `data:image/jpeg;base64,${photo.toString('base64')}`;
xml = await writeTopologyBlocks(xml, zip, [
  { type: 'image', dataUrl: image, caption: '图 2-1 导出链路测试系统网络拓扑图' },
  { type: 'text', content: '网络拓扑说明' },
], undefined, undefined, '导出链路测试系统');
xml = await writePlanningImages(xml, zip, {'device-crypto-image':image});
xml = await writeReportEvidence(xml, zip, {});
xml = await writeAppendixBImages(xml, zip, {'b1-file':[image,image,image,image]});
const replacements = Object.fromEntries(Object.entries(values).map(([key,value])=>[`{{${key}}}`,value]));
replacements['{{报告编号}}}'] = values['报告编号'];
xml = replaceReportSlots(xml, replacements);
xml = formatReportTables(xml);
assert.deepEqual(unresolvedReportSlots(xml),[]);
assert.ok(xml.includes('导出链路测试系统') && xml.includes('新测评结果'));
zip.file('word/document.xml',xml);
for (const name of Object.keys(zip.files).filter(name=>/^word\/(header\d*|footer\d*)\.xml$/.test(name))) {
  zip.file(name,replaceReportSlots(await zip.file(name).async('string'),replacements));
}
const target = path.resolve('tmp/qa-report-table-format.docx');
fs.mkdirSync(path.dirname(target),{recursive:true});
fs.writeFileSync(target,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
console.log(`PASS: full in-memory template pipeline produced ${target}`);
