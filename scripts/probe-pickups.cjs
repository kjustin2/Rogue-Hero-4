/* Weapon-pickup mini-model probe: drop each weapon close and screenshot it so the
 * 3D model reads as the real weapon. Usage: npx electron scripts/probe-pickups.cjs (after build). */
const { app, BrowserWindow } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");
const distDir = path.join(__dirname, "..", "dist");
const shotDir = path.join(__dirname, "..", "shots");
const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".woff2": "font/woff2", ".mp3": "audio/mpeg" };
const IDS = ["boltcaster", "greatsword", "rocketlance", "arclaser", "stormcaller", "warhammer", "francisca"];

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
    width: 1200, height: 900, show: false, paintWhenInitiallyHidden: true,
    backgroundColor: "#05070a", webPreferences: { backgroundThrottling: false },
  });
  win.showInactive();
  win.webContents.setAudioMuted(true); // tests run MUTED
  const js = (s) => win.webContents.executeJavaScript(s);
  await win.loadURL(`http://127.0.0.1:${port}/`);
  await sleep(4200);
  await js(`document.getElementById('rift-loader')?.remove()`);
  await js(`window.__rh4debug.start(); window.__rh4debug.god(true); window.__rh4.input.pointerLocked = true;`);
  await js(`window.__rh4.enemies.clear()`);
  for (const id of IDS) {
    await js(`window.__rh4.pickups.clear()`);
    // stand the pickup a few metres ahead; look slightly down at the hovering model
    await js(`{const p=window.__rh4.player; const z=p.pos.z+4; window.__rh4.pickups.dropWeapon('${id}', p.pos.x, z); window.__rh4.cam.yaw=Math.PI; window.__rh4.cam.pitch=0.16; 0;}`);
    await js(`window.__rh4debug.frames(20)`);
    await sleep(220);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(shotDir, `probe-pickup-${id}.png`), img.toPNG());
    console.log(`  probe-pickup-${id}.png`);
  }
  app.exit(0);
});
