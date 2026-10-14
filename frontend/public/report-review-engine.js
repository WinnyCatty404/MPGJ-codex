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
  function analyze(input) {
    const findings = [];
    const allNames = [...new Set(input.objects.map(o => o.name))];
    function add(rule, target, object, title, reason, baseline, type, params) {
      const id = hash([rule, target.id, object.key, title].join('|'));
      if (findings.some(f => f.id === id)) return;
      findings.push({ id, rule, target: { ...target }, object: { ...object }, title, reason, params: params || null,
        baseline: baseline || object.record || '', type: type || '疑点', status: '待确认', note: '',
        fingerprint: hash(JSON.stringify([baseline || object.record, target.text, object.result, object.name])) });
    }
    for (const target of input.targets) {
      if (target.section === 2 || target.section === 5) continue;
      if (!target.manual) continue;
      const objects = input.objects.filter(o => o.layer === target.layer && (!target.unit || o.unit === target.unit));
      const applicable = objects.filter(o => o.applicable);
      // 风险/问题/建议只要求覆盖问题对象；汇总结论不要求逐个列出测评对象。
      const required = target.coverage === 'problems' ? applicable.filter(o => ['不符合', '部分符合'].includes(o.result)) : applicable;
      if (target.coverage) {
        const unique = [...new Map(required.map(o => [o.name, o])).values()];
        const counts = { '服务器': new Set(applicable.filter(o => category(o, input) === '服务器').map(o => o.name)).size,
          '数据库': new Set(applicable.filter(o => category(o, input) === '数据库').map(o => o.name)).size,
          '重要数据': input.dataCount };
        for (const o of unique) {
          const group = category(o, input);
          const variants = nameVariants(o.name, allNames);
          const mentionObj = s => mentioned(s, o.name) || (o.aliases || []).some(a => mentioned(s, a)) || variants.some(v => mentioned(s, v));
          let groupText = norm(target.text);
          applicable.filter(x => category(x, input) === group).map(x => norm(x.name)).sort((a,b) => b.length - a.length)
            .forEach(name => { groupText = groupText.split(name).join(''); });
          const grouped = group && counts[group] >= 3 && groupText.includes(norm(group));
          if (!mentionObj(target.text) && !grouped) {
            add('C29', target, o, '可能遗漏测评对象：' + o.name,
              '第二步测评对象/重要数据与第三步对应记录中存在该对象，但当前描述未找到其名称、已登记别名或满足数量条件的合并名称。请确认是否已有等价概括。', '', '覆盖检查');
          }
          if (!o.record.trim() && !o.planOnly) add('C28', target, o, '现场结果记录尚未填写', '该对象缺少现场原文，无法核对描述的事实依据。', '（结果记录为空）', '证据不足');
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
      for (const o of applicable.filter(o => o.record.trim())) {
        const variants = nameVariants(o.name, allNames);
        const mention = s => mentioned(s, o.name) || (o.aliases || []).some(a => mentioned(s, a)) || variants.some(v => mentioned(s, v));
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
  const api = { analyze, norm, hash, tokens };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BBReportReviewEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
