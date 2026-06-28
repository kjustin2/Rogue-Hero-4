import { Bus } from '../bus';
import { RNG } from '../rng';
import { CARDS, CHARACTERS, ENEMIES, RELICS, BIOMES, ARENA, BOSS_DEPTH, NEON } from '../content';
import type { CardDef, CharacterDef, EnemyDef, EnemyKind, RelicDef, BiomeDef, Glyph } from '../types';
import { classifyWeave, weaveColor } from './weave';

export interface CardState { id: string; cd: number; }

export interface Player {
  x: number; z: number; angle: number;
  mvx: number; mvz: number;          // last move dir (for render lean)
  hp: number; maxHp: number; speed: number; radius: number;
  weave: Glyph[];          // the 3-slot spell weave (resolves at 3)
  empower: number;         // casts remaining that are empowered (bonus dmg + pierce)
  ward: number;            // seconds of defensive Ward (−30% incoming) remaining
  castMult: number;        // transient: this cast's damage multiplier (set per cast)
  char: CharacterDef;
  cards: CardState[];
  relics: Set<string>;
  iframe: number; dashCritArmed: boolean;
  combo: number; comboTimer: number;
  alive: boolean;
  moveX: number; moveZ: number; aimX: number; aimZ: number;
}

export interface Enemy {
  id: number; def: EnemyDef;
  x: number; z: number; hp: number; maxHp: number;
  cd: number; slow: number; stun: number; elite: boolean;
  splitsLeft: number; dead: boolean; hitFlash: number;
  patternCd: number; summonCd: number; phase: number;
  // dynamic behaviour: lunges (darter) + telegraphed slams (brute)
  lungeCd: number; lunge: number; ldx: number; ldz: number;
  windup: number; stx: number; stz: number;
}

export interface Projectile {
  active: boolean; x: number; z: number; vx: number; vz: number;
  life: number; damage: number; color: number; friendly: boolean;
  pierce: number; radius: number; hit: Set<number>;
}

export interface Pickup { x: number; z: number; life: number; }

export type RunMode = 'playing' | 'draft' | 'gameover' | 'win';

const clampArena = (v: number) => Math.max(-ARENA + 1, Math.min(ARENA - 1, v));

export class World {
  bus: Bus;
  rng = new RNG(1);
  mode: RunMode = 'playing';
  t = 0;
  player!: Player;
  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  pickups: Pickup[] = [];
  run = { depth: 1, charId: 'pyre', seed: 1, kills: 0, relics: [] as string[] };
  biome: BiomeDef = BIOMES[0];
  portalOpen = false;
  portalX = 0;
  portalZ = -(ARENA - 7);
  bossDefeated = false;
  bossDeathX = 0;
  bossDeathZ = -(ARENA - 12);
  draftOptions: RelicDef[] = [];
  shake = 0;
  hitstop = 0;
  suppressClear = false; // tutorial holds the room open until the combat step
  boss: Enemy | null = null;
  private reinforced = false;
  private waveBudget = 0;
  private nextId = 1;

  constructor(bus: Bus) { this.bus = bus; }

  // ---- run / room flow ----------------------------------------------------
  startRun(charId = 'pyre', seed = (Date.now() & 0xffffff) || 1): void {
    const char = CHARACTERS.find((c) => c.id === charId) ?? CHARACTERS[0];
    this.rng = new RNG(seed);
    this.run = { depth: 1, charId: char.id, seed, kills: 0, relics: [] };
    this.player = {
      x: 0, z: ARENA - 13, angle: -Math.PI / 2, mvx: 0, mvz: 0,
      hp: char.hp, maxHp: char.hp, speed: char.speed, radius: 0.9,
      weave: [], empower: 0, ward: 0, castMult: 1, char,
      cards: char.loadout.map((id) => ({ id, cd: 0 })),
      relics: new Set(), iframe: 0, dashCritArmed: false,
      combo: 0, comboTimer: 0, alive: true,
      moveX: 0, moveZ: 0, aimX: 0, aimZ: ARENA - 13 - 5,
    };
    this.mode = 'playing';
    this.bossDefeated = false;
    this.boss = null;
    this.enterRoom(1);
  }

