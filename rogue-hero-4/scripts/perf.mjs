// Performance gate. Headless fps is software-bound, so we gate on DETERMINISTIC
// signals: max draw calls / triangles per scenario, GPU resource stability
// (geometries/textures must not climb = no leak), and pool bounds — diffed vs a
// checked-in perf-baseline.json. Frame time is reported but only self-comparable.
// Run `npm run perf -- --update` to (re)write the baseline.
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withGame } from './harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'perf-baseline.json');
const UPDATE = process.argv.includes('--update');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (page, fn, ...a) => page.evaluate(fn, ...a);

let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); if (!ok) failed++; };

const SCENARIOS = ['combat', 'swarm', 'boss'];

const result = await withGame(async ({ page }) => {
  const out = {};
  for (const sc of SCENARIOS) {
    await ev(page, (s) => window.__game.scenario(s), sc);
    // warm up ~1.2s so one-time geometry/program uploads (models, first-seen
    // enemy shapes) settle BEFORE we sample — a leak is *late* growth, not the step-up.
    const warm = Date.now();
    while (Date.now() - warm < 1200) { await ev(page, () => { const g = window.__game; const e = g.world.enemies.find((x) => !x.dead); if (e) g.aimAt(e.x, e.z); for (let i = 0; i < 4; i++) g.cast(i); }); await wait(120); }
    const geoMid = (await ev(page, () => window.__game.frameStats())).geometries;
    // stress: hammer every card for ~3.5s more
    const peak = { drawCalls: 0, triangles: 0, activeProj: 0, enemies: 0, frameMs: 0 };
    const t0 = Date.now();
    while (Date.now() - t0 < 3500) {
      await ev(page, () => { const g = window.__game; const e = g.world.enemies.find((x) => !x.dead); if (e) g.aimAt(e.x, e.z); for (let i = 0; i < 4; i++) g.cast(i); });
      const fs = await ev(page, () => window.__game.frameStats());
      peak.drawCalls = Math.max(peak.drawCalls, fs.drawCalls);
      peak.triangles = Math.max(peak.triangles, fs.triangles);
      peak.activeProj = Math.max(peak.activeProj, fs.activeProj);
      peak.enemies = Math.max(peak.enemies, fs.enemies);
      peak.frameMs = Math.max(peak.frameMs, fs.frameMs);
      await wait(120);
    }
    const end = await ev(page, () => window.__game.frameStats());
    out[sc] = { ...peak, geomLeak: end.geometries - geoMid, geometries: end.geometries, textures: end.textures, programs: end.programs, projPool: end.projPool };
    console.log(`  ${sc.padEnd(7)} calls=${peak.drawCalls} tris=${peak.triangles} activeProj=${peak.activeProj} enemies=${peak.enemies} frameMs~${peak.frameMs} geomLeak=${out[sc].geomLeak}`);
  }
  return out;
});

// Invariants (absolute, not baseline-relative)
for (const sc of SCENARIOS) {
  const r = result[sc];
  check(`${sc}: no geometry leak`, r.geomLeak <= 4, `Δgeom=${r.geomLeak}`);
  check(`${sc}: active projectiles within pool`, r.activeProj <= r.projPool, `${r.activeProj}/${r.projPool}`);
  check(`${sc}: draw calls sane`, r.drawCalls < 400, `calls=${r.drawCalls}`);
}

// Baseline regression gate
let baseline = null;
try { baseline = JSON.parse(await readFile(BASELINE, 'utf8')); } catch { /* none yet */ }
if (UPDATE || !baseline) {
  await writeFile(BASELINE, JSON.stringify(result, null, 2));
  console.log(`\nperf-baseline.json ${baseline ? 'updated' : 'written'}.`);
} else {
  for (const sc of SCENARIOS) {
    const b = baseline[sc], r = result[sc]; if (!b) continue;
    check(`${sc}: draw calls vs baseline`, r.drawCalls <= b.drawCalls * 1.5 + 10, `${r.drawCalls} vs ${b.drawCalls}`);
    check(`${sc}: triangles vs baseline`, r.triangles <= b.triangles * 1.6 + 2000, `${r.triangles} vs ${b.triangles}`);
  }
}

console.log(failed === 0 ? '\nPERF OK' : `\nPERF FAILED (${failed})`);
process.exit(failed === 0 ? 0 : 1);
