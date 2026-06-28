import { Bus } from "./bus.js";
import { mulberry32, range, type RNG } from "./rng.js";
import { classify } from "./weave.js";
import {
  ROAD_HALF, ROAD_LEN, ROAD_START, BOSS_AT, MAX_ACTS, BIOMES, CARDS, CHARACTERS, ENEMIES, NEON, RELICS,
} from "./content.js";
import type {
  CardDef, CardState, EnemyDef, EnemyKind, Enemy, Glyph, Player, Pickup, Projectile, RelicDef,
} from "./types.js";

const clampX = (v: number) => Math.max(-ROAD_HALF, Math.min(ROAD_HALF, v));
const clampZ = (v: number) => Math.max(0, Math.min(ROAD_LEN, v));
const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

export interface Input { mx: number; mz: number; ax: number; az: number; }
interface Encounter { z: number; fired: boolean; }

// The pure, Three.js-free game world. A run is MAX_ACTS roads; each road is a
// forward push down a path, clearing waves, to a boss at the far end. Sim writes;
// renderer/HUD read. All HP changes route through hitEnemy / damagePlayer.
export class World {
  bus: Bus;
  rng: RNG = mulberry32(1);
  seed = 1;
  depth = 1;
  kills = 0;

  player!: Player;
  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  pickups: Pickup[] = [];
  bossEnt?: Enemy;
  private encounters: Encounter[] = [];

  shake = 0;
  hitstop = 0;
  time = 0;

  bossActive = false;
  awaitingDraft = false;
  bossDefeated = false;
  playerDead = false;

  input: Input = { mx: 0, mz: 0, ax: 0, az: 1 };

  constructor(bus: Bus) { this.bus = bus; }

  get biome() { return BIOMES[Math.min(this.depth - 1, BIOMES.length - 1)]; }
  get boss() { return this.bossActive ? this.enemies.find((e) => e.kind === "boss" && e.alive) : undefined; }
  get alive() { return this.enemies.filter((e) => e.alive).length; }
  get progress() { return Math.max(0, Math.min(1, (this.player.z - ROAD_START) / (BOSS_AT - ROAD_START))); }

  start(charId: string, seed: number) {
    this.seed = seed >>> 0;
    this.rng = mulberry32(this.seed);
    this.kills = 0; this.playerDead = false; this.bossDefeated = false;
    const char = CHARACTERS.find((c) => c.id === charId) ?? CHARACTERS[0];
    const cards: CardState[] = char.loadout.map((id) => ({ def: CARDS[id], cd: 0 }));
    this.player = {
      x: 0, z: ROAD_START, angle: Math.PI / 2, hp: char.hp, maxHp: char.hp, speed: char.speed,
      radius: 0.9, char, cards, weave: [], empower: 0, ward: 0, iframe: 0,
      combo: 0, comboTimer: 0, castMult: 1, dashCritArmed: false, relics: new Set(),
    };
    this.enterAct(1);
  }

  enterAct(depth: number) {
    this.depth = depth;
    this.enemies = []; this.projectiles = []; this.pickups = [];
    this.awaitingDraft = false; this.bossActive = false;
    const p = this.player;
    p.x = 0; p.z = ROAD_START; p.angle = Math.PI / 2;
    p.weave.length = 0; p.empower = 0; p.ward = 0; p.iframe = 0.6; p.combo = 0; p.comboTimer = 0;
    for (const c of p.cards) c.cd = 0;
    // dormant boss visible at the far end of the road
    this.bossEnt = this.spawnEnemy("boss", 0, BOSS_AT, false);
    this.bossEnt.dormant = true;
    // encounter lines along the road; each spawns a wave ahead when reached
    this.encounters = [ROAD_LEN * 0.2, ROAD_LEN * 0.38, ROAD_LEN * 0.56, ROAD_LEN * 0.74].map((z) => ({ z, fired: false }));
    // a starter pack right ahead so combat begins immediately (no empty road to walk)
    const starters = 3 + Math.min(depth, 3);
    for (let i = 0; i < starters; i++) {
      this.spawnEnemy(i % 4 === 0 ? "brute" : "darter",
        clampX(range(this.rng, -ROAD_HALF * 0.7, ROAD_HALF * 0.7)),
        clampZ(ROAD_START + range(this.rng, 13, 26)), false);
    }
  }