  enterRoom(depth: number): void {
    this.run.depth = depth;
    this.biome = BIOMES[Math.min(Math.floor((depth - 1) / 2), BIOMES.length - 1)];
    this.enemies = [];
    this.pickups = [];
    for (const p of this.projectiles) p.active = false;
    this.portalOpen = false;
    this.boss = null;
    this.reinforced = false;
    const pl = this.player;
    pl.x = 0; pl.z = ARENA - 13; pl.weave = []; pl.empower = 0; pl.ward = 0;
    pl.iframe = 0.6; pl.combo = 0;
    if (depth >= BOSS_DEPTH) {
      this.boss = this.spawnEnemy('boss', 0, -ARENA + 10, false);
      this.spawnEnemy('caster', -10, -ARENA + 14, false);
      this.spawnEnemy('caster', 10, -ARENA + 14, false);
    } else {
      this.spawnWave(depth);
    }
  }

  private spawnWave(depth: number, count = Math.min(4 + Math.round(depth * 2.4), 24)): void {
    this.waveBudget = count;
    const pool: EnemyKind[] = ['darter', 'darter'];
    if (depth >= 2) pool.push('brute', 'caster');
    if (depth >= 3) pool.push('splitter', 'darter');
    for (let i = 0; i < count; i++) {
      const kind = this.rng.pick(pool);
      const elite = depth >= 2 && this.rng.next() < 0.05 * depth;
      const a = this.rng.range(Math.PI * 0.15, Math.PI * 0.85); // upper arc, away from player
      const r = this.rng.range(ARENA * 0.45, ARENA - 4);
      this.spawnEnemy(kind, Math.cos(a) * r, -Math.sin(a) * r, elite);
    }
  }

  spawnEnemy(kind: EnemyKind, x: number, z: number, elite: boolean): Enemy {
    const def = ENEMIES[kind];
    const scale = (1 + (this.run.depth - 1) * 0.12) * (elite ? 1.85 : 1);
    const hp = Math.round(def.hp * scale);
    const e: Enemy = {
      id: this.nextId++, def, x: clampArena(x), z: clampArena(z), hp, maxHp: hp,
      cd: this.rng.range(0.2, def.touch || def.fireRate || 1), slow: 0, stun: 0, elite,
      splitsLeft: def.splits ?? 0, dead: false, hitFlash: 0,
      patternCd: 2.5, summonCd: 6, phase: 0,
      lungeCd: this.rng.range(1.2, 2.6), lunge: 0, ldx: 0, ldz: 0, windup: 0, stx: 0, stz: 0,
    };
    this.enemies.push(e);
    return e;
  }

  // ---- input --------------------------------------------------------------
  setMove(x: number, z: number): void { this.player.moveX = x; this.player.moveZ = z; }
  setAim(x: number, z: number): void { this.player.aimX = x; this.player.aimZ = z; }

  castCard(i: number): boolean {
    if (this.mode !== 'playing' || !this.player.alive) return false;
    const c = this.player.cards[i];
    if (!c || c.cd > 0) return false;
    const def = CARDS[c.id];
    c.cd = def.cooldown;
    const pl = this.player;
    // empowered casts (granted by a Resonance/Prismatic weave) hit harder + pierce
    pl.castMult = pl.empower > 0 ? 1.6 : 1;
    if (pl.empower > 0) pl.empower--;
    this.execCard(def);
    pl.castMult = 1;
    this.weaveGlyph(def);   // push this card's glyph; resolves the weave at 3
    this.bus.emit('fx:cast', { x: this.player.x, z: this.player.z, color: def.color, kind: def.kind });
    this.bus.emit('sfx', { name: castSfx(def.kind), vol: 0.5 });
    return true;
  }

