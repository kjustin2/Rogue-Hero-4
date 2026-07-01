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

      // --- title sub-menus: settings + controls
      await js(`document.querySelector('#settings')?.click()`);
      await sleep(120);
      expect(await js(`!!document.querySelector('.settings [data-set="sfx"]')`), "settings panel did not open");
      await shot(win, "settings");
      await js(`document.querySelector('#back')?.click()`);
      await sleep(80);
      await js(`document.querySelector('#controls')?.click()`);
      await sleep(120);
      expect(await js(`!!document.querySelector('.keybtn')`), "controls panel did not open");
      await shot(win, "controls");
      await js(`document.querySelector('#back')?.click()`);
      await sleep(80);

      // --- start the run
      await js(`window.__rh4debug.start()`);
      await js(`window.__rh4debug.god(true)`); // survive the scripted demo (toggled off before the death beat)
      // real play locks the pointer on start; reflect that so the "CLICK TO AIM" hint
      // isn't plastered over every gameplay capture (the hidden window can't truly lock).
      await js(`window.__rh4.input.pointerLocked = true`);
      await frames(3);
      expect(await js(`window.__rh4state()==='playing'`), "run did not enter playing");
      await shot(win, "path-start");

      // --- mouse-look responds: injected locked-pointer delta rotates yaw + raises pitch
      const yawA = await js(`window.__rh4.cam.yaw`);
      await js(`window.__rh4.input.mouseDX = 200; window.__rh4.input.mouseDY = -120;`);
      await frames(1);
      const yawB = await js(`window.__rh4.cam.yaw`);
      const pitchB = await js(`window.__rh4.cam.pitch`);
      expect(Math.abs(yawB - yawA) > 0.1, `mouse dx did not rotate yaw (${yawA} -> ${yawB})`);
      expect(pitchB > 0.1, `mouse dy did not raise pitch (got ${pitchB})`);
      await js(`window.__rh4.cam.pitch = 0; window.__rh4.cam.yaw = Math.PI;`);

      // --- dodge: a no-input dodge backsteps (-Z) away from where you face, not toward it
      const dz0 = await js(`window.__rh4.player.pos.z`);
      await tap("Space");
      await frames(10);
      const dz1 = await js(`window.__rh4.player.pos.z`);
      expect(dz1 < dz0 - 1, `no-input dodge should backstep (z ${dz0.toFixed(1)} -> ${dz1.toFixed(1)})`);

      // --- weapon on the ground: a pickup sits under a light pillar; walking in claims it
      await js(`window.__rh4.pickups.dropWeapon('arclaser', 0, window.__rh4.player.pos.z + 7)`);
      await frames(3);
      await shot(win, "weapon-ground");
      await key("KeyW", "keydown"); await frames(24); await key("KeyW", "keyup");
      expect(await js(`window.__rh4.player.weapons.includes('arclaser')`), "did not claim the ground weapon pickup");
      await shot(win, "weapon-claimed");
      await js(`{const p=window.__rh4.player; p.wi=0; p.cycleWeapon(0);}`); // back to the starter

      // --- enemy lineup showcase (clean look at the upgraded models at distance)
      await js(`['husk','spitter','brute','wraith'].forEach((k,i)=>window.__rh4debug.spawn(k, -10 + i*6.5, window.__rh4.player.pos.z + 15))`);
      await frames(4);
      await shot(win, "enemies");
      await js(`window.__rh4.enemies.living().forEach(e=>e.takeDamage(99999,{}))`);
      await frames(10);

      // --- walk down the (wider) causeway; advancing past the trigger spawns gate 1's wave
      const z0 = await js(`window.__rh4.player.pos.z`);
      await key("KeyW", "keydown");
      await frames(64);
      await shot(win, "path-mid");
      await key("KeyW", "keyup");
      const z1 = await js(`window.__rh4.player.pos.z`);
      expect(z1 > z0 + 1.5, `player did not advance on W (z ${z0.toFixed(1)} -> ${z1.toFixed(1)})`);
      expect(await js(`window.__rh4.enemies.aliveCount() > 0`), "advancing did not spawn the gate wave");
      // Real per-frame draw-call total (Stage sets renderer.info.autoReset=false + resets
      // once per frame, so this spans every composer pass — not just the final blit).
      const calls = await js(`window.__rh4.stage.renderer.info.render.calls`);
      console.log(`  draw calls (gate-1 combat): ${calls}`);
      expect(calls > 0, "no draw calls (" + calls + ")");
      expect(calls < 900, "draw-call regression: " + calls + " (gate-1 combat ~300-500; check level.ts instancing/merges)");
      await frames(18); // let enemies close in
      await shot(win, "combat");

      // ensure the starter (bolt caster) is equipped for the deterministic combo/projectile tests
      await js(`{const p=window.__rh4.player; p.wi=0; p.cycleWeapon(0);}`);

      // --- heavy attack mid-swing (RMB / K)
      await tap("KeyK"); await frames(9);
      await shot(win, "attack");
      await frames(14);

      // --- drive a STARFALL combo on the starter (3× light = J, J, J → big barrage shot)
      await tap("KeyJ"); await frames(11);
      await tap("KeyJ"); await frames(11);
      await tap("KeyJ"); await frames(11);
      const lastCombo = await js(`window.__rh4.player.lastCombo`);
      expect(lastCombo === "STARFALL", "STARFALL combo did not resolve (got '" + lastCombo + "')");
      await shot(win, "combat-combo");

      // --- a single light attack fires a projectile (capture early so the comet reads near camera)
      await tap("KeyJ"); await frames(2);
      await shot(win, "projectile");

      // --- fairness: low-HP danger vignette + health-shard heal
      await js(`window.__rh4.player.hp = 28`);
      await frames(2);
      await shot(win, "low-hp");
      const hpLow = await js(`window.__rh4.player.hp`);
      await js(`window.__rh4.pickups.drop(window.__rh4.player.pos.x, window.__rh4.player.pos.z + 1.5, 30)`);
      await frames(28);
      const hpHealed = await js(`window.__rh4.player.hp`);
      expect(hpHealed > hpLow, `health shard did not heal (${hpLow} -> ${hpHealed})`);

      // --- clear the wave → the gate opens
      await js(`window.__rh4.enemies.living().forEach(e=>e.takeDamage(99999,{}))`);
      await frames(10);
      expect(await js(`window.__rh4.level.gates[0].open === true`), "gate did not open after clearing the wave");
      await shot(win, "gate-open");

      // --- arsenal: grant all weapons, then showcase each DISTINCT mechanic firing
      await js(`window.__rh4debug.unlockAll()`);
      const owned = await js(`window.__rh4.player.weapons.length`);
      expect(owned >= 5, "unlockAll did not grant the full arsenal (" + owned + ")");
      const equip = (id) => js(`{const p=window.__rh4.player; p.wi=p.weapons.indexOf('${id}'); p.cycleWeapon(0);}`);
      const spawnPack = () => js(`[0,1,2].forEach(i=>window.__rh4debug.spawn('husk', -4 + i*4, window.__rh4.player.pos.z + 9))`);
      const clearPack = () => js(`window.__rh4.enemies.living().forEach(e=>e.takeDamage(99999,{}))`);

      // ---------- attack variety: light, heavy, and signature combo per weapon ----------
      // The screenshot artifact the player audits — proves each weapon's light vs heavy vs
      // combo read distinctly and that none of them blind the view. (boltcaster's three are
      // captured above as attack / combat-combo / projectile.) Each fire() spawns a fresh
      // pack at the right range, taps the keys (J=light, K=heavy) with combo-window gaps,
      // then waits past the attack's wind-up + travel/delay so the shot lands on the FX.
      const spawnAt = (dz) => js(`[0,1,2].forEach(i=>window.__rh4debug.spawn('husk', -5 + i*5, window.__rh4.player.pos.z + ${dz}))`);
      const fire = async (id, label, keys, postF, dz) => {
        await equip(id);
        await spawnAt(dz); await frames(3);
        for (let i = 0; i < keys.length; i++) { await tap(keys[i]); if (i < keys.length - 1) await frames(11); }
        await frames(postF);
        await shot(win, label);
        await clearPack();
      };

      await equip("greatsword");
      expect(await js(`window.__rh4.player.weapon.kind`) === "melee", "greatsword should be melee");
      await fire("greatsword", "atk-sword-light", ["KeyJ"], 4, 4);
      await fire("greatsword", "atk-sword-heavy", ["KeyK"], 8, 4);
      await fire("greatsword", "atk-sword-combo", ["KeyJ", "KeyJ", "KeyK"], 10, 4); // CRESCENDO slam

      await fire("rocketlance", "atk-rocket-light", ["KeyJ"], 12, 9);              // flat rocket → blast
      await fire("rocketlance", "atk-rocket-heavy", ["KeyK"], 14, 9);             // lobbed mortar
      await fire("rocketlance", "atk-rocket-combo", ["KeyJ", "KeyJ", "KeyK"], 16, 9); // SALVO rocket fan

      await fire("arclaser", "atk-laser-light", ["KeyJ"], 3, 9);                  // thin beam
      await fire("arclaser", "atk-laser-heavy", ["KeyK"], 12, 9);                 // wide beam (windup 0.32)
      await fire("arclaser", "atk-laser-combo", ["KeyJ", "KeyJ", "KeyJ"], 3, 9);  // OVERLOAD mega-beam

      await fire("stormcaller", "atk-storm-light", ["KeyJ"], 20, 16);             // single called strike
      await fire("stormcaller", "atk-storm-heavy", ["KeyK"], 24, 18);             // 3-strike barrage
      await fire("stormcaller", "atk-storm-combo", ["KeyJ", "KeyJ", "KeyK"], 28, 18); // TEMPEST cluster

      await js(`{const p=window.__rh4.player; p.wi=0; p.cycleWeapon(0);}`); // back to the projectile starter for the boss
      await frames(6);

      // --- jump to the boss arena (spawning triggers the boss-intro cutscene)
      await js(`window.__rh4debug.scenario('boss')`);
      await frames(8);
      const bossHp = await js(`window.__rh4.boss ? window.__rh4.boss.hp : null`);
      expect(typeof bossHp === "number" && bossHp > 0, "boss did not spawn (" + bossHp + ")");
      expect(await js(`window.__rh4debug.cineActive()`), "boss-intro cutscene did not start");
      expect(await js(`window.__rh4.player.frozen === true`), "player not frozen during cutscene");
      await frames(16);
      await shot(win, "boss-intro");
      // skip back to player control
      await js(`window.__rh4debug.skipCutscene()`);
      await frames(2);
      expect(await js(`!window.__rh4debug.cineActive()`), "cutscene did not end on skip");
      expect(await js(`window.__rh4.player.frozen === false`), "player still frozen after cutscene");
      await frames(18);
      await shot(win, "boss");

      // --- weak point: look up at the core → gold crosshair + a bolt lands on it
      await js(`window.__rh4.cam.pitch = 0.16`);
      await frames(2);
      expect(await js(`window.__rh4.combat.isAimingWeak()`), "aim ray not on the boss core when looking up");
      const bHp0 = await js(`window.__rh4.boss.hp`);
      await tap("KeyJ"); // light projectile fired along the look ray
      await frames(36);
      const bHp1 = await js(`window.__rh4.boss.hp`);
      expect(bHp1 < bHp0, "projectile aimed at the core did not hit the boss");
      await shot(win, "weakpoint");
      await js(`window.__rh4.cam.pitch = 0`);

      // --- phase 2 transition: cross 50% → a phase-transition cutscene fires
      await js(`window.__rh4.boss.takeDamage(window.__rh4.boss.maxHp*0.55, {})`);
      await frames(6);
      expect(await js(`window.__rh4debug.cineActive()`), "phase-2 transition cutscene did not start");
      expect(await js(`window.__rh4.player.frozen === true`), "player not frozen during the phase cutscene");
      await shot(win, "boss-phase");
      await js(`window.__rh4debug.skipCutscene()`);
      await frames(3);

      // --- phase 3: cross 25% → final-phase cutscene, then skip back to the fight
      await js(`window.__rh4.boss.takeDamage(window.__rh4.boss.maxHp*0.30, {})`);
      await frames(4);
      await js(`window.__rh4debug.skipCutscene()`);
      await frames(20);
      await shot(win, "boss-phase3");

      // --- defeat the boss → victory flow (victoryQueued ~1.8s)
      await js(`window.__rh4debug.skipCutscene()`);
      await js(`if(window.__rh4.boss) window.__rh4.boss.takeDamage(99999,{})`);
      await frames(70);
      expect(await js(`window.__rh4state()==='victory'`), "victory state never reached");
      await shot(win, "victory", false);

      // --- death flow (god off so the lethal hit lands)
      await js(`window.__rh4debug.start()`);
      await js(`window.__rh4debug.god(false)`);
      await frames(3);
      await js(`window.__rh4.combat.damagePlayer(99999, 0, 0)`);
      await frames(2);
      expect(await js(`window.__rh4state()==='dead'`), "death state never reached");
      await shot(win, "death", false);

      // --- resized viewport (verify scaling holds)
      win.setContentSize(1120, 640);
      await sleep(200);
      await js(`window.__rh4debug.start()`);
      await frames(6);
      await shot(win, "resized");
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