  private spawnEncounter() {
    const count = Math.min(3 + this.depth * 2, 13);
    const pool: EnemyKind[] = ["darter", "darter"];
    if (this.depth >= 1) pool.push("brute", "caster");
    if (this.depth >= 2) pool.push("splitter", "darter");
    const p = this.player;
    for (let i = 0; i < count; i++) {
      const kind = pool[(this.rng() * pool.length) | 0];
      const x = clampX(range(this.rng, -ROAD_HALF * 0.85, ROAD_HALF * 0.85));
      const z = clampZ(p.z + range(this.rng, 14, 34)); // ahead, down the road
      const elite = this.depth >= 2 && this.rng() < 0.05 * this.depth;
      this.spawnEnemy(kind, x, z, elite);
    }
  }

  spawnEnemy(kind: EnemyKind, x: number, z: number, elite: boolean, hpScale = 1): Enemy {
    const def: EnemyDef = ENEMIES[kind];
    const hp = Math.round(def.hp * (1 + (this.depth - 1) * 0.18) * (elite ? 1.85 : 1) * hpScale);
    const e: Enemy = {
      kind, def, x, z, angle: 0, hp, maxHp: hp, radius: def.radius, elite, alive: true,
      cd: range(this.rng, 0, def.touch || 0.5), lungeCd: range(this.rng, 0.5, 2),
      stun: 0, slow: 0, hitFlash: 0, lunging: 0, lungeDx: 0, lungeDz: 0,
      windup: 0, markX: 0, markZ: 0, phase: 0, patternCd: 2, summonCd: 7, dormant: false,
    };
    this.enemies.push(e);
    return e;
  }

  // ---- frame tick -------------------------------------------------------
  update(dt: number) {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    const simDt = this.hitstop > 0 ? dt * 0.12 : dt;
    this.hitstop = Math.max(0, this.hitstop - dt);
    this.shake = Math.max(0, this.shake - 3 * dt);

    const p = this.player;
    p.iframe = Math.max(0, p.iframe - dt);
    p.ward = Math.max(0, p.ward - dt);
    if (p.comboTimer > 0) { p.comboTimer -= dt; if (p.comboTimer <= 0) p.combo = 0; }
    for (const c of p.cards) c.cd = Math.max(0, c.cd - dt);

    if (!this.playerDead) this.movePlayer(simDt);
    this.updateProjectiles(simDt);
    if (!this.playerDead) this.updateEnemies(simDt);
    this.updatePickups(dt);
    this.checkProgress();
  }

  private movePlayer(simDt: number) {
    const p = this.player;
    let mx = this.input.mx, mz = this.input.mz;
    const ml = Math.hypot(mx, mz);
    if (ml > 1e-3) {
      mx /= ml; mz /= ml;
      const sp = p.speed * (p.relics.has("grease") ? 1.2 : 1) * simDt;
      p.x = clampX(p.x + mx * sp); p.z = clampZ(p.z + mz * sp);
    }
    p.angle = Math.atan2(this.input.az - p.z, this.input.ax - p.x);
  }

  // ---- casting ----------------------------------------------------------
  cast(slot: number) {
    const cs = this.player.cards[slot];
    if (!cs || cs.cd > 0 || this.playerDead) return;
    const p = this.player;
    cs.cd = cs.def.cooldown;
    p.castMult = p.empower > 0 ? 1.6 : 1;
    if (p.empower > 0) p.empower--;
    this.execCard(cs.def);
    p.castMult = 1;
    p.weave.push(cs.def.glyph);
    this.bus.emit("fx:cast", { x: p.x, z: p.z, color: cs.def.color });
    this.bus.emit("sfx", { id: "cast" });
    if (p.weave.length >= 3) this.resolveWeave();
  }

