// End-to-end: drive window.__game through the core loop and assert invariants.
import { withGame } from './harness.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); if (!ok) failed++; };
const ev = (page, fn) => page.evaluate(fn);

await withGame(async ({ page, errors }) => {
  check('boots to title', (await ev(page, () => window.__game.mode)) === 'title');

  await ev(page, () => window.__game.start('pyre'));
  check('run starts (playing, hp>0)', await ev(page, () => window.__game.mode === 'playing' && window.__game.world.player.hp > 0));
  check('loadout has 4 cards', (await ev(page, () => window.__game.world.player.cards.length)) === 4);

  // damage funnel: spawn one enemy, kill it, confirm count + kills update
  await ev(page, () => { const w = window.__game.world; w.enemies.length = 0; w.spawnEnemy('darter', 0, w.player.z - 4, false); });
  const before = await ev(page, () => window.__game.world.run.kills);
  await ev(page, () => { const w = window.__game.world; const e = w.enemies[0]; window.__game.world.hitEnemy(e, 9999); });
  check('damage funnel kills enemy', await ev(page, () => window.__game.world.run.kills) > before);

  // room clears -> portal opens
  await ev(page, () => { window.__game.world.enemies.length = 0; });
  await page.waitForFunction('window.__game.world.portalOpen', { timeout: 5000, polling: 50 }).catch(() => {});
  check('room clears to portal', await ev(page, () => window.__game.world.portalOpen));

  // step into portal -> draft
  await ev(page, () => { const w = window.__game.world; w.player.x = w.portalX; w.player.z = w.portalZ; });
  await wait(300);
  check('portal opens draft', (await ev(page, () => window.__game.mode)) === 'draft');
  check('draft offers relics', (await ev(page, () => window.__game.world.draftOptions.length)) >= 1);

  // boss scenario
  await ev(page, () => window.__game.scenario('boss'));
  await wait(200);
  check('boss room has a boss', await ev(page, () => !!window.__game.world.boss));

  // spell weaving: three casts complete a weave → it resolves (resets to 0) and EMPOWERS
  await ev(page, () => window.__game.scenario('combat'));
  const wove = await ev(page, async () => {
    const g = window.__game; g.world.player.weave.length = 0; g.world.player.empower = 0;
    g.world.player.cards.forEach((c) => (c.cd = 0));
    g.world.castCard(0); g.world.castCard(2); g.world.castCard(3); // storm + ember + void = a weave
    await new Promise((r) => setTimeout(r, 30));
    return g.world.player.weave.length === 0 && g.world.player.empower > 0;
  });
  check('weave resolves on the 3rd cast (empowers)', wove);

  // win + gameover terminal states
  await ev(page, () => window.__game.scenario('win'));
  check('win state reachable', (await ev(page, () => window.__game.mode)) === 'win');
  await ev(page, () => window.__game.scenario('gameover'));
  check('gameover state reachable', (await ev(page, () => window.__game.mode)) === 'gameover');

  // cutscenes: must not soft-lock — a boss reveal must complete back to 'playing'
  await ev(page, () => window.__game.setCutscenes(true));
  await ev(page, () => window.__game.scenario('cutboss'));
  check('boss cutscene enters cutscene mode', (await ev(page, () => window.__game.mode)) === 'cutscene');
  await page.waitForFunction("window.__game.mode === 'playing'", { timeout: 18000, polling: 100 });
  check('boss cutscene completes back to playing', true);
  // skip jumps straight to the resolved state
  await ev(page, () => window.__game.scenario('cutwin'));
  await ev(page, () => window.__game.cine.skip());
  check('cutscene skip resolves to win', (await ev(page, () => window.__game.mode)) === 'win');
  await ev(page, () => window.__game.setCutscenes(false));

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
});

console.log(failed === 0 ? '\nE2E OK' : `\nE2E FAILED (${failed})`);
process.exit(failed === 0 ? 0 : 1);
