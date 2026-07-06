/* Enemy + boss portrait probe: spawn each kind close-up and screenshot it for a visual-quality
 * critique (silhouette, medieval read, animation pose). Usage: npx electron scripts/probe-enemies.cjs */
const { app, BrowserWindow } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");
const distDir = path.join(__dirname, "..", "dist");
const shotDir = path.join(__dirname, "..", "shots");
const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".woff2": "font/woff2", ".mp3": "audio/mpeg" };
const KINDS = ["husk", "ghoul", "rat", "spitter", "archer", "knight", "brute", "gargoyle", "wraith", "bomber"];

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p === "/") p = "/index.html";
      fs.readFile(path.join(distDir, p), (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const port = await startServer();
  const win = new BrowserWindow({ width: 900, height: 1000, show: false, paintWhenInitiallyHidden: true, backgroundColor: "#05070a", webPreferences: { backgroundThrottling: false } });
  win.showInactive();
  win.webContents.setAudioMuted(true); // tests run MUTED
  const js = (s) => win.webContents.executeJavaScript(s);
  const shot = async (label) => { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(shotDir, `probe-enemy-${label}.png`), img.toPNG()); console.log(`  probe-enemy-${label}.png`); };
  await win.loadURL(`http://127.0.0.1:${port}/`);
  await sleep(4200);
  await js(`document.getElementById('rift-loader')?.remove()`);
  await js(`window.__rh4debug.start(); window.__rh4debug.god(true); window.__rh4.input.pointerLocked = true;`);
  // PORTRAIT MODE: hide HUD + the weapon viewmodel + clear pickups so the creature is the only subject
  await js(`[0,1,2].forEach(i=>window.__rh4.level.openGate(i)); window.__rh4.enemies.clear(); window.__rh4.pickups.clear();`);
  await js(`{const h=document.getElementById('hud'); if(h) h.style.display='none'; window.__rh4.player.vm.visible=false; 0;}`);

  for (const k of KINDS) {
    await js(`window.__rh4.enemies.clear(); window.__rh4.tele.clear && window.__rh4.tele.clear();`);
    // spawn one ~6.5u ahead, FREEZE it (no attack/telegraph), frame its whole body (look slightly down at its centre)
    await js(`{const p=window.__rh4.player; const e=window.__rh4debug.spawn('${k}', p.pos.x, p.pos.z + 6.5); e.frozen = 999; window.__rh4.cam.yaw=Math.PI; window.__rh4.cam.pitch=-0.05; 0;}`);
    await js(`window.__rh4debug.frames(24)`); // settle stance / gargoyle low pass
    await js(`{const e=window.__rh4.enemies.living()[0]; if(e){e.frozen=999;} window.__rh4.tele.clear && window.__rh4.tele.clear(); 0;}`);
    await sleep(220);
    await shot(k);
  }

  // boss portrait
  await js(`window.__rh4debug.scenario('boss'); window.__rh4debug.frames(8); window.__rh4debug.skipCutscene();`);
  await js(`window.__rh4.enemies.clear(); window.__rh4debug.frames(20);`);
  await js(`{const b=window.__rh4.boss; const p=window.__rh4.player; p.pos.set(b.pos.x, 0, b.pos.z - 16); window.__rh4.cam.yaw=Math.PI; window.__rh4.cam.pitch=0.12; 0;}`);
  await js(`window.__rh4debug.frames(10)`);
  await sleep(240);
  await shot("boss");

  app.exit(0);
});