  private execCard(def: CardDef): void {
    const pl = this.player;
    const ang = pl.angle;
    switch (def.kind) {
      case 'strike':
        this.meleeCone(def.range, 0.42, def.damage, 0);
        this.bus.emit('fx:slash', { x: pl.x, z: pl.z, angle: ang, range: def.range, color: def.color }); break;
      case 'siphon':
        this.meleeCone(def.range, 0.45, def.damage, 4);
        this.bus.emit('fx:slash', { x: pl.x, z: pl.z, angle: ang, range: def.range, color: def.color }); break;
      case 'arc':
        this.aoe(def.range, def.damage, 0);
        this.bus.emit('fx:shock', { x: pl.x, z: pl.z, r: def.range, color: def.color }); break;
      case 'nova':
        this.aoe(def.range, def.damage, 2.6);
        this.bus.emit('fx:shock', { x: pl.x, z: pl.z, r: def.range, color: def.color }); break;
      case 'bolt':
        this.fireBolt(ang, def); break;
      case 'volley': {
        const n = def.count ?? 5;
        for (let k = 0; k < n; k++) {
          this.fireBolt(ang + (k - (n - 1) / 2) * 0.13, def);
        }
        break;
      }
      case 'dash': {
        const tx = clampArena(pl.x + Math.cos(ang) * def.range);
        const tz = clampArena(pl.z + Math.sin(ang) * def.range);
        this.bus.emit('fx:shock', { x: pl.x, z: pl.z, r: 2.4, color: def.color }); // departure ring
        pl.x = tx; pl.z = tz;
        pl.iframe = Math.max(pl.iframe, 0.28 + (pl.char.dashIframe ?? 0));
        if (pl.char.postDashCrit) pl.dashCritArmed = true;
        this.aoe(2.6, def.damage, 0);
        this.bus.emit('fx:shock', { x: tx, z: tz, r: 3, color: def.color }); // arrival shock
        break;
      }
      case 'overload':
        this.bus.emit('fx:shock', { x: pl.x, z: pl.z, r: 5, color: def.color }); break; // pure tempo surge
    }
  }

  private fireBolt(ang: number, def: CardDef): void {
    const pl = this.player;
    const empowered = pl.castMult > 1;                       // this cast is empowered
    const pierce = (empowered ? 2 : 0) + (empowered && pl.relics.has('resonator') ? 2 : 0);
    this.spawnProjectile(pl.x, pl.z, ang, def.speed ?? 26, def.damage, def.color, true, pierce, 1.5);
  }

