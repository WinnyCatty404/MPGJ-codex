import JSZip from 'jszip';
import sharp from 'sharp';

export const WORD_IMPORT_DIRECT_LIMIT = 55 * 1024 * 1024;
export const WORD_IMPORT_HARD_LIMIT = 150 * 1024 * 1024;

export class DocxOptimizeError extends Error {
  constructor(message: string, public readonly status = 422) {
    super(message);
    this.name = 'DocxOptimizeError';
  }
}

type OptimizePreset = { maxDimension: number; jpegQuality: number };
type OptimizePassResult = { data: Buffer; optimizedImages: number };

const IMAGE_PATH = /^word\/media\/.*\.(?:jpe?g|png)$/i;

async function loadAndValidateDocx(data: Buffer) {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data, { checkCRC32: true });
  } catch {
    throw new DocxOptimizeError('文件不是有效的 DOCX，或 ZIP 内容已经损坏。', 400);
  }
  const documentEntry = zip.file('word/document.xml');
  if (!documentEntry) throw new DocxOptimizeError('DOCX 中缺少 word/document.xml，无法导入。', 400);
  const documentXml = await documentEntry.async('string');
  if (!/<w:document\b/.test(documentXml)) throw new DocxOptimizeError('DOCX 主文档结构无效，无法导入。', 400);
  return zip;
}

async function optimizePass(original: Buffer, preset: OptimizePreset): Promise<OptimizePassResult> {
  const zip = await loadAndValidateDocx(original);
  const mediaPaths = Object.keys(zip.files).filter(name => IMAGE_PATH.test(name) && !zip.files[name].dir);
  let optimizedImages = 0;
  for (const mediaPath of mediaPaths) {
    const source = await zip.files[mediaPath].async('nodebuffer');
    const extension = mediaPath.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
    try {
      let pipeline = sharp(source, { failOn: 'error' }).rotate().resize({
        width: preset.maxDimension,
        height: preset.maxDimension,
        fit: 'inside',
        withoutEnlargement: true,
      });
      pipeline = extension === 'png'
        ? pipeline.png({ compressionLevel: 9, adaptiveFiltering: true })
        : pipeline.jpeg({ quality: preset.jpegQuality, mozjpeg: true });
      const candidate = await pipeline.toBuffer();
      if (candidate.length < source.length) {
        zip.file(mediaPath, candidate);
        optimizedImages += 1;
      }
    } catch (error) {
      throw new DocxOptimizeError(`图片优化失败：${mediaPath}（${error instanceof Error ? error.message : String(error)}）`);
    }
  }
  const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  return { data, optimizedImages };
}

async function validateOptimizedDocx(original: Buffer, optimized: Buffer) {
  const [sourceZip, optimizedZip] = await Promise.all([
    loadAndValidateDocx(original),
    loadAndValidateDocx(optimized),
  ]);
  const sourceMedia = Object.keys(sourceZip.files).filter(name => /^word\/media\//i.test(name) && !sourceZip.files[name].dir);
  for (const mediaPath of sourceMedia) {
    const entry = optimizedZip.file(mediaPath);
    if (!entry) throw new DocxOptimizeError(`优化后的 DOCX 缺少媒体文件：${mediaPath}`);
    const bytes = await entry.async('uint8array');
    if (!bytes.length) throw new DocxOptimizeError(`优化后的 DOCX 包含空媒体文件：${mediaPath}`);
  }
}

export async function optimizeDocxForWordImport(
  original: Buffer,
  safeLimit = WORD_IMPORT_DIRECT_LIMIT,
): Promise<{ data: Buffer; originalSize: number; optimizedSize: number; optimizedImages: number; pass: number }> {
  if (!Buffer.isBuffer(original) || !original.length) throw new DocxOptimizeError('未收到 DOCX 文件内容。', 400);
  if (original.length > WORD_IMPORT_HARD_LIMIT) throw new DocxOptimizeError('Word 文件超过 150 MiB，系统不会读取该文件。', 413);
  await loadAndValidateDocx(original);
  if (original.length <= safeLimit) {
    return { data: original, originalSize: original.length, optimizedSize: original.length, optimizedImages: 0, pass: 0 };
  }

  const first = await optimizePass(original, { maxDimension: 2400, jpegQuality: 88 });
  if (first.data.length <= safeLimit) {
    await validateOptimizedDocx(original, first.data);
    return { data: first.data, originalSize: original.length, optimizedSize: first.data.length, optimizedImages: first.optimizedImages, pass: 1 };
  }

  const second = await optimizePass(original, { maxDimension: 1800, jpegQuality: 82 });
  await validateOptimizedDocx(original, second.data);
  if (second.data.length > safeLimit) {
    throw new DocxOptimizeError('自动优化后文件仍超过 55 MiB，请使用 Word 或 WPS 手工压缩图片后重新导入。');
  }
  return { data: second.data, originalSize: original.length, optimizedSize: second.data.length, optimizedImages: second.optimizedImages, pass: 2 };
}
