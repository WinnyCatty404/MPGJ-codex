import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import sharp from 'sharp';
import { optimizeDocxForWordImport, WORD_IMPORT_DIRECT_LIMIT, WORD_IMPORT_HARD_LIMIT } from '../backend/dist/docx-image-optimizer.js';

assert.equal(WORD_IMPORT_DIRECT_LIMIT, 55 * 1024 * 1024);
assert.equal(WORD_IMPORT_HARD_LIMIT, 150 * 1024 * 1024);

const width = 2800;
const height = 1900;
const photo = await sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } })
  .jpeg({ quality: 100 })
  .toBuffer();
const untouchedGif = Buffer.from('GIF89a-test-unsupported');
const documentXml = '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>文字与表格保持不变</w:t></w:r></w:p></w:body></w:document>';
const zip = new JSZip();
zip.file('word/document.xml', documentXml);
zip.file('word/media/photo.jpg', photo);
zip.file('word/media/animation.gif', untouchedGif);
const original = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

const result = await optimizeDocxForWordImport(original, original.length - 1);
assert.ok(result.optimizedSize < result.originalSize, 'JPEG 应当被压缩');
assert.equal(result.optimizedImages, 1, '应当只优化 JPEG，GIF 保持原样');
assert.equal(result.pass, 1, '第一轮应当达到测试阈值');

const optimizedZip = await JSZip.loadAsync(result.data, { checkCRC32: true });
assert.equal(await optimizedZip.file('word/document.xml').async('string'), documentXml, '文档 XML 不应改变');
assert.deepEqual(await optimizedZip.file('word/media/animation.gif').async('nodebuffer'), untouchedGif, '不支持的 GIF 不应改变');
const metadata = await sharp(await optimizedZip.file('word/media/photo.jpg').async('nodebuffer')).metadata();
assert.ok(Math.max(metadata.width || 0, metadata.height || 0) <= 2400, '第一轮最长边应限制为 2400 像素');

const secondPass = await optimizeDocxForWordImport(original, result.optimizedSize - 1);
assert.equal(secondPass.pass, 2, '第一轮仍超限时应执行第二轮');
const secondZip = await JSZip.loadAsync(secondPass.data, { checkCRC32: true });
const secondMetadata = await sharp(await secondZip.file('word/media/photo.jpg').async('nodebuffer')).metadata();
assert.ok(Math.max(secondMetadata.width || 0, secondMetadata.height || 0) <= 1800, '第二轮最长边应限制为 1800 像素');
await assert.rejects(() => optimizeDocxForWordImport(original, 1), /仍超过 55 MiB/, '两轮后仍超限应中止导入');

await assert.rejects(() => optimizeDocxForWordImport(Buffer.from('not-a-docx'), 1), /有效的 DOCX/);

for (const relative of ['frontend/src/report-generator.html', 'frontend/public/prototype.html']) {
  const html = await fs.readFile(relative, 'utf8');
  assert.match(html, /overall-editor-card[\s\S]{0,500}font-size:\s*17px/, `${relative} 总体评价长文本字号不是 17px`);
  assert.match(html, /suggestion-editor-card[\s\S]{0,1000}textarea[^}]*font-size:\s*17px/, `${relative} 安全问题及改进建议长文本字号不是 17px`);
  assert.match(html, /b7-reviewer[^\n]+defaultName:\s*'赵一凡'/, `${relative} 缺少审核人默认值`);
  assert.match(html, /b7-approver[^\n]+defaultName:\s*'朱晨鸣'/, `${relative} 缺少批准人默认值`);
  assert.match(html, /<script src="\/word-import\.js"><\/script>/, `${relative} 未加载统一 Word 导入组件`);
  assert.match(html, /report-template-staging/, `${relative} 未通过临时文件读取项目列表导入的 Word`);
  assert.match(html, /bbPersistAllStages[\s\S]{0,200}bbStoreImportedTemplate/, `${relative} 应先保存项目数据再保存正式模板`);
}

const helper = await fs.readFile('frontend/public/word-import.js', 'utf8');
assert.match(helper, /55 \* MIB/);
assert.match(helper, /150 \* MIB/);
assert.match(helper, /\/api\/word-import\/optimize/);

const app = await fs.readFile('frontend/src/App.vue', 'utf8');
assert.match(app, /report-template-staging/, '项目列表导入不得提前覆盖正式报告模板');
assert.match(app, /importStaged=/, '项目列表应把临时导入令牌传给实施页');
const server = await fs.readFile('backend/src/server.ts', 'utf8');
assert.match(server, /WORD_IMPORT_DIRECT_LIMIT/, '临时文件接口应限制优化后的安全大小');
assert.match(server, /word-import-staging/, '后端缺少一次性 Word 临时导入接口');

console.log('PASS: Word 大小分流、DOCX 图片优化、17px 长文本和表 B-7 默认人员检查通过。');
