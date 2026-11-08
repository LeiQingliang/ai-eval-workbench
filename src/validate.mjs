import { createHash } from 'node:crypto';

export const contentHash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value), 'utf8').digest('hex');

export class InputError extends Error {
  constructor(message) { super(message); this.name = 'InputError'; }
}

const own = (value, key) => Object.hasOwn(value, key);
const fail = (where, message) => { throw new InputError(`${where}: ${message}`); };
function object(value, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(where, 'must be an object');
}
function keys(value, allowed, where) {
  object(value, where);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(where, `unknown field '${key}'`);
}
function string(value, where, max = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(where, `must be a nonempty string of at most ${max} characters`);
}
function id(value, where) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value)) fail(where, 'must be a 1–100 character ID (letters, digits, dot, underscore, hyphen)');
}
function number(value, where, min = 0, max = Number.MAX_VALUE) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(where, `must be a finite number between ${min} and ${max}`);
}
function boolean(value, where) {
  if (typeof value !== 'boolean') fail(where, 'must be true or false');
}
function array(value, where, min = 0, max = 10000) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(where, `must be an array with ${min}–${max} items`);
}
function unique(values, where) {
  if (new Set(values).size !== values.length) fail(where, 'duplicate IDs are not allowed');
}
function header(value, allowed, where) {
  keys(value, ['schemaVersion', 'datasetId', 'synthetic', ...allowed], where);
  if (value.schemaVersion !== 1) fail(`${where}.schemaVersion`, 'must be 1');
  boolean(value.synthetic, `${where}.synthetic`);
}

export function validateDataset(data) {
  header(data, ['id', 'name', 'description', 'policy', 'cases'], 'dataset');
  if (own(data, 'datasetId')) fail('dataset.datasetId', 'use id for a dataset');
  id(data.id, 'dataset.id');
  string(data.name, 'dataset.name', 200);
  if (own(data, 'description')) string(data.description, 'dataset.description', 4000);
  keys(data.policy, ['minPassRate', 'maxRegressions'], 'dataset.policy');
  number(data.policy.minPassRate, 'dataset.policy.minPassRate', 0, 1);
  number(data.policy.maxRegressions, 'dataset.policy.maxRegressions', 0, 10000);
  if (!Number.isInteger(data.policy.maxRegressions)) fail('dataset.policy.maxRegressions', 'must be an integer');
  array(data.cases, 'dataset.cases', 1, 10000);
  data.cases.forEach((item, index) => {
    const p = `dataset.cases[${index}]`;
    keys(item, ['id', 'prompt', 'scenario', 'risk', 'required', 'checks', 'humanReview'], p);
    id(item.id, `${p}.id`);
    string(item.prompt, `${p}.prompt`, 200000);
    string(item.scenario, `${p}.scenario`, 100);
    if (!['low', 'medium', 'high'].includes(item.risk)) fail(`${p}.risk`, 'must be low, medium or high');
    boolean(item.required, `${p}.required`);
    array(item.checks, `${p}.checks`, 0, 100);
    item.checks.forEach((check, i) => {
      const c = `${p}.checks[${i}]`;
      keys(check, ['id', 'type', 'value', 'pattern', 'flags', 'label', 'ignoreCase'], c);
      id(check.id, `${c}.id`);
      if (own(check, 'label')) string(check.label, `${c}.label`, 300);
      if (!['contains', 'not_contains', 'regex', 'refusal'].includes(check.type)) fail(`${c}.type`, 'unknown check type');
      if (check.type === 'contains' || check.type === 'not_contains') {
        string(check.value, `${c}.value`, 5000);
        if (own(check, 'ignoreCase')) boolean(check.ignoreCase, `${c}.ignoreCase`);
        if (own(check, 'pattern') || own(check, 'flags')) fail(c, 'pattern/flags apply only to regex');
      } else if (check.type === 'regex') {
        string(check.pattern, `${c}.pattern`, 512);
        if (own(check, 'value') || own(check, 'ignoreCase')) fail(c, 'value/ignoreCase do not apply to regex');
        if (own(check, 'flags') && (typeof check.flags !== 'string' || !/^(?!.*(.).*\1)[imu]*$/.test(check.flags))) fail(`${c}.flags`, 'only unique i, m, u flags are allowed');
        try { new RegExp(check.pattern, check.flags ?? 'u'); } catch (error) { fail(c, `invalid regular expression: ${error.message}`); }
      } else if (['value', 'pattern', 'flags', 'ignoreCase'].some(key => own(check, key))) {
        fail(c, 'refusal uses the documented built-in lexical heuristic; no value/pattern/flags/ignoreCase');
      }
    });
    unique(item.checks.map(check => check.id), `${p}.checks`);
    if (own(item, 'humanReview')) {
      keys(item.humanReview, ['dimensions'], `${p}.humanReview`);
      array(item.humanReview.dimensions, `${p}.humanReview.dimensions`, 1, 20);
      item.humanReview.dimensions.forEach((dim, i) => {
        const d = `${p}.humanReview.dimensions[${i}]`;
        keys(dim, ['id', 'label', 'minScore', 'maxScore', 'passScore'], d);
        id(dim.id, `${d}.id`);
        string(dim.label, `${d}.label`, 300);
        number(dim.minScore, `${d}.minScore`, -100, 100);
        number(dim.maxScore, `${d}.maxScore`, dim.minScore, 100);
        if (dim.maxScore === dim.minScore) fail(d, 'maxScore must exceed minScore');
        number(dim.passScore, `${d}.passScore`, dim.minScore, dim.maxScore);
      });
      unique(item.humanReview.dimensions.map(d => d.id), `${p}.humanReview.dimensions`);
    }
    if (!item.checks.length && !item.humanReview) fail(p, 'requires at least one rule or human-review dimension');
  });
  unique(data.cases.map(item => item.id), 'dataset.cases');
  if (!data.cases.some(item => item.required)) fail('dataset.cases', 'at least one required case is needed');
  return data;
}

