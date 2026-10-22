/* 报告编制审核页：通过现有项目阶段保存通道持久化。 */
let reportReviewState = { findings: [], accepted: [], ranAt: '', scope: null, signature: '' };
(function() {
  const labels = ['单元测评结果分析', '整体测评分析', '风险分析', '评估结论', '总体评价', '安全问题及改进建议'];
  labels[8] = '密码应用概况';

  // ===== 图件传入检查（规则 C40）=====
  // 报告要求插入的图片：图2-1/图2-2 为「网络拓扑图及描述」中的图片块（第1、2个图片块），
  // 图3-1 为「测评方法及工具—测评接入点」中的工具接入示意图。只核对是否已传入，不判断图片内容。
  const AREA_IMAGE_IDS = new Set(['access-image']);
  const AREA_SCOPE_IDS = new Set(['access-placeholder', 'access-filename', 'access-file', 'access-upload-area',
    'method-sub-panel-2', 'access-point-list']);
  function onsitePictureText(value) {
    const str = String(value || '');
    return /^(data:image\/|blob:)/.test(str) || /^https?:/i.test(str);
  }
  function onsitePictureArea(img) {
    const area = img.closest?.('.topology-upload, .crypto-upload');
    return Boolean(area && AREA_IMAGE_IDS.has(img.id || ''));
  }
  // 图片区快照：当前 DOM；第二步未渲染时回退到末次保存的 images 快照。
  function onsitePictureStates() {
    const states = new Map();
    if (typeof document.querySelectorAll === 'function') document.querySelectorAll('img').forEach(img => { if (img.id) states.set(img.id, onsitePictureText(img.getAttribute('src'))); });
    const stored = typeof savedPlan === 'object' && savedPlan && Array.isArray(savedPlan.images) ? savedPlan.images : [];
    stored.forEach(saved => {
      if (!saved || !saved.id || states.get(saved.id)) return;
      states.set(saved.id, onsitePictureText(saved.src));
    });
    return states;
  }
  function onsitePicturePresent(states, id) {
    const value = states.get(id);
    if (value === true) return true;
    const el = document.getElementById(id);
    if (!el || !AREA_SCOPE_IDS.has(id)) return false;
    const area = el.closest?.('.topology-upload, .crypto-upload');
    return Boolean(area);
  }
  function onsiteFigureFindings() {
    const states = onsitePictureStates();
    // 拓扑图片块来自第二步数据；页面尚未初始化该数组时按“未传入”处理。
    const blocks = Array.isArray(typeof topologyBlocks === 'object' ? topologyBlocks : null) ? topologyBlocks : [];
    const topologyImages = blocks.filter(block => block && block.type === 'image' && block.dataUrl);
    const prepared = topologyImages[0];
    const deployed = topologyImages[1];
    const access = document.getElementById('access-image');
    // 图片已设置 src 或明确隐藏（display:none）时，按已传入处理；
    // 否则 DOM 缺失（第二步未渲染）时回退到末次保存的快照。
    const accessSrc = onsitePictureText(access && access.getAttribute('src'));
    const accessHidden = Boolean(access && String(access.style.display || '').toLowerCase() === 'none');
    const accessPresent = accessSrc || accessHidden || (!access && onsitePicturePresent(states, 'access-image'));
    return [
      { key: 'plan-figure-topology-prepared', name: '图2-1', section: 2, layer: -1, path: '被测系统情况—网络拓扑图及描述',
        hint: '网络拓扑图及描述（第1个图片块）', present: Boolean(prepared),
        text: prepared ? '第1个拓扑图片块：' + (prepared.caption || '图 2-1') : '',
        targetId: 'plan-topology-blocks' },
      { key: 'plan-figure-topology-deployed', name: '图2-2', section: 2, layer: -1, path: '被测系统情况—网络拓扑图及描述',
        hint: '网络拓扑图及描述（第2个图片块）', present: Boolean(deployed),
        text: deployed ? '第2个拓扑图片块：' + (deployed.caption || '图 2-2') : '',
        targetId: 'plan-topology-blocks' },
      { key: 'plan-figure-access-tool', name: '图3-1', section: 2, layer: -1, path: '测评方法及工具—测评接入点',
        unit: '测评接入点', hint: '工具接入示意图（图片名称：' + ((document.getElementById('access-filename')?.textContent || '').trim() || '--') + '）',
        present: Boolean(accessPresent), text: accessPresent ? '已传入工具接入示意图' : '',
        targetId: 'access-upload-area' }
    ];
  }
  function onsiteFigureOutline(figures) {
    // 图片齐全时不显示；缺少时提示应到哪一步哪一页补充，避免用户找不到位置。
    const missing = (figures || []).filter(figure => !figure.present);
    if (!missing.length) return '';
    return '<p class="review-hint">图片检查：需提供 图2-1、图2-2（网络拓扑图及描述）和 图3-1（测评方法及工具—测评接入点）；' +
      '当前缺少 ' + missing.map(figure => figure.name).join('、') + '，请到第二步对应页面补充图片后重新审核。</p>';
  }

  let selected = '';
  // 当前快照：渲染时复用，避免重复扫描全部测评对象。
  let snapshotCache = null;
  const esc = value => onsiteEsc(String(value || ''));
  function assetNames(kind) {
    const tbody = document.getElementById('asset-tbody-' + kind);
    return tbody ? Array.from(tbody.rows).map(r => r.cells[1]?.querySelector('textarea,input')?.value.trim()).filter(Boolean) : [];
  }
  function snapshot() {
    const objects = [], units = [], targets = [], recordExpectations = [];
    ONSITE_LAYERS.forEach((layer, t) => {
      const planned = getOnsiteObjectEntries(t);
      evaluationIndicatorLevels[t].items.forEach((unit, i) => {
        const applicable = isOnsiteUnitApplicable(t, i);
        units.push({ layer: t, name: unit.name, result: reportClassify(getRawUnitScore(t, i)) });
        const unitObjects = [];
        getOnsiteUnitObjectEntries(t, unit.name).forEach((entry, j) => {
          const record = getOnsiteRec(t, i, j);
          const aliases = (objData[t < 4 ? t + 1 : 5] || []).find(o => o.objectId === entry.id)?.aliases || [];
          const reviewObject = { key: onsiteKey(t, i, j), layer: t, item: i, index: j, name: entry.name, aliases,
            unit: unit.name, record: String(record.record || ''), result: getObjectCls(t, i, j),
            rawScore: getReportObjectScore(t, i, j, false), applicable,
            isData: t === 3 && Boolean(ONSITE_UNIT_DATA_REQ[unit.name]) };
          objects.push(reviewObject);
          unitObjects.push(reviewObject);
        });
        if (t >= 4 && t <= 7 && applicable) {
          const nonempty = new Map();
          unitObjects.forEach(object => {
            const text = String(object.record || '').trim();
            if (!text) return;
            if (!nonempty.has(text)) nonempty.set(text, { key: 'record|' + t + '|' + i + '|' + nonempty.size,
              layer: t, item: i, unit: unit.name, record: text, problem: false, sources: [] });
            const expectation = nonempty.get(text);
            expectation.sources.push({ ...object, problem: ['部分符合', '不符合'].includes(object.result) });
            if (['部分符合', '不符合'].includes(object.result)) expectation.problem = true;
          });
          if (nonempty.size) recordExpectations.push(...nonempty.values());
          else recordExpectations.push({ key: 'record-empty|' + t + '|' + i, layer: t, item: i, unit: unit.name,
            record: '', problem: unitObjects.some(object => ['部分符合', '不符合'].includes(object.result)), sources: unitObjects.map(object => ({ ...object,
              problem: ['部分符合', '不符合'].includes(object.result) })) });
        }
      });
      // 第二步存在但未绑定任何现场指标的对象也纳入覆盖检查。
      planned.forEach(entry => { if (!objects.some(o => o.layer === t && o.name === entry.name)) objects.push({ key: 'plan|' + entry.id,
        layer: t, item: -1, index: -1, name: entry.name, aliases: [], unit: '', record: '', result: '未测评', applicable: true, planOnly: true }); });
      const problemUnits = getLayerProblemUnits(t).map(p => {
        const template = findRiskTemplate(t, p.name, p.cls);
        const templateAdvice = fillRiskTemplateText(template?.advice, t, p.name);
        const adviceBaseline = templateAdvice || ('建议按照 GB/T 39786—2021 相关要求' + (p.desc ? '（' + p.desc + '）' : '') +
          '，采用符合国家密码管理要求的密码技术、密码产品与密码服务进行整改，确保相应安全需求得到有效保障。');
        return { item: p.itemIdx, name: p.name, adviceBaseline };
      });
      objects.push({ key: 'problem-count|' + t, layer: t, item: -1, index: -1, name: '问题项', unit: '',
        record: '问题项 ' + problemUnits.length + ' 个', result: String(problemUnits.length), summaryCount: true });
      objects.push({ key: 'advice-count|' + t, layer: t, item: -1, index: -1, name: '改进建议', unit: '',
        record: '问题单元 ' + problemUnits.length + ' 个', result: String(problemUnits.length), summaryCount: true });
      const definitions = [
        [0, 'report-ua-text-' + t, getReportUnitAnalysisText(t), 'all', 'unitAnalysis'],
        [4, 'report-overall-' + t, getReportOverallText(t), 'all', 'overall'],
        [5, 'report-sug-prob-' + t, getReportSuggestionText(t, 'prob'), 'problems', 'problem'],
        [5, 'report-sug-adv-' + t, getReportSuggestionText(t, 'adv'), null, 'advice']
      ];
      definitions.forEach(([section, id, text, coverage, kind]) => {
        const state = reportTextStates[id];
        const sourceMode = state?.mode || (Object.prototype.hasOwnProperty.call(reportTexts, id) ? 'manual' : 'auto');
        targets.push({ id, section, layer: t, text, manual: sourceMode !== 'auto', sourceMode, coverage, kind,
          problemUnits: section === 5 ? problemUnits : undefined });
      });
    });
    ['physical', 'network', 'device', 'application'].forEach((key, layer) => {
      const id = 'plan-crypto-' + key;
      targets.push({ id, section: 8, layer, text: document.getElementById(id)?.value || '', manual: true, coverage: 'all' });
    });
    // 整体分析与评估结论继续保留；问题描述按层面规则核对，改进建议另行检查对应关系和可执行性。
    // 整体分析是结构化修正：保留人工填写理由，不将修正前后结果不同直接判错。
    Object.entries(reportFixes).forEach(([key, fix]) => {
      const loc = locateOnsiteRecordKey(key);
      if (loc) targets.push({ id: 'fix|' + key, section: 1, layer: loc.t, unit: loc.unitName, text: String(fix.reason || ''), manual: true });
    });
    targets.push({ id: 'report-conclusion-text', section: 3, layer: -1, text: getReportTextVal('report-conclusion-text', buildConclusionSentence()), manual: Object.prototype.hasOwnProperty.call(reportTexts, 'report-conclusion-text') });
    const figures = onsiteFigureFindings();
    // 图片缺失时补一条零文本目标，保证只审该章节时仍能进入图片检查；图片齐全时此目标不产生问题。
    if (figures.some(figure => !figure.present)) {
      targets.push({ id: 'plan-figure-none', section: 2, layer: -1, text: '', manual: true, kind: 'figure' });
    }
    const input = { objects, units, targets, recordExpectations, figures,
      serverNames: assetNames('server'), databaseNames: assetNames('db'), dataCount: assetNames('data').length };
    snapshotCache = input;
    return input;
  }
  function signature(input) { return BBReportReviewEngine.hash(JSON.stringify(input)); }
  function findInputObject(input, key) {
    const direct = input.objects.find(object => object.key === key);
    if (direct) return direct;
    const expectation = (input.recordExpectations || []).find(item => item.key === key ||
      (item.sources || []).some(source => source.key === key));
    if (!expectation) return null;
    return (expectation.sources || []).find(source => source.key === key) || {
      key: expectation.key, layer: expectation.layer, item: expectation.item, index: -1,
      name: '结果记录', unit: expectation.unit, record: expectation.record, result: ''
    };
  }
  const excludedSections = new Set([2]);
  const suggestionRules = new Set(['C31', 'C32', 'C34', 'C35', 'C36', 'C37', 'C38', 'C39']);
  const managementRulesReplaced = new Set(['C29', 'C31']);
  function layerFromTargetId(id) {
    const match = /-(\d+)$/.exec(String(id || ''));
    return match ? Number(match[1]) : null;
  }
  function validFinding(finding) {
    if (!finding) return false;
    // 图件检查不属于任何章节文本，必须在章节过滤之前判定。
    if (finding.rule === 'C40') return finding.object?.key !== 'plan-figure-none';
    if (excludedSections.has(finding.target?.section)) return false;
    if (Number(finding.object?.layer) >= 4 && managementRulesReplaced.has(finding.rule)) return false;
    return finding.target?.section !== 5 || suggestionRules.has(finding.rule);
  }
  function validAccepted(item) {
    if (!item) return false;
    if (item.rule === 'C40') return item.objectKey !== 'plan-figure-none';
    if (excludedSections.has(item.targetSection)) return false;
    const layer = item.objectLayer ?? layerFromTargetId(item.targetId);
    if (Number(layer) >= 4 && managementRulesReplaced.has(item.rule)) return false;
    return item.targetSection !== 5 || suggestionRules.has(item.rule);
  }
  function sourceFingerprint(target, object, rule) {
    const source = [target.text, object.record, object.result, object.name];
    if (rule === 'C31' || /^C3[4-9]$/.test(rule)) source.push(object.unit, object.rawScore, target.kind, target.sourceMode);
    return BBReportReviewEngine.hash(JSON.stringify(source));
  }
  function acceptedFromFinding(finding) {
    return { id: finding.id, rule: finding.rule, objectKey: finding.object.key, objectName: finding.object.name,
      objectUnit: finding.object.unit, objectLayer: finding.object.layer, targetId: finding.target.id, targetSection: finding.target.section, title: finding.title,
      fingerprint: finding.fingerprint, sourceFingerprint: sourceFingerprint(finding.target, finding.object, finding.rule),
      note: finding.note || '', confirmedAt: new Date().toISOString() };
  }
  function groupedFindings(findings) {
    const groups = new Map(), view = [];
    findings.forEach(finding => {
      if (finding.rule !== 'C31' || finding.type !== '无法核对') { view.push(finding); return; }
      const key = finding.target.id + '|' + finding.object.unit;
      if (!groups.has(key)) { groups.set(key, []); view.push({ groupKey: key }); }
      groups.get(key).push(finding);
    });
    return view.map(item => {
      if (!item.groupKey) return item;
      const members = groups.get(item.groupKey);
      if (members.length === 1) return members[0];
      const first = members[0], names = members.map(f => f.object.name);
      return { ...first, id: 'c31-group-' + BBReportReviewEngine.hash(item.groupKey),
        memberIds: members.map(f => f.id), members: members.map(f => f.object),
        object: { ...first.object, name: names.join('、') },
        baseline: members.map(f => f.object.name + '：' + (f.object.record || '（结果记录为空）')).join('\n'),
        title: '无法定位低分对象对应的问题条目：' + first.object.unit + '（' + members.length + '个对象）',
        reason: first.reason + ' 涉及对象：' + names.join('、') + '。',
        status: members.every(f => f.status === first.status) ? first.status : '待确认' };
    });
  }
  function groupedAccepted(items) {
    const groups = new Map(), view = [];
    items.forEach(item => {
      if (item.rule !== 'C31' || !item.objectUnit || !String(item.title || '').startsWith('无法定位低分对象对应的问题条目')) {
        view.push(item); return;
      }
      const key = item.targetId + '|' + item.objectUnit;
      if (!groups.has(key)) { groups.set(key, []); view.push({ groupKey: key }); }
      groups.get(key).push(item);
    });
    return view.map(item => {
      if (!item.groupKey) return item;
      const members = groups.get(item.groupKey);
      if (members.length === 1) return members[0];
      return { ...members[0], id: 'accepted-group-' + BBReportReviewEngine.hash(item.groupKey),
        memberIds: members.map(member => member.id),
        objectName: members.map(member => member.objectName).join('、'),
        title: '无法定位低分对象对应的问题条目：' + members[0].objectUnit };
    });
  }
  function findingMembers(id) {
    const finding = reportReviewState.findings.find(f => f.id === id);
    if (finding) return [finding];
    const group = groupedFindings(reportReviewState.findings).find(f => f.id === id);
    return group?.memberIds?.map(memberId => reportReviewState.findings.find(f => f.id === memberId)).filter(Boolean) || [];
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
    snapshotCache = null;
    const input = snapshot();
    const filtered = { ...input, targets: input.targets.filter(t => scope == null || t.section === scope) };
    reportReviewState.accepted = reportReviewState.accepted.filter(item => {
      const target = input.targets.find(t => t.id === item.targetId);
      const object = findInputObject(input, item.objectKey);
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
      const object = findInputObject(input, f.object.key);
      f.stale = !target || !object || target.text !== f.target.text || object.record !== f.object.record || object.result !== f.object.result;
      if (f.stale) f.status = '待确认';
    });
    reportReviewState.signature = signature(input);
    selected = reportReviewState.findings[0]?.id || '';
    switchReportTab(7); render(); await persist();
  };
  window.selectReviewFinding = function(id) { selected = id; render(); };
  window.setReviewStatus = async function(id, value) {
    const members = findingMembers(id); if (!members.length) return;
    if (value === '合理差异') {
      reportReviewState.accepted.push(...members.map(acceptedFromFinding));
      const ids = new Set(members.map(f => f.id));
      reportReviewState.findings = reportReviewState.findings.filter(x => !ids.has(x.id));
      selected = reportReviewState.findings[0]?.id || '';
      render(); await persist(); return;
    }
    members.forEach(f => { f.status = value; }); render(); await persist();
  };
  window.restoreAcceptedReview = async function(id) {
    normalizeState();
    const acceptedGroup = groupedAccepted(reportReviewState.accepted).find(item => item.id === id);
    const ids = new Set(acceptedGroup?.memberIds || [id]);
    reportReviewState.accepted = reportReviewState.accepted.filter(item => !ids.has(item.id));
    await window.runReportReview(null);
  };
  window.setReviewNote = async function(id, value) {
    const members = findingMembers(id); if (!members.length) return;
    members.forEach(f => { f.note = value; }); await persist();
  };
  window.locateReviewSource = function(id) {
    const f = findingMembers(id)[0]; if (!f) return;
    if (f.rule === 'C40') { locateReviewFigure(f.object.key, f.target.id); return; }
    if (f.rule === 'C32') { switchStep(4); activeSuggestionLayer = f.target.layer; switchReportTab(5); showToast('请核对本层面的“问题项”数量及编号条目。'); return; }
    if (f.rule === 'C37' && f.object.summaryCount) { switchStep(4); activeSuggestionLayer = f.target.layer; switchReportTab(5); showToast('请核对本层面的改进建议编号及问题单元。'); return; }
    if (Number(f.object.item) < 0 || Number(f.object.index) < 0) { switchStep(3); switchOnsiteTab(f.object.layer); showToast('请核对本测评单元的现场结果记录。'); return; }
    switchStep(f.object.planOnly ? 2 : 3);
    if (f.object.planOnly) { showToast('请在第二步测评对象中核对：' + f.object.name); return; }
    switchOnsiteTab(f.object.layer);
    expandOnsiteRecord(f.object.layer, f.object.item, f.object.index);
  };
  async function locateReviewFigure(key, targetId) {
    // 图片检查定位到第二步的对应页面，并高亮目标区域。
    const isAccess = key === 'plan-figure-access-tool' || targetId === 'access-upload-area';
    switchStep(2);
    let field = null;
    if (isAccess) {
      switchPlanTab(4);
      switchMethodSubTab(2);
      field = document.getElementById('access-upload-area');
    } else {
      switchPlanTab(11);
      field = document.getElementById('topology-block-list');
    }
    if (field) {
      field.scrollIntoView({ block: 'center', behavior: 'smooth' });
      field.style.outline = '3px solid #e7a12a';
      setTimeout(() => { field.style.outline = ''; }, 3000);
      showToast(isAccess ? '请在“工具接入示意图”中粘贴或导入图3-1，然后重新审核。' : '请在“网络拓扑图及描述”中添加图2-1、图2-2 对应的图片块，然后重新审核。');
    } else {
      showToast('请到第二步对应页面补充图片后重新审核。');
    }
  }
  window.locateReviewTarget = async function(id) {
    const f = findingMembers(id)[0]; if (!f) return;
    if (f.rule === 'C40') { locateReviewFigure(f.object.key, f.target.id); return; }
    let panel;
    if (f.target.section === 8) {
      switchStep(2);
      await switchPlanTab(12);
      switchCryptoModule('overview');
      await switchCryptoLayer(f.target.layer);
      panel = document.getElementById('plan-tab-12');
    } else {
      switchStep(4);
      if (f.target.section === 0) reportUaLayer = f.target.layer;
      if (f.target.section === 4) activeOverallLayer = f.target.layer;
      if (f.target.section === 5) activeSuggestionLayer = f.target.layer;
      switchReportTab(f.target.section);
      panel = document.getElementById('report-panel-' + f.target.section);
    }
    const field = document.getElementById(f.target.id) || Array.from(panel?.querySelectorAll('textarea') || []).find(el => el.value === f.target.text);
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
    const names = (finding.members || [finding.object]).flatMap(object => [object.name].concat(object.aliases || []));
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
    if (finding.rule === 'C40') return '<b>审核依据：</b>' + esc(finding.reason);
    if (finding.rule === 'C31' || finding.rule === 'C32' || /^C3[4-9]$/.test(finding.rule)) return '<b>审核依据：</b>' + esc(finding.reason);
    const left = rvBrief(finding.baseline || finding.object.name);
    const right = String(finding.target.text || '').trim();
    return '<b>A</b> 现场结果记录中写了「<em class="ok">' + esc(left) + '</em>」，<b>B</b> ' + esc(labels[finding.target.section]) +
      '中' + (right ? '写了「<em class="bad">' + esc(rvBrief(right)) + '</em>」' : '<em class="bad">未出现该对象</em>') +
      '，两者<em class="bad">不一致</em>。';
  }
  function render() {
    const panel = document.getElementById('report-panel-7'); if (!panel) return;
    normalizeState();
    const state = reportReviewState, visible = groupedFindings(state.findings);
    const f = visible.find(x => x.id === selected || x.memberIds?.includes(selected)) || visible[0];
    const current = snapshotCache || snapshot();
    const stale = state.ranAt && (state.signature !== signature(current) || state.findings.some(x => x.stale) ||
      Boolean(onsiteFigureOutline(current.figures)) !== state.findings.some(x => x.rule === 'C40'));
    const counts = STATUSES.map(s => visible.filter(x => x.status === s).length);
    const list = reviewFilter === '全部' ? visible : visible.filter(x => x.status === reviewFilter);
    const scopeLabel = state.scope == null ? '整份报告' : labels[state.scope];
    const statusText = state.ranAt
      ? '上次审核 ' + new Date(state.ranAt).toLocaleString() + ' · ' + scopeLabel + ' · 发现 ' + visible.length + ' 项'
      : '尚未开始审核';
    const statusbar = '<div class="review-statusbar' + (stale ? ' warn' : '') + '"><span class="review-meta">' + esc(statusText) + '</span>' +
      (stale ? '<span class="review-tag">内容已变化</span>' : '') +
      '<button type="button" class="btn btn-primary review-run" onclick="runReportReview(null)">' + (state.ranAt ? '重新审核' : '开始审核') + '</button></div>';
    const filters = '<div class="review-filters"><button type="button" class="review-chip' + (reviewFilter === '全部' ? ' on' : '') + '" onclick="setReviewFilter(\'全部\')">全部 ' + visible.length + '</button>' +
      STATUSES.map((s, i) => '<button type="button" class="review-chip' + (reviewFilter === s ? ' on' : '') + (counts[i] ? '' : ' empty') + '" onclick="setReviewFilter(\'' + s + '\')">' + s + ' ' + counts[i] + '</button>').join('') + '</div>';
    const detail = f ? (function() {
      const hasObject = String(f.target.text || '').indexOf(f.object.name) >= 0;
      const recordRule = /^C3[4-9]$/.test(f.rule) || (f.rule === 'C28' && Number(f.object.layer) >= 4);
      if (f.rule === 'C40') {
        // 图件检查：左侧为应为的图号，右侧为当前是否已传入，不使用原文对照。
        return '<h4>' + esc(f.title) + '</h4>' +
          '<p class="review-desc">' + rvDescribe(f) + '</p>' +
          '<div class="review-fields"><span>检查项 <b>' + esc(f.object.name) + '</b></span>' +
            '<span>应为位置 <b>' + esc(f.object.record || '对应章节') + '</b></span></div>' +
          '<div class="review-compare"><div><div class="review-compare-head"><span>图片传入状态</span></div>' +
            '<div class="review-missing">' + esc(f.object.name) + ' 未传入图片</div></div>' +
            '<div><div class="review-compare-head"><span>当前内容</span></div>' +
            '<pre>' + esc(f.target.text || '（该位置未检测到图片）') + '</pre></div></div>' +
          '<label>处理状态 <select onchange="setReviewStatus(\'' + f.id + '\',this.value)">' + STATUSES.map(s => '<option' + (s === f.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></label>' +
          '<label>处理说明<textarea class="text-area" onchange="setReviewNote(\'' + f.id + '\',this.value)">' + esc(f.note) + '</textarea></label>';
      }
      return '<h4>' + esc(f.title) + '</h4>' +
        '<p class="review-desc">' + rvDescribe(f) + '</p>' +
        '<div class="review-fields">' +
          (f.object.unit ? '<span>测评指标 <b>' + esc(f.object.unit) + '</b></span>' : '') +
          (recordRule ? '<span>核对项目 <b>' + esc(f.target.kind === 'advice' ? '改进建议' : '结果记录') + '</b></span>' : '<span>测评对象 <b>' + esc(f.object.name) + '</b></span>') +
          '<span>所属层面 <b>' + esc((ONSITE_LAYERS[f.object.layer] || { name: '第二步准备资料' }).name) + '</b></span>' +
        '</div>' +
        '<div class="review-compare">' +
          '<div><div class="review-compare-head"><span>现场结果记录 / 第二步对象</span>' +
          (f.memberIds ? f.memberIds.map((id, i) => '<button type="button" onclick="locateReviewSource(\'' + id + '\')">定位' + esc(f.members[i].name) + '</button>').join('') :
            '<button type="button" onclick="locateReviewSource(\'' + f.id + '\')">定位现场对象</button>') + '</div>' +
          '<pre>' + rvMarkText(f.baseline || f.object.name, rvPatterns(f, 'left'), 'rv-ok') + '</pre></div>' +
          '<div><div class="review-compare-head"><span>' + esc(labels[f.target.section]) + '原文</span><button type="button" onclick="locateReviewTarget(\'' + f.id + '\')">定位报告原文</button></div>' +
          (recordRule || hasObject || f.rule === 'C32' || f.type === '无法核对' ? '' : '<div class="review-missing">未找到「' + esc(f.object.name) + '」相关描述</div>') +
          '<pre>' + rvMarkText(f.target.text || '（未填写）', rvPatterns(f, 'right'), 'rv-bad') + '</pre></div>' +
        '</div>' +
        '<label>处理状态 <select onchange="setReviewStatus(\'' + f.id + '\',this.value)">' + STATUSES.map(s => '<option' + (s === f.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></label>' +
        '<label>处理说明<textarea class="text-area" onchange="setReviewNote(\'' + f.id + '\',this.value)">' + esc(f.note) + '</textarea></label>';
    })() : '<p>选择左侧问题查看原文对照。</p>';
    const missingNote = onsiteFigureOutline(current.figures);
    panel.innerHTML = '<h3>报告审核</h3><p>技术类层面依据测评对象及现场记录核对对象、参数和结论；管理类层面依据测评单元及结果记录核对单元分析、总体评价和问题描述，允许不改变核心事实与肯否方向的合理简写。</p>' +
      '<p class="review-hint">问题描述同时检查问题项编号；改进建议检查问题单元对应关系、整改方向、可执行性以及现状与未来措施是否混淆。复杂语义及截图代码仍需人工复核，审核结果不会自动修改报告原文。</p>' +
      missingNote +
      statusbar +
      (state.accepted.length ? '<details class="review-accepted"><summary>已确认合理差异（' + groupedAccepted(state.accepted).length + '，不计入问题数）</summary>' +
        groupedAccepted(state.accepted).map(item => '<div class="review-accepted-item"><span>' + esc(item.rule + ' · ' + item.title + ' · ' + item.objectName + ' · ' + (labels[item.targetSection] || '报告内容')) +
          (item.note ? '<small>说明：' + esc(item.note) + '</small>' : '') + '</span><button type="button" class="btn" onclick="restoreAcceptedReview(\'' + item.id + '\')">撤销确认</button></div>').join('') +
        '</details>' : '') +
      filters +
      '<div class="review-grid"><div>' + list.map(x => '<button class="review-item ' + (f?.id === x.id ? 'selected' : '') + '" onclick="selectReviewFinding(\'' + x.id + '\')"><strong>' + esc(x.title) + '</strong><small>' + esc((x.rule === 'C40' ? '第二步图片检查' : labels[x.target.section]) + ' · ' + (ONSITE_LAYERS[x.object.layer] || { name: '第二步准备资料' }).name) + '<span class="review-badge st-' + esc(x.status) + '">' + esc(x.status) + '</span></small></button>').join('') +
      (state.ranAt && !visible.length ? '<p>本次规则检查未发现问题；未覆盖的语义和证据项仍需人工审核。</p>' : '') +
      (visible.length && !list.length ? '<p>当前筛选下没有问题。</p>' : '') + '</div><div>' + detail + '</div></div>';
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
