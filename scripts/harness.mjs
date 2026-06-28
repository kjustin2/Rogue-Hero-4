// Shared headless harness for the Needle game: starts the Vite dev server and
// drives system Chrome/Edge via puppeteer-core (no browser download).
// Adapted from the proven rogue-hero-4 harness; the test seam is window.__rh4.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3000;
const URL = `http://127.0.0.1:${PORT}/`;

const BROWSER_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
async function presentBrowsers() {
  const { existsSync } = await import('node:fs');
  const found = BROWSER_PATHS.filter((x) => existsSync(x));
  if (!found.length) throw new Error('No Chrome/Edge found — set a path in scripts/harness.mjs');
  return found;
}

async function waitForServer(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(URL); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Vite dev server did not start');
}

export async function withGame(run, { query = '?lowfx', shotsDir = 'shots' } = {}) {
  await mkdir(join(ROOT, shotsDir), { recursive: true });
  const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT, shell: true, stdio: 'ignore',
  });
  let browser;
  const errors = [];
  try {
    await waitForServer();
    const launchArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,720',
      '--autoplay-policy=no-user-gesture-required', '--no-sandbox'];
    for (const exe of await presentBrowsers()) {
      try { browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: launchArgs }); break; }
      catch (e) { errors.push(`browser launch failed (${exe}): ${String(e.message || e).split('\n')[0]}`); }
    }
    if (!browser) throw new Error('No browser could be launched — see errors above');
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('response', (r) => { const s = r.status(); const u = r.url(); if (s >= 400 && !u.endsWith('/favicon.ico')) errors.push(`HTTP ${s} ${u}`); });
    await page.goto(URL + query, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__rh4 && window.__rh4.ready', { timeout: 40000, polling: 100 });
    const ctx = { page, errors, shot: (name) => page.screenshot({ path: join(ROOT, shotsDir, name) }) };
    return await run(ctx);
  } finally {
    if (browser) await browser.close();
    server.kill();
    try { process.kill(-server.pid); } catch { /* ignore */ }
  }
}

// Sample the rendered frame via a real screenshot decoded back into a canvas —
// independent of the WebGL drawing-buffer (no preserveDrawingBuffer needed).
export async function sampleCanvas(page) {
  const b64 = await page.screenshot({ encoding: 'base64' });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const off = document.createElement('canvas'); off.width = 80; off.height = 45;
    const c = off.getContext('2d'); c.drawImage(img, 0, 0, 80, 45);
    const d = c.getImageData(0, 0, 80, 45).data;
    let sum = 0, max = 0, nonblack = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      sum += l; if (l > max) max = l; if (l > 12) nonblack++;
    }
    const n = d.length / 4;
    return { meanLuma: sum / n, maxLuma: max, nonblackPct: nonblack / n };
  }, b64);
}
