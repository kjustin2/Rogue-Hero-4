import * as THREE from 'three';
import { Bus } from './bus';
import { World } from './sim/world';
import { View } from './render/view';
import { Stage } from './render/stage';
import { Audio } from './audio';
import { Hud } from './hud';
import { Cinematic, easeOut, type Shot } from './render/cinematic';
import { Tutorial } from './tutorial';
import { CHARACTERS, BOSS_DEPTH, NEON, ARENA } from './content';
import type { GameMode } from './types';

const params = new URLSearchParams(location.search);
const LOWFX = params.has('lowfx') || params.has('nofx');
let cutscenesOn = !params.has('nocut'); // tests pass ?nocut for fast, deterministic state jumps

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const hudEl = document.getElementById('hud')!;
const overlayEl = document.getElementById('overlay')!;

const bus = new Bus();
const world = new World(bus);
const view = new View(world, bus, LOWFX);
const stage = new Stage(canvas, view, LOWFX);
const audio = new Audio();
const hud = new Hud(hudEl, overlayEl);
const cine = new Cinematic(view.camera);

let mode: GameMode = 'title';
let lastChar = 'pyre';
const ray = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitPoint = new THREE.Vector3();
const focusVec = new THREE.Vector3();
const keys = new Set<string>();

// ---- meta (unlocks) -------------------------------------------------------
interface Meta { unlocked: string[]; runs: number; bestDepth: number; kills: number; seenTutorial: boolean; }
const DEFAULT_META: Meta = { unlocked: [], runs: 0, bestDepth: 0, kills: 0, seenTutorial: false };
function loadMeta(): Meta {
  try { return { ...DEFAULT_META, ...JSON.parse(localStorage.getItem('rh4.meta') || '{}') }; }
  catch { return { ...DEFAULT_META }; }
}
function saveMeta(m: Meta): void { try { localStorage.setItem('rh4.meta', JSON.stringify(m)); } catch { /* private mode */ } }
let meta = loadMeta();
function unlockedSet(): Set<string> { return new Set(meta.unlocked); }

function recordRunEnd(): void {
  meta.runs++;
  meta.bestDepth = Math.max(meta.bestDepth, world.run.depth);
  meta.kills += world.run.kills;
  if (!meta.unlocked.includes('frost')) meta.unlocked.push('frost');           // finish a run
  if (meta.bestDepth >= 3 && !meta.unlocked.includes('shadow')) meta.unlocked.push('shadow');
  saveMeta(meta);
}

// ---- flow / state machine -------------------------------------------------
function toTitle(): void { mode = 'title'; hud.showTitle(toSelect, () => startTutorialRun(lastChar), () => toHowTo(toTitle), exitGame); }
// Electron 'core' window: close → app quits. In a browser this is a guarded no-op (an unguarded
// window.close logs the "scripts may only close windows they opened" warning the smoke gate flags).
function exitGame(): void { if (/electron/i.test(navigator.userAgent)) window.close(); }
function toSelect(): void { mode = 'select'; hud.showSelect(unlockedSet(), beginRun, toTitle); }
// how-to overlay over the title tableau (mode stays 'title' → orbit cam, no HUD)
function toHowTo(onDone: () => void): void { mode = 'title'; hud.showHowTo(onDone); }

// core run setup (no cutscene) — also the path scenarios use for instant state jumps
function startRun(charId: string): void {
  tutorial.stop(); // every run/scenario jump starts clean — the banner must never linger over combat
  lastChar = CHARACTERS.find((c) => c.id === charId) ? charId : 'pyre';
  world.startRun(lastChar);
  view.setCharColor(world.player.char.color);
  view.setBiome(world.biome.fog, world.biome.accent);
  hud.setLoadout(world.player.char.loadout);
  hud.hideOverlay();
  mode = 'playing';
  audio.resume(); audio.startMusic();
}

// real entry from the menu / retry — startRun + the descent cutscene.
// First-ever run: launch the interactive tutorial instead of diving straight in.
function beginRun(charId: string): void {
  if (!meta.seenTutorial) { meta.seenTutorial = true; saveMeta(meta); startTutorialRun(charId); return; }
  realBeginRun(charId);
}
function realBeginRun(charId: string): void {
  startRun(charId);
  playCutscene('dive', () => { mode = 'playing'; });
}

