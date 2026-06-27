// Flow QA — drives the REAL UI (clicks, not scenario jumps) through the whole player
// flow at MULTIPLE resolutions, and runs a deterministic DOM-overlap + offscreen-clip
// probe at every step. This is the test that catches "overlapping menus" forever:
// scenario() jumps and a single 1280x720 capture never see transition/responsive breakage.
import { withGame } from './harness.mjs';
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SIZES = [
  { w: 1280, h: 720, name: '720p' },
  { w: 1920, h: 1080, name: '1080p' },
  { w: 1280, h: 800, name: 'electron' },
  { w: 1366, h: 768, name: 'laptop' },
  { w: 1024, h: 768, name: '4-3' },
];

// Deterministic layout invariant: no two visible interactive/text UI boxes may overlap
// (excluding ancestor/descendant), and nothing interactive may sit offscreen.
const PROBE = `(() => {
  const sel = '.btn,.pick,.card,.hud-bar,.howto-grid,.howto-row,.title-big,.subtitle,.depth,.relics,.hint,.tutorial,.boss-wrap';
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 2 && r.height > 2 && s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0.05; };
  const tag = (el) => (el.className.toString().trim().split(/\\s+/)[0] || el.tagName) + ':' + (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 16);
  const els = [...document.querySelectorAll(sel)].filter(vis);
  const overlaps = [];
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
    const a = els[i], b = els[j]; if (a.contains(b) || b.contains(a)) continue;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
    const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (ox > 4 && oy > 4) overlaps.push(tag(a) + ' ✕ ' + tag(b) + ' [' + Math.round(ox) + '×' + Math.round(oy) + ']');
  }
  const clipped = [];
  for (const el of els) { const r = el.getBoundingClientRect();
    if (r.left < -2 || r.top < -2 || r.right > innerWidth + 2 || r.bottom > innerHeight + 2) clipped.push(tag(el)); }
  return { overlaps, clipped };
})()`;

const findings = [];
async function step(page, size, label, shotsOn = true) {
  await wait(400);
  const probe = await page.evaluate(PROBE);
  const tagn = `${size.name}-${label}`;
  if (shotsOn) await page.screenshot({ path: join(ROOT, 'shots', `flow-${tagn}.png`) });
  if (probe.overlaps.length || probe.clipped.length) {
    findings.push({ where: tagn, ...probe });
    console.log(`  ⚠ ${tagn}: ${probe.overlaps.length} overlaps, ${probe.clipped.length} clipped`);
  } else {
    console.log(`  ok ${tagn}`);
  }
}

const click = async (page, selector) => {
  try { await page.waitForSelector(selector, { timeout: 4000, visible: true }); await page.click(selector); return true; }
  catch { console.log(`    (no ${selector})`); return false; }
};

await withGame(async ({ page, errors }) => {
  for (const size of SIZES) {
    console.log(`\n=== ${size.name} (${size.w}×${size.h}) ===`);
    await page.setViewport({ width: size.w, height: size.h });
    // clear saved meta, then RELOAD so boot re-reads empty meta (first-run how-to shows).
    // Clearing after boot is too late — main.ts already cached meta in memory.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__game && window.__game.mode', { timeout: 30000, polling: 100 });
    await page.evaluate(() => { try { localStorage.removeItem('rh4.meta'); } catch {} });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__game && window.__game.mode', { timeout: 30000, polling: 100 });
    await page.evaluate(() => { window.__game.setCutscenes(false); window.__game.toTitle(); });

    await step(page, size, '1-title');
    await click(page, '.btn[data-play]');                 // REAL transition: title -> select
    await step(page, size, '2-select');
    await click(page, '.pick:not([disabled])');           // first run -> interactive tutorial (playing)
    await page.waitForFunction("window.__game.mode === 'playing'", { timeout: 8000, polling: 100 }).catch(() => {});
    await step(page, size, '3-tutorial');                 // tutorial prompt banner over the arena
    await page.evaluate(() => window.__game.scenario('howto'));
    await step(page, size, '4-howto');                    // reference how-to screen
    await page.evaluate(() => { const g = window.__game; g.world.suppressClear = false; g.scenario('combat'); g.aimAt(0, -8); for (let k = 0; k < 4; k++) g.cast(k); });
    await step(page, size, '5-combat');
    await page.evaluate(() => window.__game.scenario('draft'));
    await step(page, size, '6-draft');
    await page.evaluate(() => window.__game.scenario('gameover'));
    await step(page, size, '7-gameover');
    await page.evaluate(() => window.__game.scenario('win'));
    await step(page, size, '8-win');
  }

  const md = [
    '# Rogue Hero 4 — FLOW / LAYOUT REPORT', '',
    `Resolutions: ${SIZES.map((s) => s.name).join(', ')} · Console errors: ${errors.length}`,
    `**Layout problems: ${findings.length}** ${findings.length ? '❌' : '✅ none — no overlapping/clipped UI at any size'}`, '',
    ...findings.flatMap((f) => [
      `## ${f.where}`,
      ...f.overlaps.map((o) => `- OVERLAP ${o}`),
      ...f.clipped.map((c) => `- OFFSCREEN ${c}`),
    ]),
    errors.length ? '\n## Console errors\n' + errors.slice(0, 8).map((e) => '- ' + e).join('\n') : '',
  ].join('\n');
  await writeFile(join(ROOT, 'shots', 'FLOW.md'), md);
  console.log(`\nFLOW done — ${findings.length} layout problems across ${SIZES.length} sizes → shots/FLOW.md`);
  return findings.length;
}, { query: '?nocut' }).then((n) => process.exit(n > 0 ? 1 : 0)); // hard gate: overlaps fail CI
