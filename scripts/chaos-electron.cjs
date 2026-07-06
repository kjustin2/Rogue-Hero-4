/* Chaos / invariant bot — a "break the game before the player does" fuzz harness (multi-oracle,
 * seeded, reproducible). Boots the BUILT game MUTED in Electron and plays with random inputs while
 * continuously asserting invariants:
 *   - NO-CLIP: the player is never wedged inside a solid prop collider
 *   - IN-BOUNDS: the player never escapes the corridor walls / arena
 *   - NO-NAN: player + enemy positions and hp stay finite
 *   - NO-ERRORS: zero console/renderer errors across the whole run
 *   - PUSH-OUT: teleporting the player into each collider centre shoves them back out
 * Usage: npx electron scripts/chaos-electron.cjs [seed]   (after npm run build) */
const { app, BrowserWindow } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");
const distDir = path.join(__dirname, "..", "dist");
const shotDir = path.join(__dirname, "..", "shots");
const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".woff2": "font/woff2", ".mp3": "audio/mpeg" };
const SEED = parseInt(process.argv[2] || "1337", 10);
const WINDOWS = 260; // action windows (~8 frames each ≈ 2080 frames ≈ 70s of play)

// mulberry32 — reproducible input stream (harness-side only; the sim has its own seeded RNG)
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

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
const errors = [];
const fails = [];

app.whenReady().then(async () => {
  const port = await startServer();
  const win = new BrowserWindow({ width: 900, height: 700, show: false, paintWhenInitiallyHidden: true, backgroundColor: "#05070a", webPreferences: { backgroundThrottling: false } });
  win.showInactive();
  win.webContents.setAudioMuted(true); // tests run MUTED
  win.webContents.on("console-message", (_e, level, msg) => { if (level >= 3) errors.push(msg); }); // errors only (match the smoke); skip GL/CSP/perf warnings
  win.webContents.on("render-process-gone", (_e, d) => errors.push("RENDER GONE: " + JSON.stringify(d)));
  const js = (s) => win.webContents.executeJavaScript(s);
  const key = (code, type) => js(`window.dispatchEvent(new KeyboardEvent(${JSON.stringify(type)},{code:${JSON.stringify(code)}}))`);

  await win.loadURL(`http://127.0.0.1:${port}/`);
  await sleep(4200);
  await js(`document.getElementById('rift-loader')?.remove()`);
  await js(`window.__rh4debug.start(); window.__rh4debug.god(true); window.__rh4.input.pointerLocked = true;`);
  await js(`[0,1,2].forEach(i=>window.__rh4.level.openGate(i)); window.__rh4.enemies.clear();`);
  const colliderCount = await js(`window.__rh4.level.colliders.length`);
  console.log(`  seed=${SEED}  colliders=${colliderCount}`);

  // ---- PUSH-OUT oracle: run clampPosition directly on a throwaway point AT each collider centre;
  // it must eject the point. (Direct call — no frames — so it can't trip the boss cutscene/freeze.) ----
  const pushReport = await js(`(() => {
    const L=window.__rh4.level, R=window.__rh4.player.radius, bad=[];
    for (const c of L.colliders) {
      const t = { x: c.x, y: 0, z: c.z };
      L.clampPosition(t, R, false, true);
      const d = Math.hypot(t.x - c.x, t.z - c.z);
      if (d < c.r + R - 0.5) bad.push({r:c.r, z:+c.z.toFixed(1), d:+d.toFixed(2), need:+(c.r+R).toFixed(2)});
    }
    return bad;
  })()`);
  if (pushReport.length) fails.push("PUSH-OUT failed on " + pushReport.length + " collider(s): " + JSON.stringify(pushReport.slice(0, 4)));
  else console.log(`  PUSH-OUT: all ${colliderCount} colliders eject the player  OK`);

  // reset to a clean run for the fuzz phase
  await js(`window.__rh4debug.start(); window.__rh4debug.god(true); window.__rh4.input.pointerLocked = true; [0,1,2].forEach(i=>window.__rh4.level.openGate(i));`);

  // ---- FUZZ + per-frame invariants ----
  const MOVE = ["KeyW", "KeyA", "KeyS", "KeyD"];
  let held = [];
  let checked = 0;
  for (let wnd = 0; wnd < WINDOWS && !fails.length; wnd++) {
    // randomise held movement keys
    for (const k of held) await key(k, "keyup");
    held = MOVE.filter(() => rnd() < 0.45);
    for (const k of held) await key(k, "keydown");
    if (rnd() < 0.3) { await key("Space", "keydown"); await key("Space", "keyup"); } // dash
    if (rnd() < 0.5) { const a = pick(["KeyJ", "KeyK"]); await key(a, "keydown"); await key(a, "keyup"); } // attack
    if (rnd() < 0.12) await js(`window.__rh4.player.cycleWeapon(1)`); // swap
    // periodically inject an enemy pack to stress movement/combat
    if (wnd % 20 === 0) await js(`{const p=window.__rh4.player; ['husk','ghoul','rat','knight','brute'].forEach((k,i)=>window.__rh4debug.spawn(k, -8+i*4, p.pos.z + 6 + i)); 0;}`);

    // step 8 frames, checking every frame IN-PAGE (no per-frame IPC)
    const viol = await js(`(() => {
      const L=window.__rh4.level, P=window.__rh4.player, D=window.__rh4debug, R=P.radius, v=[];
      for (let f=0; f<8; f++) {
        D.frames(1);
        const x=P.pos.x, z=P.pos.z;
        if (!isFinite(x)||!isFinite(z)||!isFinite(P.hp)) { v.push('NaN pos/hp x='+x+' z='+z+' hp='+P.hp); break; }
        if (z < 184 && Math.abs(x) > 18.6) { v.push('OOB x='+x.toFixed(2)+' z='+z.toFixed(1)); break; }
        for (const e of window.__rh4.enemies.living()) { if (!isFinite(e.pos.x)||!isFinite(e.pos.z)) { v.push('enemy NaN '+e.kind); break; } }
        if (v.length) break;
        for (const c of L.colliders) { const d=Math.hypot(x-c.x,z-c.z); if (d < c.r + R - 0.6) { v.push('CLIP prop r='+c.r+' d='+d.toFixed(2)+' @('+x.toFixed(1)+','+z.toFixed(1)+')'); break; } }
        if (v.length) break;
      }
      return v;
    })()`);
    checked += 8;
    if (viol.length) fails.push(`window ${wnd}: ` + viol.join("; "));
    if (wnd % 40 === 0) { await js(`window.__rh4.enemies.clear()`); } // periodic cleanup so packs don't pile forever
  }
  for (const k of held) await key(k, "keyup");
  console.log(`  FUZZ: ${checked} frames of random input checked`);

  // a screenshot for the eyes
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(shotDir, "chaos-final.png"), img.toPNG());

  if (errors.length) fails.push(`${errors.length} console/renderer error(s): ` + errors.slice(0, 5).join(" | "));

  console.log(fails.length ? `\nCHAOS: ${fails.length} FAILURE(S)\n  - ` + fails.join("\n  - ") : `\nCHAOS: ALL INVARIANTS HELD (seed ${SEED}) — no clip / OOB / NaN / errors`);
  app.exit(fails.length ? 1 : 0);
});