// ---- interactive tutorial -------------------------------------------------
let tut = { moved: false, rotated: false, attacked: false, dashed: false };
const tutorial = new Tutorial({
  prompt: (t, s) => hud.tutorial(t, s),
  clear: () => hud.clearTutorial(),
  spawnDummies: () => { for (let i = 0; i < 3; i++) world.spawnEnemy('darter', (i - 1) * 5, 6, false); },
  startCombat: () => { world.suppressClear = false; world.enemies = []; for (let i = 0; i < 5; i++) world.spawnEnemy('darter', (i - 2) * 5, -2 - (i % 2) * 5, false); },
});
function startTutorialRun(charId: string): void {
  startRun(charId);
  world.enemies = []; world.portalOpen = false; world.suppressClear = true;
  view.camYaw = 0;
  tut = { moved: false, rotated: false, attacked: false, dashed: false };
  tutorial.start();
}

function chooseRelic(id: string): void {
  world.applyRelic(id); world.nextRoom();
  view.setBiome(world.biome.fog, world.biome.accent);
  hud.hideOverlay();
  if (cutscenesOn && world.run.depth >= BOSS_DEPTH) playCutscene('boss', () => { mode = 'playing'; });
  else mode = 'playing';
}
function toDraft(): void {
  world.rollDraft(); mode = 'draft';
  hud.showDraft(world.draftOptions, chooseRelic);
}

function toEnd(win: boolean): void {
  mode = win ? 'win' : 'gameover';
  recordRunEnd();
  audio.setMusic(false);
  hud.showEnd(win, world, () => beginRun(lastChar), toTitle);
}

// ---- cutscenes ------------------------------------------------------------
const hexColor = (n: number) => '#' + n.toString(16).padStart(6, '0');

function playCutscene(name: 'dive' | 'boss' | 'win' | 'death', onDone: () => void): void {
  if (!cutscenesOn) { onDone(); return; }
  mode = 'cutscene';
  view.cinematic = true;
  hud.hideOverlay();
  hud.letterbox(true);
  cine.play(buildCutscene(name), focusVec, () => { hud.clearCinematic(); view.resyncCam(); onDone(); });
}

function buildCutscene(name: 'dive' | 'boss' | 'win' | 'death'): Shot[] {
  const pl = world.player;
  switch (name) {
    case 'dive': // dramatic descent into the arena: high overview -> swoop behind the hero
      focusVec.set(pl.x, 0, pl.z);
      return [
        { dur: 1.7, fov: 44, fovTo: 58, ease: easeOut, pos: [0, 50, 2], posTo: [7, 24, 19], look: [0, 0, -4], lookTo: [0, 2, -2],
          onStart: () => { hud.cinematicText('DESCENDING', world.biome.name, hexColor(world.biome.accent), 1600); bus.emit('fx:cast', { x: pl.x, z: pl.z, color: world.player.char.color, kind: 'arc' }); world.shake += 0.5; audio.play('dash', 0.55); } },
        { dur: 0.9, fov: 58, fovTo: 52, ease: easeOut, pos: [7, 24, 19], posTo: [0, 12, 14], look: [0, 2, -2], lookTo: [0, 1.6, -1] },
      ];
    case 'boss': { // menacing reveal: low angle looking UP, push in, orbit, pull out
      const b = world.boss;
      focusVec.set(b ? b.x : 0, 0, b ? b.z : -18);
      return [
        { dur: 1.7, fov: 66, fovTo: 56, pos: [0, 2, 16], posTo: [5, 5, 11], look: [0, 7, 0], lookTo: [0, 6, 0],
          onStart: () => { hud.cinematicText('THE CONDUCTOR', 'Warden of the Voidline', hexColor(NEON.cyan), 2400); world.shake += 1.2; bus.emit('fx:telegraph', { x: focusVec.x, z: focusVec.z, radius: 6, dur: 1.6, color: NEON.cyan }); bus.emit('fx:death', { x: focusVec.x, z: focusVec.z, color: NEON.cyan, big: true }); audio.play('crash', 0.7); } },
        { dur: 1.3, fov: 56, pos: [5, 5, 11], posTo: [-7, 8, 13], look: [0, 6, 0], lookTo: [0, 5, 0] },
        { dur: 0.9, fov: 56, fovTo: 52, ease: easeOut, pos: [-7, 8, 13], posTo: [0, 20, 22], look: [0, 5, 0], lookTo: [0, 2, 0] },
      ];
    }
    case 'win': // triumph: detonation + slow orbit + rise
      focusVec.set(world.bossDeathX, 0, world.bossDeathZ);
      return [
        { dur: 1.9, fov: 50, pos: [8, 4, 9], posTo: [-9, 6, 11], look: [0, 3, 0], lookTo: [0, 3, 0],
          onStart: () => { hud.cinematicText('VICTORY', 'The Conductor is silenced', hexColor(NEON.green), 2700); world.shake += 1.6; bus.emit('fx:crash', { x: world.bossDeathX, z: world.bossDeathZ, hot: false }); bus.emit('fx:death', { x: world.bossDeathX, z: world.bossDeathZ, color: NEON.cyan, big: true }); bus.emit('fx:death', { x: world.bossDeathX + 2, z: world.bossDeathZ - 2, color: NEON.green, big: true }); audio.play('kill', 0.9); } },
        { dur: 1.6, fov: 50, fovTo: 54, ease: easeOut, pos: [-9, 6, 11], posTo: [0, 28, 24], look: [0, 3, 0], lookTo: [0, 2, 0] },
      ];
    case 'death':
    default: // dramatic low push onto the fallen hero, then a slow drift up
      focusVec.set(pl.x, 0, pl.z);
      return [
        { dur: 1.6, fov: 54, fovTo: 38, ease: easeOut, pos: [0, 26, 20], posTo: [3, 3, 6], look: [0, 1.4, 0], lookTo: [0, 1, 0],
          onStart: () => { hud.cinematicText('YOU FELL', 'Depth ' + world.run.depth, hexColor(NEON.red), 2200); world.shake += 1; } },
        { dur: 1.1, fov: 38, fovTo: 44, ease: easeOut, pos: [3, 3, 6], posTo: [6, 5, 9], look: [0, 1, 0], lookTo: [0, 1.3, 0] },
      ];
  }
}

