// Shared headless harness: starts the Vite dev server + drives system Edge via
// puppeteer-core (no browser download). Every test/screenshot script uses this.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5273;
const URL = `http://127.0.0.1:${PORT}/`;

const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
async function findBrowser() {
  const { existsSync } = await import('node:fs');
  const p = EDGE_PATHS.find((x) => existsSync(x));
  if (!p) throw new Error('No Edge/Chrome found — set a path in scripts/harness.mjs');
  return p;
}

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(URL); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Vite dev server did not start');
}

// Default to ?nocut so logic/perf tests get instant, deterministic state jumps
// (no cutscene timing). doctor/tour override to capture cutscenes.
export async function withGame(run, { query = '?lowfx&nocut', shotsDir = 'shots' } = {}) {
  await mkdir(join(ROOT, shotsDir), { recursive: true });
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT, shell: true, stdio: 'ignore',
  });
  let browser;
  const errors = [];
  try {
    await waitForServer();
    browser = await puppeteer.launch({
      executablePath: await findBrowser(),
      headless: 'new',
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,720',
        '--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    // "Failed to load resource" console lines have no URL; track real 4xx via responses instead.
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('response', (r) => { const s = r.status(); const u = r.url(); if (s >= 400 && !u.endsWith('/favicon.ico')) errors.push(`HTTP ${s} ${u}`); });
    await page.goto(URL + query, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__game && window.__game.mode', { timeout: 30000, polling: 100 });
    const ctx = { page, errors, shot: (name) => page.screenshot({ path: join(ROOT, shotsDir, name) }) };
    return await run(ctx);
  } finally {
    if (browser) await browser.close();
    server.kill();
    // ensure the spawned shell's child vite also dies
    try { process.kill(-server.pid); } catch { /* ignore */ }
  }
}

// Sample the rendered canvas (mean luma + brightest pixel) to catch black screens.
export async function sampleCanvas(page) {
  return page.evaluate(() => {
    const c = document.getElementById('scene');
    const off = document.createElement('canvas'); off.width = 80; off.height = 45;
    const ctx = off.getContext('2d'); ctx.drawImage(c, 0, 0, 80, 45);
    const d = ctx.getImageData(0, 0, 80, 45).data;
    let sum = 0, max = 0, nonblack = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      sum += l; if (l > max) max = l; if (l > 12) nonblack++;
    }
    const n = d.length / 4;
    return { meanLuma: sum / n, maxLuma: max, nonblackPct: nonblack / n };
  });
}
