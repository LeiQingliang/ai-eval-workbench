const htmlEscape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const md = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
const percent = value => value === null ? '—' : `${(value * 100).toFixed(1)}%`;
const numeric = (value, digits = 3) => value === null ? '—' : value.toFixed(digits);
function fence(value) {
  const runs = String(value).match(/`+/g) ?? [];
  const delimiter = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
  return `${delimiter}text\n${value}\n${delimiter}`;
}

export function renderMarkdown(report) {
  const c = report.candidate;
  const s = c.summary;
  const lines = [
    '# AI Eval Workbench · 质量评测报告', '',
    `**Gate: ${report.gate.verdict}** · Dataset: ${md(report.dataset.id)} · Run: ${md(c.runId)}`, '',
    c.synthetic || report.baseline?.synthetic ? '> SYNTHETIC: This report includes constructed demonstration data and/or example human annotations. It is not a measured model benchmark or company business result.' : '> This report evaluates supplied responses and annotations. It does not verify their provenance.', '',
    `Generated: ${report.generatedAt}`, '',
    '| Metric | Candidate |', '| --- | --- |',
    `| Rule + supplied-review pass rate | ${percent(s.passRate)} (${s.counts.PASS}/${s.evaluated} evaluated responses) |`,
    `| Required coverage | ${s.requiredCovered}/${s.requiredCases} |`,
    `| PASS / FAIL / REVIEW / MISSING / SKIPPED | ${Object.values(s.counts).join(' / ')} |`,
    `| Latency mean / p95 (nearest-rank) | ${numeric(s.latency.mean)} / ${numeric(s.latency.p95)} ms; ${s.latency.measured}/${s.latency.total} measured |`,
    `| Complete cost total | ${numeric(s.cost.completeTotal, 6)} ${c.currency}; ${s.cost.measured}/${s.cost.total} measured |`,
    `| Observed partial cost sum | ${numeric(s.cost.observedSum, 6)} ${c.currency} |`, '',
    '## Gate evidence', '',
    ...(!report.gate.reasons.length ? ['Configured checks passed on this dataset. Human deployment authorization remains separate.'] : report.gate.reasons.map(reason => `- **${reason.severity} · ${reason.code}**: ${md(reason.message)}${reason.caseIds.length ? ` — ${reason.caseIds.map(md).join(', ')}` : ''}`)), '',
    '## Scenario breakdown', '', '| Scenario | Pass / evaluated | Pending | Missing |', '| --- | ---: | ---: | ---: |',
    ...c.byScenario.map(group => `| ${md(group.name)} | ${group.counts.PASS}/${group.evaluated} | ${group.counts.REVIEW} | ${group.counts.MISSING} |`), '',
    '## Check dimensions', '', '| Dimension | Passed | Failed | Pending |', '| --- | ---: | ---: | ---: |',
    ...c.byDimension.map(d => `| ${md(d.name)} | ${d.passed} | ${d.failed} | ${d.pending} |`), ''
  ];
  if (report.comparison) {
    const p = report.comparison;
    lines.push('## Paired comparison', '', `Baseline: ${md(p.baselineRunId)} → Candidate: ${md(p.candidateRunId)}; ${p.pairedCases} paired responses, ${p.comparableCases} conclusive, ${p.inconclusivePairs} awaiting review.`, '',
      `Improvements: **${p.improvements}** · Regressions: **${p.regressions}** · Pass-rate delta: **${p.passRateDelta === null ? '—' : `${(p.passRateDelta * 100).toFixed(1)} percentage points`}**.`, '',
      `Mean latency delta: ${numeric(p.meanLatencyDeltaMs)} ms; complete cost delta: ${numeric(p.totalCostDelta, 6)} ${c.currency}.`, '',
      '| Case | Baseline | Candidate | Change |', '| --- | --- | --- | --- |',
      ...p.pairs.map(pair => `| ${md(pair.caseId)} | ${pair.baseline} | ${pair.candidate} | ${pair.change} |`), '');
  }
  lines.push('## Badcases and pending evidence', '');
  const badcases = c.cases.filter(item => !['PASS', 'SKIPPED'].includes(item.status));
  if (!badcases.length) lines.push('No candidate badcases in the configured checks. See JSON/HTML for the full case record.', '');
  for (const item of badcases) {
    lines.push(`### ${md(item.id)} · ${item.status} · ${item.risk}`, '', `Scenario: ${md(item.scenario)}.`, '', '**Prompt**', '', fence(item.prompt), '', '**Supplied output**', '', fence(item.output ?? '(missing)'), '');
    for (const check of item.checks.filter(c => c.passed !== true)) lines.push(`- ${md(check.id)}: ${check.passed === null ? 'PENDING' : 'FAIL'} · ${md(check.expectation)} · evidence: ${md(check.evidence)}`);
    if (item.reviewNotes) lines.push('', `Reviewer: ${md(item.reviewer)} · ${md(item.reviewedAt)}`, '', fence(item.reviewNotes));
    lines.push('');
  }
  lines.push('## Scope and limitations', '', ...report.limitations.map(value => `- ${value}`), '', '## Input fingerprints', '', 'SHA-256 of JSON.stringify(parsed JSON); key ordering is significant. Human review records additionally bind to the exact UTF-8 output text.', '', ...Object.entries(report.fingerprints).map(([key, value]) => `- ${key}: ${value ?? '(not supplied)'}`), '');
  return lines.join('\n');
}

