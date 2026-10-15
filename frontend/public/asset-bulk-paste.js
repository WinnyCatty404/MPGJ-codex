// 系统资产表格：将 Excel 剪贴板中的多行单元格追加到当前分类。
(function () {
  const field = (key, ...headers) => ({ key, headers });
  const assessed = field('assessed', '是否测评', '是否纳入测评');
  const schemas = {
    env: [field('name', '物理环境名称', '物理环境'), field('location', '物理位置', '位置'), field('importance', '重要程度'), assessed],
    security: [field('name', '产品名称', '设施名称'), field('vendorModel', '生产厂商和型号', '生产厂商及型号'), field('environment', '所在物理环境名称', '物理环境名称'), field('importance', '重要程度'), assessed],
    crypto: [field('name', '产品名称'), field('vendor', '生产厂商', '厂商'), field('certificate', '商密产品认证证书编号', '认证证书编号'), field('algorithm', '使用的密码算法', '密码算法'), field('quantity', '数量'), field('purpose', '用途'), assessed],
    server: [field('name', '设备名称', '服务器名称'), field('vendor', '生产厂商', '厂商'), field('model', '型号', '设备型号'), field('os', '操作系统版本', '操作系统'), field('virtual', '是否为虚拟设备'), field('purpose', '用途', '主要用途'), field('quantity', '数量'), field('importance', '重要程度'), assessed],
    network: [field('name', '设备名称'), field('vendor', '生产厂商', '厂商'), field('model', '型号', '设备型号'), field('purpose', '用途（包括涉及的密码技术）', '用途'), field('quantity', '数量'), field('importance', '重要程度'), assessed],
    db: [field('name', '数据库管理系统名称', '数据库名称'), field('version', '版本'), field('location', '部署位置', '位置'), field('function', '主要功能', '功能'), field('importance', '重要程度'), assessed],
    app: [field('name', '应用名称', '关键业务应用'), field('version', '版本'), field('location', '部署位置', '位置'), field('function', '主要功能', '功能'), assessed],
    data: [field('name', '数据', '数据名称'), field('description', '数据描述'), field('application', '所属应用'), field('location', '存储位置'), field('requirements', '安全需求')],
    doc: [field('name', '文档名称'), field('content', '主要内容', '文档内容')],
    person: [field('name', '姓名'), field('role', '岗位/角色', '岗位', '角色'), field('duty', '职责说明', '职责'), field('contact', '联系方式')],
    appUser: [field('name', '应用用户名称', '用户名称'), field('application', '所属应用')]
  };

  function parseGrid(text) {
    const source = String(text || '').replace(/\r\n?/g, '\n');
    const rows = [];
    let row = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < source.length; index++) {
      const char = source[index];
      if (char === '"') {
        if (quoted && source[index + 1] === '"') { value += '"'; index++; }
        else if (quoted) quoted = false;
        else if (!value) quoted = true;
        else value += char;
      } else if (char === '\t' && !quoted) {
        row.push(value); value = '';
      } else if (char === '\n' && !quoted) {
        row.push(value); rows.push(row); row = []; value = '';
      } else value += char;
    }
    if (quoted) throw new Error('粘贴内容中有未闭合的引号，请重新从 Excel 复制');
    row.push(value);
    rows.push(row);
    return rows.map(function (cells) {
      while (cells.length > 1 && !cells[cells.length - 1].trim()) cells.pop();
      return cells;
    }).filter(cells => cells.some(cell => cell.trim()));
  }

  function normalizeHeader(value) {
    return String(value || '').trim().replace(/[\s　:：()（）\-_/／]/g, '').toLowerCase();
  }

  function columnForHeader(type, value) {
    const normalized = normalizeHeader(value);
    if (normalized === '序号' || normalized === '编号') return 'sequence';
    return schemas[type].find(column => column.headers.some(header => normalizeHeader(header) === normalized))?.key || '';
  }

  function parseAssessed(value, rowNumber) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized || ['否', '未测评', '不测评', 'false', 'no', 'n', '0', '×', '✗', '☐', '□'].includes(normalized)) return false;
    if (['是', '测评', '已测评', 'true', 'yes', 'y', '1', '√', '✓', '✔', '☑'].includes(normalized)) return true;
    throw new Error('第 ' + rowNumber + ' 行的“是否测评”无法识别：' + value);
  }

  function isExcelGrid(text, html, cells) {
    if (!cells.length) return false;
    if (cells.some(row => row.length > 1)) return true;
    // 单个含换行的文本单元格仍由浏览器正常粘贴；Excel 单列多行会带 HTML 表格。
    return cells.length > 1 && (String(html || '').match(/<tr(?:\s|>)/gi) || []).length > 1;
  }

  function prepare(type, text) {
    const fields = schemas[type];
    if (!fields) throw new Error('不支持的资产分类');
    let rows = parseGrid(text);
    if (!rows.length) throw new Error('没有可粘贴的资产行');
    const first = rows[0];
    const candidate = first.map(value => columnForHeader(type, value));
    const known = candidate.filter(Boolean).length;
    const likelyHeader = known > 0;
    let columns;
    if (likelyHeader) {
      if (first.some(value => !value.trim())) throw new Error('表头有空白列，请补齐列名后重试');
      const unknown = first.find((value, index) => value.trim() && !candidate[index]);
      if (unknown) throw new Error('表头列无法识别：' + unknown + '；请使用当前表格的列名');
      columns = candidate;
      const duplicated = columns.find((key, index) => key !== 'sequence' && columns.indexOf(key) !== index);
      if (duplicated) throw new Error('表头存在重复列，请检查后重试');
      rows = rows.slice(1);
    } else {
      const serials = rows.map(row => Number(String(row[0] || '').trim()));
      const hasSequence = rows.every(row => row.length > 1 && /^\d+$/.test(String(row[0] || '').trim())) &&
        (rows.length > 1 && serials.every((value, index) => index === 0 || value === serials[index - 1] + 1) || rows.some(row => row.length > fields.length));
      if (hasSequence) rows = rows.map(row => row.slice(1));
      const width = Math.max(...rows.map(row => row.length));
      if (width > fields.length) throw new Error('粘贴列数多于当前表格，请核对资产分类或复制表头');
      columns = fields.slice(0, width).map(column => column.key);
    }
    if (!columns.includes('name')) throw new Error('粘贴内容缺少名称列，请连同名称列一起复制');
    if (!rows.length) throw new Error('表头下面没有资产数据');
    const records = rows.map(function (row, index) {
      if (row.length > columns.length && row.slice(columns.length).some(value => value.trim())) {
        throw new Error('第 ' + (index + 1) + ' 行列数不一致，请核对 Excel 表格');
      }
      const record = {};
      fields.forEach(column => { record[column.key] = column.key === 'assessed' ? false : ''; });
      columns.forEach((key, cellIndex) => {
        if (key && key !== 'sequence') record[key] = row[cellIndex] || '';
      });
      if (!String(record.name).trim()) throw new Error('第 ' + (index + 1) + ' 行缺少名称，整批未写入');
      if (fields.some(column => column.key === 'assessed')) record.assessed = parseAssessed(record.assessed, index + 1);
      return record;
    });
    return { type, records };
  }

  function createRow(type, index, record) {
    const holder = document.createElement('tbody');
    holder.innerHTML = type === 'appUser' ? getAppUserRowHtml(index) : getAssetRowHtml(type, index, false);
    const row = holder.firstElementChild;
    schemas[type].forEach(function (column, fieldIndex) {
      const cell = row.cells[fieldIndex + 1];
      if (column.key === 'requirements') cell.innerHTML = getDataReqChips(parseImportedDataReqs(record.requirements));
      else if (column.key === 'assessed') cell.querySelector('input[type="checkbox"]').checked = record.assessed;
      else cell.querySelector('input,textarea').value = record[column.key];
    });
    return row;
  }

  function appendRecords(type, tbody, records) {
    const newRows = records.map((record, index) => createRow(type, tbody.rows.length + index + 1, record));
    const first = tbody.rows.length === 1 ? tbody.rows[0] : null;
    const reusePlaceholder = type !== 'person' && first &&
      Array.from(first.querySelectorAll('input[type="text"],textarea')).every(input => !input.value.trim()) &&
      Array.from(first.querySelectorAll('input[type="checkbox"]')).every(input => !input.checked);
    if (reusePlaceholder) first.replaceWith(newRows.shift());
    newRows.forEach(row => tbody.appendChild(row));
    if (type === 'appUser') Array.from(tbody.rows).forEach((row, index) => { row.cells[0].textContent = index + 1; });
    else renumberAssetRows(type);
    enhanceAssetEditors();
    document.dispatchEvent(new Event('bb:prototype-change'));
    showToast('已追加 ' + records.length + ' 条' + (type === 'appUser' ? '应用用户' : '系统资产') + '，正在自动保存');
  }

  function onPaste(event) {
    const target = event.target;
    const tbody = target?.closest?.('tbody');
    const type = tbody?.id === 'app-user-tbody' ? 'appUser' : /^asset-tbody-(\w+)$/.exec(tbody?.id || '')?.[1];
    if (!schemas[type] || !target.closest('input:not([type="checkbox"]),textarea') || target.readOnly || target.disabled) return;
    const clipboard = event.clipboardData;
    const text = clipboard?.getData('text/plain') || '';
    if (!text) return;
    let cells;
    try { cells = parseGrid(text); }
    catch (error) {
      if (!text.includes('\t')) return;
      event.preventDefault(); event.stopPropagation(); showToast(error.message, true); return;
    }
    if (!isExcelGrid(text, clipboard?.getData('text/html'), cells)) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      const prepared = prepare(type, text);
      appendRecords(type, tbody, prepared.records);
    } catch (error) {
      showToast('批量粘贴失败：' + (error.message || error), true);
    }
  }

  if (typeof document !== 'undefined') document.addEventListener('paste', onPaste, true);
  if (typeof module !== 'undefined' && module.exports) module.exports = { schemas, parseGrid, isExcelGrid, prepare, appendRecords, onPaste };
})();
