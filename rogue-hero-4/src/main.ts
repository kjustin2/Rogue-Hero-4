import * as THREE from 'three';
import { Bus } from './bus';
import { World } from './sim/world';
import { View } from './render/view';
import { Stage } from './render/stage';
import { Audio } from './audio';
import { Hud } from './hud';
import { CHARACTERS, BOSS_DEPTH } from './content';
import type { GameMode } from './types';

const params = new URLSearchParams(location.search);
const LOWFX = params.has('lowfx') || params.has('nofx');

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const hudEl = document.getElementById('hud')!;
const overlayEl = document.getElementById('overlay')!;

const bus = new Bus();
const world = new World(bus);
const view = new View(world, bus, LOWFX);
const stage = new Stage(canvas, view, LOWFX);
const audio = new Audio();
const hud = new Hud(hudEl, overlayEl);

let mode: GameMode = 'title';
let lastChar = 'pyre';
const ray = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitPoint = new THREE.Vector3();
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
function toSelect(): void { mode = 'select'; hud.showSelect(unlockedSet(), startRun, toTitle); }

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

function toDraft(): void {
  world.rollDraft(); mode = 'draft';
  hud.showDraft(world.draftOptions, (id) => {
    world.applyRelic(id); world.nextRoom();
    view.setBiome(world.biome.fog, world.biome.accent);
    hud.hideOverlay(); mode = 'playing';
  });
}

function toEnd(win: boolean): void {
  mode = win ? 'win' : 'gameover';
  recordRunEnd();
  audio.setMusic(false);
  hud.showEnd(win, world, () => startRun(lastChar), toTitle);
}

// ---- input ----------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (mode !== 'playing') return;
  if (e.code === 'Digit1') world.castCard(0);
  if (e.code === 'Digit2') world.castCard(1);
  if (e.code === 'Digit3') world.castCard(2);
  if (e.code === 'Digit4') world.castCard(3);
  if (e.code === 'Space') { e.preventDefault(); castByKind('dash'); }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  audio.resume();
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

function readMoveInput(): void {
  if (mode !== 'playing') return;
  let x = 0, z = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) z -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) z += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  world.setMove(x, z);
}

// ---- damage floaters ------------------------------------------------------
bus.on('damage', (p) => {
  const v = new THREE.Vector3(p.x, 1.4, p.z).project(view.camera);
  const sx = (v.x * 0.5 + 0.5) * canvas.clientWidth;
  const sy = (-v.y * 0.5 + 0.5) * canvas.clientHeight;
  const text = p.heal ? `+${p.amount}` : `-${p.amount}`;
  const color = p.heal ? '#53ff8a' : p.crit ? '#ffb340' : '#ff5a6e';
  hud.floater(sx, sy, text, color);
});
bus.on('sfx', (p) => audio.play(p.name, p.vol ?? 1));

// ---- loop -----------------------------------------------------------------
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  hudEl.style.display = mode === 'playing' ? 'block' : 'none';
  if (mode === 'playing') {
    readMoveInput();
    world.tick(dt);
    if (!world.player.alive) toEnd(false);
    else if (world.bossDefeated) toEnd(true);
    else if (world.playerInPortal()) toDraft();
    hud.update(world);
  }
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
    default: return `unknown scenario: ${spec}`;
  }
  return spec;
}

function expose(): void {
  (window as any).__game = {
    world, bus, view, stage, audio,
    version: '0.2.0', lowfx: LOWFX,
    get mode() { return mode; },
    start: startRun, toTitle, toSelect,
    scenario, scenarios: () => ['title', 'select', 'combat', 'swarm', 'boss', 'crit', 'cold', 'hot', 'draft', 'gameover', 'win'],
    setMove: (x: number, z: number) => world.setMove(x, z),
    aimAt: (x: number, z: number) => world.setAim(x, z),
    cast: (i: number) => world.castCard(i),
    frameStats: () => ({
      ...stage.frameStats(),
      mode, depth: world.run.depth, enemies: world.aliveCount(),
      hp: world.player?.hp ?? 0, tempo: world.player?.tempo ?? 0,
      kills: world.run.kills,
    }),
  };
}

boot();
