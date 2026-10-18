/* 纯规则审核：不调用外部服务，不改变原文或测评判定。 */
(function(root) {
  function norm(text) { return String(text || '').normalize('NFKC').replace(/[\s“”‘’"'_-]/g, '').toLowerCase(); }
  function hash(value) { let n = 2166136261; for (const c of value) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return (n >>> 0).toString(16); }
  function mentioned(text, name) { return Boolean(norm(name)) && norm(text).includes(norm(name)); }
  // 简称变体：从对象全称中移除一段 2-3 字的内部片段生成候选（如「浙政钉扫码通道」→「浙政钉通道」）。
  // 与其它对象名冲突的变体剔除，避免把别家对象的句子算到当前对象头上。
  function nameVariants(name, allNames) {
    const out = new Set();
    if (String(name).length >= 5) {
      for (let i = 1; i < name.length - 2; i++) {
        for (let j = 2; j <= 3; j++) {
          if (i + j > name.length - 1) continue;
          const v = name.slice(0, i) + name.slice(i + j);
          if (v.length < 4) continue;
          if (allNames.some(n => n && n !== name && (n.includes(v) || v.includes(n)))) continue;
          out.add(v);
        }
      }
    }
    return [...out];
  }
  function tokens(text) {
    const result = { tls: [], aes: [] };
    // 严格写法（TLS 1.2 / TLSv1.3）与宽松写法（"TLS 协议版本为 1.2"）都识别；数字与关键词间隔不超过 12 字。
    for (const m of String(text).matchAll(/TLS\s*v?\s*(1\.[0-3])|TLS[^\d。；\n]{0,12}?(1\.[0-3])/gi)) result.tls.push(m[1] || m[2]);
    for (const m of String(text).matchAll(/AES[\s_-]*(128|192|256)/gi)) result.aes.push(m[1]);
    return result;
  }
  function category(object, input) {
    if (object.layer === 2 && input.serverNames.some(n => norm(n) === norm(object.name))) return '服务器';
    if (object.layer === 2 && input.databaseNames.some(n => norm(n) === norm(object.name))) return '数据库';
    if (object.layer === 3 && object.isData) return '重要数据';
    return '';
  }
  function safeAliases(object, allNames) {
    return (object.aliases || []).filter(alias => {
      const name = norm(alias);
      return name.length >= 4 && !allNames.some(other => other !== object.name &&
        (norm(other).includes(name) || name.includes(norm(other))));
    });
  }
  function objectMentioned(text, object, allNames) {
    return mentioned(text, object.name) || safeAliases(object, allNames).some(a => mentioned(text, a)) ||
      nameVariants(object.name, allNames).some(v => mentioned(text, v));
  }
  function uniqueChannelMentioned(text, object, allNames) {
    const match = /^(.{3,}?)(?:扫码|访问|接入)通道$/.exec(norm(object.name));
    if (!match) return false;
    const root = match[1];
    if (allNames.some(name => name !== object.name && norm(name).includes(root))) return false;
    const line = norm(text), start = line.indexOf(root);
    return start >= 0 && line.slice(start + root.length, start + root.length + 6).includes('通道');
  }
  function coordinatedChannelMentioned(text, object) {
    const match = /^(.*?)(非国密访问|国密访问|扫码|访问)通道$/.exec(norm(object.name));
    if (!match || match[1].length < 4) return false;
    const line = norm(text);
    return line.includes(match[1]) && new RegExp('(?:^|[、，,；;])' + match[2] + '通道(?=$|[、，,。；;的])').test(line);
  }
  function groupMentioned(text, object, peers, input) {
    const group = category(object, input);
    if (!group) return false;
    const count = group === '重要数据' ? input.dataCount :
      new Set(peers.filter(o => category(o, input) === group).map(o => o.name)).size;
    if (count < 3) return false;
    let rest = norm(text);
    peers.filter(o => category(o, input) === group).map(o => norm(o.name)).sort((a,b) => b.length - a.length)
      .forEach(name => { rest = rest.split(name).join(''); });
    return rest.includes(norm(group));
  }
  function numberedProblems(text) {
    const source = String(text || '').replace(/\r\n?/g, '\n');
    // Word 导入常保留全角段首空格，多个编号也可能在同一段的句号后连续出现。
    const markers = [...source.matchAll(/(?:^|[\n。；;])[ \t\u3000\u00a0]*(\d{1,3})(?:[）、）]|\.(?!\d)|(?=[ \t\u3000\u00a0]+\S))[ \t\u3000\u00a0]*/g)];
    return markers.map((match, index) => ({ number: Number(match[1]),
      text: source.slice(match.index + match[0].length, index + 1 < markers.length ? markers[index + 1].index : source.length).trim() }));
  }
  function problemNorm(text) {
    return norm(text).replace(/的/g, '').replace(/视频(?:音像|图像)监控/g, '视频监控');
  }
  function problemMentionsUnit(text, unit) {
    const name = problemNorm(unit);
    const parts = /^(.*?)(传输|存储|来源)?(完整性|机密性|真实性)$/.exec(name);
    return String(text || '').split(/[。！？；;\n]/).some(sentence => {
      const line = problemNorm(sentence);
      if (line.includes(name)) return true;
      if (name === '通信过程中重要数据机密性')
        return line.includes('机密性') && /数据传输|通信报文|通信过程/.test(line);
      if (name === '通信数据完整性')
        return line.includes('完整性') && /通信数据|数据传输|通信报文/.test(line);
      if (name === '网络边界访问控制信息完整性')
        return line.includes('边界访问控制信息') && line.includes('完整性');
      if (name === '远程管理通道安全')
        return /远程管理|远程运维|远程登录|https|ssh|明文传输/.test(line);
      if (name === '重要可执行程序完整性、重要可执行程序来源真实性')
        return line.includes('重要可执行程序') && line.includes('完整性') && line.includes('来源真实性');
      if (name === '定期修订安全管理制度')
        return line.includes('制度') && line.includes('定期') && line.includes('修订');
      if (!parts) return false;
      const subject = parts[1];
      if (subject.length < 4) return false;
      const start = line.indexOf(subject);
      if (start < 0) return false;
      const tail = line.slice(start + subject.length, start + subject.length + 50);
      const qualifier = parts[2] ? tail.indexOf(parts[2]) : 0;
      return qualifier >= 0 && tail.indexOf(parts[3], qualifier + (parts[2] || '').length) >= 0;
    });
  }
  const MANAGEMENT_FACT_TERMS = [
    '密码', '密钥', '制度', '方案', '策略', '流程', '规程', '职责', '岗位', '培训', '考核', '保密', '调离',
    '记录', '修订', '发布', '评估', '应急', '演练', '报告', '事件', '处置', '检查', '审批', '备案', '留存',
    '算法', '协议', '产品', '服务', '身份鉴别', '机密性', '完整性', '访问控制', '日志', '通道', '证书'
  ];
  const ADVICE_ACTIONS = /采用|完善|制定|修订|建立|明确|落实|开展|配置|部署|替换|更新|留存|培训|考核|演练|检查|评估|整改/;
  const FUTURE_MARKERS = /建议|应当|应|需要|需|拟|计划|要求/;
  const COMPLETED_MARKERS = /已完成|已经(?:完成|部署|采用|建立|制定|开展|落实|整改)|目前已|现已/;
  function recordNorm(text, names) {
    let value = String(text || '').normalize('NFKC');
    (names || []).filter(Boolean).sort((a, b) => b.length - a.length).forEach(name => {
      value = value.split(String(name).normalize('NFKC')).join('');
    });
    return value
      .replace(/经(?:现场)?(?:核查|访谈|查看|检查|测评)|测评发现|现场发现|结果显示/g, '')
      .replace(/[\s“”‘’"'`·•，,。；;：:、！？!?（）()【】\[\]《》<>_-]/g, '')
      .toLowerCase();
  }
  function polarity(text) {
    const value = String(text || '');
    const negative = /未(?:制定|建立|开展|落实|提供|留存|修订|发布|培训|考核|演练|评估|报告|记录|采用)|没有|无(?:相关|有效|明确|完整)?|缺少|缺失|不完善|不足|不到位|不符合/.test(value);
    const positive = /已(?:制定|建立|开展|落实|提供|留存|修订|发布|培训|考核|演练|评估|报告|记录|采用)|具备|(?<!不)符合/.test(value);
    if (negative && positive) return 'mixed';
    if (negative) return 'negative';
    if (positive) return 'positive';
    return 'neutral';
  }
  function bigrams(text) {
    const out = new Set();
    for (let i = 0; i < text.length - 1; i++) out.add(text.slice(i, i + 2));
    return out;
  }
  function factTerms(text) { return MANAGEMENT_FACT_TERMS.filter(term => String(text || '').includes(term)); }
  function recordCoverage(record, targetText, names) {
    const source = recordNorm(record, names), target = recordNorm(targetText, names);
    const leftPolarity = polarity(record), rightPolarity = polarity(targetText);
    const conflict = (leftPolarity === 'positive' && rightPolarity === 'negative') ||
      (leftPolarity === 'negative' && rightPolarity === 'positive');
    if (!source || !target) return { status: 'missing', score: 0, source, target };
    const shorter = Math.min(source.length, target.length);
    if (!conflict && shorter >= 6 && (source.includes(target) || target.includes(source))) {
      return { status: 'covered', score: 1, source, target };
    }
    const sourcePairs = bigrams(source), targetPairs = bigrams(target);
    const matched = [...sourcePairs].filter(pair => targetPairs.has(pair)).length;
    const score = sourcePairs.size ? matched / sourcePairs.size : 0;
    const sharedTerms = factTerms(record).filter(term => targetText.includes(term));
    if (conflict && (score >= 0.35 || sharedTerms.length)) return { status: 'conflict', score, source, target };
    if (!conflict && score >= 0.6 && sharedTerms.length) return { status: 'covered', score, source, target };
    if (score >= 0.35 || sharedTerms.length) return { status: 'uncertain', score, source, target };
    return { status: 'missing', score, source, target };
  }
  function targetUnitText(target, unit, unitNames) {
    if (target.kind === 'problem' || target.kind === 'advice') {
      return numberedProblems(target.text).filter(entry => problemMentionsUnit(entry.text, unit)).map(entry => entry.text).join('；');
    }
    const text = String(target.text || '');
    const names = [...new Set((unitNames || []).filter(name => name && name !== unit))];
    const matches = [];
    let cursor = 0;
    while (cursor < text.length) {
      const start = text.indexOf(unit, cursor);
      if (start < 0) break;
      const next = names.map(name => text.indexOf(name, start + unit.length)).filter(index => index >= 0);
      const end = next.length ? Math.min(...next) : text.length;
      matches.push(text.slice(start, end));
      cursor = Math.max(end, start + unit.length);
    }
    return matches.join('；');
  }
  function sourceForExpectation(expectation, problemOnly) {
    const sources = expectation.sources || [];
    return (problemOnly ? sources.find(source => source.problem) : null) || sources[0] || {
      key: expectation.key, layer: expectation.layer, item: expectation.item, index: -1,
      name: '结果记录', unit: expectation.unit, record: expectation.record, result: ''
    };
  }
  function adviceDirectionCovered(baseline, text) {
    const expected = factTerms(baseline).filter(term => !['密码', '产品', '服务'].includes(term));
    return expected.some(term => String(text || '').includes(term));
  }
  function analyze(input) {
    const findings = [];
    const allNames = [...new Set(input.objects.filter(o => !o.summaryCount).map(o => o.name))];
    function add(rule, target, object, title, reason, baseline, type, params) {
      const id = hash([rule, target.id, object.key, title].join('|'));
      if (findings.some(f => f.id === id)) return;
      findings.push({ id, rule, target: { ...target }, object: { ...object }, title, reason, params: params || null,
        baseline: baseline || object.record || '', type: type || '疑点', status: '待确认', note: '',
        fingerprint: hash(JSON.stringify(rule === 'C31'
          ? [baseline || object.record, target.text, object.result, object.name, object.unit, object.rawScore]
          : [baseline || object.record, target.text, object.result, object.name])) });
    }
    function analyzeProblemCount(target) {
      const expected = target.problemUnits || [];
      const entries = numberedProblems(target.text);
      const summary = { key: 'problem-count|' + target.layer, layer: target.layer, item: -1, index: -1,
        name: '问题项', unit: '', record: '问题项 ' + expected.length + ' 个', result: String(expected.length), summaryCount: true };
      if (expected.length && !entries.length) {
        add('C32', target, summary, '问题描述无法按编号核对',
          '本层面有 ' + expected.length + ' 个问题项，但问题描述没有可识别的独立编号；请补充编号或人工核对。', summary.record, '无法核对');
        return entries;
      }
      const lastNumber = entries.at(-1)?.number || 0;
      if (lastNumber !== expected.length) {
        add('C32', target, summary, '问题描述编号数量不一致',
          '本层面有 ' + expected.length + ' 个问题项，问题描述最后一个可识别编号为 ' + lastNumber + '。', summary.record, '数量核对');
      }
      return entries;
    }
    function analyzeManagementRecords(target) {
      const problemOnly = target.kind === 'problem';
      const expected = (input.recordExpectations || []).filter(item => item.layer === target.layer && (!problemOnly || item.problem));
      const unitNames = [...new Set((input.recordExpectations || []).filter(item => item.layer === target.layer).map(item => item.unit))];
      for (const item of expected) {
        const source = sourceForExpectation(item, problemOnly);
        const baseline = String(item.record || '');
        if (!baseline.trim()) {
          // 空记录只在单元分析目标提示一次，避免在三个章节重复报告同一基础数据问题。
          if (target.kind === 'unitAnalysis') add('C28', target, source, '现场结果记录尚未填写：' + item.unit,
            '该测评单元的现场结果记录全部为空，无法核对后续报告描述。', '（结果记录为空）', '证据不足');
          continue;
        }
        const unitText = targetUnitText(target, item.unit, unitNames);
        const names = (item.sources || []).map(row => row.name);
        const coverage = recordCoverage(baseline, unitText, names);
        const scoreText = Math.round(coverage.score * 100) + '%';
        if (coverage.status === 'missing') add('C34', target, source, '可能遗漏结果记录：' + item.unit,
          '当前章节在“' + item.unit + '”对应内容中未找到该结果记录的核心事实。', baseline, '覆盖检查', { score: scoreText });
        else if (coverage.status === 'uncertain') add('C35', target, source, '无法确认简写是否覆盖：' + item.unit,
          '当前章节可能对结果记录进行了简写，但核心事实覆盖不足，请人工核对。', baseline, '无法核对', { score: scoreText });
        else if (coverage.status === 'conflict') add('C36', target, source, '结果记录肯否方向可能相反：' + item.unit,
          '现场结果记录与当前章节在肯定、否定方向上可能不一致，请核对是否改变了原意。', baseline, '一致性检查', { score: scoreText });
      }
    }
    function analyzeAdvice(target) {
      const expected = target.problemUnits || [];
      const entries = numberedProblems(target.text);
      const summary = { key: 'advice-count|' + target.layer, layer: target.layer, item: -1, index: -1,
        name: '改进建议', unit: '', record: '问题单元 ' + expected.length + ' 个', result: String(expected.length), summaryCount: true };
      if (expected.length && !entries.length) {
        add('C37', target, summary, '改进建议无法按编号核对',
          '本层面有 ' + expected.length + ' 个问题单元，但改进建议没有可识别的独立编号。', summary.record, '无法核对');
        return;
      }
      const lastNumber = entries.at(-1)?.number || 0;
      if (lastNumber !== expected.length) add('C37', target, summary, '改进建议编号数量不一致',
        '本层面有 ' + expected.length + ' 个问题单元，改进建议最后一个可识别编号为 ' + lastNumber + '。', summary.record, '数量核对');
      for (const unit of expected) {
        const matching = entries.filter(entry => problemMentionsUnit(entry.text, unit.name));
        const recordItem = (input.recordExpectations || []).find(item => item.layer === target.layer && item.item === unit.item && item.problem);
        const technicalSource = input.objects.find(object => object.layer === target.layer && object.item === unit.item && object.applicable &&
          typeof object.rawScore === 'number' && object.rawScore >= 0 && object.rawScore < 1);
        const source = recordItem ? sourceForExpectation(recordItem, true) : (technicalSource ||
          { ...summary, key: 'advice|' + target.layer + '|' + unit.item, unit: unit.name });
        if (!matching.length) {
          add('C37', target, source, '问题单元缺少对应改进建议：' + unit.name,
            '没有找到能够对应“' + unit.name + '”问题单元的编号建议。', unit.adviceBaseline || unit.name, '覆盖检查');
          continue;
        }
        const text = matching.map(entry => entry.text).join('；');
        const unitPos = text.indexOf(unit.name);
        const adviceBody = unitPos >= 0 ? text.slice(0, unitPos) + text.slice(unitPos + unit.name.length) : text;
        if (!ADVICE_ACTIONS.test(adviceBody) || !adviceDirectionCovered(unit.adviceBaseline || unit.name, adviceBody)) {
          add('C38', target, source, '改进建议缺少可执行措施：' + unit.name,
            '建议应包含明确整改动作，并与该测评单元的整改方向相关；仅写“加强管理、尽快整改”等泛化表述不足以核对。', unit.adviceBaseline || unit.name, '建议质量');
        }
        const confused = text.split(/[。！？；;\n]/).find(sentence => COMPLETED_MARKERS.test(sentence) && !FUTURE_MARKERS.test(sentence));
        if (confused) add('C39', target, source, '现状与未来措施可能混淆：' + unit.name,
          '改进建议使用了已完成或已采用的现状措辞，但没有“建议、应、需、拟”等整改限定。', confused, '一致性检查');
      }
    }
    for (const target of input.targets) {
      if (target.section === 2) continue;
      const managementRecordTarget = target.layer >= 4 && target.layer <= 7 &&
        ['unitAnalysis', 'overall', 'problem'].includes(target.kind);
      if (managementRecordTarget) analyzeManagementRecords(target);
      if (target.kind === 'advice') {
        analyzeAdvice(target);
        continue;
      }
      if (target.section === 5) {
        const expected = target.problemUnits || [];
        const entries = analyzeProblemCount(target);
        if (managementRecordTarget) continue;
        if (expected.length && !entries.length) continue;
        const objects = input.objects.filter(o => o.layer === target.layer && typeof o.rawScore === 'number' && o.rawScore >= 0 && o.rawScore < 1 && o.applicable);
        for (const o of objects) {
          const matchingEntries = entries.filter(e => problemMentionsUnit(e.text, o.unit));
          if (!matchingEntries.length) {
            add('C31', target, o, '无法定位低分对象对应的问题条目：' + o.name,
              '现场该对象在“' + o.unit + '”指标中得分低于1，但编号条目未明确对应此指标；请人工核对，不能据此断定问题已遗漏。', '', '无法核对');
          } else if (!matchingEntries.some(entry => {
            const peers = input.objects.filter(x => x.layer === target.layer && x.applicable && !x.summaryCount);
            const unitPeers = peers.filter(x => x.unit === o.unit);
            return objectMentioned(entry.text, o, allNames) || uniqueChannelMentioned(entry.text, o, allNames) ||
              coordinatedChannelMentioned(entry.text, o) ||
              groupMentioned(entry.text, o, peers, input) ||
              (target.layer >= 4 && target.layer <= 5 && unitPeers.length === 1 && /未|不|缺|无/.test(entry.text));
          })) {
            add('C31', target, o, '问题描述可能遗漏低分对象：' + o.name,
              '现场该对象在“' + o.unit + '”指标中得分低于1，对应编号条目没有找到对象名称、有效别名或允许的合并称谓。', '', '覆盖检查');
          }
        }
        continue;
      }
      if (!target.manual && !managementRecordTarget) continue;
      const objects = input.objects.filter(o => !o.summaryCount && o.layer === target.layer && (!target.unit || o.unit === target.unit));
      const applicable = objects.filter(o => o.applicable);
      // 风险/问题/建议只要求覆盖问题对象；汇总结论不要求逐个列出测评对象。
      const required = target.coverage === 'problems' ? applicable.filter(o => ['不符合', '部分符合'].includes(o.result)) : applicable;
      if (target.coverage && !managementRecordTarget) {
        const unique = [...new Map(required.map(o => [o.name, o])).values()];
        for (const o of unique) {
          if (!objectMentioned(target.text, o, allNames) && !groupMentioned(target.text, o, applicable, input)) {
            add(target.section === 8 ? 'C33' : 'C29', target, o,
              (target.section === 8 ? '密码应用概况可能遗漏测评对象：' : '可能遗漏测评对象：') + o.name,
              '第二步测评对象/重要数据与第三步对应记录中存在该对象，但当前描述未找到其名称、已登记别名或满足数量条件的合并名称。请确认是否已有等价概括。', '', '覆盖检查');
          }
          if (target.section !== 8 && !o.record.trim() && !o.planOnly) add('C28', target, o, '现场结果记录尚未填写', '该对象缺少现场原文，无法核对描述的事实依据。', '（结果记录为空）', '证据不足');
        }
      }
      if (target.advice || target.section === 3) continue;
      for (const group of ['服务器', '数据库', '重要数据']) {
        const groupedObjects = applicable.filter(o => category(o, input) === group);
        const sentences = target.text.split(/[。；\n]/).filter(s => mentioned(s, group) && /均|全部|所有/.test(s));
        for (const sentence of sentences) {
          const verdict = /(?:均|全部|所有)[^。；]{0,10}?(部分符合|不符合|符合)/.exec(sentence);
          if (verdict) {
            const different = groupedObjects.find(o => !['不适用', '未测评'].includes(o.result) && o.result !== verdict[1]);
            if (different) add('C30', target, different, '合并描述可能掩盖对象结论差异',
              '合并名称只简化对象列举，不能将“' + different.name + '：' + different.result + '”概括为“' + group + '均' + verdict[1] + '”。请保留例外。');
          }
        }
      }
      // 参数比较限定到包含对象名称的句子，避免在多对象段落中交叉比较；
      // 对象名使用简称或写在相邻句时，通过简称变体与相邻句回退兜底（相邻句不得提及其它对象）。
      for (const o of (managementRecordTarget ? [] : applicable.filter(o => o.record.trim()))) {
        const mention = s => objectMentioned(s, o, allNames);
        const namesOther = s => allNames.some(n => n && n !== o.name && mentioned(s, n));
        const recSents = o.record.split(/[。；\n]/);
        const recParts = new Set(applicable.length === 1 ? recSents : recSents.filter(mention));
        for (let i = 0; i < recSents.length; i++) {
          if (!mention(recSents[i])) continue;
          const next = recSents[i + 1];
          if (next && !namesOther(next)) recParts.add(next);
        }
        const source = [...recParts].join('。');
        const repSents = target.text.split(/[。；\n]/);
        const repParts = new Set(repSents.filter(mention));
        for (let i = 0; i < repSents.length; i++) {
          if (!mention(repSents[i])) continue;
          const next = repSents[i + 1];
          if (next && !namesOther(next)) repParts.add(next);
        }
        const a = tokens(source), b = tokens([...repParts].join('。'));
        for (const attr of ['tls', 'aes']) {
          const left = [...new Set(a[attr])], right = [...new Set(b[attr])];
          if (left.length === 1 && right.length === 1 && left[0] !== right[0]) {
            add(attr === 'tls' ? 'C06' : 'C07', target, o, attr === 'tls' ? 'TLS版本可能不一致' : 'AES密钥长度可能不一致',
              '现场记录为 ' + left[0] + '，对应对象的报告句子为 ' + right[0] + '。需确认是否同一次连接、同一用途和有效版本。',
              source, null, { attr, left: left[0], right: right[0] });
          }
        }
      }
      if (target.section === 0) {
        // 指标级结论与系统已有原始单元汇总比较，不与单个对象结论直接比较。
        for (const unit of input.units.filter(u => u.layer === target.layer)) {
          const paragraphs = target.text.split('\n').filter(p => p.includes(unit.name));
          for (const paragraph of paragraphs) {
            const m = /(?:故|因此)[^。\n]{0,20}?(?:指标|测评单元)[^。\n]{0,8}?(不适用|未测评|部分符合|不符合|符合)[。\s]*$/.exec(paragraph);
            if (m && m[1] !== unit.result && unit.result !== '未测评') {
              const o = applicable.find(x => x.unit === unit.name);
              if (o) add('C03', target, o, '单元结论可能不一致：' + unit.name,
                '现场记录对应的原始单元汇总为“' + unit.result + '”，当前段落结论为“' + m[1] + '”。',
                '现场原始单元汇总：' + unit.result + '\n' + applicable.filter(x => x.unit === unit.name).map(x => x.name + '：' + x.result + '\n' + x.record).join('\n'));
            }
          }
        }
      }
    }
    return findings;
  }
  const api = { analyze, norm, hash, tokens, recordCoverage };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BBReportReviewEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
