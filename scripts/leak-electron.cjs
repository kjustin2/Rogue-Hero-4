/* Resource-leak harness — restarts the game many times (with enemy/boss/FX churn) and checks that
 * GPU resources + JS heap do NOT grow monotonically (disposal leaks, per-instance material/shader
 * growth, listener accumulation). Boots MUTED. Usage: npx electron scripts/leak-electron.cjs */
const { app, BrowserWindow } = require("electron");
const http = require("http"); const fs = require("fs"); const path = require("path");
const distDir = path.join(__dirname, "..", "dist");
const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".woff2": "font/woff2", ".mp3": "audio/mpeg", ".png": "image/png" };
const CYCLES = 16;
function startServer() { return new Promise((res) => { const s = http.createServer((rq, rs) => { let p = decodeURIComponent(new URL(rq.url, "http://x").pathname); if (p === "/") p = "/index.html"; fs.readFile(path.join(distDir, p), (e, d) => { if (e) { rs.writeHead(404); rs.end(); return; } rs.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream" }); rs.end(d); }); }); s.listen(0, "127.0.0.1", () => res(s.address().port)); }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const port = await startServer();
  const win = new BrowserWindow({ width: 900, height: 700, show: false, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false, jsFlags: "--expose-gc" } });
  win.showInactive(); win.webContents.setAudioMuted(true);
  const js = (s) => win.webContents.executeJavaScript(s);
  const errors = [];
  win.webContents.on("console-message", (_e, level, msg) => { if (level >= 3) errors.push(msg); });
  await win.loadURL(`http://127.0.0.1:${port}/`); await sleep(4200);
  await js(`document.getElementById('rift-loader')?.remove()`);

  // exercise one full cycle: start → play → spawn a mixed pack → boss → kill everything → clear
  const cycle = async () => {
    await js(`window.__rh4debug.start(); window.__rh4.input.pointerLocked=true; [0,1,2].forEach(i=>window.__rh4.level.openGate(i));`);
    await js(`{const p=window.__rh4.player; ['husk','ghoul','rat','knight','brute','archer','spitter','gargoyle','wraith','bomber'].forEach((k,i)=>window.__rh4debug.spawn(k,-9+i*2,p.pos.z+8)); 0;}`);
    await js(`window.__rh4debug.frames(120)`);
    await js(`window.__rh4debug.breakParts('knight'); window.__rh4debug.breakParts('brute'); window.__rh4debug.frames(20);`);
    await js(`window.__rh4debug.scenario('boss'); window.__rh4debug.frames(20); window.__rh4debug.skipCutscene(); window.__rh4debug.frames(60);`);
    await js(`window.__rh4debug.breakParts('boss'); window.__rh4debug.frames(30);`);
    await js(`window.__rh4.enemies.living().forEach(e=>e.takeDamage(99999,{})); if(window.__rh4.boss) window.__rh4.boss.takeDamage(99999,{}); window.__rh4debug.frames(40);`);
  };
  const snap = async (label) => {
    const s = await js(`(() => { const r=window.__rh4.stage.renderer, m=performance.memory; if(typeof gc==='function'){gc();gc();} return { geo:r.info.memory.geometries, tex:r.info.memory.textures, prog:r.info.programs.length, heapMB: m? Math.round(m.usedJSHeapSize/1048576):-1 }; })()`);
    console.log(`  ${label.padEnd(10)} geo=${s.geo}  tex=${s.tex}  programs=${s.prog}  heap=${s.heapMB}MB`);
    return s;
  };

  // two warmup cycles so the enemy/FX pools reach steady state before we baseline
  await cycle(); await cycle();
  const base = await snap("baseline");
  for (let i = 0; i < CYCLES; i++) await cycle();
  const end = await snap(`after ${CYCLES}`);

  const fails = [];
  if (end.geo - base.geo > 20) fails.push(`geometries grew ${base.geo}->${end.geo} (leak: geometry not disposed)`);
  if (end.tex - base.tex > 6) fails.push(`textures grew ${base.tex}->${end.tex} (leak: texture not disposed)`);
  if (end.prog - base.prog > 4) fails.push(`shader programs grew ${base.prog}->${end.prog} (leak: per-instance material)`);
  if (base.heapMB > 0 && end.heapMB - base.heapMB > 40) fails.push(`JS heap grew ${base.heapMB}->${end.heapMB}MB across ${CYCLES} cycles (leak)`);
  if (errors.length) fails.push(`${errors.length} console error(s): ` + errors.slice(0, 3).join(" | "));

  console.log(fails.length ? `\nLEAK: ${fails.length} FAILURE(S)\n  - ` + fails.join("\n  - ") : `\nLEAK: STABLE across ${CYCLES} restart cycles — no geometry/texture/program/heap growth`);
  app.exit(fails.length ? 1 : 0);
});