  private execCard(def: CardDef) {
    const p = this.player, ang = p.angle;
    switch (def.kind) {
      case "strike": this.meleeCone(def.range, 0.42, def.damage, 0); this.bus.emit("fx:slash", { x: p.x, z: p.z, angle: ang, color: def.color }); break;
      case "siphon": this.meleeCone(def.range, 0.45, def.damage, 4); this.bus.emit("fx:slash", { x: p.x, z: p.z, angle: ang, color: def.color }); break;
      case "arc":  this.aoe(def.range, def.damage, 0);  this.bus.emit("fx:shock", { x: p.x, z: p.z, radius: def.range, color: def.color }); break;
      case "nova": this.aoe(def.range, def.damage, 2.6); this.bus.emit("fx:shock", { x: p.x, z: p.z, radius: def.range, color: def.color }); break;
      case "bolt": this.fireBolt(def, ang); break;
      case "volley": { const c = def.count ?? 5; for (let k = 0; k < c; k++) this.fireBolt(def, ang + (k - (c - 1) / 2) * 0.13); break; }
      case "dash": this.doDash(def); break;
      case "overload": this.bus.emit("fx:shock", { x: p.x, z: p.z, radius: 5, color: def.color }); break;
    }
  }

  private meleeCone(reach: number, cosHalf: number, base: number, heal: number) {
    const p = this.player;
    for (const e of this.enemies) {
      if (!e.alive || e.dormant) continue;
      const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz);
      if (d > reach + e.radius) continue;
      const nx = d > 1e-3 ? dx / d : Math.cos(p.angle), nz = d > 1e-3 ? dz / d : Math.sin(p.angle);
      if (nx * Math.cos(p.angle) + nz * Math.sin(p.angle) >= cosHalf) {
        this.hitEnemy(e, base, nx, nz);
        if (heal > 0) this.heal(heal);
      }
    }
  }

  private aoe(radius: number, base: number, slow: number) {
    const p = this.player;
    for (const e of this.enemies) {
      if (!e.alive || e.dormant) continue;
      const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz);
      if (d > radius + e.radius) continue;
      const nx = d > 1e-3 ? dx / d : 1, nz = d > 1e-3 ? dz / d : 0;
      this.hitEnemy(e, base, nx, nz);
      if (slow > 0) e.slow = Math.max(e.slow, slow);
    }
  }

  private fireBolt(def: CardDef, ang: number) {
    const p = this.player, empowered = p.castMult > 1;
    let pierce = empowered ? 2 : 0;
    if (empowered && p.relics.has("resonator")) pierce += 2;
    const speed = def.speed ?? 26;
    this.projectiles.push({
      x: p.x, z: p.z, vx: Math.cos(ang) * speed, vz: Math.sin(ang) * speed,
      life: 1.6, radius: 0.55, damage: def.damage * p.castMult, friendly: true,
      pierce, color: def.color, hits: new Set(),
    });
  }

  private doDash(def: CardDef) {
    const p = this.player, ang = p.angle;
    const tx = clampX(p.x + Math.cos(ang) * def.range), tz = clampZ(p.z + Math.sin(ang) * def.range);
    this.bus.emit("fx:dash", { x: p.x, z: p.z, tx, tz, color: def.color });
    this.bus.emit("fx:shock", { x: p.x, z: p.z, radius: 2, color: def.color });
    p.x = tx; p.z = tz;
    p.iframe = Math.max(p.iframe, 0.28 + (p.char.dashIframe ?? 0));
    if (p.char.postDashCrit) p.dashCritArmed = true;
    this.aoe(2.6, def.damage, 0);
    this.bus.emit("fx:shock", { x: tx, z: tz, radius: 2.6, color: def.color });
  }

  private resolveWeave() {
    const p = this.player, g = p.weave;
    const { kind, element } = classify(g);
    let radius: number, dmg: number, empowerGrant = 0, freeze = false, pull = false;
    if (kind === "prismatic") { radius = 9; dmg = 40; empowerGrant = 3; p.ward = Math.max(p.ward, 2); }
    else if (kind === "resonance") {
      radius = 7; dmg = 30; empowerGrant = p.relics.has("metronome") ? 3 : 2;
      if (element === "ember") dmg *= 1.3;
      else if (element === "frost") { freeze = true; p.ward = Math.max(p.ward, 2.5); }
      else if (element === "void") pull = true;
    } else { radius = 5.5; dmg = 18; if (element === "frost") freeze = true; }

    const oc = p.relics.has("overcharge") ? 1.7 : 1;
    const rr = p.relics.has("runaway") ? 1.35 : 1;
    const wp = p.char.weavePower ?? 1;
    radius *= oc * rr;
    dmg *= oc * wp * (1 + (this.depth - 1) * 0.08);
    if (empowerGrant) p.empower = empowerGrant;

    const hot = element !== "frost";
    const color = kind === "prismatic" ? NEON.mag : ({ ember: NEON.ember, frost: NEON.ice, storm: NEON.cyan, void: NEON.violet } as Record<Glyph, number>)[element];
    for (const e of this.enemies) {
      if (!e.alive || e.dormant) continue;
      const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz);
      if (d > radius + e.radius) continue;
      let kx = d > 1e-3 ? dx / d : 1, kz = d > 1e-3 ? dz / d : 0;
      if (pull) { kx = -kx; kz = -kz; }
      this.hitEnemy(e, dmg, kx, kz);
      if (freeze && e.alive) { e.stun = 1.5; e.slow = 2.5; }
    }
    this.shake += kind === "prismatic" ? 1.6 : 1.1;
    this.hitstop = 0.08;
    this.bus.emit("weave:resolve", { kind, hot, x: p.x, z: p.z, color });
    this.bus.emit("fx:crash", { x: p.x, z: p.z, color, hot });
    this.bus.emit("fx:shock", { x: p.x, z: p.z, radius, color });
    this.bus.emit("fx:shake", { power: kind === "prismatic" ? 1.2 : 0.9 });
    this.bus.emit("sfx", { id: "crash" });
    p.weave.length = 0;
  }

  // ---- the one damage funnel -------------------------------------------
  private hitEnemy(e: Enemy, base: number, kx: number, kz: number) {
    const p = this.player;
    if (e.dormant) e.dormant = false; // hitting the boss wakes it
    let mult = p.castMult * (1 + Math.min(p.combo, 12) * 0.015);
    if (p.relics.has("razor")) mult *= 1.18;
    let crit = false;
    if (p.dashCritArmed) { crit = true; mult *= 2; p.dashCritArmed = false; }
    const amount = Math.max(1, Math.round(base * mult));
    e.hp -= amount; e.hitFlash = 0.12; e.stun = Math.max(e.stun, 0.12);
    e.x = clampX(e.x + kx * 0.9); e.z = clampZ(e.z + kz * 0.9);
    p.combo++; p.comboTimer = 1.5;
    this.bus.emit("damage", { x: e.x, z: e.z, amount, crit, heal: false });
    this.bus.emit("fx:hit", { x: e.x, z: e.z, color: e.def.color, crit });
    this.bus.emit("sfx", { id: "hit" });
    if (crit) this.shake += 0.35;
    if (e.hp <= 0) this.onDeath(e);
  }

  private onDeath(e: Enemy) {
    if (!e.alive) return;
    e.alive = false; this.kills++;
    this.hitstop = Math.max(this.hitstop, e.elite ? 0.07 : 0.045);
    this.bus.emit("enemy:killed", { kind: e.kind, x: e.x, z: e.z });
    this.bus.emit("fx:death", { x: e.x, z: e.z, color: e.def.color, big: e.kind === "brute" || e.elite });
    this.bus.emit("sfx", { id: "kill" });
    if (this.player.relics.has("siphon")) this.heal(5);
    if (e.kind === "boss") {
      this.bossActive = false; this.shake += 1.6; this.hitstop = 0.12;
      if (this.depth >= MAX_ACTS) { this.bossDefeated = true; this.bus.emit("run:win", {}); }
      else { this.awaitingDraft = true; this.bus.emit("draft:open", { choices: this.draftChoices() }); }
      return;
    }
    if (e.def.splits) {
      for (let i = 0; i < e.def.splits; i++) {
        const a = this.rng() * Math.PI * 2;
        const child = this.spawnEnemy("darter", clampX(e.x + Math.cos(a) * 1.2), clampZ(e.z + Math.sin(a) * 1.2), false);
        child.hp = Math.round(child.maxHp * 0.6); child.maxHp = child.hp;
      }
    } else if (e.elite || this.rng() < 0.18) {
      this.pickups.push({ x: e.x, z: e.z, heal: 11, life: 16 });
    }
  }

  damagePlayer(amount: number) {
    const p = this.player;
    if (this.playerDead || p.iframe > 0) return;
    let amt = amount * (p.ward > 0 ? 0.7 : 1) * (1 + (this.depth - 1) * 0.16);
    amt *= 1 - (p.char.dmgResist ?? 0);
    amt = Math.max(1, Math.round(amt));
    p.hp -= amt; p.iframe = 0.45;
    if (p.char.hurtWard) p.ward = Math.max(p.ward, p.char.hurtWard);
    this.shake += 0.6;
    this.bus.emit("player:hurt", { amount: amt });
    this.bus.emit("damage", { x: p.x, z: p.z, amount: amt, crit: false, heal: false });
    this.bus.emit("fx:shake", { power: 0.5 });
    this.bus.emit("sfx", { id: "hurt" });
    if (p.hp <= 0) { p.hp = 0; this.playerDead = true; this.bus.emit("run:lose", {}); }
  }

  private heal(n: number) {
    const p = this.player;
    if (p.hp >= p.maxHp) return;
    p.hp = Math.min(p.maxHp, p.hp + n);
    this.bus.emit("damage", { x: p.x, z: p.z, amount: n, crit: false, heal: true });
  }

  // ---- projectiles ------------------------------------------------------
  private updateProjectiles(simDt: number) {
    const p = this.player;
    let n = 0;
    for (const pr of this.projectiles) {
      pr.x += pr.vx * simDt; pr.z += pr.vz * simDt; pr.life -= simDt;
      let dead = pr.life <= 0 || Math.abs(pr.x) > ROAD_HALF + 1 || pr.z < -1 || pr.z > ROAD_LEN + 1;
      if (!dead && pr.friendly) {
        for (const e of this.enemies) {
          if (!e.alive || pr.hits.has(e)) continue;
          if (dist(pr.x, pr.z, e.x, e.z) <= pr.radius + e.radius) {
            const d = Math.hypot(pr.vx, pr.vz) || 1;
            this.hitEnemy(e, pr.damage, pr.vx / d, pr.vz / d);
            pr.hits.add(e);
            if (pr.pierce-- <= 0) { dead = true; break; }
          }
        }
      } else if (!dead && !pr.friendly) {
        if (dist(pr.x, pr.z, p.x, p.z) <= pr.radius + p.radius) { this.damagePlayer(pr.damage); dead = true; }
      }
      if (!dead) this.projectiles[n++] = pr;
    }
    this.projectiles.length = n;
  }

  private enemyShot(e: Enemy, ang: number, speed: number, dmg: number, color = NEON.enemyShot) {
    this.projectiles.push({
      x: e.x, z: e.z, vx: Math.cos(ang) * speed, vz: Math.sin(ang) * speed,
      life: 5, radius: 0.4, damage: dmg, friendly: false, pierce: 0, color, hits: new Set(),
    });
  }

  // ---- enemy AI ---------------------------------------------------------
  private updateEnemies(simDt: number) {
    const p = this.player;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.hitFlash = Math.max(0, e.hitFlash - simDt);
      if (e.dormant) { e.angle = Math.atan2(p.z - e.z, p.x - e.x); continue; } // idle, faces player
      e.stun = Math.max(0, e.stun - simDt);
      e.slow = Math.max(0, e.slow - simDt);
      e.cd = Math.max(0, e.cd - simDt);
      e.lungeCd = Math.max(0, e.lungeCd - simDt);
      if (e.stun > 0) continue;
      const speed = e.def.speed * (e.slow > 0 ? 0.45 : 1) * (1 + (this.depth - 1) * 0.06);
      const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz) || 1;
      e.angle = Math.atan2(dz, dx);

      if (e.kind === "boss") this.bossUpdate(e, simDt, d, dx, dz);
      else if (e.def.ranged) this.rangedUpdate(e, simDt, speed, d, dx, dz);
      else if (e.kind === "brute") this.bruteUpdate(e, simDt, speed, d);
      else this.meleeUpdate(e, simDt, speed, d, dx / d, dz / d);

      if (e.def.touch > 0 && d < e.radius + p.radius + 0.25 && e.cd <= 0) {
        this.damagePlayer(e.def.damage); e.cd = e.def.touch;
      }
    }
    this.separate();
  }

  private meleeUpdate(e: Enemy, simDt: number, speed: number, d: number, ux: number, uz: number) {
    if (e.lunging > 0) {
      e.lunging -= simDt;
      e.x = clampX(e.x + e.lungeDx * e.def.speed * 2.8 * simDt);
      e.z = clampZ(e.z + e.lungeDz * e.def.speed * 2.8 * simDt);
      return;
    }
    if (e.lungeCd <= 0 && d > 3 && d < 16) {
      e.lunging = 0.34; e.lungeDx = ux; e.lungeDz = uz; e.lungeCd = range(this.rng, 1.8, 3);
      this.bus.emit("fx:shock", { x: e.x, z: e.z, radius: 0.6, color: e.def.color });
      return;
    }
    e.x = clampX(e.x + ux * speed * simDt); e.z = clampZ(e.z + uz * speed * simDt);
  }

  private bruteUpdate(e: Enemy, simDt: number, speed: number, d: number) {
    const p = this.player;
    if (e.windup > 0) {
      e.windup -= simDt;
      if (e.windup <= 0) {
        const a = Math.atan2(e.markZ - e.z, e.markX - e.x);
        e.x = clampX(e.x + Math.cos(a) * 2.2); e.z = clampZ(e.z + Math.sin(a) * 2.2);
        if (dist(e.markX, e.markZ, p.x, p.z) < 4.2) this.damagePlayer(Math.round(e.def.damage * 1.6));
        this.shake += 0.8; this.hitstop = Math.max(this.hitstop, 0.04);
        e.lungeCd = range(this.rng, 3, 4.2);
      }
      return;
    }
    if (e.lungeCd <= 0 && d < 6.5) {
      e.windup = 0.7; e.markX = p.x; e.markZ = p.z;
      this.bus.emit("fx:shock", { x: e.markX, z: e.markZ, radius: 4.2, color: e.def.color });
      return;
    }
    const ux = (p.x - e.x) / d, uz = (p.z - e.z) / d;
    e.x = clampX(e.x + ux * speed * simDt); e.z = clampZ(e.z + uz * speed * simDt);
  }

  private rangedUpdate(e: Enemy, simDt: number, speed: number, d: number, dx: number, dz: number) {
    const pref = 13;
    const ux = dx / d, uz = dz / d;
    if (d > pref + 1) { e.x = clampX(e.x + ux * speed * simDt); e.z = clampZ(e.z + uz * speed * simDt); }
    else if (d < pref - 1) { e.x = clampX(e.x - ux * speed * simDt); e.z = clampZ(e.z - uz * speed * simDt); }
    else { e.x = clampX(e.x + -uz * speed * 0.6 * simDt); e.z = clampZ(e.z + ux * speed * 0.6 * simDt); }
    if (e.cd <= 0) {
      const a = Math.atan2(dz, dx);
      for (let k = -1; k <= 1; k++) this.enemyShot(e, a + k * 0.16, 20, e.def.damage);
      e.cd = (e.def.fireRate ?? 1.25) * (1 - Math.min(0.4, (this.depth - 1) * 0.07));
    }
  }

  private bossUpdate(e: Enemy, simDt: number, d: number, dx: number, dz: number) {
    const pref = 12;
    const ux = dx / d, uz = dz / d;
    if (e.phase === 0 && e.hp < e.maxHp * 0.5) { e.phase = 1; this.shake += 1; this.hitstop = Math.max(this.hitstop, 0.06); }
    const speed = e.def.speed * (1 + (this.depth - 1) * 0.06);
    if (d > pref + 1) { e.x = clampX(e.x + ux * speed * simDt); e.z = clampZ(e.z + uz * speed * simDt); }
    else if (d < pref - 1) { e.x = clampX(e.x - ux * speed * simDt); e.z = clampZ(e.z - uz * speed * simDt); }
    else { e.x = clampX(e.x - uz * speed * 0.5 * simDt); e.z = clampZ(e.z + ux * speed * 0.5 * simDt); }

    e.patternCd = Math.max(0, e.patternCd - simDt);
    e.summonCd = Math.max(0, e.summonCd - simDt);
    if (e.patternCd <= 0) {
      const n = e.phase ? 16 : 10;
      for (let k = 0; k < n; k++) this.enemyShot(e, (k / n) * Math.PI * 2 + this.time * 0.55, 13, e.def.damage * 0.5, NEON.cyan);
      if (e.phase) { const a = Math.atan2(dz, dx); for (let k = -1; k <= 1; k++) this.enemyShot(e, a + k * 0.18, 21, e.def.damage * 0.6, NEON.mag); }
      e.patternCd = e.phase ? 2.4 : 3.3;
    }
    if (e.summonCd <= 0 && this.alive < 12) {
      for (let i = 0; i < 2; i++) this.spawnEnemy("darter", clampX(e.x + range(this.rng, -3, 3)), clampZ(e.z + range(this.rng, -3, 3)), false);
      e.summonCd = 7;
    }
  }

  private separate() {
    const es = this.enemies;
    for (let i = 0; i < es.length; i++) {
      const a = es[i]; if (!a.alive || a.dormant) continue;
      for (let j = i + 1; j < es.length; j++) {
        const b = es[j]; if (!b.alive || b.dormant) continue;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = a.radius + b.radius;
        if (d > 1e-3 && d < min) {
          const push = (min - d) / 2, nx = dx / d, nz = dz / d;
          a.x = clampX(a.x - nx * push); a.z = clampZ(a.z - nz * push);
          b.x = clampX(b.x + nx * push); b.z = clampZ(b.z + nz * push);
        }
      }
    }
  }

  private updatePickups(dt: number) {
    const p = this.player;
    let n = 0;
    for (const pk of this.pickups) {
      pk.life -= dt;
      let dead = pk.life <= 0;
      if (!dead && dist(pk.x, pk.z, p.x, p.z) < p.radius + 1.3) {
        this.heal(pk.heal);
        if (p.relics.has("siphon")) this.heal(5);
        dead = true;
      }
      if (!dead) this.pickups[n++] = pk;
    }
    this.pickups.length = n;
  }

  private checkProgress() {
    if (this.bossDefeated || this.playerDead || this.awaitingDraft) return;
    const p = this.player;
    for (const enc of this.encounters) {
      if (!enc.fired && p.z > enc.z - 18) { enc.fired = true; this.spawnEncounter(); }
    }
    if (!this.bossActive && this.bossEnt?.alive && p.z > BOSS_AT - 26) {
      this.bossActive = true; this.bossEnt.dormant = false;
      this.shake += 1.2; this.bus.emit("fx:shake", { power: 1 }); this.bus.emit("sfx", { id: "crash" });
    }
  }

  // ---- draft / acts -----------------------------------------------------
  draftChoices(): RelicDef[] {
    const owned = this.player.relics;
    const pool = RELICS.filter((r) => !owned.has(r.id));
    const out: RelicDef[] = [];
    while (out.length < 3 && pool.length) out.push(pool.splice((this.rng() * pool.length) | 0, 1)[0]);
    return out;
  }

  chooseRelic(id: string) {
    this.player.relics.add(id);
    if (id === "iron") { this.player.maxHp += 30; this.player.hp += 30; }
  }

  nextAct() { this.awaitingDraft = false; this.enterAct(this.depth + 1); }
}