// ---- input ----------------------------------------------------------------
// Movement is CAMERA-RELATIVE (W = into the screen) so it stays intuitive as the player
// rotates the chase cam. It writes one channel (world.setMove); when no move key is held we
// stop writing so tests/AI can drive setMove directly without a per-frame poll clobbering them.
let kbMoveActive = false;
const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
function applyMove(): void {
  if (!world.player) return;
  let x = 0, z = 0;
  if (keys.has('KeyW')) z -= 1;
  if (keys.has('KeyS')) z += 1;
  if (keys.has('KeyA')) x -= 1;
  if (keys.has('KeyD')) x += 1;
  if (x === 0 && z === 0) { world.setMove(0, 0); kbMoveActive = false; return; }
  const yaw = view.camYaw; // rotate the input by the camera yaw
  world.setMove(x * Math.cos(yaw) - z * Math.sin(yaw), x * Math.sin(yaw) + z * Math.cos(yaw));
}
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (MOVE_KEYS.includes(e.code)) { kbMoveActive = true; applyMove(); }
  if (mode === 'cutscene') { cine.skip(); return; }
  if (mode !== 'playing') return;
  if (e.code === 'Digit1') world.castCard(0);
  if (e.code === 'Digit2') world.castCard(1);
  if (e.code === 'Digit3') world.castCard(2);
  if (e.code === 'Digit4') world.castCard(3);
  if (e.code === 'Space') { e.preventDefault(); castByKind('dash'); }
});
window.addEventListener('keyup', (e) => { keys.delete(e.code); if (MOVE_KEYS.includes(e.code)) applyMove(); });
window.addEventListener('blur', () => { keys.clear(); kbMoveActive = false; if (world.player) world.setMove(0, 0); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => { e.preventDefault(); view.zoomBy(e.deltaY > 0 ? 0.12 : -0.12); }, { passive: false });
canvas.addEventListener('mousedown', (e) => {
  audio.resume();
  if (mode === 'cutscene') { cine.skip(); return; }
  if (mode !== 'playing') return;
  if (e.button === 0) world.castCard(0);
  if (e.button === 2) world.castCard(1);
});
window.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
  const ny = -((e.clientY - r.top) / r.height) * 2 + 1;
  ray.setFromCamera(new THREE.Vector2(nx, ny), view.camera);
  if (ray.ray.intersectPlane(groundPlane, hitPoint) && world.player) world.setAim(hitPoint.x, hitPoint.z);
});

function castByKind(kind: string): void {
  // loadout card ids equal their kind (strike/bolt/arc/dash/...), so match by id
  const i = world.player.cards.findIndex((c) => c.id === kind);
  if (i >= 0) world.castCard(i);
}

