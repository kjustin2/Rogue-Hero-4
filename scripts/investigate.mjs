// REAL player-flow gate at FULL FX (no ?lowfx, no scenario() shortcut): boot → click ENTER →
// click a hero → play → move → look. FAILS on WebGL context loss, shader errors, or a broken
// flow step — the exact class of bug the scenario()/lowfx harness missed.
//   npm run flow            # default ANGLE (matches a real Chrome on Windows) — REAL GPU
//   RH_GPU=0 npm run flow   # force swiftshader (CI/no-GPU)
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3000;
const URL = `http://127.0.0.1:${PORT}/`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const log = [];
const L = (s) => { log.push(s); console.log(s); };

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
let browser, fail = 0;
const r = {}; // captured step results
try {
  for (let i = 0; i < 120; i++) { try { const x = await fetch(URL); if (x.ok) break; } catch { } await wait(300); }
  await mkdir(join(ROOT, 'shots'), { recursive: true });
  const exe = BROWSERS.find(existsSync);
  // default to the REAL GPU (default ANGLE = D3D11 on Windows, what a normal Chrome uses).
  const gpu = process.env.RH_GPU !== '0';
  const args = gpu
    ? ['--ignore-gpu-blocklist', '--enable-gpu', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--window-size=1280,720']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--window-size=1280,720'];
  if (process.env.RH_ANGLE) args.push(`--use-angle=${process.env.RH_ANGLE}`); // test a specific backend (e.g. gl)
  L(`browser=${exe}  realGPU=${gpu}`);
  browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const gfx = [];
  page.on('console', (m) => { const t = `[${m.type()}] ${m.text()}`; if (/Context Lost|CONTEXT_LOST|Shader Error|VALIDATE_STATUS|program not valid/i.test(t)) gfx.push(t); });
  page.on('pageerror', (e) => gfx.push(`[PAGEERROR] ${String(e).split('\n')[0]}`));
  const shot = (n) => page.screenshot({ path: join(ROOT, 'shots', n) });
  const Q = process.env.RH_QUERY || '';

  await page.goto(URL + Q, { waitUntil: 'domcontentloaded' });
  try { await page.waitForFunction('window.__rh4 && window.__rh4.ready', { timeout: 30000, polling: 100 }); r.booted = true; } catch { r.booted = false; }
  await wait(2200); await shot('flow-1-title.png');
  r.titleMode = await page.evaluate(() => window.__rh4?.mode);
  r.entered = await page.evaluate(() => { const b = [...document.querySelectorAll('.btn')].find((x) => /ENTER/i.test(x.textContent)); if (b) { b.click(); return true; } return false; });
  await wait(700); await shot('flow-2-select.png');
  r.cards = await page.evaluate(() => document.querySelectorAll('.reliccard').length);
  r.picked = await page.evaluate(() => { const c = document.querySelector('.reliccard'); if (c) { c.click(); return true; } return false; });
  await wait(1600); await shot('flow-3-play.png');
  r.playMode = await page.evaluate(() => window.__rh4?.mode);
  r.enemies = await page.evaluate(() => window.__rh4?.frameStats?.().enemies);
  const p0 = await page.evaluate(() => window.__rh4?.getPos());
  await page.keyboard.down('KeyW'); await wait(700); await page.keyboard.up('KeyW');
  const p1 = await page.evaluate(() => window.__rh4?.getPos());
  r.movedFwd = p0 && p1 ? +(p1.z - p0.z).toFixed(2) : 0;
  const y0 = await page.evaluate(() => window.__rh4?.getYaw?.() ?? 0);
  await page.evaluate(() => window.__rh4?.look?.(280, 0));
  const y1 = await page.evaluate(() => window.__rh4?.getYaw?.() ?? 0);
  r.lookDelta = +(y1 - y0).toFixed(2);
  await shot('flow-4-after.png');
  r.gfxErrors = gfx.slice(0, 4);

  const checks = [
    ['boots to ready', r.booted],
    ['title overlay (mode=title)', r.titleMode === 'title'],
    ['ENTER button clicks → select', r.entered],
    ['3 hero cards present', r.cards === 3],
    ['hero click → mode=playing', r.picked && r.playMode === 'playing'],
    ['enemies present on start', r.enemies > 0],
    ['W moves forward (+Z)', r.movedFwd > 0.2],
    ['look() rotates view', Math.abs(r.lookDelta) > 0.1],
    ['NO WebGL context loss / shader error', gfx.length === 0],
  ];
  L('');
  for (const [n, ok] of checks) { L(`${ok ? 'PASS' : 'FAIL'}  ${n}`); if (!ok) fail++; }
  if (gfx.length) { L('\nGPU errors:'); gfx.slice(0, 6).forEach((g) => L('  ' + g)); }
  L(`\nresults: ${JSON.stringify(r)}`);
} catch (e) {
  L(`THREW: ${String(e.stack || e).split('\n').slice(0, 3).join(' / ')}`); fail++;
} finally {
  await writeFile(join(ROOT, 'shots', 'FLOW.md'), log.join('\n'));
  if (browser) await browser.close();
  server.kill(); try { process.kill(-server.pid); } catch { }
}
console.log(fail === 0 ? '\nFLOW OK' : `\nFLOW FAILED (${fail})`);
process.exit(fail === 0 ? 0 : 1);