  // ---- combat funnel ------------------------------------------------------
  private meleeCone(range: number, cosHalf: number, base: number, heal: number): void {
    const pl = this.player; const fx = Math.cos(pl.angle); const fz = Math.sin(pl.angle);
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - pl.x, dz = e.z - pl.z; const rr = range + e.def.radius;
      const d2 = dx * dx + dz * dz; if (d2 > rr * rr) continue;
      const d = Math.sqrt(d2) || 1;
      if ((dx / d) * fx + (dz / d) * fz < cosHalf) continue;
      this.hitEnemy(e, base, dx / d, dz / d);
      if (heal > 0) this.heal(heal);
    }
  }

  private aoe(radius: number, base: number, slow: number): void {
    const pl = this.player;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - pl.x, dz = e.z - pl.z; const rr = radius + e.def.radius;
      const d2 = dx * dx + dz * dz; if (d2 > rr * rr) continue;
      const d = Math.sqrt(d2) || 1;
      this.hitEnemy(e, base, dx / d, dz / d);
      if (slow > 0) e.slow = Math.max(e.slow, slow);
    }
  }

  hitEnemy(e: Enemy, base: number, kx = 0, kz = 0): void {
    const pl = this.player;
    // damage = base × this cast's empower multiplier × kill-combo ramp × relic
    let mult = pl.castMult * (1 + Math.min(pl.combo, 12) * 0.015);
    if (pl.relics.has('razor')) mult *= 1.18;
    let crit = false;
    if (pl.dashCritArmed) { crit = true; mult *= 2; pl.dashCritArmed = false; }
    const amount = Math.max(1, Math.round(base * mult));
    e.hp -= amount; e.hitFlash = 0.12;
    if (e.stun >= 0) e.stun = Math.max(e.stun, 0.12);          // brief flinch — enemy reaction read
    e.x = clampArena(e.x + kx * 0.9); e.z = clampArena(e.z + kz * 0.9); // stronger knockback sells the hit
    pl.combo++; pl.comboTimer = 1.5;
    this.bus.emit('damage', { x: e.x, z: e.z, amount, crit });
    this.bus.emit('fx:hit', { x: e.x, z: e.z, color: e.def.color, power: crit ? 1.7 : 1 });
    this.bus.emit('sfx', { name: 'hit', vol: 0.35 });
    if (e.hp <= 0 && !e.dead) this.onDeath(e);
  }

  private onDeath(e: Enemy): void {
    e.dead = true;
    this.run.kills++;
    this.hitstop = Math.max(this.hitstop, e.elite ? 0.07 : 0.045); // brief freeze-frame on a kill (DMC5 "sleep")
    this.bus.emit('enemy:killed', { elite: e.elite });
    this.bus.emit('fx:death', { x: e.x, z: e.z, color: e.def.color, big: e.def.kind === 'boss' || e.elite });
    this.bus.emit('sfx', { name: 'kill', vol: e.def.kind === 'boss' ? 0.9 : 0.5 });
    if (this.player.relics.has('siphon')) this.heal(5);
    if (e.def.kind === 'boss') {
      this.bossDefeated = true; this.boss = null; this.bossDeathX = e.x; this.bossDeathZ = e.z;
      this.shake += 1.4; this.hitstop = 0.1;
      this.bus.emit('fx:shake', { power: 1.4 });
      this.bus.emit('run:win', {});
      return;
    }
    if (e.splitsLeft > 0) {
      for (let i = 0; i < e.splitsLeft; i++) {
        const a = (i / e.splitsLeft) * Math.PI * 2;
        const c = this.spawnEnemy('darter', e.x + Math.cos(a) * 1.5, e.z + Math.sin(a) * 1.5, false);
        c.hp = c.maxHp = Math.round(c.maxHp * 0.6);
      }
    } else if (e.elite || this.rng.next() < 0.18) {
      this.pickups.push({ x: e.x, z: e.z, life: 14 });
    }
  }

  damagePlayer(amount: number): void {
    const pl = this.player;
    if (!pl.alive || pl.iframe > 0) return;
    // difficulty RAMP (flow channel): incoming damage scales with depth so deeper rooms apply
    // real pressure — audit showed full HP at depth 4 (too flat / outside the flow channel).
    let amt = amount * (pl.ward > 0 ? 0.7 : 1) * (1 + (this.run.depth - 1) * 0.16);
    if (pl.char.dmgResist) amt *= 1 - pl.char.dmgResist;
    amt = Math.max(1, Math.round(amt));
    pl.hp -= amt; pl.iframe = 0.45;
    if (pl.char.hurtWard) pl.ward = Math.max(pl.ward, pl.char.hurtWard); // Frost: a hit grants a Ward
    this.shake += 0.6;
    this.bus.emit('player:hurt', {});
    this.bus.emit('damage', { x: pl.x, z: pl.z, amount: amt, crit: false });
    this.bus.emit('fx:shake', { power: 0.6 });
    this.bus.emit('sfx', { name: 'enemy-attack', vol: 0.45 });
    if (pl.hp <= 0) {
      pl.hp = 0; pl.alive = false; this.mode = 'gameover';
      this.bus.emit('player:dead', {});
    }
  }

  private heal(n: number): void {
    const pl = this.player; if (pl.hp >= pl.maxHp) return;
    pl.hp = Math.min(pl.maxHp, pl.hp + n);
    this.bus.emit('damage', { x: pl.x, z: pl.z, amount: n, crit: false, heal: true });
  }

  // ---- spell weaving ------------------------------------------------------
  // push a cast's glyph onto the 3-slot weave; resolve the pattern at 3.
  private weaveGlyph(def: CardDef): void {
    const pl = this.player;
    pl.weave.push(def.glyph);
    if (pl.weave.length >= 3) this.resolveWeave();
  }

  // resolve a completed weave into a burst (Resonance / Surge / Prismatic Rite) and reset.
  private resolveWeave(): void {
    const pl = this.player;
    const glyphs = pl.weave.slice(0, 3); pl.weave = [];
    const { kind, element } = classifyWeave(glyphs);
    const oc = pl.relics.has('overcharge') ? 1.7 : 1;
    const rr = pl.relics.has('runaway') ? 1.35 : 1;
    const wp = pl.char.weavePower ?? 1;
    let radius: number, dmg: number;
    let frost = false, pull = false;
    if (kind === 'prismatic') {
      radius = 9; dmg = 40; pl.empower = 3; pl.ward = Math.max(pl.ward, 2);  // the big finisher
    } else if (kind === 'resonance') {
      radius = 7; dmg = 30; pl.empower = pl.relics.has('metronome') ? 3 : 2;
      if (element === 'ember') dmg *= 1.3;
      if (element === 'frost') { frost = true; pl.ward = Math.max(pl.ward, 2.5); }
      if (element === 'void') pull = true;
    } else {
      radius = 5.5; dmg = 18; if (element === 'frost') frost = true;          // surge
    }
    radius *= oc * rr;
    dmg *= oc * wp * (1 + (this.run.depth - 1) * 0.08);
    const prevMult = pl.castMult; pl.castMult = 1;       // burst uses its own damage, not the cast's
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - pl.x, dz = e.z - pl.z; const d2 = dx * dx + dz * dz;
      if (d2 > radius * radius) continue;
      const d = Math.sqrt(d2) || 1;
      const kx = (pull ? -dx : dx) / d, kz = (pull ? -dz : dz) / d;
      this.hitEnemy(e, dmg, kx, kz);
      if (frost) { e.stun = 1.5; e.slow = 2.5; }
    }
    pl.castMult = prevMult;
    const hot = !frost;
    this.shake += kind === 'prismatic' ? 1.6 : 1.1; this.hitstop = 0.08;
    this.bus.emit('weave:resolve', { kind, hot });
    this.bus.emit('fx:crash', { x: pl.x, z: pl.z, hot });
    this.bus.emit('fx:shock', { x: pl.x, z: pl.z, r: radius, color: weaveColor(kind, element) });
    this.bus.emit('fx:shake', { power: kind === 'prismatic' ? 1.2 : 0.9 });
    this.bus.emit('sfx', { name: 'crash', vol: kind === 'prismatic' ? 0.95 : 0.8 });
  }

  // ---- projectiles --------------------------------------------------------
  private spawnProjectile(x: number, z: number, ang: number, speed: number, damage: number, color: number, friendly: boolean, pierce: number, life: number): void {
    let p = this.projectiles.find((q) => !q.active);
    if (!p) { p = { active: false, x: 0, z: 0, vx: 0, vz: 0, life: 0, damage: 0, color: 0, friendly: true, pierce: 0, radius: 0.5, hit: new Set() }; this.projectiles.push(p); }
    p.active = true; p.x = x; p.z = z; p.vx = Math.cos(ang) * speed; p.vz = Math.sin(ang) * speed;
    p.life = life; p.damage = damage; p.color = color; p.friendly = friendly; p.pierce = pierce; p.radius = 0.55;
    p.hit.clear();
  }

  private updateProjectiles(dt: number): void {
    const pl = this.player;
    for (const p of this.projectiles) {
      if (!p.active) continue;
      p.x += p.vx * dt; p.z += p.vz * dt; p.life -= dt;
      if (p.life <= 0 || Math.abs(p.x) > ARENA || Math.abs(p.z) > ARENA) { p.active = false; continue; }
      if (p.friendly) {
        for (const e of this.enemies) {
          if (e.dead || p.hit.has(e.id)) continue;
          const dx = e.x - p.x, dz = e.z - p.z; const rr = p.radius + e.def.radius;
          if (dx * dx + dz * dz <= rr * rr) {
            this.hitEnemy(e, p.damage, p.vx, p.vz); p.hit.add(e.id);
            if (p.pierce-- <= 0) { p.active = false; break; }
          }
        }
      } else {
        const dx = pl.x - p.x, dz = pl.z - p.z; const rr = p.radius + pl.radius;
        if (dx * dx + dz * dz <= rr * rr) { this.damagePlayer(p.damage); p.active = false; }
      }
    }
  }

  // ---- enemies ------------------------------------------------------------
  private updateEnemies(dt: number): void {
    const pl = this.player;
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (e.hitFlash > 0) e.hitFlash -= dt;
      if (e.slow > 0) e.slow -= dt;
      if (e.stun > 0) { e.stun -= dt; continue; }
      const sl = e.slow > 0 ? 0.45 : 1;
      const dx = pl.x - e.x, dz = pl.z - e.z; const d = Math.hypot(dx, dz) || 1;
      const spd = e.def.speed * sl * (1 + (this.run.depth - 1) * 0.06); // faster + more pressure at depth

      // committed lunge (a darter dart): fast dash along a STORED direction — readable + dodgeable
      if (e.lunge > 0) {
        e.lunge -= dt;
        e.x = clampArena(e.x + e.ldx * e.def.speed * 2.8 * dt);
        e.z = clampArena(e.z + e.ldz * e.def.speed * 2.8 * dt);
        e.cd -= dt;
        if (d < e.def.radius + pl.radius + 0.3 && e.cd <= 0) { this.damagePlayer(e.def.damage); e.cd = e.def.touch; e.lunge = 0; }
        continue;
      }
      // telegraphed slam wind-up (a brute): rooted, then SLAMs the marked spot
      if (e.windup > 0) { e.windup -= dt; if (e.windup <= 0) this.enemySlam(e); continue; }
      e.lungeCd -= dt;

      if (e.def.ranged) {
        const pref = e.def.kind === 'boss' ? 12 : 14;
        let mx = 0, mz = 0;
        if (d > pref + 1) { mx = dx / d; mz = dz / d; }
        else if (d < pref - 1) { mx = -dx / d; mz = -dz / d; }
        else { mx = -dz / d; mz = dx / d; } // strafe
        e.x = clampArena(e.x + mx * spd * dt); e.z = clampArena(e.z + mz * spd * dt);
        e.cd -= dt;
        if (e.cd <= 0) {
          const ang = Math.atan2(dz, dx);
          if (e.def.kind === 'boss') this.spawnProjectile(e.x, e.z, ang, 19, e.def.damage, e.def.color, false, 0, 2.4);
          else for (let s = -1; s <= 1; s++) this.spawnProjectile(e.x, e.z, ang + s * 0.16, 20, e.def.damage, e.def.color, false, 0, 2.4); // 3-round fan
          e.cd = (e.def.fireRate ?? 1.5) * (e.phase >= 1 ? 0.6 : 1) * (1 - Math.min(0.4, (this.run.depth - 1) * 0.07)); // ranged pressure ramps with depth
        }
        if (e.def.kind === 'boss') this.bossUpdate(e, dt, d);
      } else {
        // brutes telegraph a slam up close; faster minions dart-lunge from mid range
        if (e.def.kind === 'brute' && e.lungeCd <= 0 && d < 6.5) {
          e.windup = 0.7; e.stx = pl.x; e.stz = pl.z; e.lungeCd = this.rng.range(3, 4.2);
          this.bus.emit('fx:telegraph', { x: pl.x, z: pl.z, radius: 4.2, dur: 0.7, color: NEON.red });
          this.bus.emit('sfx', { name: 'swap', vol: 0.4 });
          continue;
        }
        if (e.def.kind !== 'brute' && e.lungeCd <= 0 && d > 3 && d < 16) {
          e.lunge = 0.34; e.ldx = dx / d; e.ldz = dz / d; e.lungeCd = this.rng.range(1.8, 3.0);
          this.bus.emit('fx:telegraph', { x: e.x, z: e.z, radius: 1.4, dur: 0.18, color: e.def.color });
        }
        e.x = clampArena(e.x + (dx / d) * spd * dt);
        e.z = clampArena(e.z + (dz / d) * spd * dt);
        e.cd -= dt;
        if (d < e.def.radius + pl.radius + 0.25 && e.cd <= 0) { this.damagePlayer(e.def.damage); e.cd = e.def.touch; }
      }
    }
    this.separate();
  }

  // a telegraphed brute slam: lunge into the marked spot and detonate an AoE
  private enemySlam(e: Enemy): void {
    const pl = this.player; const r = 4.2;
    const bdx = e.stx - e.x, bdz = e.stz - e.z, bd = Math.hypot(bdx, bdz) || 1;
    e.x = clampArena(e.x + (bdx / bd) * 2.2); e.z = clampArena(e.z + (bdz / bd) * 2.2);
    const dx = pl.x - e.stx, dz = pl.z - e.stz;
    if (dx * dx + dz * dz < r * r) this.damagePlayer(Math.round(e.def.damage * 1.6));
    this.shake += 0.8; this.hitstop = Math.max(this.hitstop, 0.04);
    this.bus.emit('fx:death', { x: e.stx, z: e.stz, color: NEON.red, big: true });
    this.bus.emit('fx:shock', { x: e.stx, z: e.stz, r: r, color: NEON.red });
    this.bus.emit('fx:shake', { power: 0.8 });
    this.bus.emit('sfx', { name: 'crash', vol: 0.5 });
    e.lungeCd = this.rng.range(3, 4.2);
  }

  private bossUpdate(e: Enemy, dt: number, distToPlayer: number): void {
    if (e.hp < e.maxHp * 0.5 && e.phase < 1) { e.phase = 1; this.shake += 1; this.hitstop = 0.06; }
    const base = Math.atan2(this.player.z - e.z, this.player.x - e.x);
    e.patternCd -= dt;
    if (e.patternCd <= 0) {
      const n = e.phase >= 1 ? 16 : 10;
      const spin = this.t * 0.55; // slowly rotating ring
      for (let k = 0; k < n; k++) {
        this.spawnProjectile(e.x, e.z, spin + (k / n) * Math.PI * 2, 13, e.def.damage * 0.5, NEON.cyan, false, 0, 3.2);
      }
      // phase 2 adds an aimed lead-fan that punishes standing still
      if (e.phase >= 1) for (let s = -1; s <= 1; s++) this.spawnProjectile(e.x, e.z, base + s * 0.2, 21, e.def.damage * 0.6, NEON.mag, false, 0, 2.6);
      e.patternCd = e.phase >= 1 ? 2.4 : 3.3;
      this.bus.emit('sfx', { name: 'shoot2', vol: 0.5 });
    }
    e.summonCd -= dt;
    if (e.summonCd <= 0 && this.aliveCount() < 12) {
      this.spawnEnemy('darter', e.x + (distToPlayer > 8 ? 0 : 3), e.z + 2, false);
      this.spawnEnemy('darter', e.x - 3, e.z + 2, false);
      e.summonCd = 7;
    }
  }

  private separate(): void {
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i]; if (a.dead) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]; if (b.dead) continue;
        const dx = b.x - a.x, dz = b.z - a.z; const min = a.def.radius + b.def.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 > 0.0001 && d2 < min * min) {
          const d = Math.sqrt(d2); const push = (min - d) * 0.5;
          const ux = dx / d, uz = dz / d;
          a.x = clampArena(a.x - ux * push); a.z = clampArena(a.z - uz * push);
          b.x = clampArena(b.x + ux * push); b.z = clampArena(b.z + uz * push);
        }
      }
    }
  }

  // ---- per-frame tick -----------------------------------------------------
  tick(dt: number): void {
    if (this.mode !== 'playing') return;
    this.t += dt;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 3);
    this.updatePlayer(dt);
    if (this.player.ward > 0) this.player.ward = Math.max(0, this.player.ward - dt); // Ward ticks down
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    if (this.enemies.length > 60) this.enemies = this.enemies.filter((e) => !e.dead);
    else for (let i = this.enemies.length - 1; i >= 0; i--) if (this.enemies[i].dead) this.enemies.splice(i, 1);
    this.checkRoom();
  }

  private updatePlayer(dt: number): void {
    const pl = this.player;
    pl.angle = Math.atan2(pl.aimZ - pl.z, pl.aimX - pl.x);
    const ml = Math.hypot(pl.moveX, pl.moveZ);
    const spd = pl.speed * (pl.relics.has('grease') ? 1.2 : 1);
    if (ml > 0.001) {
      const nx = pl.moveX / ml, nz = pl.moveZ / ml;
      pl.x = clampArena(pl.x + nx * spd * dt); pl.z = clampArena(pl.z + nz * spd * dt);
      pl.mvx = nx; pl.mvz = nz;
    } else { pl.mvx *= 0.8; pl.mvz *= 0.8; }
    if (pl.iframe > 0) pl.iframe -= dt;
    if (pl.comboTimer > 0) { pl.comboTimer -= dt; if (pl.comboTimer <= 0) pl.combo = 0; }
    for (const c of pl.cards) if (c.cd > 0) c.cd -= dt;
    for (const pk of this.pickups) {
      pk.life -= dt;
      const dx = pk.x - pl.x, dz = pk.z - pl.z;
      if (dx * dx + dz * dz < (pl.radius + 1.3) ** 2) {
        this.heal(11); pk.life = 0;
        this.bus.emit('fx:pickup', { x: pk.x, z: pk.z, color: NEON.green });
        this.bus.emit('sfx', { name: 'pickup', vol: 0.6 });
      }
    }
    if (this.pickups.length) this.pickups = this.pickups.filter((p) => p.life > 0);
  }

  private checkRoom(): void {
    if (this.mode !== 'playing' || this.portalOpen) return;
    if (this.suppressClear) return; // tutorial: don't open the portal until combat begins
    if (this.run.depth >= BOSS_DEPTH) return; // boss room: win is via run:win
    const alive = this.aliveCount();
    // mid-room reinforcement keeps deeper rooms under sustained pressure (once per room)
    if (this.run.depth >= 4 && !this.reinforced && alive > 0 && alive <= Math.ceil(this.waveBudget * 0.4)) {
      this.reinforced = true;
      this.spawnWave(this.run.depth, Math.ceil(this.waveBudget * 0.5));
      this.bus.emit('sfx', { name: 'swap', vol: 0.4 });
      return;
    }
    if (alive > 0) return;
    this.portalOpen = true;
    this.bus.emit('room:clear', {});
    this.bus.emit('portal:open', {});
  }

  playerInPortal(): boolean {
    if (!this.portalOpen) return false;
    const dx = this.player.x - this.portalX, dz = this.player.z - this.portalZ;
    return dx * dx + dz * dz < 2.6 * 2.6;
  }

  // ---- draft / progression ------------------------------------------------
  rollDraft(): void {
    const owned = new Set(this.run.relics);
    const avail = RELICS.filter((r) => !owned.has(r.id));
    this.draftOptions = (avail.length >= 3 ? this.rng.sample(avail, 3) : avail.slice());
    this.mode = 'draft';
  }

  applyRelic(id: string): void {
    if (this.run.relics.includes(id)) return;
    this.run.relics.push(id);
    this.player.relics.add(id);
    if (id === 'iron') { this.player.maxHp += 30; this.player.hp += 30; }
  }

  nextRoom(): void { this.enterRoom(this.run.depth + 1); this.mode = 'playing'; }

  aliveCount(): number { let n = 0; for (const e of this.enemies) if (!e.dead) n++; return n; }
}

function castSfx(kind: CardDef['kind']): string {
  switch (kind) {
    case 'volley': return 'shoot2';
    case 'arc': case 'overload': return 'swap';
    case 'nova': return 'land';
    case 'dash': return 'dash';
    default: return 'shoot';
  }
}
