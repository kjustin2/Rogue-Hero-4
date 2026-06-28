// Boot smoke: real Edge, ?lowfx, into combat — asserts a NON-BLACK frame, that
// the player moves, a cast shifts tempo, and there are zero console errors.
import { withGame, sampleCanvas } from './harness.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); if (!ok) failed++; };

await withGame(async ({ page, errors, shot }) => {
  await page.evaluate(() => window.__game.scenario('combat'));
  await wait(900);

  const s = await sampleCanvas(page);
  check('canvas renders non-black', s.nonblackPct > 0.05 && s.maxLuma > 60, `mean=${s.meanLuma.toFixed(1)} max=${s.maxLuma.toFixed(0)} nonblack=${(s.nonblackPct * 100).toFixed(1)}%`);

  // movement — drive real keyboard input (the loop reads keys each frame)
  const x0 = await page.evaluate(() => window.__game.world.player.x);
  await page.keyboard.down('KeyD');
  await wait(500);
  await page.keyboard.up('KeyD');
  const x1 = await page.evaluate(() => window.__game.world.player.x);
  check('player moves', Math.abs(x1 - x0) > 0.3, `dx=${(x1 - x0).toFixed(2)}`);

  // a cast weaves a glyph (spell-weaving mechanic)
  const w0 = await page.evaluate(() => window.__game.world.player.weave.length);
  await page.evaluate(() => { window.__game.aimAt(0, -10); window.__game.cast(0); });
  await wait(200);
  const w1 = await page.evaluate(() => window.__game.world.player.weave.length);
  check('cast weaves a glyph', w1 !== w0, `weave ${w0} -> ${w1}`);

  const fs = await page.evaluate(() => window.__game.frameStats());
  check('draw calls > 0', fs.drawCalls > 0, `calls=${fs.drawCalls} tris=${fs.triangles}`);
  check('enemies present', fs.enemies > 0, `enemies=${fs.enemies}`);

  await shot('smoke.png');
  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
});

console.log(failed === 0 ? '\nSMOKE OK' : `\nSMOKE FAILED (${failed})`);
process.exit(failed === 0 ? 0 : 1);
