// Doctor: shoot every scenario, tile them into ONE captioned contact sheet
// (shots/contact.png) + a HEALTH report (shots/HEALTH.md) with luma/perf/errors.
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withGame, sampleCanvas } from './harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await withGame(async ({ page, errors }) => {
  const list = await page.evaluate(() => window.__game.scenarios());
  const rows = [];
  for (const name of list) {
    await page.evaluate((n) => window.__game.scenario(n), name);
    if (['combat', 'swarm', 'boss', 'hot', 'crit'].includes(name)) {
      await page.evaluate(() => { window.__game.aimAt(0, -12); for (let k = 0; k < 4; k++) window.__game.cast(k); });
    }
    await wait(650);
    const img = await page.screenshot({ encoding: 'base64' });
    const s = await sampleCanvas(page);
    const fs = await page.evaluate(() => window.__game.frameStats());
    const black = s.maxLuma < 50 || s.nonblackPct < 0.03;
    rows.push({ name, img, s, fs, black });
    console.log(`${black ? 'BLACK' : ' ok  '}  ${name.padEnd(9)} luma=${s.meanLuma.toFixed(1)} max=${s.maxLuma.toFixed(0)} calls=${fs.drawCalls} enemies=${fs.enemies}`);
  }

  // contact sheet via an HTML grid screenshot (no image libs needed)
  const cells = rows.map((r) => `
    <div class="cell ${r.black ? 'bad' : ''}">
      <img src="data:image/png;base64,${r.img}"/>
      <div class="cap">${r.name} · luma ${r.s.meanLuma.toFixed(0)} · calls ${r.fs.drawCalls} · ${r.fs.enemies} foes${r.black ? ' · ⚠ BLACK' : ''}</div>
    </div>`).join('');
  await page.setViewport({ width: 1320, height: 1180 });
  await page.setContent(`<html><head><style>
    body{margin:0;background:#08060f;font-family:Segoe UI,sans-serif;color:#dfeaff}
    h1{padding:14px 18px;margin:0;font-size:20px;letter-spacing:.1em}
    .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:0 12px 12px}
    .cell{border:1px solid #2a2350;border-radius:8px;overflow:hidden;background:#0d0a1c}
    .cell.bad{border-color:#ff3b5c;box-shadow:0 0 12px #ff3b5c66}
    img{width:100%;display:block}
    .cap{font-size:11px;padding:5px 7px;letter-spacing:.04em;opacity:.85}
  </style></head><body><h1>ROGUE HERO 4 — DOCTOR CONTACT SHEET</h1><div class="grid">${cells}</div></body></html>`);
  await wait(300);
  await page.screenshot({ path: join(ROOT, 'shots', 'contact.png'), fullPage: true });

  const bad = rows.filter((r) => r.black);
  const md = [
    '# Rogue Hero 4 — HEALTH', '',
    `Scenarios: ${rows.length} · Black/flat: ${bad.length} · Console errors: ${errors.length}`, '',
    '| scenario | mean luma | max | nonblack% | draw calls | tris | enemies |',
    '|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.name} | ${r.s.meanLuma.toFixed(1)} | ${r.s.maxLuma.toFixed(0)} | ${(r.s.nonblackPct * 100).toFixed(1)} | ${r.fs.drawCalls} | ${r.fs.triangles} | ${r.fs.enemies} |`),
    '', bad.length ? `## ⚠ Flat/black: ${bad.map((b) => b.name).join(', ')}` : '## ✓ No black/flat scenarios',
    errors.length ? `## ⚠ Console errors\n${errors.slice(0, 8).map((e) => '- ' + e).join('\n')}` : '## ✓ No console errors',
  ].join('\n');
  await writeFile(join(ROOT, 'shots', 'HEALTH.md'), md);
  console.log(`\nDOCTOR done — shots/contact.png + shots/HEALTH.md (${bad.length} black, ${errors.length} errors)`);
}, { query: '?lowfx' }); // cutscenes ON so cut* scenarios render
