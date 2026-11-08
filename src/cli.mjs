#!/usr/bin/env node
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { evaluate } from './evaluate.mjs';
import { renderHtml, renderMarkdown } from './report.mjs';
import { InputError, contentHash, validateDataset, validateResponses } from './validate.mjs';

const HELP = `AI Eval Workbench 1.0.0 — offline evaluation of supplied AI responses

Evaluate:
  node src/cli.mjs --dataset FILE --responses FILE [--reviews FILE]
    [--baseline FILE --baseline-reviews FILE] [--out-dir DIRECTORY]

Prepare a human review template (does not assign scores):
  node src/cli.mjs --dataset FILE --responses FILE --review-template FILE

Outputs: report.json, report.md, report.html (default directory: reports/)
Existing report files are replaced. All processing is local; no API calls.
Exit codes: 0 = PASS or template created; 2 = BLOCK/REVIEW; 1 = invalid input/runtime error.
`;

function parse(argv) {
  const allowed = new Set(['dataset', 'responses', 'reviews', 'baseline', 'baseline-reviews', 'out-dir', 'review-template']);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag.startsWith('--') || !allowed.has(flag.slice(2))) throw new InputError(`Unknown argument: ${flag}`);
    const key = flag.slice(2);
    if (Object.hasOwn(args, key)) throw new InputError(`Duplicate argument: ${flag}`);
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new InputError(`Missing value for ${flag}`);
    args[key] = argv[++i];
  }
  if (!args.dataset || !args.responses) throw new InputError('--dataset and --responses are required; use --help for usage');
  if (args['baseline-reviews'] && !args.baseline) throw new InputError('--baseline-reviews requires --baseline');
  if (args['review-template'] && ['reviews', 'baseline', 'baseline-reviews', 'out-dir'].some(key => args[key])) throw new InputError('--review-template cannot be combined with evaluation/output arguments');
  return args;
}
async function load(path) {
  if ((await stat(path)).size > 20 * 1024 * 1024) throw new InputError(`${path}: JSON file exceeds 20 MiB`);
  let raw = await readFile(path, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  try { return JSON.parse(raw); } catch (error) { throw new InputError(`${path}: invalid JSON (${error.message})`); }
}
function samePath(a, b) {
  return process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
}
async function main() {
  if (process.argv.length === 3 && ['--help', '-h'].includes(process.argv[2])) { console.log(HELP); return; }
  const args = parse(process.argv.slice(2));
  const dataset = await load(args.dataset);
  const responses = await load(args.responses);
  if (args['review-template']) {
    validateDataset(dataset); validateResponses(responses, dataset);
    if ([args.dataset, args.responses].some(path => samePath(path, args['review-template']))) throw new InputError('Review template output cannot overwrite an input file');
    const byId = new Map(responses.responses.map(item => [item.caseId, item]));
    const template = { schemaVersion: 1, datasetId: dataset.id, datasetSha256: contentHash(dataset), runId: responses.runId, synthetic: dataset.synthetic || responses.synthetic, reviews: dataset.cases.filter(item => item.humanReview && byId.has(item.id)).map(item => ({ caseId: item.id, outputSha256: contentHash(byId.get(item.id).text), reviewer: '', reviewedAt: '', scores: Object.fromEntries(item.humanReview.dimensions.map(dim => [dim.id, null])), notes: '' })) };
    await mkdir(dirname(resolve(args['review-template'])), { recursive: true });
    // Exclusive create prevents an annotation template from erasing completed reviews.
    await writeFile(args['review-template'], JSON.stringify(template, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    console.log(`Review template created: ${resolve(args['review-template'])}\nFill reviewer, reviewedAt, scores and evidence notes. Unfilled templates are invalid annotations.`);
    return;
  }
  const report = await evaluate({ dataset, responses, reviews: args.reviews ? await load(args.reviews) : null, baseline: args.baseline ? await load(args.baseline) : null, baselineReviews: args['baseline-reviews'] ? await load(args['baseline-reviews']) : null });
  const outDir = resolve(args['out-dir'] ?? 'reports');
  const files = { 'report.json': JSON.stringify(report, null, 2) + '\n', 'report.md': renderMarkdown(report), 'report.html': renderHtml(report) };
  const inputs = ['dataset', 'responses', 'reviews', 'baseline', 'baseline-reviews'].filter(key => args[key]).map(key => args[key]);
  if (Object.keys(files).some(name => inputs.some(input => samePath(resolve(outDir, name), input)))) throw new InputError('Output report would overwrite an input file; choose another --out-dir');
  await mkdir(outDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) await writeFile(resolve(outDir, name), content, 'utf8');
  console.log(`Gate: ${report.gate.verdict} | ${report.candidate.summary.counts.PASS}/${report.candidate.summary.evaluated} checks-and-review cases passed | required coverage ${report.candidate.summary.requiredCovered}/${report.candidate.summary.requiredCases}`);
  if (report.comparison) console.log(`Paired changes: ${report.comparison.improvements} improved, ${report.comparison.regressions} regressed`);
  console.log(`Reports: ${outDir}`);
  process.exitCode = report.gate.verdict === 'PASS' ? 0 : 2;
}
try { await main(); } catch (error) { console.error(`ERROR: ${error.message}`); process.exitCode = 1; }
