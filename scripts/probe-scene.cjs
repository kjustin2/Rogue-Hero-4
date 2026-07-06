/* Scene probe: boot the built game hidden, teleport to given spots, screenshot each.
 * Usage: npx electron scripts/probe-scene.cjs  (after npm run build)
 * Edit SPOTS below per investigation. Writes shots/probe-*.png */
const { app, BrowserWindow } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");
const distDir = path.join(__dirname, "..", "dist");
const shotDir = path.join(__dirname, "..", "shots");
const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".woff2": "font/woff2", ".mp3": "audio/mpeg" };

// [label, x, z, yaw, pitch, pre-js]
const SPOTS = [
  ["arena-approach", 0, 150, Math.PI, 0, ""],
  ["arena-mouth", 0, 172, Math.PI, 0, ""],
  ["arena-mouth-up", 0, 172, Math.PI, 0.25, ""],
  ["mid-path", 0, 80, Math.PI, 0, ""],
];

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
    width: 1600, height: 900, show: false, paintWhenInitiallyHidden: true,
    backgroundColor: "#05070a", webPreferences: { backgroundThrottling: false },
  });
  win.showInactive();
  win.webContents.setAudioMuted(true); // tests run MUTED
  const js = (s) => win.webContents.executeJavaScript(s);
  await win.loadURL(`http://127.0.0.1:${port}/`);
  await sleep(4200);
  await js(`document.getElementById('rift-loader')?.remove()`);
  await js(`window.__rh4debug.start(); window.__rh4debug.god(true); window.__rh4.input.pointerLocked = true;`);
  await js(`[0,1,2].forEach(i=>window.__rh4.level.openGate(i))`);
  await js(`window.__rh4.enemies.clear()`);
  for (const [label, x, z, yaw, pitch, pre] of SPOTS) {
    if (pre) await js(pre);
    await js(`{const p=window.__rh4.player; p.pos.set(${x},0,${z}); window.__rh4.cam.yaw=${yaw}; window.__rh4.cam.pitch=${pitch}; 0;}`);
    await js(`window.__rh4debug.frames(6)`);
    await sleep(180);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(shotDir, `probe-${label}.png`), img.toPNG());
    console.log(`  probe-${label}.png`);
  }
  app.exit(0);
});
