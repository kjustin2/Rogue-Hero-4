// Full-FX beauty shot (no ?lowfx) — captures the graded look for human review.
// May be heavier under SwiftShader; generous settle time.
import { withGame } from './harness.mjs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await withGame(async ({ page, errors, shot }) => {
  await page.evaluate(() => window.__rh4.scenario('swarm')); // into combat
  await wait(800);
  // fire a few abilities so FX/juice/floaters are on-screen
  await page.evaluate(() => { const g = window.__rh4, p = g.world.player; g.aimAt(p.x + 6, p.z - 2); for (const c of p.cards) c.cd = 0; g.cast(1); g.cast(2); g.cast(0); });
  await wait(900);
  await shot('beauty.png');
  console.log(errors.length ? `errors: ${errors.slice(0, 3).join(' | ')}` : 'no console errors');
}, { query: '' });

console.log('beauty shot -> shots/beauty.png');
