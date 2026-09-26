const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const JSZip = require('jszip');

const html = fs.readFileSync(path.join(__dirname, '../frontend/public/prototype.html'), 'utf8');
const slice = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));

(async () => {
  const zip = await JSZip.loadAsync(fs.readFileSync(process.argv[2]));
  const context = vm.createContext({});
  vm.runInContext(slice('  function _impXmlUnescape(', '  // 标题级别：'), context);
  const blocks = context._impExtractBlocks(await zip.file('word/document.xml').async('string'));
  let caption = '';
  for (const block of blocks) {
    if (block.type === 'p') {
      if (block.text.trim()) caption = block.text.trim();
      continue;
    }
    if (/(物理安防设施|服务器\/存储设备|网络及安全设备|数据库管理系统|关键业务应用)/.test(caption)) {
      console.log(caption, JSON.stringify(block.rows[0] || []));
    }
    caption = '';
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
