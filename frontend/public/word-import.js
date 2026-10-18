(function () {
  'use strict';

  var MIB = 1024 * 1024;
  var DIRECT_LIMIT = 55 * MIB;
  var HARD_LIMIT = 150 * MIB;
  var DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  var MANUAL_GUIDE = [
    'Microsoft Word：打开报告并先另存为副本；点击任意图片 → 图片格式 → 压缩图片；取消“仅应用于此图片”，勾选“删除图片的裁剪区域”；优先选择“打印（220 ppi）”，仍过大时选择“网页（150 ppi）”；保存并关闭后重新导入。',
    'WPS：点击任意图片 → 图片工具 → 压缩图片；选择应用到文档中的所有图片；优先选择 220 ppi，仍过大时降低到 150 ppi；不建议使用 96 ppi。'
  ].join('\n\n');

  function formatMiB(bytes) {
    return (Number(bytes || 0) / MIB).toFixed(1) + ' MiB';
  }

  function makeError(message, manualRequired, cancelled) {
    var error = new Error(message);
    error.manualRequired = !!manualRequired;
    error.cancelled = !!cancelled;
    return error;
  }

  async function readError(response) {
    var fallback = 'Word 图片自动优化失败';
    try {
      var contentType = response.headers.get('Content-Type') || '';
      if (contentType.indexOf('application/json') >= 0) {
        var data = await response.json();
        return data.message || fallback;
      }
      return (await response.text()) || fallback;
    } catch (_error) {
      return fallback;
    }
  }

  async function prepare(file, options) {
    options = options || {};
    if (!file || !/\.docx$/i.test(file.name || '')) throw makeError('请选择 .docx 格式的密评报告。');
    if (file.size > HARD_LIMIT) {
      throw makeError('文件大小为 ' + formatMiB(file.size) + '，超过 150 MiB，系统不会读取。\n\n' + MANUAL_GUIDE, true);
    }
    if (file.size <= DIRECT_LIMIT) {
      return { file: file, optimized: false, originalSize: file.size, optimizedSize: file.size, optimizedImages: 0 };
    }

    var confirmation = '当前 Word 文件为 ' + formatMiB(file.size) + '，超过 55 MiB。\n\n' +
      '系统将只优化 DOCX 内嵌的 JPEG/PNG 图片：第一轮最长边 2400 像素、JPEG 质量 88；必要时第二轮最长边 1800 像素、质量 82。文字、表格和样式不会修改，您电脑上的原文件也不会改变。\n\n是否继续？';
    if (!(options.confirm || window.confirm)(confirmation)) throw makeError('已取消 Word 导入。', false, true);
    if (options.onStatus) options.onStatus('正在自动优化 Word 图片，请稍候…');

    var response;
    try {
      response = await fetch('/api/word-import/optimize', {
        method: 'POST',
        headers: {
          'Authorization': options.token ? 'Bearer ' + options.token : '',
          'Content-Type': DOCX_TYPE
        },
        body: file
      });
    } catch (error) {
      throw makeError('无法连接图片优化服务：' + (error && error.message ? error.message : error) + '\n\n' + MANUAL_GUIDE, true);
    }
    if (!response.ok) throw makeError((await readError(response)) + '\n\n' + MANUAL_GUIDE, true);

    var blob = await response.blob();
    if (!blob.size || blob.size > DIRECT_LIMIT) throw makeError('自动优化结果仍超过 55 MiB。\n\n' + MANUAL_GUIDE, true);
    var optimizedFile = new File([blob], file.name, { type: DOCX_TYPE, lastModified: file.lastModified || Date.now() });
    return {
      file: optimizedFile,
      optimized: true,
      originalSize: Number(response.headers.get('X-BMPBGS-Original-Size')) || file.size,
      optimizedSize: Number(response.headers.get('X-BMPBGS-Optimized-Size')) || blob.size,
      optimizedImages: Number(response.headers.get('X-BMPBGS-Optimized-Images')) || 0
    };
  }

  window.bbWordImport = {
    directLimit: DIRECT_LIMIT,
    hardLimit: HARD_LIMIT,
    manualGuide: MANUAL_GUIDE,
    formatMiB: formatMiB,
    prepare: prepare
  };
})();
