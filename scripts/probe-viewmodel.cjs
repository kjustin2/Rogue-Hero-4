/* Quick viewmodel probe: boots the BUILT game hidden, equips each weapon, screenshots
 * shots/probe-wpn-<id>.png. For iterating GLB weapon orientation without the full smoke.
 * Usage: node scripts/probe-viewmodel.cjs   (run `npm run build` first) */
const { app, BrowserWindow } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");

const distDir = path.join(__dirname, "..", "dist");
const shotDir = path.join(__dirname, "..", "shots");
const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".glb": "model/gltf-binary", ".png": "image/png", ".woff2": "font/woff2", ".mp3": "audio/mpeg" };

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
  const js = (s) => win.webContents.executeJavaScript(s);
  await win.loadURL(`http://127.0.0.1:${port}/`);
  await sleep(4200);
  await js(`document.getElementById('rift-loader')?.remove()`);
  await js(`window.__rh4debug.start(); window.__rh4debug.god(true); window.__rh4.input.pointerLocked = true;`);
  await js(`window.__rh4debug.unlockAll()`);
  console.log("models:", JSON.stringify(await js(`window.__rh4debug.models()`)));
  await js(`window.__rh4debug.frames(5)`);
  for (let i = 0; i < 5; i++) {
    await js(`window.__rh4debug.swapWeapon()`);
    await js(`window.__rh4debug.frames(4)`);
    const id = await js(`window.__rh4.player.weapon.id`);
    await sleep(160);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(shotDir, `probe-wpn-${id}.png`), img.toPNG());
    console.log(`  probe-wpn-${id}.png`);
  }
  app.exit(0);
});
