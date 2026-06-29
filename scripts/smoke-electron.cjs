/* eslint-disable */
// Real-runtime playthrough smoke (Wall-of-Dead style). Boots the BUILT game in
// an Electron/Chromium window — the actual shipping renderer — serves dist/ over
// a loopback HTTP server, drives a full slice of the game, screenshots every
// scene to shots/electron-*.png, and captures every console/renderer error.
//
// This is the "looks right + actually works in the shipped runtime" net that the
// targeted Playwright smokes (which run the dev server) don't cover. READ the
// screenshots — a clean console over a black canvas is still a failure.
//
// Run:  npm run smoke        (after npm run build)
//       npm run test:play    (build + smoke)
// Uses Electron's bundled Chromium — no Playwright browser download.

const { app, BrowserWindow } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");

const distDir = path.join(__dirname, "..", "dist");
const shotDir = path.join(__dirname, "..", "shots");
fs.mkdirSync(shotDir, { recursive: true });

if (!fs.existsSync(path.join(distDir, "index.html"))) {
  console.error("No dist/ build found. Run `npm run build` first.");
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
};

let server;
function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || "/").split("?")[0]);
      if (p === "/") p = "/index.html";
      const file = path.join(distDir, p);
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
let shotN = 0;

// Fraction of sampled pixels that are clearly lit — a black/frozen canvas fails.
function brightFraction(img) {
  const bmp = img.toBitmap(); // BGRA
  let bright = 0, total = 0;
  for (let i = 0; i < bmp.length; i += 4 * 97) {
    const lum = 0.114 * bmp[i] + 0.587 * bmp[i + 1] + 0.299 * bmp[i + 2];
    if (lum > 28) bright++;
    total++;
  }
  return total ? bright / total : 0;
}

async function shot(win, name, checkBright = true) {
  await sleep(160); // let the compositor recomposite DOM (menu) changes before capture
  const img = await win.webContents.capturePage();
  const file = `electron-${String(++shotN).padStart(2, "0")}-${name}.png`;
  fs.writeFileSync(path.join(shotDir, file), img.toPNG());
  const bf = brightFraction(img);
  console.log(`  shot: ${file}  bright=${(bf * 100).toFixed(1)}%`);
  if (checkBright && bf < 0.02) errors.push(`BLACK FRAME: ${name} only ${(bf * 100).toFixed(2)}% lit`);
}

