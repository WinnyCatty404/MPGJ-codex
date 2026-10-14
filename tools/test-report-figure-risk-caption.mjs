import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from 'jszip';
import { formatFigureOneOne, placeRiskTableCaptionAbove } from '../backend/dist/report-template.js';

const paragraphText = block => [...block.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
  .map(match => match[1]).join('');
const readXml = async file => {
  const zip = await JSZip.loadAsync(fs.readFileSync(new URL(file, import.meta.url)));
  return zip.file('word/document.xml').async('string');
};

const xml = await readXml('../storage/templates/report/default-report-template.docx');
const sizedFigure = formatFigureOneOne(xml);
const paragraphs = [...sizedFigure.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)];
const figureCaptionIndex = paragraphs.findIndex(match => /^图\s*1[-－]\s*1/.test(paragraphText(match[0]).replace(/\s/g, '')));
assert.ok(figureCaptionIndex >= 1, '应找到图1-1标题');
const figureParagraph = paragraphs.slice(Math.max(0, figureCaptionIndex - 3), figureCaptionIndex)
  .find(match => /<o:OLEObject\b[^>]*ProgID="Visio\./.test(match[0]));
assert.ok(figureParagraph, '应找到图1-1的嵌入式图形');
const figureStyle = /<v:shape\b[^>]*\bstyle="([^"]*)"/.exec(figureParagraph[0])?.[1];
const figureWidth = Number(/\bwidth:([\d.]+)pt/.exec(figureStyle)?.[1]);
const figureHeight = Number(/\bheight:([\d.]+)pt/.exec(figureStyle)?.[1]);
const originalStyle = /<v:shape\b[^>]*\bstyle="([^"]*)"/.exec(xml.slice(figureParagraph.index, figureParagraph.index + figureParagraph[0].length))?.[1];
const originalWidth = Number(/\bwidth:([\d.]+)pt/.exec(originalStyle)?.[1]);
const originalHeight = Number(/\bheight:([\d.]+)pt/.exec(originalStyle)?.[1]);
assert.ok(Math.abs(figureWidth - 11 * 72 / 2.54) < 0.02, '图1-1应为11厘米宽');
assert.ok(Math.abs(figureHeight / figureWidth - originalHeight / originalWidth) < 0.001, '图1-1高度应按比例缩放');

const placed = placeRiskTableCaptionAbove(xml);
const riskCaption = [...placed.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)]
  .find(match => paragraphText(match[0]).replace(/\s/g, '') === '表6-1风险分析');
assert.ok(riskCaption?.[0].includes('<w:keepNext/>'), '标题应与风险表格保持在同一页');
assert.match(placed.slice(riskCaption.index + riskCaption[0].length), /^<w:tbl\b/,
  '标题应紧接在风险表格上方');
assert.equal(placeRiskTableCaptionAbove(placed), placed, '调整应幂等');

const levelTwoXml = await readXml('../storage/templates/report/level-2/default-report-template.docx');
assert.equal(placeRiskTableCaptionAbove(levelTwoXml), levelTwoXml, '不应移动二级模板已有的表题');
if (process.env.REPORT_LAYOUT_TEST_OUT) {
  const zip = await JSZip.loadAsync(fs.readFileSync(new URL('../storage/templates/report/default-report-template.docx', import.meta.url)));
  zip.file('word/document.xml', placeRiskTableCaptionAbove(sizedFigure));
  fs.writeFileSync(process.env.REPORT_LAYOUT_TEST_OUT, await zip.generateAsync({ type: 'nodebuffer' }));
}
console.log('PASS: figure 1-1 is 11 cm wide with proportional height, and risk table caption precedes the table.');
