import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
function cli(...args) { return spawnSync(process.execPath, [join(root, 'src/cli.mjs'), ...args], { cwd: root, encoding: 'utf8', timeout: 15000 }); }
const base = ['--dataset','examples/dataset.json','--responses','examples/candidate.json'];

test('demo fixtures produce inspectable reports with exit 0', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-eval-pass-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const result = cli(...base,'--reviews','examples/candidate-reviews.json','--baseline','examples/baseline.json','--baseline-reviews','examples/baseline-reviews.json','--out-dir',dir);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(join(dir,'report.json'),'utf8'));
  assert.equal(report.candidate.summary.totalCases, 18);
  assert.equal(report.candidate.synthetic, true);
  assert.equal(report.comparison.improvements, 5);
  assert.ok((await readFile(join(dir,'report.html'),'utf8')).startsWith('<!doctype html>'));
  assert.match(await readFile(join(dir,'report.md'),'utf8'), /SYNTHETIC/);
});

test('omitted human annotations yield exit 2 and REVIEW report', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-eval-review-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const result = cli(...base,'--out-dir',dir);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(JSON.parse(await readFile(join(dir,'report.json'),'utf8')).gate.verdict, 'REVIEW');
});

test('bad baseline fixture can be evaluated as a blocking candidate', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-eval-block-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const result = cli('--dataset','examples/dataset.json','--responses','examples/baseline.json','--reviews','examples/baseline-reviews.json','--out-dir',dir);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(JSON.parse(await readFile(join(dir,'report.json'),'utf8')).gate.verdict, 'BLOCK');
});

test('malformed JSON and unknown CLI flags return exit 1', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-eval-invalid-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const bad = join(dir,'bad.json'); await writeFile(bad,'{broken','utf8');
  const malformed = cli('--dataset',bad,'--responses','examples/candidate.json','--out-dir',dir);
  assert.equal(malformed.status, 1); assert.match(malformed.stderr, /invalid JSON/);
  assert.equal(cli(...base,'--typo','x').status, 1);
  assert.equal(cli(...base,'--responses','examples/baseline.json').status, 1);
});

test('review template includes hashes and blank scores, never overwrites completed work', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-eval-template-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir,'review.json');
  assert.equal(cli(...base,'--review-template',path).status, 0);
  const raw = await readFile(path,'utf8'); const template = JSON.parse(raw);
  assert.match(template.datasetSha256,/^[0-9a-f]{64}$/);
  assert.equal(template.reviews[0].reviewer,'');
  assert.ok(Object.values(template.reviews[0].scores).every(score=>score===null));
  assert.equal(cli(...base,'--review-template',path).status, 1);
  assert.equal(await readFile(path,'utf8'),raw);
  assert.equal(cli(...base,'--reviews',path,'--out-dir',join(dir,'report')).status, 1);
});

test('UTF-8 BOM inputs are accepted and source-overwriting outputs are blocked', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-eval-bom-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir,'report.json');
  const data = await readFile(join(root,'examples/dataset.json'),'utf8');
  await writeFile(path,'\ufeff'+data,'utf8');
  const result = cli('--dataset',path,'--responses','examples/candidate.json','--reviews','examples/candidate-reviews.json','--out-dir',dir);
  assert.equal(result.status, 1); assert.match(result.stderr,/overwrite an input file/);
  assert.equal(await readFile(path,'utf8'),'\ufeff'+data);
});
