// Strict reviewer: shoot every scenario at full FX into ONE captioned contact sheet
// + a HEALTH table (luma / nonblack / draws / tris / enemies / errors per scenario).
// Read shots/contact.png and criticize it — this is the whole-game checkup.
import { withGame } from './harness.mjs';
import { writeFile } from 'node:fs/promises';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SCENES = ['title', 'select', 'combat', 'swarm', 'boss'];

await withGame(async ({ page, errors }) => {
  const shots = [];
  const health = [];
  for (const sc of SCENES) {
    const before = errors.length;
    await page.evaluate((s) => window.__rh4.scenario(s), sc);
    await wait(1100);
    if (sc === 'combat' || sc === 'swarm' || sc === 'boss') {
      await page.evaluate(() => { const g = window.__rh4, p = g.world.player; if (p) { g.aimAt(p.x + 6, p.z - 2); for (const c of p.cards) c.cd = 0; g.cast(1); g.cast(2); g.cast(0); } });
      await wait(650);
    }
    const b64 = await page.screenshot({ encoding: 'base64' });
    shots.push({ sc, b64 });
    const stats = await page.evaluate(() => { try { return window.__rh4.frameStats(); } catch { return { drawCalls: 0, triangles: 0, enemies: 0 }; } });
    const luma = await page.evaluate(async (b) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b; await img.decode();
      const o = document.createElement('canvas'); o.width = 80; o.height = 45; const c = o.getContext('2d'); c.drawImage(img, 0, 0, 80, 45);
      const d = c.getImageData(0, 0, 80, 45).data; let s = 0, nb = 0;
      for (let i = 0; i < d.length; i += 4) { const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; s += l; if (l > 12) nb++; }
      return { mean: s / (d.length / 4), nonblack: nb / (d.length / 4) };
    }, b64);
    health.push({ sc, ...stats, mean: luma.mean.toFixed(1), nonblack: (luma.nonblack * 100).toFixed(0) + '%', errs: errors.length - before });
  }

  const sheet = await page.evaluate(async (shots) => {
    const cols = 2, tw = 600, th = 338, pad = 8, lh = 22, rows = Math.ceil(shots.length / cols);
    const cv = document.createElement('canvas'); cv.width = cols * tw + (cols + 1) * pad; cv.height = rows * (th + lh) + (rows + 1) * pad;
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#0a0a12'; ctx.fillRect(0, 0, cv.width, cv.height);
    for (let i = 0; i < shots.length; i++) {
      const img = new Image(); img.src = 'data:image/png;base64,' + shots[i].b64; await img.decode();
      const cx = i % cols, cy = (i / cols) | 0, x = pad + cx * (tw + pad), y = pad + cy * (th + lh + pad);
      ctx.drawImage(img, x, y, tw, th);
      ctx.fillStyle = '#bfe0ff'; ctx.font = '16px system-ui'; ctx.fillText(shots[i].sc.toUpperCase(), x + 6, y + th + 16);
    }
    return cv.toDataURL('image/png').split(',')[1];
  }, shots);
  await writeFile('shots/contact.png', Buffer.from(sheet, 'base64'));

  let md = '# RH4 Doctor\n\n| scenario | luma | nonblack | draws | tris | enemies | errs |\n|---|---|---|---|---|---|---|\n';
  for (const h of health) md += `| ${h.sc} | ${h.mean} | ${h.nonblack} | ${h.drawCalls} | ${h.triangles} | ${h.enemies} | ${h.errs} |\n`;
  md += `\n**Total console errors:** ${errors.length}\n`;
  await writeFile('shots/HEALTH.md', md);
  console.log(md);
}, { query: '' });

console.log('contact -> shots/contact.png');
