import * as THREE from 'three';
import { Bus } from './bus';
import { World } from './sim/world';
import { View } from './render/view';
import { Stage } from './render/stage';
import { Audio } from './audio';
import { Hud } from './hud';
import { Cinematic, easeOut, type Shot } from './render/cinematic';
import { CHARACTERS, BOSS_DEPTH, NEON } from './content';
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
interface Meta { unlocked: string[]; runs: number; bestDepth: number; kills: number; }
const DEFAULT_META: Meta = { unlocked: [], runs: 0, bestDepth: 0, kills: 0 };
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
function toTitle(): void { mode = 'title'; hud.showTitle(toSelect); }
function toSelect(): void { mode = 'select'; hud.showSelect(unlockedSet(), beginRun, toTitle); }

// core run setup (no cutscene) — also the path scenarios use for instant state jumps
function startRun(charId: string): void {
  lastChar = CHARACTERS.find((c) => c.id === charId) ? charId : 'pyre';
  world.startRun(lastChar);
  view.setCharColor(world.player.char.color);
  view.setBiome(world.biome.fog, world.biome.accent);
  hud.setLoadout(world.player.char.loadout);
  hud.hideOverlay();
  mode = 'playing';
  audio.resume(); audio.startMusic();
}

// real entry from the menu / retry — startRun + the descent cutscene
function beginRun(charId: string): void {
  startRun(charId);
  playCutscene('dive', () => { mode = 'playing'; });
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
    case 'dive':
      focusVec.set(pl.x, 0, pl.z);
      return [{
        dur: 1.5, fov: 38, fovTo: 52, ease: easeOut,
        pos: [0, 62, 3], posTo: [0, 30, 22], look: [0, 0, -3], lookTo: [0, 1.5, -3],
        onStart: () => { hud.cinematicText('DESCENDING', world.biome.name, hexColor(world.biome.accent), 1500); audio.play('dash', 0.5); },
      }];
    case 'boss': {
      const b = world.boss;
      focusVec.set(b ? b.x : 0, 0, b ? b.z : -(/* fallback */ 18));
      return [
        { dur: 1.7, fov: 60, fovTo: 54, pos: [0, 2.5, 15], posTo: [3, 8, 18], look: [0, 5, 0], lookTo: [0, 4, 0],
          onStart: () => { hud.cinematicText('THE CONDUCTOR', 'Warden of the Voidline', hexColor(NEON.cyan), 2300); world.shake += 1; audio.play('crash', 0.7); } },
        { dur: 1.0, fov: 54, fovTo: 52, pos: [3, 8, 18], posTo: [0, 22, 24], look: [0, 4, 0], lookTo: [0, 2, 0], ease: easeOut },
      ];
    }
    case 'win':
      focusVec.set(world.bossDeathX, 0, world.bossDeathZ);
      return [
        { dur: 1.9, fov: 50, pos: [7, 5, 10], posTo: [-8, 7, 12], look: [0, 3, 0], lookTo: [0, 3, 0],
          onStart: () => { hud.cinematicText('VOIDLINE BROKEN', 'The Conductor is silenced', hexColor(NEON.cyan), 2700); world.shake += 1.4; bus.emit('fx:crash', { x: world.bossDeathX, z: world.bossDeathZ, hot: false }); audio.play('kill', 0.9); } },
        { dur: 1.6, fov: 50, fovTo: 52, pos: [-8, 7, 12], posTo: [0, 30, 26], look: [0, 3, 0], lookTo: [0, 2, 0], ease: easeOut },
      ];
    case 'death':
    default:
      focusVec.set(pl.x, 0, pl.z);
      return [
        { dur: 1.5, fov: 52, fovTo: 40, pos: [0, 30, 22], posTo: [3.5, 4, 7.5], look: [0, 1.4, 0], lookTo: [0, 1.2, 0],
          onStart: () => { hud.cinematicText('YOU FELL', '', hexColor(NEON.red), 2000); world.shake += 1; } },
        { dur: 0.9, fov: 40, pos: [3.5, 4, 7.5], posTo: [3.5, 4, 7.5], look: [0, 1.2, 0], lookTo: [0, 1.2, 0] },
      ];
  }
}

