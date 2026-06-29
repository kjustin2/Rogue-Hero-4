import "@fontsource/cinzel/600.css";
import "@fontsource/cinzel/700.css";
import "@fontsource/rajdhani/500.css";
import "@fontsource/rajdhani/600.css";
import "@fontsource/rajdhani/700.css";
import "./style.css";

import * as THREE from "three";
import { EventBus } from "./core/events";
import { Rng } from "./core/rng";
import { Input } from "./core/input";
import { Stage } from "./render/stage";
import { Particles } from "./render/particles";
import { SwordTrail } from "./render/trail";
import { Telegraphs } from "./render/telegraphs";
import { Floaters } from "./render/floaters";
import { FpsCamera } from "./render/fpsCamera";
import { Sfx } from "./audio/sfx";
import { Music } from "./audio/music";
import { Level, PLAYER_SPAWN, ARENA_BLEND_Z, BOSS_ANCHOR } from "./game/level";
import { Player } from "./game/player";
import { Combat } from "./game/combat";
import { EnemyManager, type EnemyKind } from "./game/enemies";
import { Projectiles } from "./game/projectiles";
import { Pickups } from "./game/pickups";
import { Boss } from "./game/boss";
import { comboSelfCheck } from "./game/combos";
import { Hud } from "./ui/hud";
import { Menus } from "./ui/menus";
import type { Ctx } from "./game/ctx";

const lowfx = new URLSearchParams(location.search).has("lowfx");
type State = "title" | "playing" | "paused" | "dead" | "victory";

// --------------------------------------------------------------------- boot
const canvas = document.getElementById("game") as HTMLCanvasElement;

const ctx = {} as Ctx;
ctx.events = new EventBus();
ctx.rng = new Rng(20260629);
ctx.stage = new Stage(canvas);
if (lowfx) ctx.stage.applyQuality("low");
ctx.input = new Input(canvas);
ctx.fx = new Particles(ctx.stage.scene);
ctx.trail = new SwordTrail(ctx.stage.scene);
ctx.tele = new Telegraphs(ctx.stage.scene);
ctx.floaters = new Floaters(ctx.stage.camera);
ctx.sfx = new Sfx(ctx.events);
ctx.music = new Music();
ctx.cam = new FpsCamera(ctx);
ctx.level = new Level(ctx);
ctx.combat = new Combat(ctx);
ctx.enemies = new EnemyManager(ctx);
ctx.projectiles = new Projectiles(ctx);
ctx.pickups = new Pickups(ctx);
ctx.player = new Player(ctx);
ctx.boss = null;
ctx.playing = false;
ctx.hitstop = 0;

// The weapon viewmodel is parented to the camera, so the camera must live in the
// scene graph for its children to render.
ctx.stage.scene.add(ctx.stage.camera);

ctx.level.build();
const hud = new Hud(ctx);
const menus = new Menus(ctx);

// --------------------------------------------------------------------- state
let state: State = "title";
let runTime = 0;
let kills = 0;
let streak = 0;
let streakTimer = 0;
let bossSpawned = false;
let triggered: boolean[] = ctx.level.gates.map(() => false);
let victoryQueued = 0;
const CINE_LEN = 3.4; // boss-intro cutscene length
let cineT = 0; // boss-intro cutscene timer (>0 = cutscene running)
let cineBeatT = 0; // ticks down to fire the next scripted ripple/beam beat
const cineTarget = new THREE.Vector3();
const BOSS_TEAL = 0x4fe0d0; // matches Boss.hitColor

ctx.events.on("KILL", (e) => {
  kills++;
  streak++;
  streakTimer = 3;
  ctx.events.emit("KILL_STREAK", { count: streak });
  ctx.pickups.maybeDrop(e.x, e.z);
});
ctx.events.on("PLAYER_HIT", () => { streak = 0; });
ctx.events.on("PLAYER_DIED", () => setState("dead"));
ctx.events.on("BOSS_DEFEATED", () => {
  ctx.events.emit("RUN_VICTORY", {});
  ctx.sfx.bossDeath();
  ctx.music.silence();
  victoryQueued = 1.8; // let the death animation play, then show victory
});

function setState(s: State): void {
  state = s;
  ctx.playing = s === "playing";
  if (s === "title") {
    ctx.stage.setLowCost(true);
    ctx.input.unlockPointer();
    hud.setVisible(false);
    ctx.music.menu();
    menus.showTitle(() => { unlockAudio(); startRun(); });
  } else if (s === "playing") {
    ctx.stage.setLowCost(false);
    menus.clear();
    hud.setVisible(true);
    ctx.input.lockPointer();
  } else if (s === "paused") {
    ctx.input.unlockPointer();
    menus.showPause(() => { ctx.input.lockPointer(); setState("playing"); }, () => setState("title"));
  } else if (s === "dead") {
    ctx.input.unlockPointer();
    hud.setVisible(false);
    ctx.music.silence();
    menus.showDead({ time: runTime, kills }, () => startRun(), () => setState("title"));
  } else if (s === "victory") {
    ctx.input.unlockPointer();
    hud.setVisible(false);
    ctx.music.menu();
    menus.showVictory({ time: runTime, kills }, () => startRun());
  }
}

