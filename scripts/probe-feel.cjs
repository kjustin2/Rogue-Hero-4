/* Feel probe: storm-caller ground reticle + damage-direction chevron / ABOVE cue.
 * Usage: npx electron scripts/probe-feel.cjs (after build). Writes shots/probe-feel-*.png */
const { app, BrowserWindow } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");
const distDir = path.join(__dirname, "..", "dist");
const shotDir = path.join(__dirname, "..", "shots");
const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".woff2": "font/woff2", ".mp3": "audio/mpeg" };

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
  const win = new BrowserWindow({
    width: 1200, height: 800, show: false, paintWhenInitiallyHidden: true,
    backgroundColor: "#05070a", webPreferences: { backgroundThrottling: false },
  });
  win.showInactive();
  const js = (s) => win.webContents.executeJavaScript(s);
  const shot = async (label) => { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(shotDir, `probe-feel-${label}.png`), img.toPNG()); console.log(`  probe-feel-${label}.png`); };
  await win.loadURL(`http://127.0.0.1:${port}/`);
  await sleep(4200);
  await js(`document.getElementById('rift-loader')?.remove()`);
  await js(`window.__rh4debug.start(); window.__rh4debug.god(true); window.__rh4.input.pointerLocked = true;`);
  await js(`window.__rh4.enemies.clear()`);

  // storm-caller reticle: equip + aim down at the ground ahead
  await js(`{const p=window.__rh4.player; if(!p.weapons.includes('stormcaller'))p.unlockWeapon('stormcaller'); p.wi=p.weapons.indexOf('stormcaller'); p.cycleWeapon(0); window.__rh4.cam.yaw=Math.PI; window.__rh4.cam.pitch=-0.35; 0;}`);
  await js(`window.__rh4debug.frames(10)`);
  await sleep(160);
  await shot("storm-reticle");

  // damage-direction chevron — hit from BEHIND (srcZ behind the +Z-facing player), level height
  await js(`{const p=window.__rh4.player; window.__rh4.cam.pitch=0; window.__rh4.events.emit('PLAYER_HIT',{dmg:20,srcX:p.pos.x,srcZ:p.pos.z-8,srcY:1.6});}`);
  await js(`window.__rh4debug.frames(2)`);
  await sleep(120);
  await shot("dmgdir-behind");

  // damage-direction + ABOVE cue — overhead attack (high srcY)
  await js(`{const p=window.__rh4.player; window.__rh4.events.emit('PLAYER_HIT',{dmg:38,srcX:p.pos.x+3,srcZ:p.pos.z+3,srcY:6});}`);
  await js(`window.__rh4debug.frames(2)`);
  await sleep(120);
  await shot("dmgdir-above");

  app.exit(0);
});
