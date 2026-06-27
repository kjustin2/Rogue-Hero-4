// QA — ONE confident gate. Runs every check and prints a single verdict so you never
// ship with a broken type, an overlapping menu, a perf regression, or an ugly screen.
//
//   hard gates (fail the build): typecheck, flow/layout invariants, perf
//   advisory (reported, read them): vision look/feel, doctor contact sheet
//
// Usage: node scripts/qa.mjs            (full)
//        node scripts/qa.mjs --fast     (skip vision + doctor — fast deterministic gate)
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FAST = process.argv.includes('--fast');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, shell: true, encoding: 'utf8' });
  return { code: r.status ?? 1, out: (r.stdout || '') + (r.stderr || '') };
}
const pick = (out, re) => { const m = out.match(re); return m ? m[0] : ''; };

const results = [];
function gate(name, hard, cmd, args, metricRe) {
  process.stdout.write(`▶ ${name} … `);
  const r = run(cmd, args);
  const ok = r.code === 0;
  const metric = metricRe ? pick(r.out, metricRe) : '';
  console.log(`${ok ? 'PASS' : 'FAIL'}${metric ? '  ' + metric : ''}`);
  results.push({ name, hard, ok, metric });
  return r;
}

// --- hard gates -------------------------------------------------------------
gate('typecheck', true, 'npm', ['run', 'typecheck']);
gate('flow / layout invariants', true, 'node', ['scripts/flow.mjs'], /\d+ layout problems[^\n]*/);
gate('perf', true, 'node', ['scripts/perf.mjs'], /(PASS|FAIL)[^\n]*/);

// --- advisory (look/feel) ---------------------------------------------------
let visionAvg = '';
if (!FAST) {
  const v = gate('vision look/feel', false, 'node', ['scripts/vision.mjs'], /avg [\d.]+ · min \d+|avg [\d.]+, min \d+/);
  visionAvg = pick(v.out, /avg [\d.]+/);
  gate('motion / feel', false, 'node', ['scripts/motion.mjs'], /frozen moment|all moving/);
  gate('doctor contact sheet', false, 'node', ['scripts/doctor.mjs'], /\d+ black, \d+ errors/);
}

// --- verdict ----------------------------------------------------------------
const hardFails = results.filter((r) => r.hard && !r.ok);
const verdict = hardFails.length === 0 ? '✅ SHIPPABLE' : '❌ BLOCKED';
const md = [
  '# Rogue Hero 4 — QA', '',
  `**${verdict}**  ${visionAvg ? '· vision ' + visionAvg : ''}`, '',
  '| gate | type | result | metric |',
  '|---|---|---|---|',
  ...results.map((r) => `| ${r.name} | ${r.hard ? 'hard' : 'advisory'} | ${r.ok ? '✅' : '❌'} | ${r.metric || ''} |`),
  '', 'Reports: shots/FLOW.md (layout) · shots/VISION.md (look/feel) · shots/HEALTH.md + contact.png',
].join('\n');
await writeFile(join(ROOT, 'shots', 'QA.md'), md);

console.log(`\n${'='.repeat(48)}\n${verdict}${visionAvg ? '  · vision ' + visionAvg : ''}\n${'='.repeat(48)}`);
if (hardFails.length) console.log('Blocking: ' + hardFails.map((r) => r.name).join(', '));
console.log('→ shots/QA.md');
process.exit(hardFails.length ? 1 : 0);
