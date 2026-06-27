// Motion / FEEL QA — the static-screenshot harness can't see "juice", so this captures a
// BURST of frames over a combat/crash moment and judges MOTION:
//   1. deterministic signals (VLMs are weak at motion, F1~0.5): byte-diff "motion energy"
//      between consecutive frames + peak particles/shake/projectiles from sim state.
//      A near-zero energy burst = a dead/frozen scene (no juice) — a hard, objective fail.
//   2. a tiled FILMSTRIP judged by the VLM for feel / readability-in-motion / juice.
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withGame } from './harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// normalized byte difference of two PNG buffers — identical frames -> 0, motion -> high.
// (PNG of an unchanged WebGL frame is byte-identical; any visual change perturbs it.)
function byteDiff(a, b) {
  const n = Math.min(a.length, b.length); let d = Math.abs(a.length - b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) d++;
  return d / Math.max(a.length, b.length);
}

// A "moment" = a scripted burst of actions; we grab FRAMES frames across it.
const MOMENTS = {
  combat: { setup: 'combat', act: (k) => { window.__game.aimAt([-6, 0, 6][k % 3], -8); window.__game.cast(k % 4); window.__game.setMove(((k % 2) * 2 - 1), -1); } },
  crash:  { setup: 'hot', act: (k) => { window.__game.world.player.tempo = Math.min(99, 80 + k * 6); window.__game.aimAt(0, -8); window.__game.cast(2); } },
  swarm:  { setup: 'swarm', act: (k) => { window.__game.aimAt([0, -8, 8][k % 3], -6); window.__game.cast(k % 4); } },
};
const FRAMES = 8;

function judge(name) {
  const prompt = `You are the MOTION/FEEL judge for a neon-arcade roguelike. Design intent: @docs/GAME_BIBLE.md.
This is a FILMSTRIP — ${FRAMES} consecutive frames (left→right, top→bottom) of one "${name}" moment: @shots/motion-${name}.png
Judge the MOTION across frames, not one still. Be a HARSH critic. Anchors:
- feel (0-10): 8-10 = punchy/alive (projectiles flying, particle bursts, hit flashes, screen kick); 4-6 = some motion; 0-3 = nearly static/frozen.
- readability_in_motion (0-10): 8-10 = you can still track hero vs enemies vs projectiles as it moves; 0-3 = chaos/can't tell.
- juice (0-10): 8-10 = lots of satisfying feedback FX (trails, sparks, flashes, knockback); 0-3 = flat/no feedback.
- animation (0-10): 8-10 = entities have real CHARACTER animation across frames (idle motion, attack anticipation/recoil, hit reactions, squash/stretch, spawn/death scaling); 4-6 = a little; 0-3 = entities only translate/spin rigidly like static props — no animation.
Return ONLY one minified JSON object: {"reasoning":"<2 blunt sentences>","scores":{"feel":<n>,"readability_in_motion":<n>,"juice":<n>,"animation":<n>},"top_issues":["<fix>","<fix>"]}`;
  return new Promise((resolve) => {
    const p = spawn('claude', ['-p', '--model', 'sonnet'], { cwd: ROOT, shell: true });
    let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', () => {});
    p.stdin.write(prompt); p.stdin.end();
    p.on('close', () => { const m = out.match(/\{[\s\S]*\}/); try { resolve({ name, ...JSON.parse(m[0]) }); } catch { resolve({ name, error: 'no JSON', raw: out.slice(0, 160) }); } });
  });
}

