// Tour: cut to every scenario and screenshot it into shots/tour-*.png.
import { withGame } from './harness.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Full FX (no lowfx) so the screenshots show the real bloom-graded neon look.
await withGame(async ({ page, shot }) => {
  const list = await page.evaluate(() => window.__game.scenarios());
  for (const name of list) {
    await page.evaluate((n) => window.__game.scenario(n), name);
    // let a few attacks fire so combat shots aren't empty
    if (['combat', 'swarm', 'boss'].includes(name)) {
      await page.evaluate(() => { window.__game.aimAt(0, -12); for (let k = 0; k < 4; k++) window.__game.cast(k); });
    }
    await wait(700);
    await shot(`tour-${name}.png`);
    console.log(`shot tour-${name}.png`);
  }
}, { query: '' });
console.log('\nTOUR done — see shots/');