function startRun(): void {
  ctx.rng.reseed(20260629);
  ctx.player.reset(PLAYER_SPAWN);
  ctx.cam.yaw = Math.PI;
  ctx.cam.pitch = 0;
  ctx.level.reset();
  ctx.enemies.clear();
  ctx.projectiles.clear();
  ctx.pickups.clear();
  ctx.hitstop = 0;
  if (ctx.boss) { ctx.boss.dispose(); ctx.boss = null; }
  triggered = ctx.level.gates.map(() => false);
  bossSpawned = false;
  victoryQueued = 0;
  cineT = 0;
  ctx.player.frozen = false;
  ctx.cam.setCinematic(false);
  runTime = 0;
  kills = 0;
  streak = 0;
  ctx.music.combat(1, false);
  setState("playing");
}

function unlockAudio(): void {
  ctx.sfx.resume();
  ctx.music.unlock();
}

// re-lock pointer when the player clicks back into the game
canvas.addEventListener("click", () => {
  if (state === "playing" && !ctx.input.pointerLocked) { unlockAudio(); ctx.input.lockPointer(); }
});

// --------------------------------------------------------------------- flow
function updatePlaying(dt: number): void {
  runTime += dt;
  if (streakTimer > 0) { streakTimer -= dt; if (streakTimer <= 0) streak = 0; }

  // pause toggle
  if (ctx.input.actionPressed("pause") || ctx.input.pauseEdgeRaw()) { setState("paused"); return; }

  // boss-intro cutscene takes over control while it runs
  if (cineT > 0) { updateBossCutscene(dt); return; }

  ctx.player.update(dt);
  ctx.enemies.update(dt);
  if (ctx.boss) ctx.boss.tick(dt);
  ctx.projectiles.update(dt);
  ctx.pickups.update(dt);

  // wave gates: trigger the next sealed gate's wave, open it when cleared
  const idx = ctx.level.gates.findIndex((g) => !g.open);
  if (idx >= 0) {
    const g = ctx.level.gates[idx];
    if (!triggered[idx] && ctx.player.pos.z > g.triggerZ) {
      ctx.enemies.spawnWave(idx);
      triggered[idx] = true;
      hud.showBanner("RIFT-BORN", 0xff5ea0);
      ctx.sfx.bossIntroSting();
    } else if (triggered[idx] && ctx.enemies.aliveCount() === 0) {
      ctx.level.openGate(idx);
      hud.showBanner("WAY OPEN", 0x8affd0);
      ctx.sfx.critical();
    }
  }

  // boss spawns when the path is fully open and the player steps into the arena
  if (!bossSpawned && ctx.level.gates.every((g) => g.open) && ctx.level.inArena(ctx.player.pos.z)) {
    ctx.boss = new Boss(ctx);
    bossSpawned = true;
    startBossCutscene("Rift Warden");
  }

  if (victoryQueued > 0) {
    victoryQueued -= dt;
    if (victoryQueued <= 0) setState("victory");
  }
}

// --------------------------------------------------------------------- boss cutscene
// A short cinematic when a boss rises: freeze the player, swing the camera to frame the
// boss as it rises (zoom-in FOV + shake), reveal its name, then hand control back.
// Reusable for any boss; currently the Rift Warden is the only one.
function startBossCutscene(name: string): void {
  cineT = CINE_LEN;
  cineBeatT = 0;
  ctx.player.frozen = true;
  ctx.cam.setCinematic(true);
  ctx.events.emit("BOSS_INTRO", { name });
  ctx.music.boss(1);
  ctx.sfx.bossRoar();
  ctx.cam.addTrauma(0.45);
  // an arena-wide shockwave the instant the rift tears open
  ctx.fx.ring(BOSS_ANCHOR.x, BOSS_ANCHOR.z, { radius: 26, color: BOSS_TEAL, duration: 0.9, y: 0.2, startRadius: 1 });
  hud.showBanner(name.toUpperCase(), 0x9ff0e4);
}

