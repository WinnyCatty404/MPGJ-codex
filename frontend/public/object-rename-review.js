// 测评对象改名候选：按稳定对象 ID 记任务；只在用户确认时改写正文。
window.BBObjectRename = (function() {
  const PAGE_SIZE = 50;
  let open = false;
  let page = 0;
  let filter = 'all';
  let selected = {};
  let visible = [];
  let sectionGroups = [];
  let lastPreview = [];
  const esc = value => String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const layerClass = layer => 'rename-layer-' + Math.max(1, Math.min(5, Number(layer) || 1));
  const isSelected = candidate => candidate.id in selected ? selected[candidate.id] : !candidate.uncertain;
  const layerName = layer => layer === 5 ? '安全管理' : (ONSITE_LAYERS[layer - 1]?.name || '');
  function highlightedExcerpt(candidate, changed) {
    const start = Math.max(0, candidate.at - 35);
    const end = Math.min(candidate.text.length, candidate.at + candidate.old.length + 35);
    const name = changed ? candidate.job.next : candidate.old;
    return (start ? '…' : '') + esc(candidate.text.slice(start, candidate.at)) +
      '<mark class="rename-mark ' + (changed ? 'rename-mark-after' : 'rename-mark-before') + '">' + esc(name) + '</mark>' +
      esc(candidate.text.slice(candidate.at + candidate.old.length, end)) + (end < candidate.text.length ? '…' : '');
  }
  const sectionName = id => id.startsWith('report-ua-text-') ? '单元测评结果分析'
    : id.startsWith('report-overall-') ? '总体评价'
    : id.startsWith('report-sug-prob-') ? '安全问题及改进建议·问题描述'
    : '安全问题及改进建议·改进建议';
  const reportLayer = id => {
    const match = /^report-(?:ua-text|overall|sug-prob|sug-adv)-(\d+)$/.exec(id);
    return match ? Number(match[1]) : -1;
  };
  function sourcesFor(layer) {
    const sources = [];
    ONSITE_LAYERS.forEach((cfg, t) => {
      if (cfg.objLayer !== layer) return;
      Object.keys(onsiteRecords).forEach(key => {
        const pos = locateOnsiteRecordKey(key);
        if (!pos || pos.t !== t || pos.objIdx < 0 || !onsiteRecords[key]?.record) return;
        const title = '现场测评 · ' + cfg.name + ' · ' + pos.unitName + ' · ' + (getOnsiteUnitObjects(t, pos.unitName)[pos.objIdx] || '测评对象');
        sources.push({ id: 'onsite|' + key, title, section: '现场测评', get: () => onsiteRecords[key]?.record || '',
          set: text => { onsiteRecords[key].record = text; } });
      });
      Object.keys(reportTexts).forEach(id => {
        if (reportLayer(id) !== t) return;
        sources.push({ id: 'text|' + id, title: '报告编制 · ' + cfg.name + ' · ' + sectionName(id), section: sectionName(id),
          get: () => reportTexts[id] || '', set: text => { reportTexts[id] = text; } });
      });
      getRiskRows().filter(row => row.t === t).forEach(row => {
        ['desc', 'analysis'].forEach(field => {
          const text = String(row[field] || '');
          if (!text) return;
          sources.push({ id: 'risk|' + row.key + '|' + field,
            title: '报告编制 · ' + cfg.name + ' · 风险' + (field === 'desc' ? '描述' : '分析') + ' · ' + row.unit,
            section: '风险分析', get: () => {
              const live = getRiskRows().find(item => item.key === row.key);
              return String(live?.[field] || '');
            }, set: value => {
              const store = reportRiskStore[row.key] || (reportRiskStore[row.key] = {});
              store[field] = value;
              if (!store._manualFields) store._manualFields = {};
              store._manualFields[field] = true;
              const imported = reportImportedRiskRows.find(item => item.key === row.key);
              if (imported) imported[field] = value;
            } });
        });
      });
    });
    return sources;
  }
  function protectedRanges(text, job) {
    const names = new Set([job.next]);
    Object.values(objData).forEach(rows => (rows || []).forEach(row => {
      if (row.objectId !== job.objectId && row.object) names.add(String(row.object).trim());
    }));
    const ranges = [];
    names.forEach(name => {
      if (!name || !job.oldNames.some(old => name.length > old.length && name.includes(old))) return;
      let at = -1;
      while ((at = text.indexOf(name, at + 1)) >= 0) ranges.push([at, at + name.length]);
    });
    return ranges;
  }
  function candidates() {
    const out = [];
    pendingObjectRenames.forEach(job => {
      const object = (objData[job.layer] || []).find(row => row.objectId === job.objectId);
      if (!object || !job.next) return;
      const sources = sourcesFor(Number(job.layer));
      sources.forEach(source => {
        const text = source.get();
        if (!text) return;
        const protectedNames = protectedRanges(text, job);
        const occupied = [];
        job.oldNames.slice().sort((a, b) => b.length - a.length).forEach(old => {
          if (!old || old === job.next) return;
          let at = -1;
          while ((at = text.indexOf(old, at + 1)) >= 0) {
            if (protectedNames.some(([start, end]) => at < end && at + old.length > start)) continue;
            if (occupied.some(([start, end]) => at < end && at + old.length > start)) continue;
            occupied.push([at, at + old.length]);
            const left = at ? text[at - 1] : '';
            const right = text[at + old.length] || '';
            const uncertain = /[\p{L}\p{N}]/u.test(left) || /[\p{L}\p{N}]/u.test(right);
            const id = [job.objectId, source.id, old, at].join('|');
            out.push({ id, job, source, text, old, at, uncertain,
              before: text.slice(Math.max(0, at - 35), Math.min(text.length, at + old.length + 35)),
              after: text.slice(Math.max(0, at - 35), at) + job.next + text.slice(at + old.length, Math.min(text.length, at + old.length + 35)) });
          }
        });
      });
    });
    return out;
  }
  function refresh() {
    const box = document.getElementById('object-rename-review');
    if (!box) return;
    const all = candidates();
    lastPreview = all;
    if (!pendingObjectRenames.length) { box.innerHTML = ''; open = false; return; }
    const filtered = filter === 'uncertain' ? all.filter(c => c.uncertain) : all;
    const groupMap = new Map();
    filtered.forEach(candidate => {
      const key = candidate.job.objectId + '|' + candidate.source.section;
      if (!groupMap.has(key)) groupMap.set(key, { key, job: candidate.job, section: candidate.source.section, items: [] });
      groupMap.get(key).items.push(candidate);
    });
    sectionGroups = Array.from(groupMap.values());
    page = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
    visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const header = '<div class="rename-review-head"><div><strong>对象改名待处理</strong><span class="rename-review-count">' + all.length +
      ' 处</span><small>核对名称变化，再决定哪些正文需要更新</small></div>' +
      '<button type="button" class="btn btn-secondary" onclick="BBObjectRename.open()">'
      + (open ? '收起面板' : '打开处理面板') + '</button></div>';
    if (!open) { box.innerHTML = header; return; }
    const jobs = pendingObjectRenames.map(job => {
      const count = all.filter(c => c.job === job).length;
      return '<div class="rename-review-job ' + layerClass(job.layer) + '"><span class="rename-layer-badge">' +
        esc(layerName(Number(job.layer))) + '</span><span class="rename-review-job-name">' +
        esc(job.oldNames.join(' / ')) + ' <span aria-hidden="true">→</span> <strong>' + esc(job.next) +
        '</strong></span><span class="rename-review-job-count">' + count + ' 处</span>' +
        '<button type="button" onclick="BBObjectRename.dismiss(\'' + esc(job.objectId) + '\')">不修改</button></div>';
    }).join('');
    let previousGroup = '';
    const rows = visible.map((c, index) => {
      const groupKey = c.job.objectId + '|' + c.source.section;
      const groupIndex = sectionGroups.findIndex(group => group.key === groupKey);
      const heading = groupKey === previousGroup ? '' :
        '<div class="rename-review-section ' + layerClass(c.job.layer) + '"><span class="rename-layer-badge">' +
        esc(layerName(Number(c.job.layer))) + '</span><strong>' + esc(c.source.section) +
        '</strong><span class="rename-review-job-count">' + sectionGroups[groupIndex].items.length + ' 处</span>' +
        '<button type="button" onclick="BBObjectRename.selectSection(' + groupIndex + ',true)">勾选本组确定项</button>' +
        '<button type="button" onclick="BBObjectRename.selectSection(' + groupIndex + ',false)">清空本组</button></div>';
      previousGroup = groupKey;
      return heading + '<label class="rename-review-row ' + layerClass(c.job.layer) + '"><input type="checkbox" ' +
        (isSelected(c) ? 'checked' : '') + ' onchange="BBObjectRename.toggle(' + index + ',this.checked)" ' +
        'aria-label="选择此处对象名称修改"><span class="rename-review-row-content"><span class="rename-review-row-title">' +
        esc(c.source.title) + '</span>' + (c.uncertain ? ' <em>名称嵌在更长文字中，需确认</em>' : '') +
        '<span class="rename-review-compare"><span class="rename-review-text"><b>原文</b><span>' +
        highlightedExcerpt(c, false) + '</span></span><span class="rename-review-text"><b>修改后</b><span>' +
        highlightedExcerpt(c, true) + '</span></span></span></span></label>';
    }).join('');
    box.innerHTML = header + '<div class="rename-review-body"><p class="rename-review-help">只处理对应层面的现场记录与已保存报告正文。自动草稿会根据最新对象名称生成；橙色提示项默认不勾选。</p>' +
      jobs + '<div class="rename-review-tools"><label><input type="checkbox" ' + (filter === 'uncertain' ? 'checked' : '') +
      ' onchange="BBObjectRename.filter(this.checked)">仅看不确定项</label>' +
      '<button type="button" onclick="BBObjectRename.selectGroup(true)">勾选本页确定项</button>' +
      '<button type="button" onclick="BBObjectRename.selectGroup(false)">清空本页勾选</button></div>' +
      (rows || '<p>当前筛选下没有候选。可点“不修改”结束本次改名任务。</p>') +
      '<div class="rename-review-actions"><button type="button" class="btn btn-primary" onclick="BBObjectRename.apply()">应用所选</button>' +
      '<button type="button" class="btn btn-secondary" onclick="BBObjectRename.dismissAll()">全部不修改</button>' +
      '<span>第 ' + (page + 1) + ' / ' + Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)) + ' 页</span>' +
      '<button type="button" onclick="BBObjectRename.page(-1)" ' + (!page ? 'disabled' : '') + '>上一页</button>' +
      '<button type="button" onclick="BBObjectRename.page(1)" ' + ((page + 1) * PAGE_SIZE >= filtered.length ? 'disabled' : '') + '>下一页</button></div></div>';
  }
  async function persist(steps) {
    try {
      for (const step of steps) await window.bbPersistProjectStage(step, true, true);
    } catch (error) { showToast('改名处理已更新，但保存失败：' + (error.message || error), true); }
  }
  function dismiss(objectId) {
    pendingObjectRenames = pendingObjectRenames.filter(item => item.objectId !== objectId);
    refresh(); persist([2]);
  }
  function apply() {
    const all = lastPreview.filter(isSelected);
    if (!all.length) { showToast('请先勾选需要修改的内容', true); return; }
    const bySource = new Map();
    all.forEach(c => {
      if (!bySource.has(c.source.id)) bySource.set(c.source.id, []);
      bySource.get(c.source.id).push(c);
    });
    let changed = 0, stale = 0;
    const steps = new Set();
    bySource.forEach(group => {
      const source = group[0].source;
      const current = source.get();
      if (current !== group[0].text) { stale += group.length; return; }
      let next = current;
      group.sort((a, b) => b.at - a.at).forEach(c => {
        if (next.slice(c.at, c.at + c.old.length) !== c.old) { stale++; return; }
        next = next.slice(0, c.at) + c.job.next + next.slice(c.at + c.old.length);
        changed++;
      });
      if (next !== current) {
        source.set(next);
        steps.add(source.id.startsWith('onsite|') ? 3 : 4);
      }
    });
    selected = {};
    // 已处理完的改名任务自动从列表移除；保留仍有候选的任务供人工检查。
    pendingObjectRenames = pendingObjectRenames.filter(job => candidates().some(c => c.job === job));
    refresh();
    persist(Array.from(steps).concat(2));
    showToast('已修改 ' + changed + ' 处' + (stale ? '；' + stale + ' 处原文已变化，请重新检查' : ''));
  }
  const style = document.createElement('style');
  style.textContent = [
    '.object-rename-review:not(:empty){margin:14px 0;border:1px solid #cad8e6;border-radius:14px;background:#f8fbff;color:#23354b;box-shadow:0 4px 20px rgba(30,59,93,.06);overflow:hidden}',
    '.rename-review-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 20px}',
    '.rename-review-head strong{font-size:16px}.rename-review-head small{display:block;margin-top:4px;color:#687b91;font-size:12px}',
    '.rename-review-count{display:inline-block;margin-left:10px;padding:3px 9px;border-radius:999px;background:#e3efff;color:#1b5ca9;font-size:12px;font-weight:700}',
    '.rename-review-head .btn{width:auto;white-space:nowrap;padding:0 16px}',
    '.rename-review-body{max-height:min(80vh,960px);overflow:auto;padding:0 20px 16px;scrollbar-gutter:stable}',
    '.rename-review-help{margin:0 0 16px;padding:11px 13px;border-radius:8px;background:#edf4fc;color:#53677e;font-size:13px;line-height:1.6}',
    '.rename-review-job,.rename-review-tools,.rename-review-actions,.rename-review-section{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
    '.rename-review-job{margin:8px 0;padding:12px 14px;border:1px solid #d8e3ef;border-left:4px solid var(--rename-layer-accent);border-radius:10px;background:#fff}',
    '.rename-review-job-name{font-size:14px;line-height:1.5}.rename-review-job-count{padding:3px 8px;border-radius:999px;background:#edf2f8;color:#53677e;font-size:12px}',
    '.rename-review-job button{margin-left:auto}.rename-layer-badge{display:inline-flex;align-items:center;padding:4px 9px;border-radius:999px;background:var(--rename-layer-tint);color:var(--rename-layer-accent);font-size:12px;font-weight:700;white-space:nowrap}',
    '.rename-layer-1{--rename-layer-accent:#396fba;--rename-layer-tint:#e8f0fd}.rename-layer-2{--rename-layer-accent:#227f88;--rename-layer-tint:#e1f3f2}',
    '.rename-layer-3{--rename-layer-accent:#7559aa;--rename-layer-tint:#f0eafd}.rename-layer-4{--rename-layer-accent:#ab602c;--rename-layer-tint:#fff0e3}.rename-layer-5{--rename-layer-accent:#417448;--rename-layer-tint:#e7f4e9}',
    '.rename-review-section{position:sticky;top:0;z-index:1;margin-top:18px;padding:10px 12px;border:1px solid #d8e3ef;border-radius:9px;background:#f0f5fb}',
    '.rename-review-section strong{font-size:14px}.rename-review-section button:first-of-type{margin-left:auto}',
    '.rename-review-row{display:flex;gap:12px;margin:8px 0;padding:14px;border:1px solid #d8e3ef;border-left:3px solid var(--rename-layer-accent);border-radius:10px;background:#fff;cursor:pointer}',
    '.rename-review-row:hover{border-color:var(--rename-layer-accent);box-shadow:0 3px 12px rgba(30,59,93,.08)}.rename-review-row>input{flex:none;align-self:flex-start;margin-top:3px;width:17px;height:17px}',
    '.rename-review-row-content{min-width:0;flex:1}.rename-review-row-title{display:inline-block;margin-bottom:10px;font-weight:700;line-height:1.5;overflow-wrap:anywhere}',
    '.rename-review-row em{display:inline-block;margin:0 0 10px 7px;padding:3px 8px;border-radius:6px;background:#fff1df;color:#99500f;font-size:12px;font-style:normal}',
    '.rename-review-compare{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.rename-review-text{display:block;min-width:0;padding:10px 12px;border:1px solid #e0e7ef;border-radius:8px;background:#f8fafc;line-height:1.7;overflow-wrap:anywhere}',
    '.rename-review-text>b{display:block;margin-bottom:5px;color:#65758b;font-size:12px}.rename-mark{padding:1px 3px;border-radius:4px;font-weight:800}.rename-mark-before{background:#ffdfbd;color:#793d0d}.rename-mark-after{background:#cff2dc;color:#195937}',
    '.rename-review-tools{margin:16px 0 12px}.rename-review-tools label{display:inline-flex;align-items:center;gap:5px}.rename-review-actions{position:sticky;bottom:-16px;z-index:2;margin:18px -20px -16px;padding:12px 20px;border-top:1px solid #cad8e6;background:#f8fbff;box-shadow:0 -5px 14px rgba(30,59,93,.06)}',
    '.rename-review-actions .btn{width:auto;padding:0 16px}.rename-review-body button:not(.btn){padding:6px 10px;border:1px solid #b8cbe0;border-radius:7px;background:#fff;color:#315172;cursor:pointer}.rename-review-body button:not(.btn):hover{background:#eaf2fb}',
    '@media(max-width:1050px){.rename-review-compare{grid-template-columns:1fr}.rename-review-section button:first-of-type{margin-left:0}}',
    'html[data-theme="dark"] .object-rename-review:not(:empty){background:#202d29;color:#e4eae5;border-color:#52675d}',
    'html[data-theme="dark"] .rename-review-head small,html[data-theme="dark"] .rename-review-help{color:#c0d0c7}',
    'html[data-theme="dark"] .rename-review-count{background:#29483f;color:#a7e0c3}',
    'html[data-theme="dark"] .rename-review-help,html[data-theme="dark"] .rename-review-section,html[data-theme="dark"] .rename-review-actions{background:#263630;border-color:#52675d}',
    'html[data-theme="dark"] .rename-review-job,html[data-theme="dark"] .rename-review-row,html[data-theme="dark"] .rename-review-text{background:#27332f;color:#e4eae5;border-color:#52675d}',
    'html[data-theme="dark"] .rename-review-job,html[data-theme="dark"] .rename-review-row{border-left-color:var(--rename-layer-accent)}',
    'html[data-theme="dark"] .rename-layer-1{--rename-layer-accent:#91bbff}html[data-theme="dark"] .rename-layer-2{--rename-layer-accent:#82d6d4}html[data-theme="dark"] .rename-layer-3{--rename-layer-accent:#c5aaff}html[data-theme="dark"] .rename-layer-4{--rename-layer-accent:#ffc18b}html[data-theme="dark"] .rename-layer-5{--rename-layer-accent:#9bdfa5}',
    'html[data-theme="dark"] .rename-layer-badge{background:#34463e;color:var(--rename-layer-accent)}html[data-theme="dark"] .rename-review-job-count{background:#34463e;color:#c0d0c7}',
    'html[data-theme="dark"] .rename-review-text>b{color:#bfcfc6}html[data-theme="dark"] .rename-review-row em{background:#5c3d22;color:#ffd8a7}',
    'html[data-theme="dark"] .rename-mark-before{background:#704728;color:#ffe0ba}html[data-theme="dark"] .rename-mark-after{background:#265c42;color:#d0f3dd}',
    'html[data-theme="dark"] .rename-review-body button:not(.btn){background:#2d3d36;color:#e4eae5;border-color:#5b7164}html[data-theme="dark"] .rename-review-body button:not(.btn):hover{background:#375348}'
  ].join('');
  document.head.appendChild(style);
  return { refresh, open() { open = !open; refresh(); }, toggle(index, checked) { if (visible[index]) selected[visible[index].id] = checked; },
    filter(uncertain) { filter = uncertain ? 'uncertain' : 'all'; page = 0; refresh(); },
    selectGroup(value) { visible.forEach(c => { if (!value || !c.uncertain) selected[c.id] = value; }); refresh(); },
    selectSection(index, value) { (sectionGroups[index]?.items || []).forEach(c => { if (!value || !c.uncertain) selected[c.id] = value; }); refresh(); },
    page(direction) { page += direction; refresh(); }, dismiss, dismissAll() { pendingObjectRenames = []; selected = {}; refresh(); persist([2]); },
    apply };
})();
