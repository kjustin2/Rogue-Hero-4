// Logic gate: drives the sim through window.__rh4 and asserts the core loop —
// run starts, the damage funnel works, the weave builds and resolves, no errors.
import { withGame } from './harness.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); if (!ok) failed++; };

await withGame(async ({ page, errors }) => {
  await page.evaluate(() => window.__rh4.scenario('combat'));
  await wait(300);

  check('run starts (mode=playing)', await page.evaluate(() => window.__rh4.mode) === 'playing');
  check('wave spawned', await page.evaluate(() => window.__rh4.frameStats().enemies) > 0);

  // damage funnel: spawn a darter directly in front, face it, strike it
  const dmg = await page.evaluate(() => {
    const g = window.__rh4, w = g.world, p = w.player;
    const e = w.spawnEnemy('darter', p.x, p.z - 2.5, false);
    const hp0 = e.hp;
    p.angle = Math.atan2(e.z - p.z, e.x - p.x);
    w.cast(0); // strike (melee cone)
    return { hp0, hp1: e.hp };
  });
  check('damage funnel hurts enemy', dmg.hp1 < dmg.hp0, JSON.stringify(dmg));

  // weave: three casts on distinct slots push 3 glyphs and RESOLVE (clears to 0)
  const w = await page.evaluate(() => {
    const g = window.__rh4, p = g.world.player;
    p.weave.length = 0;
    for (const c of p.cards) c.cd = 0; // deterministic: clear cooldowns
    g.cast(0); const a = p.weave.length;
    g.cast(1); const b = p.weave.length;
    g.cast(2); const c = p.weave.length;
    return { a, b, c };
  });
  check('weave builds 1→2 then resolves to 0', w.a === 1 && w.b === 2 && w.c === 0, JSON.stringify(w));

  // first-person look: look() must rotate the view (mouse-look wiring)
  const yl = await page.evaluate(() => { const g = window.__rh4; const a = g.getYaw(); g.look(300, 0); return { a, b: g.getYaw() }; });
  check('mouse look rotates the view', Math.abs(yl.b - yl.a) > 0.1, JSON.stringify(yl));

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
});

console.log(failed === 0 ? '\nE2E OK' : `\nE2E FAILED (${failed})`);
process.exit(failed === 0 ? 0 : 1);
