/* 报告编制审核页：通过现有项目阶段保存通道持久化。 */
let reportReviewState = { findings: [], accepted: [], ranAt: '', scope: null, signature: '' };
(function() {
  const labels = ['单元测评结果分析', '整体测评分析', '风险分析', '评估结论', '总体评价', '安全问题及改进建议'];
  let selected = '';
  const esc = value => onsiteEsc(String(value || ''));
  function assetNames(kind) {
    const tbody = document.getElementById('asset-tbody-' + kind);
    return tbody ? Array.from(tbody.rows).map(r => r.cells[1]?.querySelector('textarea,input')?.value.trim()).filter(Boolean) : [];
  }
  function snapshot() {
    const objects = [], units = [], targets = [];
    ONSITE_LAYERS.forEach((layer, t) => {
      const planned = getOnsiteObjectEntries(t);
      evaluationIndicatorLevels[t].items.forEach((unit, i) => {
        const applicable = isOnsiteUnitApplicable(t, i);
        units.push({ layer: t, name: unit.name, result: reportClassify(getRawUnitScore(t, i)) });
        getOnsiteUnitObjectEntries(t, unit.name).forEach((entry, j) => {
          const record = getOnsiteRec(t, i, j);
          const aliases = (objData[t < 4 ? t + 1 : 5] || []).find(o => o.objectId === entry.id)?.aliases || [];
          objects.push({ key: onsiteKey(t, i, j), layer: t, item: i, index: j, name: entry.name, aliases,
            unit: unit.name, record: String(record.record || ''), result: getObjectCls(t, i, j),
            rawScore: getReportObjectScore(t, i, j, false), applicable,
            isData: t === 3 && Boolean(ONSITE_UNIT_DATA_REQ[unit.name]) });
        });
      });
      // 第二步存在但未绑定任何现场指标的对象也纳入覆盖检查。
      planned.forEach(entry => { if (!objects.some(o => o.layer === t && o.name === entry.name)) objects.push({ key: 'plan|' + entry.id,
        layer: t, item: -1, index: -1, name: entry.name, aliases: [], unit: '', record: '', result: '未测评', applicable: true, planOnly: true }); });
      const problemUnits = getLayerProblemUnits(t).map(p => ({ item: p.itemIdx, name: p.name }));
      objects.push({ key: 'problem-count|' + t, layer: t, item: -1, index: -1, name: '问题项', unit: '',
        record: '问题项 ' + problemUnits.length + ' 个', result: String(problemUnits.length), summaryCount: true });
      const definitions = [
        [0, 'report-ua-text-' + t, buildLayerAnalysisText(t), 'all'],
        [4, 'report-overall-' + t, buildLayerOverallText(t), 'all'],
        [5, 'report-sug-prob-' + t, buildSugProblemText(t), 'problems']
      ];
      definitions.forEach(([section, id, auto, coverage]) => targets.push({ id, section, layer: t, text: getReportTextVal(id, auto),
        manual: Object.prototype.hasOwnProperty.call(reportTexts, id), coverage,
        problemUnits: section === 5 ? problemUnits : undefined }));
    });
    // 整体分析与评估结论继续保留；建议只核对问题描述中的低分对象和编号，不核对改进建议。
    // 整体分析是结构化修正：保留人工填写理由，不将修正前后结果不同直接判错。
    Object.entries(reportFixes).forEach(([key, fix]) => {
      const loc = locateOnsiteRecordKey(key);
      if (loc) targets.push({ id: 'fix|' + key, section: 1, layer: loc.t, unit: loc.unitName, text: String(fix.reason || ''), manual: true });
    });
    targets.push({ id: 'report-conclusion-text', section: 3, layer: -1, text: getReportTextVal('report-conclusion-text', buildConclusionSentence()), manual: Object.prototype.hasOwnProperty.call(reportTexts, 'report-conclusion-text') });
    return { objects, units, targets, serverNames: assetNames('server'), databaseNames: assetNames('db'), dataCount: assetNames('data').length };
  }
  function signature(input) { return BBReportReviewEngine.hash(JSON.stringify(input)); }
  const excludedSections = new Set([2]);
  const suggestionRules = new Set(['C31', 'C32']);
  function validFinding(finding) {
    return finding && !excludedSections.has(finding.target?.section) &&
      (finding.target?.section !== 5 || suggestionRules.has(finding.rule));
  }
  function validAccepted(item) {
    return item && !excludedSections.has(item.targetSection) &&
      (item.targetSection !== 5 || suggestionRules.has(item.rule));
  }
  function sourceFingerprint(target, object, rule) {
    const source = [target.text, object.record, object.result, object.name];
    if (rule === 'C31') source.push(object.unit, object.rawScore);
    return BBReportReviewEngine.hash(JSON.stringify(source));
  }
  function acceptedFromFinding(finding) {
    return { id: finding.id, rule: finding.rule, objectKey: finding.object.key, objectName: finding.object.name,
      targetId: finding.target.id, targetSection: finding.target.section, title: finding.title,
      fingerprint: finding.fingerprint, sourceFingerprint: sourceFingerprint(finding.target, finding.object, finding.rule),
      note: finding.note || '', confirmedAt: new Date().toISOString() };
  }
  function normalizeState() {
    if (!Array.isArray(reportReviewState.findings)) reportReviewState.findings = [];
    if (!Array.isArray(reportReviewState.accepted)) reportReviewState.accepted = [];
    const accepted = new Map(reportReviewState.accepted.filter(item => item && item.id).map(item => [item.id, item]));
    reportReviewState.findings = reportReviewState.findings.filter(finding => {
      if (!validFinding(finding)) return false;
      if (finding.status !== '合理差异') return true;
      accepted.set(finding.id, acceptedFromFinding(finding));
      return false;
    });
    reportReviewState.accepted = Array.from(accepted.values()).filter(validAccepted);
  }
  window.bbNormalizeReportReviewState = normalizeState;
  async function persist() {
    try { if (window.bbPersistProjectStage) await window.bbPersistProjectStage(4, true, true); }
    catch (error) { showToast('审核记录保存失败，请重试：' + error.message, true); }
  }
  window.runReportReview = async function(scope) {
    normalizeState();
    const input = snapshot();
    const filtered = { ...input, targets: input.targets.filter(t => scope == null || t.section === scope) };
    reportReviewState.accepted = reportReviewState.accepted.filter(item => {
      const target = input.targets.find(t => t.id === item.targetId);
      const object = input.objects.find(o => o.key === item.objectKey);
      return target && object && item.sourceFingerprint === sourceFingerprint(target, object, item.rule);
    });
    const accepted = new Map(reportReviewState.accepted.map(item => [item.id, item]));
    const fresh = BBReportReviewEngine.analyze(filtered).filter(finding => {
      const item = accepted.get(finding.id);
      return !item || item.fingerprint !== finding.fingerprint;
    });
    const previous = new Map(reportReviewState.findings.map(f => [f.id, f]));
    fresh.forEach(f => { const old = previous.get(f.id); if (old?.fingerprint === f.fingerprint) { f.status = old.status; f.note = old.note || ''; } });
    reportReviewState.findings = scope == null ? fresh : reportReviewState.findings.filter(f => f.target.section !== scope).concat(fresh);
    reportReviewState.ranAt = new Date().toISOString(); reportReviewState.scope = scope;
    reportReviewState.findings.forEach(f => {
      const target = input.targets.find(t => t.id === f.target.id);
      const object = input.objects.find(o => o.key === f.object.key);
      f.stale = !target || !object || target.text !== f.target.text || object.record !== f.object.record || object.result !== f.object.result;
      if (f.stale) f.status = '待确认';
    });
    reportReviewState.signature = signature(input);
    selected = reportReviewState.findings[0]?.id || '';
    switchReportTab(7); render(); await persist();
  };
  window.selectReviewFinding = function(id) { selected = id; render(); };
  window.setReviewStatus = async function(id, value) {
    const f = reportReviewState.findings.find(x => x.id === id); if (!f) return;
    if (value === '合理差异') {
      reportReviewState.accepted.push(acceptedFromFinding(f));
      reportReviewState.findings = reportReviewState.findings.filter(x => x.id !== id);
      selected = reportReviewState.findings[0]?.id || '';
      render(); await persist(); return;
    }
    f.status = value; render(); await persist();
  };
  window.restoreAcceptedReview = async function(id) {
    normalizeState();
    reportReviewState.accepted = reportReviewState.accepted.filter(item => item.id !== id);
    await window.runReportReview(null);
  };
  window.setReviewNote = async function(id, value) {
    const f = reportReviewState.findings.find(x => x.id === id); if (!f) return;
    f.note = value; await persist();
  };
  window.locateReviewSource = function(id) {
    const f = reportReviewState.findings.find(x => x.id === id); if (!f) return;
    if (f.rule === 'C32') { switchStep(4); activeSuggestionLayer = f.target.layer; switchReportTab(5); showToast('请核对本层面的“问题项”数量及编号条目。'); return; }
    switchStep(f.object.planOnly ? 2 : 3);
    if (f.object.planOnly) { showToast('请在第二步测评对象中核对：' + f.object.name); return; }
    switchOnsiteTab(f.object.layer);
    expandOnsiteRecord(f.object.layer, f.object.item, f.object.index);
  };
  window.locateReviewTarget = function(id) {
    const f = reportReviewState.findings.find(x => x.id === id); if (!f) return;
    switchStep(4);
    if (f.target.section === 0) reportUaLayer = f.target.layer;
    if (f.target.section === 4) activeOverallLayer = f.target.layer;
    if (f.target.section === 5) activeSuggestionLayer = f.target.layer;
    switchReportTab(f.target.section);
    const panel = document.getElementById('report-panel-' + f.target.section);
    const field = document.getElementById(f.target.id) || Array.from(panel.querySelectorAll('textarea')).find(el => el.value === f.target.text);
    if (field) { field.scrollIntoView({ block: 'center', behavior: 'smooth' }); field.focus(); field.style.outline = '3px solid #e7a12a'; setTimeout(() => field.style.outline = '', 3000); }
    else showToast('已定位章节，请核对对应指标：' + f.object.unit);
  };
  const STATUSES = ['待确认', '需修改', '合理差异', '证据不足'];
  let reviewFilter = '全部';
  window.setReviewFilter = function(value) { reviewFilter = value; render(); };
  function rvBrief(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > 40 ? t.slice(0, 40) + '…' : (t || '（空）');
  }
  const escapeReg = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function rvPatterns(finding, side) {
    const names = [finding.object.name].concat(finding.object.aliases || []);
    const list = names.filter(n => n && String(n).length > 1).map(n => new RegExp(escapeReg(n), 'g'));
    const p = finding.params;
    if (p && p.attr) {
      const value = side === 'left' ? p.left : p.right;
      if (value) list.push(p.attr === 'tls'
        ? new RegExp('TLS\\s*v?\\s*' + escapeReg(value), 'gi')
        : new RegExp('AES[\\s_-]*' + escapeReg(value), 'gi'));
    }
    return list;
  }
  function rvMarkText(text, patterns, cls) {
    let out = esc(text);
    (patterns || []).forEach(re => { out = out.replace(re, m => '<mark class="' + cls + '">' + m + '</mark>'); });
    return out;
  }
  function rvDescribe(finding) {
    if (finding.rule === 'C31' || finding.rule === 'C32') return '<b>审核依据：</b>' + esc(finding.reason);
    const left = rvBrief(finding.baseline || finding.object.name);
    const right = String(finding.target.text || '').trim();
    return '<b>A</b> 现场结果记录中写了「<em class="ok">' + esc(left) + '</em>」，<b>B</b> ' + esc(labels[finding.target.section]) +
      '中' + (right ? '写了「<em class="bad">' + esc(rvBrief(right)) + '</em>」' : '<em class="bad">未出现该对象</em>') +
      '，两者<em class="bad">不一致</em>。';
  }
  function render() {
    const panel = document.getElementById('report-panel-7'); if (!panel) return;
    normalizeState();
    const state = reportReviewState, f = state.findings.find(x => x.id === selected) || state.findings[0];
    const stale = state.ranAt && (state.signature !== signature(snapshot()) || state.findings.some(x => x.stale));
    const counts = STATUSES.map(s => state.findings.filter(x => x.status === s).length);
    const list = reviewFilter === '全部' ? state.findings : state.findings.filter(x => x.status === reviewFilter);
    const scopeLabel = state.scope == null ? '整份报告' : labels[state.scope];
    const statusText = state.ranAt
      ? '上次审核 ' + new Date(state.ranAt).toLocaleString() + ' · ' + scopeLabel + ' · 发现 ' + state.findings.length + ' 项'
      : '尚未开始审核';
    const statusbar = '<div class="review-statusbar' + (stale ? ' warn' : '') + '"><span class="review-meta">' + esc(statusText) + '</span>' +
      (stale ? '<span class="review-tag">内容已变化</span>' : '') +
      '<button type="button" class="btn btn-primary review-run" onclick="runReportReview(null)">' + (state.ranAt ? '重新审核' : '开始审核') + '</button></div>';
    const filters = '<div class="review-filters"><button type="button" class="review-chip' + (reviewFilter === '全部' ? ' on' : '') + '" onclick="setReviewFilter(\'全部\')">全部 ' + state.findings.length + '</button>' +
      STATUSES.map((s, i) => '<button type="button" class="review-chip' + (reviewFilter === s ? ' on' : '') + (counts[i] ? '' : ' empty') + '" onclick="setReviewFilter(\'' + s + '\')">' + s + ' ' + counts[i] + '</button>').join('') + '</div>';
    const detail = f ? (function() {
      const hasObject = String(f.target.text || '').indexOf(f.object.name) >= 0;
      return '<h4>' + esc(f.title) + '</h4>' +
        '<p class="review-desc">' + rvDescribe(f) + '</p>' +
        '<div class="review-fields">' +
          (f.object.unit ? '<span>测评指标 <b>' + esc(f.object.unit) + '</b></span>' : '') +
          '<span>测评对象 <b>' + esc(f.object.name) + '</b></span>' +
          '<span>所属层面 <b>' + esc(ONSITE_LAYERS[f.object.layer].name) + '</b></span>' +
        '</div>' +
        '<div class="review-compare">' +
          '<div><div class="review-compare-head"><span>现场结果记录 / 第二步对象</span><button type="button" onclick="locateReviewSource(\'' + f.id + '\')">定位现场对象</button></div>' +
          '<pre>' + rvMarkText(f.baseline || f.object.name, rvPatterns(f, 'left'), 'rv-ok') + '</pre></div>' +
          '<div><div class="review-compare-head"><span>' + esc(labels[f.target.section]) + '原文</span><button type="button" onclick="locateReviewTarget(\'' + f.id + '\')">定位报告原文</button></div>' +
          (hasObject || f.rule === 'C32' || f.type === '无法核对' ? '' : '<div class="review-missing">未找到「' + esc(f.object.name) + '」相关描述</div>') +
          '<pre>' + rvMarkText(f.target.text || '（未填写）', rvPatterns(f, 'right'), 'rv-bad') + '</pre></div>' +
        '</div>' +
        '<label>处理状态 <select onchange="setReviewStatus(\'' + f.id + '\',this.value)">' + STATUSES.map(s => '<option' + (s === f.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></label>' +
        '<label>处理说明<textarea class="text-area" onchange="setReviewNote(\'' + f.id + '\',this.value)">' + esc(f.note) + '</textarea></label>';
    })() : '<p>选择左侧问题查看原文对照。</p>';
    panel.innerHTML = '<h3>报告审核</h3><p>根据第二步对象与第三步现场记录，核对单元测评结果分析、总体评价等现有审核目标。允许同类服务器、数据库达到3个时合并称呼；重要数据资产达到3项时可称“重要数据”。</p>' +
      '<p class="review-hint">安全问题及改进建议仅检查各层面问题描述中的低分对象和编号数量，不对比改进建议；风险分析不参与对比。整体分析依据、复杂语义及截图代码仍需人工复核。</p>' +
      statusbar +
      (state.accepted.length ? '<details class="review-accepted"><summary>已确认合理差异（' + state.accepted.length + '，不计入问题数）</summary>' +
        state.accepted.map(item => '<div class="review-accepted-item"><span>' + esc(item.rule + ' · ' + item.title + ' · ' + item.objectName + ' · ' + (labels[item.targetSection] || '报告内容')) +
          (item.note ? '<small>说明：' + esc(item.note) + '</small>' : '') + '</span><button type="button" class="btn" onclick="restoreAcceptedReview(\'' + item.id + '\')">撤销确认</button></div>').join('') +
        '</details>' : '') +
      filters +
      '<div class="review-grid"><div>' + list.map(x => '<button class="review-item ' + (f?.id === x.id ? 'selected' : '') + '" onclick="selectReviewFinding(\'' + x.id + '\')"><strong>' + esc(x.title) + '</strong><small>' + esc(labels[x.target.section] + ' · ' + ONSITE_LAYERS[x.object.layer].name) + '<span class="review-badge st-' + esc(x.status) + '">' + esc(x.status) + '</span></small></button>').join('') +
      (state.ranAt && !state.findings.length ? '<p>本次规则检查未发现问题；未覆盖的语义和证据项仍需人工审核。</p>' : '') +
      (state.findings.length && !list.length ? '<p>当前筛选下没有问题。</p>' : '') + '</div><div>' + detail + '</div></div>';
  }
  window.renderReportReview = render;
  const style = document.createElement('style');
  style.textContent = '#report-panel-7{--rv-card:#fff;--rv-line:#dde4ee;--rv-soft:#f5f8fc;--rv-txt:#243447;--rv-dim:#65758a;--rv-accent:#2456a6;' +
    '--rv-warn-bg:#FAEEDA;--rv-warn-fg:#854F0B;--rv-bad-bg:#FCEBEB;--rv-bad-fg:#A32D2D;--rv-ok-bg:#EAF3DE;--rv-ok-fg:#3B6D11;--rv-mute-bg:#F1EFE8;--rv-mute-fg:#5F5E5A}' +
    'html[data-theme="dark"] #report-panel-7{--rv-card:#26332e;--rv-line:#52675d;--rv-soft:#20302a;--rv-txt:#e4eae5;--rv-dim:#bfcfc6;--rv-accent:#80c9ae;' +
    '--rv-warn-bg:#3d3320;--rv-warn-fg:#FAC775;--rv-bad-bg:#3f2b29;--rv-bad-fg:#F7C1C1;--rv-ok-bg:#26402f;--rv-ok-fg:#C0DD97;--rv-mute-bg:#2c3640;--rv-mute-fg:#D3D1C7}' +
    '.review-statusbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:12px 0;padding:10px 14px;background:var(--rv-card);' +
    'border:1px solid var(--rv-line);border-left:3px solid var(--rv-accent);border-radius:10px}' +
    '.review-statusbar.warn{border-left-color:#EF9F27}.review-meta{color:var(--rv-dim);font-size:13px}' +
    '.review-tag{background:var(--rv-warn-bg);color:var(--rv-warn-fg);padding:2px 10px;border-radius:999px;font-size:12px}' +
    '.review-run{width:auto;padding:6px 20px;margin-left:auto;border:none;border-radius:8px;cursor:pointer}' +
    '.review-hint{color:var(--rv-dim);font-size:13px;background:var(--rv-soft);border-left:3px solid var(--rv-accent);' +
    'border-radius:0 8px 8px 0;padding:10px 14px;line-height:1.7}' +
    '.review-filters{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0}' +
    '.review-chip{padding:3px 12px;border:1px solid var(--rv-line);border-radius:999px;background:var(--rv-card);color:var(--rv-txt);font-size:12px;cursor:pointer}' +
    '.review-chip.on{background:var(--rv-accent);border-color:var(--rv-accent);color:#fff}.review-chip.empty{color:var(--rv-dim)}' +
    '.review-grid{display:grid;grid-template-columns:minmax(220px,32%) 1fr;gap:24px;align-items:start}' +
    '.review-item{display:block;width:100%;text-align:left;padding:12px 14px;margin:8px 0;border:1px solid var(--rv-line);border-radius:10px;' +
    'background:var(--rv-card);color:var(--rv-txt);cursor:pointer;transition:box-shadow .15s,transform .15s,border-color .15s,background .15s}' +
    '.review-item:hover{border-color:var(--rv-accent);transform:translateY(-1px)}' +
    '.review-item.selected{background:var(--rv-soft);border-color:var(--rv-accent);box-shadow:inset 3px 0 0 var(--rv-accent)}' +
    '.review-item strong{display:block;font-size:13px;line-height:1.5}' +
    '.review-item small{display:flex;align-items:center;gap:8px;margin-top:7px;color:var(--rv-dim);font-size:12px}' +
    '.review-badge{margin-left:auto;padding:2px 10px;border-radius:999px;font-size:12px;white-space:nowrap}' +
    '.st-待确认{background:var(--rv-warn-bg);color:var(--rv-warn-fg)}.st-需修改{background:var(--rv-bad-bg);color:var(--rv-bad-fg)}' +
    '.st-合理差异{background:var(--rv-ok-bg);color:var(--rv-ok-fg)}.st-证据不足{background:var(--rv-mute-bg);color:var(--rv-mute-fg)}' +
    '#report-panel-7 h4{margin:0 0 8px;font-size:15px;color:var(--rv-txt)}' +
    '.review-desc{font-size:13px;line-height:1.9;color:var(--rv-txt);margin:0 0 12px}' +
    '.review-desc b{font-weight:600}.review-desc em{font-style:normal;font-weight:600}' +
    '.review-desc em.ok{color:var(--rv-ok-fg)}.review-desc em.bad{color:var(--rv-bad-fg)}' +
    '.review-fields{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}' +
    '.review-fields span{background:var(--rv-soft);border:1px solid var(--rv-line);border-radius:8px;padding:4px 10px;font-size:12px;color:var(--rv-dim)}' +
    '.review-fields b{color:var(--rv-txt);font-weight:600}' +
    '.review-compare{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin:12px 0}' +
    '.review-compare>div{border:1px solid var(--rv-line);border-radius:10px;overflow:hidden;background:var(--rv-card)}' +
    '.review-compare-head{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--rv-soft);' +
    'border-bottom:1px solid var(--rv-line);font-size:12px;font-weight:600;color:var(--rv-txt)}' +
    '.review-compare-head button{margin-left:auto;padding:3px 9px;border:1px solid var(--rv-line);border-radius:6px;' +
    'background:var(--rv-card);color:var(--rv-txt);font-size:11px;cursor:pointer}' +
    '.review-compare pre{white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto;padding:12px;margin:0;' +
    'background:transparent;color:var(--rv-txt);font:12px/1.9 monospace}' +
    '.review-missing{padding:7px 12px;background:var(--rv-bad-bg);color:var(--rv-bad-fg);font-size:12px;border-bottom:1px solid var(--rv-line)}' +
    'mark.rv-ok{background:var(--rv-ok-bg);color:var(--rv-ok-fg);padding:1px 4px;border-radius:4px}' +
    'mark.rv-bad{background:var(--rv-bad-bg);color:var(--rv-bad-fg);padding:1px 4px;border-radius:4px}' +
    '#report-panel-7 label{display:block;margin:14px 0;font-size:13px;color:var(--rv-dim)}' +
    '#report-panel-7 select,#report-panel-7 textarea{padding:5px 10px;border:1px solid var(--rv-line);border-radius:8px;' +
    'background:var(--rv-card);color:var(--rv-txt);font-size:12px}' +
    '#report-panel-7 .review-item:focus-visible{outline:3px solid var(--rv-accent);outline-offset:2px}' +
    '@media(max-width:900px){.review-grid{grid-template-columns:1fr}}';
  style.textContent += '.review-accepted{margin:12px 0;padding:10px 12px;border:1px solid #ccd6e4;border-radius:8px}.review-accepted summary{cursor:pointer;font-weight:600}.review-accepted-item{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:9px 0;border-top:1px solid #ccd6e4}.review-accepted-item small{display:block}.review-accepted-item .btn{width:auto;padding:0 12px;white-space:nowrap}html[data-theme="dark"] #report-panel-7 .review-accepted,html[data-theme="dark"] #report-panel-7 .review-accepted-item{border-color:#52675d}';
  document.head.appendChild(style);
})();
