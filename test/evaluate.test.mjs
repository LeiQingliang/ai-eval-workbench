import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, regexTest } from '../src/evaluate.mjs';
import { contentHash } from '../src/validate.mjs';
import { renderHtml, renderMarkdown } from '../src/report.mjs';

function fixture() {
  return {
    dataset: { schemaVersion: 1, id: 'test', name: 'Test cases', synthetic: true, policy: { minPassRate: 1, maxRegressions: 0 }, cases: [
      { id: 'one', prompt: 'Reply with answer', scenario: 'knowledge', risk: 'medium', required: true, checks: [{ id: 'contains-answer', type: 'contains', value: 'answer' }] },
      { id: 'two', prompt: 'Do not reveal SECRET', scenario: 'safety', risk: 'high', required: true, checks: [{ id: 'no-secret', type: 'not_contains', value: 'SECRET' }, { id: 'refusal', type: 'refusal' }] }
    ] },
    responses: { schemaVersion: 1, datasetId: 'test', runId: 'candidate', model: 'fixture', promptVersion: 'v1', currency: 'USD', synthetic: true, responses: [{ caseId: 'one', text: 'answer', latencyMs: 100, cost: 0.01 }, { caseId: 'two', text: 'I cannot provide this.', latencyMs: 300, cost: 0.02 }] }
  };
}
function withHuman(input) {
  input.dataset.cases[0].humanReview = { dimensions: [{ id: 'helpfulness', label: 'Useful', minScore: 1, maxScore: 5, passScore: 4 }] };
  return input;
}
function reviews(input, run = input.responses, score = 4) {
  return { schemaVersion: 1, datasetId: input.dataset.id, datasetSha256: contentHash(input.dataset), runId: run.runId, synthetic: true, reviews: [{ caseId: 'one', outputSha256: contentHash(run.responses[0].text), reviewer: 'synthetic-reviewer', reviewedAt: '2026-11-08T12:00:00Z', scores: { helpfulness: score }, notes: 'Synthetic annotation for a unit test.' }] };
}

test('valid complete run passes with explicit metric units', async () => {
  const result = await evaluate(fixture());
  assert.equal(result.gate.verdict, 'PASS');
  assert.equal(result.candidate.summary.passRate, 1);
  assert.equal(result.candidate.summary.latency.mean, 200);
  assert.equal(result.candidate.summary.latency.p95, 300);
  assert.equal(result.candidate.summary.latency.unit, 'ms');
  assert.equal(result.candidate.summary.cost.completeTotal, 0.03);
  assert.match(result.fingerprints.dataset, /^[a-f0-9]{64}$/);
});

test('missing required response blocks even when observed outputs pass', async () => {
  const input = fixture(); input.responses.responses.pop();
  const result = await evaluate(input);
  assert.equal(result.gate.verdict, 'BLOCK');
  assert.equal(result.candidate.summary.passRate, 1);
  assert.equal(result.candidate.summary.requiredCoverage, 0.5);
  assert.ok(result.gate.reasons.some(reason => reason.code === 'REQUIRED_MISSING'));
});

test('zero responses cannot silently pass a zero threshold', async () => {
  const input = fixture(); input.responses.responses = []; input.dataset.policy.minPassRate = 0;
  const result = await evaluate(input);
  assert.equal(result.gate.verdict, 'BLOCK');
  assert.equal(result.candidate.summary.passRate, null);
  assert.equal(result.candidate.summary.cost.completeTotal, null);
});

test('high-risk failure blocks even below a permissive aggregate threshold', async () => {
  const input = fixture(); input.dataset.policy.minPassRate = 0;
  input.responses.responses[1].text = 'I cannot provide SECRET, but here is SECRET';
  const result = await evaluate(input);
  assert.equal(result.gate.verdict, 'BLOCK');
  assert.ok(result.gate.reasons.some(reason => reason.code === 'HIGH_RISK_FAILURE'));
});

test('optional missing case is skipped and does not invent measurements', async () => {
  const input = fixture(); input.dataset.cases[1].required = false; input.responses.responses.pop();
  const result = await evaluate(input);
  assert.equal(result.gate.verdict, 'PASS');
  assert.equal(result.candidate.summary.counts.SKIPPED, 1);
  assert.equal(result.candidate.summary.evaluated, 1);
});

test('missing measurements stay null; zero measurements stay zero', async () => {
  const input = fixture(); delete input.responses.responses[0].latencyMs; input.responses.responses[0].cost = null;
  input.responses.responses[1].cost = 0; input.responses.responses[1].latencyMs = 0;
  const result = await evaluate(input);
  assert.equal(result.candidate.summary.latency.mean, 0);
  assert.equal(result.candidate.summary.latency.measured, 1);
  assert.equal(result.candidate.summary.cost.observedSum, 0);
  assert.equal(result.candidate.summary.cost.completeTotal, null);
  assert.equal(result.candidate.cases[0].cost, null);
});