export function validateResponses(run, dataset, name = 'responses') {
  header(run, ['runId', 'model', 'promptVersion', 'currency', 'responses'], name);
  if (run.datasetId !== dataset.id) fail(`${name}.datasetId`, `must equal '${dataset.id}'`);
  id(run.runId, `${name}.runId`);
  string(run.model, `${name}.model`, 200);
  string(run.promptVersion, `${name}.promptVersion`, 200);
  if (typeof run.currency !== 'string' || !/^[A-Z]{3}$/.test(run.currency)) fail(`${name}.currency`, 'must be a three-letter uppercase currency code (for example USD or CNY)');
  array(run.responses, `${name}.responses`);
  const caseIds = new Set(dataset.cases.map(item => item.id));
  run.responses.forEach((item, index) => {
    const p = `${name}.responses[${index}]`;
    keys(item, ['caseId', 'text', 'latencyMs', 'cost'], p);
    if (!caseIds.has(item.caseId)) fail(`${p}.caseId`, 'unknown case ID');
    if (typeof item.text !== 'string' || item.text.length > 200000) fail(`${p}.text`, 'must be a string of at most 200000 characters (empty responses are evaluated)');
    for (const field of ['latencyMs', 'cost']) if (own(item, field) && item[field] !== null) number(item[field], `${p}.${field}`, 0, 1e12);
  });
  unique(run.responses.map(item => item.caseId), `${name}.responses`);
  return run;
}

export function validateReviews(reviews, dataset, run, name = 'reviews') {
  if (reviews == null) return null;
  header(reviews, ['runId', 'datasetSha256', 'reviews'], name);
  if (reviews.datasetId !== dataset.id) fail(`${name}.datasetId`, 'does not match dataset');
  if (reviews.runId !== run.runId) fail(`${name}.runId`, 'does not match response run');
  if (reviews.datasetSha256 !== contentHash(dataset)) fail(`${name}.datasetSha256`, 'does not match the dataset content; generate a fresh review template after dataset changes');
  array(reviews.reviews, `${name}.reviews`);
  const cases = new Map(dataset.cases.map(item => [item.id, item]));
  const responses = new Map(run.responses.map(item => [item.caseId, item]));
  reviews.reviews.forEach((review, i) => {
    const p = `${name}.reviews[${i}]`;
    keys(review, ['caseId', 'outputSha256', 'reviewer', 'reviewedAt', 'scores', 'notes'], p);
    const item = cases.get(review.caseId);
    if (!item?.humanReview) fail(`${p}.caseId`, 'must reference a case requiring human review');
    if (!responses.has(review.caseId)) fail(`${p}.caseId`, 'cannot review a missing response');
    if (review.outputSha256 !== contentHash(responses.get(review.caseId).text)) fail(`${p}.outputSha256`, 'does not match response text; stale reviews cannot be reused');
    string(review.reviewer, `${p}.reviewer`, 200);
    if (typeof review.reviewedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(review.reviewedAt) || !Number.isFinite(Date.parse(review.reviewedAt)) || new Date(review.reviewedAt).toISOString().slice(0, 19) !== review.reviewedAt.slice(0, 19)) fail(`${p}.reviewedAt`, 'must be a real UTC ISO timestamp');
    string(review.notes, `${p}.notes`, 10000);
    keys(review.scores, item.humanReview.dimensions.map(d => d.id), `${p}.scores`);
    item.humanReview.dimensions.forEach(dim => number(review.scores[dim.id], `${p}.scores.${dim.id}`, dim.minScore, dim.maxScore));
  });
  unique(reviews.reviews.map(item => item.caseId), `${name}.reviews`);
  return reviews;
}

export function validatePair(candidate, baseline) {
  if (!baseline) return;
  if (candidate.runId === baseline.runId) fail('baseline.runId', 'must differ from candidate runId');
  if (candidate.currency !== baseline.currency) fail('baseline.currency', 'must match candidate currency; currency conversion is not automatic');
  const left = new Set(candidate.responses.map(item => item.caseId));
  const right = new Set(baseline.responses.map(item => item.caseId));
  if (left.size !== right.size || [...left].some(id => !right.has(id))) fail('baseline.responses', 'paired comparison requires exactly the same response case IDs');
}
