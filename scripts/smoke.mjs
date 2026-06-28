// Boot smoke (?lowfx): asserts a NON-BLACK frame, that the player moves on
// input, draw calls > 0, and zero console errors.
import { withGame, sampleCanvas } from './harness.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); if (!ok) failed++; };

await withGame(async ({ page, errors, shot }) => {
  await page.evaluate(() => window.__rh4.scenario('combat')); // start a run
  await wait(900); // let the scene + first frames settle

  const started = await page.evaluate(() => window.__rh4.mode);
  check('run starts (mode=playing)', started === 'playing', `mode=${started}`);

  const s = await sampleCanvas(page);
  check('canvas renders non-black', s.nonblackPct > 0.05 && s.maxLuma > 60,
    `mean=${s.meanLuma.toFixed(1)} max=${s.maxLuma.toFixed(0)} nonblack=${(s.nonblackPct * 100).toFixed(1)}%`);

  const p0 = await page.evaluate(() => window.__rh4.getPos());
  await page.keyboard.down('KeyW');
  await wait(600);
  await page.keyboard.up('KeyW');
  const p1 = await page.evaluate(() => window.__rh4.getPos());
  const dz = p1.z - p0.z, moved = Math.hypot(p1.x - p0.x, dz);
  check('player moves on input', moved > 0.3, `d=${moved.toFixed(2)}`);
  // regression: W must go FORWARD (+Z, down the road toward the boss)
  check('W moves forward (+Z, toward boss)', dz > 0.2, `dz=${dz.toFixed(2)}`);

  const fs = await page.evaluate(() => window.__rh4.frameStats());
  check('draw calls > 0', fs.drawCalls > 0, `calls=${fs.drawCalls} tris=${fs.triangles}`);

  await shot('smoke.png');
  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
});

console.log(failed === 0 ? '\nSMOKE OK' : `\nSMOKE FAILED (${failed})`);
process.exit(failed === 0 ? 0 : 1);