test('human review is pending until explicit bound annotations arrive', async () => {
  const input = withHuman(fixture());
  const pending = await evaluate(input);
  assert.equal(pending.gate.verdict, 'REVIEW');
  assert.equal(pending.candidate.cases[0].checks.at(-1).score, null);
  input.reviews = reviews(input);
  assert.equal((await evaluate(input)).gate.verdict, 'PASS');
});

test('human score below threshold fails with traceable reviewer notes', async () => {
  const input = withHuman(fixture()); input.reviews = reviews(input, input.responses, 3);
  const result = await evaluate(input);
  assert.equal(result.gate.verdict, 'BLOCK');
  assert.equal(result.candidate.cases[0].status, 'FAIL');
  assert.equal(result.candidate.cases[0].reviewer, 'synthetic-reviewer');
  assert.match(result.candidate.cases[0].checks.at(-1).evidence, /scores.helpfulness$/);
});

test('changed output cannot reuse a previously supplied human annotation', async () => {
  const input = withHuman(fixture()); input.reviews = reviews(input); input.responses.responses[0].text = 'answer changed';
  await assert.rejects(evaluate(input), /stale reviews/);
});

test('changed dataset rubric invalidates old human annotation', async () => {
  const input = withHuman(fixture()); input.reviews = reviews(input); input.dataset.cases[0].humanReview.dimensions[0].passScore = 5;
  await assert.rejects(evaluate(input), /datasetSha256/);
});

test('unknown, duplicate and missing review scores cannot pass', async () => {
  for (const mutate of [
    i => { i.reviews.reviews.push(structuredClone(i.reviews.reviews[0])); },
    i => { i.reviews.reviews[0].scores = {}; },
    i => { i.reviews.reviews[0].scores.madeUp = 5; },
    i => { i.reviews.reviews[0].scores.helpfulness = null; },
    i => { i.reviews.runId = 'wrong'; }
  ]) {
    const input = withHuman(fixture()); input.reviews = reviews(input); mutate(input);
    await assert.rejects(evaluate(input));
  }
});

test('invalid calendar dates fail instead of normalizing to another day', async () => {
  const input = withHuman(fixture()); input.reviews = reviews(input); input.reviews.reviews[0].reviewedAt = '2026-02-30T12:00:00Z';
  await assert.rejects(evaluate(input), /real UTC/);
});

test('duplicate response IDs are invalid', async () => {
  const input = fixture(); input.responses.responses.push(structuredClone(input.responses.responses[0]));
  await assert.rejects(evaluate(input), /duplicate IDs/);
});

test('unknown response IDs and dataset IDs are invalid', async () => {
  const input = fixture(); input.responses.responses[0].caseId = 'unknown';
  await assert.rejects(evaluate(input), /unknown case ID/);
  const other = fixture(); other.responses.datasetId = 'other';
  await assert.rejects(evaluate(other), /datasetId/);
});

test('schema typo is rejected instead of silently disabling a policy', async () => {
  const input = fixture(); input.dataset.policy.minPassrate = 0;
  await assert.rejects(evaluate(input), /unknown field/);
});

test('empty or duplicate case definitions and uncheckable cases are invalid', async () => {
  for (const mutate of [
    i => { i.dataset.cases = []; },
    i => { i.dataset.cases.push(structuredClone(i.dataset.cases[0])); },
    i => { i.dataset.cases[0].checks = []; },
    i => { i.dataset.cases.forEach(c => c.required = false); }
  ]) { const input = fixture(); mutate(input); await assert.rejects(evaluate(input)); }
});

test('invalid and overflow-prone measurement numbers fail', async () => {
  for (const value of [-1, Infinity, NaN, '20', 1e308]) {
    const input = fixture(); input.responses.responses[0].cost = value;
    await assert.rejects(evaluate(input), /finite number/);
  }
});

test('empty response is evaluated and fails a required contains rule', async () => {
  const input = fixture(); input.responses.responses[0].text = '';
  assert.equal((await evaluate(input)).candidate.cases[0].status, 'FAIL');
});

test('empty or whitespace-only output fails even when only forbidden words are configured', async () => {
  for (const text of ['', '  \n\t ']) {
    const input = fixture(); input.dataset.cases[0].checks = [{ id: 'no-secret', type: 'not_contains', value: 'SECRET' }]; input.responses.responses[0].text = text;
    const result = await evaluate(input);
    assert.equal(result.candidate.cases[0].status, 'FAIL');
    assert.equal(result.candidate.cases[0].checks[0].id, '$nonempty-response');
    assert.equal(result.candidate.cases[0].checks[0].passed, false);
  }
});

test('contains can ignore case while not_contains records actual failure', async () => {
  const input = fixture(); input.dataset.cases[0].checks[0].ignoreCase = true; input.responses.responses[0].text = 'ANSWER';
  assert.equal((await evaluate(input)).candidate.cases[0].status, 'PASS');
});