// ---- damage floaters ------------------------------------------------------
const floatScratch = new THREE.Vector3();
bus.on('damage', (p) => {
  const v = floatScratch.set(p.x, 1.4, p.z).project(view.camera);
  const sx = (v.x * 0.5 + 0.5) * canvas.clientWidth;
  const sy = (-v.y * 0.5 + 0.5) * canvas.clientHeight;
  const text = p.heal ? `+${p.amount}` : `-${p.amount}`;
  const color = p.heal ? '#53ff8a' : p.crit ? '#ffb340' : '#ff5a6e';
  hud.floater(sx, sy, text, color);
});
bus.on('sfx', (p) => audio.play(p.name, p.vol ?? 1));
bus.on('fx:cast', (p) => { if (tutorial.active) { if (p.kind === 'dash') tut.dashed = true; else tut.attacked = true; } });
bus.on('tempo:crash', (p) => hud.flash(p.hot ? '#ff7a3a' : '#bfeaff', 0.5)); // impact flash on a crash
bus.on('player:dead', () => hud.flash('#ff3b5c', 0.55));

// ---- loop -----------------------------------------------------------------
let last = performance.now();
let frameMsEMA = 16;
let titleT = 0;
function titleOrbit(dt: number): void {
  titleT += dt;
  const a = titleT * 0.1;
  // close, low hero-feature orbit: the chrome hero is the subject, the reflective floor +
  // neon skyline + megastructure sweep behind it (replaces the empty far-out boxy orbit).
  const px = world.player.x, pz = world.player.z;
  view.camera.position.set(px + Math.sin(a) * 8.5, 4.2 + Math.sin(titleT * 0.35) * 0.7, pz + Math.cos(a) * 8.5);
  view.camera.lookAt(px, 2.1, pz);
}

function frame(now: number): void {
  const rawMs = now - last;
  const dt = Math.min(0.05, rawMs / 1000); last = now;
  frameMsEMA = frameMsEMA * 0.9 + rawMs * 0.1;
  hudEl.style.display = mode === 'playing' ? 'block' : 'none';
  if (tutorial.active && mode !== 'playing') tutorial.stop(); // never let the prompt linger over a menu
  if (mode === 'playing') {
    // player-steered camera rotation (Q/E or ← →); keep movement aligned as it turns
    const rot = 1.9 * dt;
    if (keys.has('KeyQ') || keys.has('ArrowLeft')) view.rotateCam(rot);
    if (keys.has('KeyE') || keys.has('ArrowRight')) view.rotateCam(-rot);
    if (kbMoveActive) applyMove();
    // hitstop: freeze-frame the sim briefly on crashes / boss death for punch (render stays smooth)
    const simDt = world.hitstop > 0 ? dt * 0.12 : dt;
    if (world.hitstop > 0) world.hitstop = Math.max(0, world.hitstop - dt);
    world.tick(simDt);
    if (!world.player.alive) { if (cutscenesOn) playCutscene('death', () => toEnd(false)); else toEnd(false); }
    else if (world.bossDefeated) { if (cutscenesOn) playCutscene('win', () => toEnd(true)); else toEnd(true); }
    else if (world.playerInPortal()) toDraft();
    hud.update(world);
    if (tutorial.active) {
      const pl = world.player;
      if (Math.hypot(pl.x, pl.z - (ARENA - 9)) > 2.5) tut.moved = true;
      if (Math.abs(view.camYaw) > 0.2) tut.rotated = true;
      tutorial.update({ ...tut, cleared: world.portalOpen });
    }
  } else if (mode === 'cutscene') {
    cine.update(dt);
  }
  // camera ownership: menu/overlay screens use the slow arena orbit (a clean framed
  // backdrop, no cropped hero); cutscene drives its own; otherwise View follows the player.
  const menuMode = mode === 'title' || mode === 'select' || mode === 'draft' || mode === 'gameover' || mode === 'win';
  if (menuMode) { titleOrbit(dt); view.cinematic = true; }
  else view.cinematic = mode === 'cutscene';
  stage.render(dt);
  requestAnimationFrame(frame);
}

// ---- boot -----------------------------------------------------------------
async function boot(): Promise<void> {
  await Promise.all([view.init(), audio.init()]);
  world.startRun('pyre', 12345);          // populate a live tableau behind the title
  mode = 'title';
  view.setCharColor(world.player.char.color);
  view.setBiome(world.biome.fog, world.biome.accent);
  hud.setLoadout(world.player.char.loadout);
  toTitle();
  expose();
  requestAnimationFrame(frame);
}

