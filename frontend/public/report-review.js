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
            unit: unit.name, record: String(record.record || ''), result: getObjectCls(t, i, j), applicable,
            isData: t === 3 && Boolean(ONSITE_UNIT_DATA_REQ[unit.name]) });
        });
      });
      // 第二步存在但未绑定任何现场指标的对象也纳入覆盖检查。
      planned.forEach(entry => { if (!objects.some(o => o.layer === t && o.name === entry.name)) objects.push({ key: 'plan|' + entry.id,
        layer: t, item: -1, index: -1, name: entry.name, aliases: [], unit: '', record: '', result: '未测评', applicable: true, planOnly: true }); });
      const definitions = [
        [0, 'report-ua-text-' + t, buildLayerAnalysisText(t), 'all'],
        [4, 'report-overall-' + t, buildLayerOverallText(t), 'all']
      ];
      definitions.forEach(([section, id, auto, coverage]) => targets.push({ id, section, layer: t, text: getReportTextVal(id, auto),
        manual: Object.prototype.hasOwnProperty.call(reportTexts, id), coverage, advice: id.includes('sug-adv') }));
    });
    // 整体分析与评估结论继续保留为现有审核目标；风险分析和建议不参与对比。
    // 整体分析是结构化修正：保留人工填写理由，不将修正前后结果不同直接判错。
    Object.entries(reportFixes).forEach(([key, fix]) => {
      const loc = locateOnsiteRecordKey(key);
      if (loc) targets.push({ id: 'fix|' + key, section: 1, layer: loc.t, unit: loc.unitName, text: String(fix.reason || ''), manual: true });
    });
    targets.push({ id: 'report-conclusion-text', section: 3, layer: -1, text: getReportTextVal('report-conclusion-text', buildConclusionSentence()), manual: Object.prototype.hasOwnProperty.call(reportTexts, 'report-conclusion-text') });
    return { objects, units, targets, serverNames: assetNames('server'), databaseNames: assetNames('db'), dataCount: assetNames('data').length };
  }
  function signature(input) { return BBReportReviewEngine.hash(JSON.stringify(input)); }
  const excludedSections = new Set([2, 5]);
  function sourceFingerprint(target, object) {
    return BBReportReviewEngine.hash(JSON.stringify([target.text, object.record, object.result, object.name]));
  }
  function acceptedFromFinding(finding) {
    return { id: finding.id, rule: finding.rule, objectKey: finding.object.key, objectName: finding.object.name,
      targetId: finding.target.id, targetSection: finding.target.section, title: finding.title,
      fingerprint: finding.fingerprint, sourceFingerprint: sourceFingerprint(finding.target, finding.object),
      note: finding.note || '', confirmedAt: new Date().toISOString() };
  }
  function normalizeState() {
    if (!Array.isArray(reportReviewState.findings)) reportReviewState.findings = [];
    if (!Array.isArray(reportReviewState.accepted)) reportReviewState.accepted = [];
    const accepted = new Map(reportReviewState.accepted.filter(item => item && item.id).map(item => [item.id, item]));
    reportReviewState.findings = reportReviewState.findings.filter(finding => {
      if (!finding || excludedSections.has(finding.target?.section)) return false;
      if (finding.status !== '合理差异') return true;
      accepted.set(finding.id, acceptedFromFinding(finding));
      return false;
    });
    reportReviewState.accepted = Array.from(accepted.values()).filter(item => !excludedSections.has(item.targetSection));
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
      return target && object && item.sourceFingerprint === sourceFingerprint(target, object);
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
  function render() {
    const panel = document.getElementById('report-panel-7'); if (!panel) return;
    normalizeState();
    const state = reportReviewState, f = state.findings.find(x => x.id === selected) || state.findings[0];
    const stale = state.ranAt && (state.signature !== signature(snapshot()) || state.findings.some(x => x.stale));
    panel.innerHTML = '<h3>报告审核</h3><p>根据第二步对象与第三步现场记录，核对单元测评结果分析、总体评价等现有审核目标。允许同类服务器、数据库达到3个时合并称呼；重要数据资产达到3项时可称“重要数据”。</p>' +
      '<p class="review-hint">当前不对比风险分析、安全问题及改进建议，也不因这些栏目缺少测评对象而报错。其余栏目进行本地规则初审；整体分析依据、复杂语义及截图代码仍需人工复核。</p>' +
      '<p>' + (state.ranAt ? '上次审核：' + esc(new Date(state.ranAt).toLocaleString()) + '；' + (state.scope == null ? '整份报告' : labels[state.scope]) + '；发现 ' + state.findings.length + ' 项' : '尚未开始审核') + (stale ? '；内容已变化，请重新审核' : '') + '</p>' +
      (state.accepted.length ? '<details class="review-accepted"><summary>已确认合理差异（' + state.accepted.length + '，不计入问题数）</summary>' +
        state.accepted.map(item => '<div class="review-accepted-item"><span>' + esc(item.rule + ' · ' + item.title + ' · ' + item.objectName + ' · ' + (labels[item.targetSection] || '报告内容')) +
          (item.note ? '<small>说明：' + esc(item.note) + '</small>' : '') + '</span><button type="button" class="btn" onclick="restoreAcceptedReview(\'' + item.id + '\')">撤销确认</button></div>').join('') +
        '</details>' : '') +
      '<div class="review-grid"><div>' + state.findings.map(x => '<button class="review-item ' + (f?.id === x.id ? 'selected' : '') + '" onclick="selectReviewFinding(\'' + x.id + '\')"><strong>' + esc(x.title) + '</strong><small>' + esc(labels[x.target.section] + ' · ' + ONSITE_LAYERS[x.object.layer].name + ' · ' + x.status) + '</small></button>').join('') +
      (state.ranAt && !state.findings.length ? '<p>本次规则检查未发现问题；未覆盖的语义和证据项仍需人工审核。</p>' : '') + '</div><div>' + (f ?
      '<h4>' + esc(f.title) + '</h4><p>' + esc(f.reason) + '</p><p>' + esc(f.object.unit + ' / ' + f.object.name) + '</p><div class="review-compare"><div><strong>现场结果记录 / 第二步对象</strong><pre>' + esc(f.baseline || f.object.name) + '</pre><button class="btn" onclick="locateReviewSource(\'' + f.id + '\')">定位现场/对象</button></div><div><strong>' + esc(labels[f.target.section]) + '原文</strong><pre>' + esc(f.target.text || '（未填写）') + '</pre><button class="btn" onclick="locateReviewTarget(\'' + f.id + '\')">定位报告原文</button></div></div><label>处理状态 <select onchange="setReviewStatus(\'' + f.id + '\',this.value)">' + ['待确认', '需修改', '合理差异', '证据不足'].map(s => '<option' + (s === f.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></label><label>处理说明<textarea class="text-area" onchange="setReviewNote(\'' + f.id + '\',this.value)">' + esc(f.note) + '</textarea></label>' : '<p>选择左侧问题查看原文对照。</p>') + '</div></div>';
  }
  window.renderReportReview = render;
  const style = document.createElement('style');
  style.textContent = '.review-grid{display:grid;grid-template-columns:minmax(220px,30%) 1fr;gap:20px}.review-item{display:block;width:100%;text-align:left;padding:12px;margin:6px 0;border:1px solid #ccd6e4;border-radius:8px;background:white;color:#243447;cursor:pointer}.review-item.selected{background:#eaf1fb;border-color:#2456a6}.review-item small{display:block;margin-top:8px}.review-compare{display:grid;grid-template-columns:1fr 1fr;gap:14px}.review-compare pre{white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto;padding:12px;background:#f5f7fb;color:#243447;font:13px/1.8 sans-serif}.review-hint{color:#65758a;font-size:13px}#report-panel-7 label{display:block;margin:14px 0}#report-panel-7 select{padding:8px}#report-panel-7 .review-item:focus-visible{outline:3px solid #62a892;outline-offset:2px}html[data-theme="dark"] #report-panel-7 .review-item{background:#26332e;color:#e4eae5;border-color:#52675d}html[data-theme="dark"] #report-panel-7 .review-item.selected{background:#29483f;border-color:#80c9ae}html[data-theme="dark"] #report-panel-7 .review-item:hover{background:#32483e}html[data-theme="dark"] #report-panel-7 .review-item small,html[data-theme="dark"] #report-panel-7 .review-hint{color:#bfcfc6}html[data-theme="dark"] #report-panel-7 .review-compare pre,html[data-theme="dark"] #report-panel-7 select,html[data-theme="dark"] #report-panel-7 textarea{background:#26332e;color:#e4eae5;border-color:#52675d}@media(max-width:900px){.review-grid,.review-compare{grid-template-columns:1fr}}';
  style.textContent += '.review-accepted{margin:12px 0;padding:10px 12px;border:1px solid #ccd6e4;border-radius:8px}.review-accepted summary{cursor:pointer;font-weight:600}.review-accepted-item{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:9px 0;border-top:1px solid #ccd6e4}.review-accepted-item small{display:block}.review-accepted-item .btn{width:auto;padding:0 12px;white-space:nowrap}html[data-theme="dark"] #report-panel-7 .review-accepted,html[data-theme="dark"] #report-panel-7 .review-accepted-item{border-color:#52675d}';
  document.head.appendChild(style);
})();
