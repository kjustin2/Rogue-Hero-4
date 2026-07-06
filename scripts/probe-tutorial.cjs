/* Tutorial drive probe: run the first-run training with REAL key inputs (not event emits) and
 * assert every step advances + the player never dies. Usage: npx electron scripts/probe-tutorial.cjs */
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
const fails = [];
const ok = (cond, msg) => { console.log(`  ${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails.push(msg); };

app.whenReady().then(async () => {
  const port = await startServer();
  const win = new BrowserWindow({ width: 1000, height: 700, show: false, paintWhenInitiallyHidden: true, backgroundColor: "#05070a", webPreferences: { backgroundThrottling: false } });
  win.showInactive();
  win.webContents.setAudioMuted(true); // tests run MUTED
  const js = (s) => win.webContents.executeJavaScript(s);
  const key = (code, type) => js(`window.dispatchEvent(new KeyboardEvent(${JSON.stringify(type)},{code:${JSON.stringify(code)}}))`);
  const tap = async (code) => { await key(code, "keydown"); await key(code, "keyup"); };
  const frames = (n) => js(`window.__rh4debug.frames(${n})`);
  const prompt = () => js(`(document.querySelector('#tutorial')||{}).textContent||''`);
  const hp = () => js(`window.__rh4.player.hp`);
  const maxHp = () => js(`window.__rh4.player.maxHp`);

  await win.loadURL(`http://127.0.0.1:${port}/`);
  await sleep(4200);
  await js(`document.getElementById('rift-loader')?.remove()`);

  // launch the tutorial + reflect a locked pointer so attack inputs register
  await js(`window.__rh4debug.tutorial(); window.__rh4.input.pointerLocked = true;`);
  await frames(2);
  ok(await js(`window.__rh4debug.tutorialActive()`), "tutorial started");
  ok(await js(`window.__rh4.player.god === true`), "training is invulnerable (god on)");
  const full = await maxHp();

  // STEP 0 — move (hold W)
  ok(/Move with/.test(await prompt()), "step0 prompt = move");
  await key("KeyW", "keydown");
  await frames(24);
  await key("KeyW", "keyup");
  await frames(2);
  ok(/light strike/.test(await prompt()), "moving advanced to the LIGHT step");

  // anti-pre-latch: wrong verbs during the LIGHT step must NOT skip later lessons
  await tap("KeyK"); await frames(2);   // heavy
  await tap("Space"); await frames(2);  // dash
  await tap("KeyE"); await frames(2);   // swap
  ok(/light strike/.test(await prompt()), "wrong-verb inputs did NOT skip past the LIGHT step (step-gated)");
  await frames(24); // let the stray heavy attack + cooldowns settle before the real light

  // STEP 1 — light (LMB / J)  (equip may now be the greatsword after the stray E-swap; any light works)
  await tap("KeyJ");
  await frames(3);
  ok(/DASH/.test(await prompt()), "a LIGHT attack advanced to the DASH step");

  // STEP 2 — dash (Space)
  await tap("Space");
  await frames(3);
  ok(/HEAVY strike/.test(await prompt()), "a DASH advanced to the HEAVY step");

  // STEP 3 — heavy (RMB / K)  <-- the reported-broken step
  await tap("KeyK");
  await frames(4);
  ok(/COMBO FINISHER/.test(await prompt()), "a HEAVY attack advanced to the COMBO step (the reported bug)");

  // STEP 4 — combo (L,L,H = J,J,K within the 1.3s window).
  // Wait out the step-3 heavy's 0.7s cooldown first, else the combo's final heavy is blocked.
  await frames(26);
  await tap("KeyJ"); await frames(6);
  await tap("KeyJ"); await frames(6);
  await tap("KeyK"); await frames(6);
  ok(/SWAP/.test(await prompt()), "a COMBO FINISHER advanced to the SWAP step");

  // STEP 5 — swap (E)
  await tap("KeyE");
  await frames(4);
  ok(/COMPLETE/.test(await prompt()), "a WEAPON SWAP advanced to TRAINING COMPLETE");

  // run out the completion hold
  await frames(95);
  ok(await js(`window.__rh4state()==='title'`), "tutorial finished back to the main menu");
  ok(await js(`window.__rh4.player.god === false`), "training invulnerability lifted on completion");

  // no-death: hp stayed full the whole run
  const endHp = await hp();
  ok(endHp >= full, `player never lost health during training (hp=${endHp}/${full})`);

  console.log(fails.length ? `\nTUTORIAL PROBE: ${fails.length} FAIL` : `\nTUTORIAL PROBE: ALL PASS`);
  app.exit(fails.length ? 1 : 0);
});