// ---- test / debug hook ----------------------------------------------------
// a few foes near the hero so the chase cam frames the hero in the lower third (used by the
// tempo-zone scenarios; mirrors how the combat scenario curates its spawn for a representative shot)
function tempoTableau(): void {
  world.enemies = [];
  world.spawnEnemy('darter', -4, 11, false); world.spawnEnemy('brute', 4, 7, false); world.spawnEnemy('caster', 8, 13, false);
}
function scenario(spec: string): string {
  const pl = () => world.player;
  switch (spec) {
    case 'title': toTitle(); break;
    case 'select': toSelect(); break;
    case 'howto': toHowTo(toTitle); break;
    case 'tutorial': startTutorialRun('pyre'); break;
    case 'combat': startRun('pyre');
      world.spawnEnemy('darter', -5, 12, false); world.spawnEnemy('brute', 3, 8, false);
      world.spawnEnemy('caster', 9, 14, false); world.spawnEnemy('darter', -10, 15, false); hud.update(world); break;
    case 'swarm': startRun('pyre'); world.enemies = [];
      // a wall of foes AHEAD of the hero (not on top of them) so the swarm reads and the hero stays visible
      for (let i = 0; i < 14; i++) world.spawnEnemy('darter', ((i % 7) - 3) * 6, -2 - Math.floor(i / 7) * 8, i % 6 === 0); hud.update(world); break;
    case 'boss': startRun('pyre'); world.enterRoom(BOSS_DEPTH); world.player.z = world.boss ? world.boss.z + 8 : -6; mode = 'playing'; view.setBiome(world.biome.fog, world.biome.accent); hud.update(world); break;
    // tempo-zone scenarios: spawn a few foes NEAR the hero (like combat) so the chase cam frames
    // the hero in the lower third instead of stretching to far foes and cropping the hero at the edge.
    case 'crit': startRun('pyre'); tempoTableau(); pl().tempo = 97; pl().tempoStall = 99; hud.update(world); break;
    case 'cold': startRun('pyre'); tempoTableau(); pl().tempo = 6; pl().tempoStall = 99; hud.update(world); break;
    case 'hot': startRun('pyre'); tempoTableau(); pl().tempo = 82; pl().tempoStall = 99; hud.update(world); break;
    case 'draft': startRun('pyre'); world.enemies = []; world.portalOpen = true; toDraft(); break;
    case 'gameover': startRun('pyre'); world.run.kills = 23; world.run.depth = 3; world.run.relics.push('razor', 'metronome');
      pl().iframe = 0; pl().hp = 1; world.damagePlayer(999); if (!pl().alive) toEnd(false); break;
    case 'win': startRun('pyre'); world.run.kills = 71; world.run.relics.push('razor', 'iron', 'overcharge');
      world.bossDefeated = true; toEnd(true); break;
    case 'cutdive': startRun('pyre'); playCutscene('dive', () => { mode = 'playing'; }); break;
    case 'cutboss': startRun('pyre'); world.enterRoom(BOSS_DEPTH); view.setBiome(world.biome.fog, world.biome.accent); playCutscene('boss', () => { mode = 'playing'; }); break;
    case 'cutwin': startRun('pyre'); world.bossDeathX = 0; world.bossDeathZ = -18; playCutscene('win', () => toEnd(true)); break;
    case 'cutdeath': startRun('pyre'); pl().iframe = 0; world.damagePlayer(9999); playCutscene('death', () => toEnd(false)); break;
    default: return `unknown scenario: ${spec}`;
  }
  return spec;
}

function expose(): void {
  (window as any).__game = {
    world, bus, view, stage, audio,
    version: '0.2.0', lowfx: LOWFX,
    get mode() { return mode; },
    start: startRun, toTitle, toSelect, chooseRelic,
    showHowTo: () => toHowTo(toTitle),
    scenario, scenarios: () => ['title', 'select', 'howto', 'tutorial', 'combat', 'swarm', 'boss', 'crit', 'cold', 'hot', 'draft', 'gameover', 'win', 'cutdive', 'cutboss', 'cutwin', 'cutdeath'],
    cine, get cutscenes() { return cutscenesOn; }, setCutscenes: (b: boolean) => { cutscenesOn = b; },
    setMove: (x: number, z: number) => world.setMove(x, z),
    aimAt: (x: number, z: number) => world.setAim(x, z),
    cast: (i: number) => world.castCard(i),
    rotateCam: (d: number) => view.rotateCam(d),
    get camYaw() { return view.camYaw; },
    frameStats: () => ({
      ...stage.frameStats(),
      ...view.counts(),
      mode, depth: world.run.depth, enemies: world.aliveCount(),
      frameMs: Math.round(frameMsEMA * 10) / 10,
      projectiles: world.projectiles.length,
      activeProj: world.projectiles.reduce((n, p) => n + (p.active ? 1 : 0), 0),
      shake: Math.round(world.shake * 100) / 100,
      pickups: world.pickups.length,
      hp: world.player?.hp ?? 0, maxHp: world.player?.maxHp ?? 0, tempo: world.player?.tempo ?? 0,
      kills: world.run.kills,
    }),
  };
}

boot();
