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
  const isSelected = candidate => candidate.id in selected ? selected[candidate.id] : !candidate.uncertain;
  const layerName = layer => layer === 5 ? '安全管理' : (ONSITE_LAYERS[layer - 1]?.name || '');
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
    const header = '<div class="rename-review-head"><strong>对象改名待处理：' + all.length + ' 处</strong>' +
      '<button type="button" class="btn btn-secondary" onclick="BBObjectRename.open()">'
      + (open ? '收起清单' : '集中处理') + '</button></div>';
    if (!open) { box.innerHTML = header; return; }
    const jobs = pendingObjectRenames.map(job => {
      const count = all.filter(c => c.job === job).length;
      return '<div class="rename-review-job"><span>' + esc(layerName(Number(job.layer))) + ' · ' +
        esc(job.oldNames.join(' / ')) + ' → ' + esc(job.next) + '（' + count + ' 处）</span>' +
        '<button type="button" onclick="BBObjectRename.dismiss(\'' + esc(job.objectId) + '\')">不修改</button></div>';
    }).join('');
    let previousGroup = '';
    const rows = visible.map((c, index) => {
      const groupKey = c.job.objectId + '|' + c.source.section;
      const groupIndex = sectionGroups.findIndex(group => group.key === groupKey);
      const heading = groupKey === previousGroup ? '' :
        '<div class="rename-review-section"><strong>' + esc(c.source.section) + ' · ' +
        esc(c.job.next) + '（' + sectionGroups[groupIndex].items.length + ' 处）</strong>' +
        '<button type="button" onclick="BBObjectRename.selectSection(' + groupIndex + ',true)">勾选本组确定项</button>' +
        '<button type="button" onclick="BBObjectRename.selectSection(' + groupIndex + ',false)">清空本组</button></div>';
      previousGroup = groupKey;
      return heading + '<label class="rename-review-row"><input type="checkbox" ' + (isSelected(c) ? 'checked' : '') +
        ' onchange="BBObjectRename.toggle(' + index + ',this.checked)"><span><b>' + esc(c.source.title) +
        '</b>' + (c.uncertain ? ' <em>名称嵌在更长文字中，需确认</em>' : '') +
        '<small>原文：' + esc(c.before) + '</small><small>修改后：' + esc(c.after) + '</small></span></label>';
    }).join('');
    box.innerHTML = header + '<div class="rename-review-body"><p>只处理对应层面的现场记录与已保存报告正文。自动草稿会根据最新对象名称生成。</p>' +
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
  style.textContent = '.object-rename-review:not(:empty){margin:12px 0;padding:12px;border:1px solid #b7c9dd;border-radius:8px;background:#f7faff}.rename-review-head,.rename-review-job,.rename-review-tools,.rename-review-actions,.rename-review-section{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.rename-review-head{justify-content:space-between}.rename-review-body{margin-top:12px}.rename-review-job{padding:8px 0;border-top:1px solid #dce5ef}.rename-review-job button{margin-left:auto}.rename-review-section{padding:9px 0;border-top:1px solid #b7c9dd}.rename-review-row{display:flex;gap:10px;padding:10px;border-top:1px solid #dce5ef;cursor:pointer}.rename-review-row input{align-self:flex-start}.rename-review-row small{display:block;white-space:pre-wrap;word-break:break-word;line-height:1.5}.rename-review-row em{color:#a65320;font-style:normal}.rename-review-tools,.rename-review-actions{margin:12px 0}.rename-review-body button:not(.btn){padding:5px 9px;border:1px solid #b7c9dd;border-radius:5px;background:transparent;cursor:pointer}html[data-theme="dark"] .object-rename-review:not(:empty){background:#26332e;color:#e4eae5;border-color:#52675d}html[data-theme="dark"] .rename-review-row,html[data-theme="dark"] .rename-review-job{border-color:#52675d}';
  document.head.appendChild(style);
  return { refresh, open() { open = !open; refresh(); }, toggle(index, checked) { if (visible[index]) selected[visible[index].id] = checked; },
    filter(uncertain) { filter = uncertain ? 'uncertain' : 'all'; page = 0; refresh(); },
    selectGroup(value) { visible.forEach(c => { if (!value || !c.uncertain) selected[c.id] = value; }); refresh(); },
    selectSection(index, value) { (sectionGroups[index]?.items || []).forEach(c => { if (!value || !c.uncertain) selected[c.id] = value; }); refresh(); },
    page(direction) { page += direction; refresh(); }, dismiss, dismissAll() { pendingObjectRenames = []; selected = {}; refresh(); persist([2]); },
    apply };
})();