export function renderHtml(report) {
  const data = JSON.stringify(report).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>${htmlEscape(report.dataset.name)} · AI Eval Workbench</title>
<style>
:root{--ink:#16243d;--muted:#62708a;--line:#e2e7ef;--blue:#2457d7;--paper:#f3f6fb;--green:#126f50;--red:#ac3045;--amber:#926100}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}header{background:#12213a;color:#fff;padding:34px max(5vw,22px)}.eyebrow{font-size:12px;letter-spacing:.15em;color:#a9bce2;font-weight:700}h1{font-size:clamp(25px,4vw,38px);margin:8px 0}header p{margin:0;color:#c0cbe0}main{max-width:1280px;padding:26px;margin:auto}.notice{background:#fff4cf;border-left:4px solid #d8a72e;padding:14px 18px;border-radius:8px;margin-bottom:22px}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.card,section{background:#fff;border:1px solid var(--line);border-radius:12px;padding:22px}.card .label{color:var(--muted);font-size:13px}.metric{font-size:29px;font-weight:750;letter-spacing:-.04em;margin:4px 0}.meta{font-size:12px;color:var(--muted)}section{margin-top:20px}h2{font-size:20px;margin:0 0 14px}h3{font-size:15px;margin:16px 0 8px}p{margin:8px 0}.pill{display:inline-block;border-radius:6px;padding:3px 9px;font-size:12px;font-weight:750;background:#eaf0fb;color:#36517b;white-space:nowrap}.PASS,.IMPROVEMENT{background:#e4f4ec;color:var(--green)}.FAIL,.BLOCK,.MISSING,.REGRESSION{background:#ffe8e9;color:var(--red)}.REVIEW{background:#fff2cf;color:var(--amber)}.filters{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px}label{font-size:12px;color:var(--muted)}input,select{display:block;border:1px solid #c7d1df;border-radius:7px;padding:9px 11px;margin-top:4px;color:var(--ink);background:#fff;font:inherit;max-width:100%}input{min-width:260px}button{border:1px solid #c7d1df;border-radius:7px;background:#fff;color:var(--ink);padding:9px 12px;cursor:pointer;align-self:end}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #8eb4ff;outline-offset:2px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;color:var(--muted);font-weight:600}td,th{padding:11px 10px;border-bottom:1px solid var(--line);vertical-align:top}.case-id{font-weight:650}summary{cursor:pointer}pre{white-space:pre-wrap;word-break:break-word;background:#f5f7fb;border:1px solid var(--line);padding:13px;border-radius:8px;font:12px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace;max-height:280px;overflow:auto}.details{min-width:330px;max-width:650px}.reason{padding:10px 0;border-bottom:1px solid var(--line)}.bar{height:7px;background:#edf1f8;border-radius:8px;overflow:hidden;width:120px;margin-top:5px}.bar span{display:block;height:100%;background:var(--blue)}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.grid section{min-width:0}.empty{padding:26px;text-align:center;color:var(--muted)}footer{padding:28px 0;color:var(--muted);font-size:12px}.fingerprints{font:11px/1.8 ui-monospace,Consolas,monospace;overflow-wrap:anywhere}.muted{color:var(--muted)}.small{font-size:12px}.list{padding-left:20px}.scope{font-size:13px;color:var(--muted)}@media(max-width:800px){main{padding:16px}.cards{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}.card,section{padding:16px}}@media(max-width:420px){.cards{grid-template-columns:1fr}input{min-width:0;width:100%}}@media print{body{background:white}.filters{display:none}section,.card{break-inside:avoid}.cards{grid-template-columns:repeat(4,1fr)}header{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<header><div class="eyebrow">AI EVAL WORKBENCH / QUALITY OPERATIONS</div><h1>每次迭代，都有证据。</h1><p id="subtitle"></p></header>
<main><div class="notice" id="notice"></div><div class="cards" id="cards"></div>
<section><h2>上线门禁 <span id="verdict"></span></h2><div id="reasons"></div><p class="scope">PASS 仅表示当前测试集和规则通过；词法检查不等于语义准确率，发布决定仍需负责人确认。</p></section>
<div class="grid"><section><h2>场景覆盖</h2><div class="table-wrap" id="scenarios"></div></section><section><h2>检查维度</h2><div class="table-wrap" id="dimensions"></div></section></div>
<section id="comparison-section"><h2>基线 → 候选 · 成对对比</h2><p id="comparison-summary"></p><div class="table-wrap" id="comparison"></div><p class="scope">固定样本上的描述性差异，不代表统计显著性、因果效应或线上业务增长。</p></section>
<section><h2>案例与证据</h2><div class="filters"><label>搜索案例 / 输入 / 输出<input id="search" type="search" placeholder="输入关键词" autocomplete="off"></label><label>结果<select id="status"><option value="">全部结果</option><option>PASS</option><option>FAIL</option><option>REVIEW</option><option>MISSING</option><option>SKIPPED</option></select></label><label>场景<select id="scenario"><option value="">全部场景</option></select></label><label>风险<select id="risk"><option value="">全部风险</option><option>high</option><option>medium</option><option>low</option></select></label><button id="reset" type="button">重置筛选</button></div><p id="result-count" class="meta" aria-live="polite"></p><div class="table-wrap"><table><thead><tr><th>案例</th><th>结果</th><th>场景 / 风险</th><th>证据详情</th></tr></thead><tbody id="cases"></tbody></table></div></section>
<section><h2>使用范围与可追溯性</h2><ul id="limitations" class="scope list"></ul><details><summary>查看输入指纹</summary><div id="fingerprints" class="fingerprints"></div></details></section>
<footer>Offline by design · 零远程请求 · 报告包含原始输入与输出，请按数据敏感级别保管。<br><span id="generated"></span></footer></main>
<script type="application/json" id="report-data">${data}</script>
<script>
'use strict';
const r=JSON.parse(document.getElementById('report-data').textContent),c=r.candidate,s=c.summary;
const el=id=>document.getElementById(id),node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const pct=n=>n===null?'—':(n*100).toFixed(1)+'%',num=(n,d=2)=>n===null?'—':n.toFixed(d),badge=text=>node('span',text,'pill '+text);
el('subtitle').textContent=r.dataset.name+' · '+c.runId+' · '+c.model+' / '+c.promptVersion;
el('notice').textContent=c.synthetic||(r.baseline&&r.baseline.synthetic)?'SYNTHETIC 演示数据：回复、成本、延迟和人工评分为构造样本。该报告不证明真实模型表现或企业业务成果。':'当前报告基于导入的回复与人工评分。工具不核验其真实性，也不会向模型服务发送数据。';
const cards=[['检查通过率',pct(s.passRate),s.counts.PASS+' / '+s.evaluated+' 条已执行；包含已提供的人工评分'],['必测覆盖',s.requiredCovered+' / '+s.requiredCases,'缺失 '+s.counts.MISSING+' · 待复核 '+s.counts.REVIEW],['平均延迟',num(s.latency.mean)+' ms','P95 '+num(s.latency.p95)+' ms · '+s.latency.measured+'/'+s.latency.total+' 有测量'],['完整成本',num(s.cost.completeTotal,6)+' '+c.currency,s.cost.measured+'/'+s.cost.total+' 有测量；缺失不计作 0']];
for(const [label,value,meta] of cards){const card=node('div',undefined,'card');card.append(node('div',label,'label'),node('div',value,'metric'),node('div',meta,'meta'));el('cards').append(card);}
el('verdict').append(badge(r.gate.verdict));
if(!r.gate.reasons.length)el('reasons').append(node('p','当前配置全部通过。请仍检查抽样范围、未覆盖场景与业务发布条件。'));
for(const reason of r.gate.reasons){const div=node('div',undefined,'reason');div.append(badge(reason.severity),node('p',reason.message),node('div',reason.code+(reason.caseIds.length?' · '+reason.caseIds.join(', '):''),'meta'));el('reasons').append(div);}
function table(headers,rows){const t=node('table'),head=node('thead'),tr=node('tr');headers.forEach(h=>tr.append(node('th',h)));head.append(tr);t.append(head);const body=node('tbody');for(const row of rows){const tr=node('tr');for(const value of row){const td=node('td');td.append(typeof value==='object'?value:document.createTextNode(String(value)));tr.append(td);}body.append(tr);}t.append(body);return t;}
el('scenarios').append(table(['场景','通过 / 执行','待复核 / 缺失'],c.byScenario.map(g=>{const d=node('div',g.counts.PASS+'/'+g.evaluated),bar=node('div',undefined,'bar'),fill=node('span');fill.style.width=((g.passRate||0)*100)+'%';bar.append(fill);d.append(bar);return[g.name,d,g.counts.REVIEW+' / '+g.counts.MISSING];})));
el('dimensions').append(table(['维度','通过','失败','待复核'],c.byDimension.map(d=>[d.name,d.passed,d.failed,d.pending])));
if(r.comparison){const p=r.comparison;el('comparison-summary').textContent=p.baselineRunId+' → '+p.candidateRunId+' · '+p.pairedCases+' 对样本 · 可比较 '+p.comparableCases+' · 待复核 '+p.inconclusivePairs+' · 改善 '+p.improvements+' · 回退 '+p.regressions+' · 通过率差 '+(p.passRateDelta===null?'—':(p.passRateDelta*100).toFixed(1)+' 个百分点')+' · 平均延迟差 '+num(p.meanLatencyDeltaMs)+' ms · 完整成本差 '+num(p.totalCostDelta,6)+' '+c.currency;el('comparison').append(table(['案例','基线','候选','变化'],p.pairs.map(p=>[p.caseId,badge(p.baseline),badge(p.candidate),badge(p.change)])));}else{el('comparison-section').hidden=true;}
for(const g of c.byScenario){const option=node('option',g.name);option.value=g.name;el('scenario').append(option);}
function draw(){const q=el('search').value.toLocaleLowerCase(),status=el('status').value,scenario=el('scenario').value,risk=el('risk').value;const matches=c.cases.filter(x=>(!status||x.status===status)&&(!scenario||x.scenario===scenario)&&(!risk||x.risk===risk)&&(!q||[x.id,x.prompt,x.output||''].join(' ').toLocaleLowerCase().includes(q)));el('cases').replaceChildren();el('result-count').textContent='显示 '+matches.length+' / '+c.cases.length+' 条；展开详情查看原始文本、检查规则和人工评分。';
for(const x of matches){const tr=node('tr'),id=node('td',x.id,'case-id'),statusCell=node('td'),context=node('td'),detailCell=node('td'),detail=node('details',undefined,'details');statusCell.append(badge(x.status));context.append(node('div',x.scenario),node('div',x.risk+' · '+(x.required?'必测':'可选'),'meta'));detail.append(node('summary',(x.checks.filter(k=>k.passed===false).length)+' 个失败检查 · '+x.checks.filter(k=>k.passed===null).length+' 个待复核维度'));detail.append(node('h3','输入'),node('pre',x.prompt),node('h3','输出'),node('pre',x.output===null?'(missing)':x.output));for(const check of x.checks){detail.append(node('h3',(check.passed===null?'PENDING':check.passed?'PASS':'FAIL')+' · '+check.label),node('p',check.expectation,'small'),node('p',check.evidence,'meta'));if(check.kind==='human')detail.append(node('p','评分 '+(check.score===null?'未提供':check.score)+' / '+check.maxScore,'small'));}if(x.reviewer)detail.append(node('h3','人工复核'),node('p',x.reviewer+' · '+x.reviewedAt,'meta'),node('pre',x.reviewNotes));detail.append(node('p','Latency: '+num(x.latencyMs)+' ms · Cost: '+num(x.cost,6)+' '+c.currency,'meta'));detailCell.append(detail);tr.append(id,statusCell,context,detailCell);el('cases').append(tr);}if(!matches.length){const tr=node('tr'),td=node('td','没有符合筛选条件的案例。','empty');td.colSpan=4;tr.append(td);el('cases').append(tr);}}
['search','status','scenario','risk'].forEach(id=>el(id).addEventListener('input',draw));el('reset').addEventListener('click',()=>{['search','status','scenario','risk'].forEach(id=>el(id).value='');draw();});draw();
for(const text of r.limitations)el('limitations').append(node('li',text));for(const [key,value] of Object.entries(r.fingerprints))el('fingerprints').append(node('p',key+': '+(value||'(not supplied)')));el('generated').textContent='Generated '+r.generatedAt+' · SHA-256 fingerprints use JSON.stringify(parsed JSON), key order significant.';
</script></body></html>`;
}