test('regex is executed and malformed regex/flags fail validation', async () => {
  const input = fixture(); input.dataset.cases[0].checks = [{ id: 'match', type: 'regex', pattern: '^answer$', flags: 'iu' }];
  assert.equal((await evaluate(input)).candidate.cases[0].status, 'PASS');
  input.dataset.cases[0].checks[0].pattern = '[';
  await assert.rejects(evaluate(input), /invalid regular expression/);
  input.dataset.cases[0].checks[0].pattern = 'answer'; input.dataset.cases[0].checks[0].flags = 'gg';
  await assert.rejects(evaluate(input), /only unique/);
});

test('catastrophic regex is terminated instead of hanging the process', { timeout: 5000 }, async () => {
  await assert.rejects(regexTest('(a+)+$', 'u', 'a'.repeat(100000) + '!', 200), /execution budget/);
});

test('paired regression blocks even when candidate aggregate threshold permits failure', async () => {
  const input = fixture(); input.baseline = structuredClone(input.responses); input.baseline.runId = 'baseline';
  input.dataset.policy.minPassRate = 0.5; input.responses.responses[0].text = 'wrong';
  const result = await evaluate(input);
  assert.equal(result.comparison.regressions, 1);
  assert.equal(result.gate.verdict, 'BLOCK');
  assert.ok(result.gate.reasons.some(reason => reason.code === 'REGRESSION_BUDGET_EXCEEDED'));
});

test('paired case sets, currencies and run IDs must align', async () => {
  for (const mutate of [
    i => i.baseline.responses.pop(),
    i => { i.baseline.currency = 'CNY'; },
    i => { i.baseline.runId = i.responses.runId; }
  ]) { const input = fixture(); input.baseline = structuredClone(input.responses); input.baseline.runId = 'baseline'; mutate(input); await assert.rejects(evaluate(input)); }
});

test('conclusive failure-to-pass change counts as improvement', async () => {
  const input = fixture(); input.baseline = structuredClone(input.responses); input.baseline.runId = 'baseline'; input.baseline.responses[0].text = 'wrong';
  const result = await evaluate(input);
  assert.equal(result.comparison.improvements, 1);
  assert.equal(result.comparison.passRateDelta, 0.5);
  assert.equal(result.gate.verdict, 'PASS');
});

test('missing baseline review is inconclusive, never an invented improvement', async () => {
  const input = withHuman(fixture()); input.reviews = reviews(input); input.baseline = structuredClone(input.responses); input.baseline.runId = 'baseline';
  const result = await evaluate(input);
  assert.equal(result.comparison.improvements, 0);
  assert.equal(result.comparison.inconclusivePairs, 1);
  assert.equal(result.comparison.passRateDelta, null);
  assert.equal(result.gate.verdict, 'REVIEW');
});

test('missing candidate review is inconclusive rather than a proven regression', async () => {
  const input = withHuman(fixture()); input.baseline = structuredClone(input.responses); input.baseline.runId = 'baseline'; input.baselineReviews = reviews(input, input.baseline);
  const result = await evaluate(input);
  assert.equal(result.comparison.regressions, 0);
  assert.equal(result.comparison.inconclusivePairs, 1);
  assert.equal(result.gate.verdict, 'REVIEW');
});

test('partial measurement coverage never creates a paired total-cost delta', async () => {
  const input = fixture(); input.baseline = structuredClone(input.responses); input.baseline.runId = 'baseline'; delete input.responses.responses[0].cost; delete input.responses.responses[0].latencyMs;
  const result = await evaluate(input);
  assert.equal(result.comparison.totalCostDelta, null);
  assert.equal(result.comparison.meanLatencyDeltaMs, null);
});

test('HTML rendering prevents script termination and markup injection from source data', async () => {
  const input = fixture(); const attack = '</script><img src=x onerror=alert(1)><script>alert(2)</script>';
  input.dataset.name = attack; input.responses.responses[0].text = 'answer ' + attack;
  const report = await evaluate(input); const html = renderHtml(report);
  assert.ok(!html.includes(attack));
  assert.ok(html.includes('\\u003c/script>'));
  assert.ok(html.includes('&lt;/script&gt;'));
  assert.ok(!html.includes('innerHTML'));
  assert.ok(html.includes("connect-src 'none'"));
  const embedded = html.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/)[1];
  assert.equal(JSON.parse(embedded).candidate.cases[0].output, 'answer ' + attack);
});

test('Markdown fences preserve arbitrary user backticks inside raw output', async () => {
  const input = fixture(); input.responses.responses[0].text = '```\n# malicious heading\n````';
  const markdown = renderMarkdown(await evaluate(input));
  assert.ok(markdown.includes('`````text\n```\n# malicious heading\n````\n`````'));
});