const rows = await withGame(async ({ page }) => {
  // PHASE 1 — capture every moment on the LIVE game page (no setContent in between, or it
  // clobbers window.__game and later moments freeze on the static filmstrip HTML).
  const captures = [];
  for (const [name, m] of Object.entries(MOMENTS)) {
    await page.evaluate((s) => window.__game.scenario(s), m.setup);
    await wait(300);
    const frames = [], stats = [];
    for (let k = 0; k < FRAMES; k++) {
      await page.evaluate(m.act, k);
      await wait(95);
      // Buffer.from: page.screenshot() returns a Uint8Array; .toString('base64') on a raw
      // Uint8Array yields garbage (a comma list), which makes the filmstrip data-URLs broken.
      frames.push(Buffer.from(await page.screenshot()));
      stats.push(await page.evaluate(() => window.__game.frameStats()));
    }
    captures.push({ name, frames, stats });
  }
  // PHASE 2 — compute signals + build filmstrips (game page no longer needed)
  const out = [];
  for (const { name, frames, stats } of captures) {
    let e = 0; for (let i = 1; i < frames.length; i++) e += byteDiff(frames[i], frames[i - 1]);
    const energy = +((e / (frames.length - 1)) * 100).toFixed(2);
    const peakParts = Math.max(...stats.map((s) => s.activeParts || 0));
    const peakShake = Math.max(...stats.map((s) => s.shake || 0));
    const peakProj = Math.max(...stats.map((s) => s.activeProj || 0));
    const cells = frames.map((b, i) => `<div class="c"><img src="data:image/png;base64,${b.toString('base64')}"/><span>${i + 1}</span></div>`).join('');
    await page.setViewport({ width: 1280, height: 740 });
    await page.setContent(`<html><head><style>body{margin:0;background:#06040f}.g{display:grid;grid-template-columns:repeat(4,1fr);gap:3px}.c{position:relative}.c img{width:100%;display:block}.c span{position:absolute;top:2px;left:4px;color:#7df;font:700 12px sans-serif}</style></head><body><div class="g">${cells}</div></body></html>`);
    await wait(200);
    await page.screenshot({ path: join(ROOT, 'shots', `motion-${name}.png`), fullPage: true });
    out.push({ name, energy, peakParts, peakShake, peakProj });
    console.log(`captured ${name}: energy=${energy} parts=${peakParts} shake=${peakShake} proj=${peakProj}`);
  }
  return out;
}, { query: '' });

console.log('\nJudging motion filmstrips with claude (sonnet)…');
const verdicts = [];
for (const r of rows) verdicts.push(await judge(r.name));

const byName = Object.fromEntries(verdicts.map((v) => [v.name, v]));
const ENERGY_MIN = 2.0; // below this across a combat burst = effectively frozen / no juice
const md = [
  '# Rogue Hero 4 — MOTION / FEEL REPORT', '',
  'Deterministic motion + VLM filmstrip judgment (VLMs are weak at motion, so the energy/particle/shake signals are the objective floor).', '',
  '| moment | motion energy | peak particles | peak shake | peak proj | feel | readable-in-motion | juice | animation |',
  '|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => { const v = byName[r.name] || {}; const s = v.scores || {};
    return `| ${r.name} | ${r.energy}${r.energy < ENERGY_MIN ? ' ⚠FROZEN' : ''} | ${r.peakParts} | ${r.peakShake} | ${r.peakProj} | ${s.feel ?? '?'} | ${s.readability_in_motion ?? '?'} | ${s.juice ?? '?'} | ${s.animation ?? '?'} |`; }),
  '', '## Notes',
  ...verdicts.flatMap((v) => v.scores ? [`\n### ${v.name}\n${v.reasoning || ''}`, ...(v.top_issues || []).map((i) => `- ${i}`)] : [`\n### ${v.name} — JUDGE ERROR ${v.error || ''}`]),
].join('\n');
await writeFile(join(ROOT, 'shots', 'MOTION.md'), md);
console.log('\n' + md.split('\n').slice(0, 8 + rows.length).join('\n'));
const frozen = rows.filter((r) => r.energy < ENERGY_MIN);
console.log(`\nMOTION done → shots/MOTION.md (${frozen.length ? '⚠ ' + frozen.length + ' frozen moment(s)' : 'all moving'})`);
process.exit(0);