// ---- input ----------------------------------------------------------------
// Movement lives in one channel (world.setMove): keyboard writes it on key events,
// and tests/AI can write it directly without a per-frame poll clobbering them.
function syncMove(): void {
  let x = 0, z = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) z -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) z += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  if (world.player) world.setMove(x, z);
}
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  syncMove();
  if (mode === 'cutscene') { cine.skip(); return; }
  if (mode !== 'playing') return;
  if (e.code === 'Digit1') world.castCard(0);
  if (e.code === 'Digit2') world.castCard(1);
  if (e.code === 'Digit3') world.castCard(2);
  if (e.code === 'Digit4') world.castCard(3);
  if (e.code === 'Space') { e.preventDefault(); castByKind('dash'); }
});
window.addEventListener('keyup', (e) => { keys.delete(e.code); syncMove(); });
window.addEventListener('blur', () => { keys.clear(); if (world.player) world.setMove(0, 0); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
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

// ---- loop -----------------------------------------------------------------
let last = performance.now();
let frameMsEMA = 16;
let titleT = 0;
function titleOrbit(dt: number): void {
  titleT += dt;
  const a = titleT * 0.16;
  view.camera.position.set(Math.sin(a) * 30, 23 + Math.sin(titleT * 0.4) * 3, Math.cos(a) * 30);
  view.camera.lookAt(0, 2.5, 0);
}

function frame(now: number): void {
  const rawMs = now - last;
  const dt = Math.min(0.05, rawMs / 1000); last = now;
  frameMsEMA = frameMsEMA * 0.9 + rawMs * 0.1;
  hudEl.style.display = mode === 'playing' ? 'block' : 'none';
  if (mode === 'playing') {
    // hitstop: freeze-frame the sim briefly on crashes / boss death for punch (render stays smooth)
    const simDt = world.hitstop > 0 ? dt * 0.12 : dt;
    if (world.hitstop > 0) world.hitstop = Math.max(0, world.hitstop - dt);
    world.tick(simDt);
    if (!world.player.alive) { if (cutscenesOn) playCutscene('death', () => toEnd(false)); else toEnd(false); }
    else if (world.bossDefeated) { if (cutscenesOn) playCutscene('win', () => toEnd(true)); else toEnd(true); }
    else if (world.playerInPortal()) toDraft();
    hud.update(world);
  } else if (mode === 'cutscene') {
    cine.update(dt);
  }
  // camera ownership: cutscene / title orbit drive it; otherwise View follows the player
  if (mode === 'title') { titleOrbit(dt); view.cinematic = true; }
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
function scenario(spec: string): string {
  const pl = () => world.player;
  switch (spec) {
    case 'title': toTitle(); break;
    case 'select': toSelect(); break;
    case 'combat': startRun('pyre'); break;
    case 'swarm': startRun('pyre'); for (let i = 0; i < 10; i++) world.spawnEnemy('darter', (i - 5) * 3, -10, false); hud.update(world); break;
    case 'boss': startRun('pyre'); world.enterRoom(BOSS_DEPTH); mode = 'playing'; view.setBiome(world.biome.fog, world.biome.accent); hud.update(world); break;
    case 'crit': startRun('pyre'); pl().tempo = 95; hud.update(world); break;
    case 'cold': startRun('pyre'); pl().tempo = 6; hud.update(world); break;
    case 'hot': startRun('pyre'); pl().tempo = 84; hud.update(world); break;
    case 'draft': startRun('pyre'); world.enemies = []; world.portalOpen = true; toDraft(); break;
    case 'gameover': startRun('pyre'); pl().iframe = 0; pl().hp = 1; world.damagePlayer(999); if (!pl().alive) toEnd(false); break;
    case 'win': startRun('pyre'); world.bossDefeated = true; toEnd(true); break;
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
    scenario, scenarios: () => ['title', 'select', 'combat', 'swarm', 'boss', 'crit', 'cold', 'hot', 'draft', 'gameover', 'win', 'cutdive', 'cutboss', 'cutwin', 'cutdeath'],
    cine, get cutscenes() { return cutscenesOn; }, setCutscenes: (b: boolean) => { cutscenesOn = b; },
    setMove: (x: number, z: number) => world.setMove(x, z),
    aimAt: (x: number, z: number) => world.setAim(x, z),
    cast: (i: number) => world.castCard(i),
    frameStats: () => ({
      ...stage.frameStats(),
      ...view.counts(),
      mode, depth: world.run.depth, enemies: world.aliveCount(),
      frameMs: Math.round(frameMsEMA * 10) / 10,
      projectiles: world.projectiles.length,
      activeProj: world.projectiles.reduce((n, p) => n + (p.active ? 1 : 0), 0),
      pickups: world.pickups.length,
      hp: world.player?.hp ?? 0, maxHp: world.player?.maxHp ?? 0, tempo: world.player?.tempo ?? 0,
      kills: world.run.kills,
    }),
  };
}

boot();