app.whenReady().then(async () => {
  const port = await startServer();
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    // Never show a real window: a visible Electron window grabs OS focus (and
    // the cursor) away from the editor/terminal, then dumps it back on close.
    // `capturePage()` still renders real frames from a hidden window as long as
    // it keeps painting — hence paintWhenInitiallyHidden + backgroundThrottling
    // off below. (Was `show: true`, which is what stole focus during smokes.)
    show: false,
    paintWhenInitiallyHidden: true,
    backgroundColor: "#05070a",
    webPreferences: { backgroundThrottling: false, offscreen: false },
  });
  // Show without activating: a never-shown window won't recomposite the DOM overlay
  // layer (menus/HUD capture stale), but showInactive composites normally and does
  // not steal OS focus from the editor/terminal.
  win.showInactive();

  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 3) errors.push("CONSOLE: " + message);
  });
  win.webContents.on("render-process-gone", (_e, d) => errors.push("RENDERER GONE: " + d.reason));
  win.webContents.on("unresponsive", () => errors.push("UNRESPONSIVE"));

  const js = (s) => win.webContents.executeJavaScript(s);
  const key = (code, type) => js(`window.dispatchEvent(new KeyboardEvent(${JSON.stringify(type)},{code:${JSON.stringify(code)}}))`);
  const tap = async (code) => { await key(code, "keydown"); await key(code, "keyup"); };
  // Drive the sim deterministically — rAF is suspended in a never-shown window.
  const frames = (n, dt = 0.033) => js(`window.__rh4debug.frames(${n}, ${dt})`);
  const expect = (cond, msg) => { if (!cond) errors.push("FLOW: " + msg); };

  const run = async () => {
    try {
      await win.loadURL(`http://127.0.0.1:${port}/`);
      await sleep(2600);
      expect(await js(`!!window.__rh4`), "window.__rh4 hook missing in prod build");
      expect(await js(`window.__rh4state()==='title'`), "did not boot to title");
      await frames(2);
      await shot(win, "title");

      // combo matcher self-check (pure logic gate)
      const comboFails = await js(`window.__rh4debug.checkCombos()`);
      expect(Array.isArray(comboFails) && comboFails.length === 0, "combo self-check failed: " + JSON.stringify(comboFails));

      // --- start the run
      await js(`window.__rh4debug.start()`);
      await frames(3);
      expect(await js(`window.__rh4state()==='playing'`), "run did not enter playing");
      await shot(win, "path-start");

      // --- player advances forward on W (yaw faces +Z down the causeway)
      const z0 = await js(`window.__rh4.player.pos.z`);
      await key("KeyW", "keydown");
      await frames(24);
      await key("KeyW", "keyup");
      const z1 = await js(`window.__rh4.player.pos.z`);
      expect(z1 > z0 + 1.5, `player did not advance on W (z ${z0.toFixed(1)} -> ${z1.toFixed(1)})`);

      // --- spawn a wave and confirm enemies + draw calls
      await js(`window.__rh4debug.scenario('wave')`);
      await frames(3);
      expect(await js(`window.__rh4.enemies.aliveCount() > 0`), "wave did not spawn enemies");
      const calls = await js(`window.__rh4.stage.renderer.info.render.calls`);
      expect(calls > 0, "no draw calls (" + calls + ")");
      await frames(20); // let enemies approach for a livelier shot
      await shot(win, "combat");

      // --- drive a CRESCENDO combo (Strike, Strike, Cleave = J, J, K)
      await tap("KeyJ"); await frames(11);
      await tap("KeyJ"); await frames(11);
      await tap("KeyK"); await frames(11);
      const lastCombo = await js(`window.__rh4.player.lastCombo`);
      expect(lastCombo === "CRESCENDO", "CRESCENDO combo did not resolve (got '" + lastCombo + "')");
      await shot(win, "combat-combo");

      // --- bolt fires a projectile
      await tap("KeyE"); await frames(4);
      await shot(win, "bolt");

      // --- fairness: low-HP danger vignette + health-shard heal
      await js(`window.__rh4.player.hp = 28`);
      await frames(2);
      await shot(win, "low-hp");
      const hpLow = await js(`window.__rh4.player.hp`);
      await js(`window.__rh4.pickups.drop(window.__rh4.player.pos.x, window.__rh4.player.pos.z + 1.5, 30)`);
      await frames(28);
      const hpHealed = await js(`window.__rh4.player.hp`);
      expect(hpHealed > hpLow, `health shard did not heal (${hpLow} -> ${hpHealed})`);

      // --- clear the field, jump to the boss
      await js(`window.__rh4.enemies.living().forEach(e=>e.takeDamage(99999,{}))`);
      await frames(8);
      await js(`window.__rh4debug.scenario('boss')`);
      await frames(8);
      const bossHp = await js(`window.__rh4.boss ? window.__rh4.boss.hp : null`);
      expect(typeof bossHp === "number" && bossHp > 0, "boss did not spawn (" + bossHp + ")");
      await frames(16);
      await shot(win, "boss");

      // --- defeat the boss → victory flow (victoryQueued ~1.8s)
      await js(`if(window.__rh4.boss) window.__rh4.boss.takeDamage(99999,{})`);
      await frames(70);
      expect(await js(`window.__rh4state()==='victory'`), "victory state never reached");
      await shot(win, "victory", false);

      // --- death flow
      await js(`window.__rh4debug.start()`);
      await frames(3);
      await js(`window.__rh4.combat.damagePlayer(99999, 0, 0)`);
      await frames(2);
      expect(await js(`window.__rh4state()==='dead'`), "death state never reached");
      await shot(win, "death", false);
    } catch (e) {
      errors.push("EXCEPTION: " + (e && e.message ? e.message : String(e)));
    }
  };

  await run();

  console.log(
    errors.length ? `\nERRORS (${errors.length}):\n` + errors.slice(0, 25).join("\n") : "\nNO ERRORS — first-person slice rendered title → path → combat → combo → boss → victory → death."
  );
  try { server.close(); } catch (_) {}
  win.destroy();
  app.exit(errors.length ? 1 : 0);
});
