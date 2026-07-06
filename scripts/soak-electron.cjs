/* Real-GPU boss-fight perf soak: boots the BUILT game in a hidden (but painting)
 * Electron window on the REAL GPU, runs the boss fight in real time (rAF, not
 * frames()) with periodic combo fire, and reports frame-time percentiles, draw
 * calls, and classified spikes (compile vs gc/stall). Exit 1 on budget breach.
 * Usage: npm run build && npx electron scripts/soak-electron.cjs */
const { app, BrowserWindow } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");

const distDir = path.join(__dirname, "..", "dist");
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

process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e && e.message ? e.message : e); app.exit(2); });

app.whenReady().then(async () => {
  const port = await startServer();
  const win = new BrowserWindow({
    width: 1600, height: 900, show: false, paintWhenInitiallyHidden: true,
    backgroundColor: "#05070a", webPreferences: { backgroundThrottling: false },
  });
  win.showInactive();
  win.webContents.setAudioMuted(true); // tests run MUTED
  const js = (s) => win.webContents.executeJavaScript(s);
  const tap = async (code) => {
    await js(`window.dispatchEvent(new KeyboardEvent("keydown",{code:"${code}"}))`);
    await js(`window.dispatchEvent(new KeyboardEvent("keyup",{code:"${code}"}))`);
  };

  await win.loadURL(`http://127.0.0.1:${port}/`);
  await sleep(4500);

  // cut to the boss fight, full arsenal, god on — then let REAL TIME run it
  await js(`window.__rh4debug.scenario('boss'); window.__rh4debug.god(true); window.__rh4.input.pointerLocked = true; window.__rh4debug.unlockAll();`);
  await sleep(600);
  await js(`window.__rh4debug.skipCutscene()`);
  await js(`window.__rh4perf.setSpikeThreshold(80); window.__rh4perf.clearSpikes(); window.__rh4perf.start('boss-soak');`);

  const SOAK_S = 25;
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < SOAK_S * 1000) {
    // keep the combat live: light-light-light combo bursts + occasional swap/heavy/dash
    await tap("KeyJ");
    if (i % 3 === 2) await tap("KeyE");
    if (i % 4 === 3) await tap("KeyK");
    if (i % 5 === 4) await tap("Space");
    i++;
    await sleep(350);
  }

  const stats = await js(`window.__rh4perf.stop()`);
  const spikes = await js(`window.__rh4perf.spikes()`);
  console.log("=== boss-fight real-GPU soak ===");
  console.log(`frames p50=${stats.p50?.toFixed(1)}ms p95=${stats.p95?.toFixed(1)}ms p99=${stats.p99?.toFixed(1)}ms max=${stats.max?.toFixed(1)}ms`);
  console.log(`long frames: >16ms=${stats.long16} >33ms=${stats.long33} >50ms=${stats.long50} >100ms=${stats.long100} >250ms=${stats.over250}`);
  console.log(`snap: calls=${stats.snap.calls} tris=${stats.snap.triangles} programs=${stats.snap.programs} heap=${stats.snap.heapMB}MB enemies=${stats.snap.enemies}`);
  console.log(`spikes (${spikes.length}):`, spikes.slice(0, 10).map((s) => `${s.dt.toFixed(0)}ms ${s.klass}@${s.state}`).join(", ") || "none");

  const errors = [];
  if (stats.p95 > 20) errors.push(`p95 ${stats.p95.toFixed(1)}ms > 20ms budget`);
  if (stats.over250 > 0) errors.push(`${stats.over250} freeze-class frames (>250ms)`);
  if (stats.snap.calls > 900) errors.push(`draw calls ${stats.snap.calls} > 900`);
  console.log(errors.length ? "SOAK FAIL:\n" + errors.join("\n") : "SOAK OK");
  app.exit(errors.length ? 1 : 0);
});