function updateBossCutscene(dt: number): void {
  cineT -= dt;
  const k = Math.min(1, (CINE_LEN - cineT) / CINE_LEN); // 0→1 as the boss rises
  if (ctx.boss) {
    ctx.boss.tick(dt); // keep rising
    ctx.boss.coreWorld(cineTarget);
    ctx.cam.setCinematic(true, cineTarget);
  }
  // scripted beats: rings ripple outward + soul-fire pillars erupt around the dais,
  // intensifying as the Warden rises — the cutscene now builds instead of just waiting.
  cineBeatT -= dt;
  if (cineBeatT <= 0) {
    cineBeatT = 0.4;
    const bx = BOSS_ANCHOR.x, bz = BOSS_ANCHOR.z;
    ctx.fx.ring(bx, bz, { radius: 7 + k * 16, color: BOSS_TEAL, duration: 0.7, y: 0.2, startRadius: 1 });
    const n = 2 + Math.round(k * 3);
    for (let i = 0; i < n; i++) {
      const a = ctx.rng.range(0, Math.PI * 2);
      const r = 3.5 + ctx.rng.range(0, 6);
      ctx.fx.beam(bx + Math.cos(a) * r, bz + Math.sin(a) * r, i % 2 ? BOSS_TEAL : 0xffffff);
    }
    ctx.fx.burst({ x: bx, y: 1, z: bz, count: 14 + Math.round(k * 16), color: [BOSS_TEAL, 0xffffff], speed: [4, 12], up: 1.4, vertical: 0.3, life: [0.4, 1.0] });
  }
  // rhythmic shake while it rises sells the weight, harder near the climax
  if (ctx.rng.next() < 0.08 + k * 0.12) ctx.cam.addTrauma(0.12 + k * 0.16);
  // skippable with any attack/dodge input
  if (ctx.input.actionPressed("dash") || ctx.input.actionPressed("light")
    || ctx.input.actionPressed("heavy") || ctx.input.actionPressed("bolt")) cineT = 0;
  if (cineT <= 0) endBossCutscene();
}

function endBossCutscene(): void {
  cineT = 0;
  ctx.player.frozen = false;
  ctx.cam.setCinematic(false);
  ctx.cam.addTrauma(0.5);
  ctx.stage.punch(0.4);
  ctx.sfx.bossRoar();
}

// --------------------------------------------------------------------- loop
function frame(dt: number): void {
  // hit-stop: briefly crunch the frame dt for impact (decremented in real time)
  if (ctx.hitstop > 0) { ctx.hitstop = Math.max(0, ctx.hitstop - dt); dt *= 0.08; }

  ctx.input.pollGamepad();
  if (state === "playing") updatePlaying(dt);

  ctx.cam.update(dt, state === "playing" ? ctx.player.moveAmount : 0);
  ctx.level.update(dt);
  ctx.fx.update(dt);
  ctx.tele.update(dt);
  ctx.music.update(dt);
  ctx.stage.update(dt);
  if (state === "playing" || state === "paused") hud.update(dt);
  ctx.stage.render(dt);
  ctx.input.endFrame();
}

let last = performance.now();
ctx.stage.renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  frame(dt);
});

// --------------------------------------------------------------------- scenarios + debug seam
function scenario(name: string): void {
  startRun();
  if (name.startsWith("boss")) {
    for (let i = 0; i < ctx.level.gates.length; i++) { ctx.level.openGate(i); triggered[i] = true; }
    ctx.enemies.clear();
    ctx.player.pos.set(0, 0, ARENA_BLEND_Z + 6);
  } else if (name.startsWith("wave")) {
    ctx.enemies.spawnWave(0);
    triggered[0] = true;
  } else if (name === "win") {
    setState("victory");
  } else if (name === "lose") {
    setState("dead");
  }
}

const w = window as unknown as Record<string, unknown>;
w.__rh4 = ctx;
w.__rh4state = () => state;
w.__rh4debug = {
  scenario,
  start: startRun,
  setState: (s: State) => setState(s),
  checkCombos: comboSelfCheck,
  spawn: (k: EnemyKind, x: number, z: number) => ctx.enemies.spawn(k, x, z),
  stats: () => ({ time: runTime, kills, state, enemies: ctx.enemies.aliveCount(), bossHp: ctx.boss?.hp ?? null }),
  // deterministic stepping for headless tests (rAF is suspended in a hidden window)
  tick: (dt = 0.033) => frame(dt),
  frames: (n: number, dt = 0.033) => { for (let i = 0; i < n; i++) frame(dt); },
  god: (on: boolean) => { ctx.player.god = on; },
  cineActive: () => cineT > 0,
  skipCutscene: () => { if (cineT > 0) endBossCutscene(); },
};

// --------------------------------------------------------------------- finish boot
ctx.stage.warmUp();
setState("title");

function hideLoader(): void {
  const loader = document.getElementById("rift-loader");
  const fill = loader?.querySelector(".rl-bar-fill") as HTMLElement | null;
  if (fill) fill.style.width = "100%";
  loader?.classList.add("rl-done");
}
if (document.fonts?.ready) document.fonts.ready.then(hideLoader); else hideLoader();
setTimeout(hideLoader, 1500);
