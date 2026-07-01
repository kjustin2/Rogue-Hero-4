import * as THREE from "three";
import type { Ctx } from "./ctx";
import type { WeaponComboDef } from "./weapons";

export interface HitOpts {
  knockback?: number;
  fromX?: number;
  fromZ?: number;
  heavy?: boolean;
  /** Hit landed on a weak point (e.g. the boss core) — full damage + crit feel. */
  weak?: boolean;
}

/** Anything the player can hit — enemies and the boss both implement this. */
export interface Hittable {
  pos: THREE.Vector3;
  radius: number;
  alive: boolean;
  hp: number;
  maxHp: number;
  kind: string;
  /** Spark palette for hit feedback. */
  hitColor: number;
  /** Top of the vertical hitbox (default ~2.6); tall bosses set this higher. */
  hitTop?: number;
  /** True if (x,y,z) lands inside this thing's weak point (boss core). */
  isWeakHit?(x: number, y: number, z: number): boolean;
  /** Returns true if this hit killed it. */
  takeDamage(dmg: number, opts: HitOpts): boolean;
}

/**
 * The one damage funnel. Every outgoing hit goes through dealDamage (which fires the
 * ENEMY_HIT/KILL events + sparks/floaters/shake), every melee swing through
 * meleeSweep, every player wound through damagePlayer, and every chained combo
 * through resolveCombo. Centralizing it keeps feel + balance in one auditable place.
 */
const COMBO_DIR = new THREE.Vector3(); // scratch — projectiles.spawn copies its dir
const FAN_DIR = new THREE.Vector3();

export class Combat {
  private aimEye = new THREE.Vector3();
  private aimDir = new THREE.Vector3(0, 0, 1);
  private wp = new THREE.Vector3();
  private targetList: Hittable[] = []; // targets() scratch — consume immediately, never retain

  constructor(private ctx: Ctx) {}

  /**
   * Is the live first-person aim ray on the boss weak point (core)? Read from the
   * camera each call so the gold crosshair tracks where you look, and melee crits
   * only when you're looking up at the core. Vertical aim matters.
   */
  isAimingWeak(): boolean {
    const b = this.ctx.boss;
    if (!b || !b.alive || b.dormant) return false;
    const cam = this.ctx.stage.camera;
    cam.getWorldPosition(this.aimEye);
    cam.getWorldDirection(this.aimDir);
    b.coreWorld(this.wp);
    // ray-to-core, allocation-free: project (core - eye) onto the aim dir, then
    // squared distance from the core to that closest point (no clone, no sqrt).
    const ex = this.wp.x - this.aimEye.x, ey = this.wp.y - this.aimEye.y, ez = this.wp.z - this.aimEye.z;
    const t = ex * this.aimDir.x + ey * this.aimDir.y + ez * this.aimDir.z;
    if (t < 0) return false;
    const cx = ex - this.aimDir.x * t, cy = ey - this.aimDir.y * t, cz = ez - this.aimDir.z * t;
    return cx * cx + cy * cy + cz * cz < b.weakRadius * b.weakRadius;
  }

  targets(): Hittable[] {
    // living() returns a reusable scratch — copy into our own scratch and add the boss.
    const list = this.targetList;
    list.length = 0;
    for (const e of this.ctx.enemies.living()) list.push(e);
    const boss = this.ctx.boss;
    if (boss && boss.alive && !boss.dormant) list.push(boss);
    return list;
  }

  dealDamage(t: Hittable, dmg: number, opts: HitOpts = {}): void {
    const weak = !!opts.weak;
    const isBoss = t.kind === "boss";
    // Boss body is armored — chip damage unless you land the core (vertical aim matters).
    if (isBoss && !weak) dmg *= 0.45;
    dmg = Math.max(1, Math.round(dmg));
    const killed = t.takeDamage(dmg, opts);
    const heavy = !!opts.heavy;
    const crit = heavy || (weak && isBoss);
    // where the feedback shows: at the core for a weak hit, else mid-body
    const fy = weak && isBoss ? this.wp.y : 1.6;
    this.ctx.events.emit("ENEMY_HIT", { x: t.pos.x, y: fy, z: t.pos.z, dmg, heavy: crit, killed });
    if (weak && isBoss) {
      this.ctx.floaters.spawn(t.pos.x, fy + 0.4, t.pos.z, "WEAK " + dmg, "crit", "#ffd24a");
      this.ctx.fx.ring(t.pos.x, t.pos.z, { radius: 2.0, color: 0xffd24a, duration: 0.3, y: fy });
    } else {
      this.ctx.floaters.spawn(t.pos.x, fy, t.pos.z, String(dmg), crit ? "crit" : "dmg");
    }
    this.ctx.fx.burst({
      x: t.pos.x, y: fy, z: t.pos.z, count: crit ? 18 : 9, color: weak ? [t.hitColor, 0xffd24a] : t.hitColor,
      speed: crit ? [4, 11] : [3, 7], size: [0.12, 0.34], life: [0.2, 0.5],
    });
    if (crit) this.ctx.fx.ring(t.pos.x, t.pos.z, { radius: 2.4, color: t.hitColor, duration: 0.32, y: 1 });
    this.ctx.cam.addTrauma(crit ? 0.22 : 0.08);
    if (crit) this.ctx.hitstop = Math.max(this.ctx.hitstop, 0.05);
    if (killed) {
      this.ctx.events.emit("KILL", { x: t.pos.x, z: t.pos.z, kind: t.kind });
      this.ctx.fx.burst({
        x: t.pos.x, y: 1.1, z: t.pos.z, count: 26, color: t.hitColor,
        speed: [5, 14], size: [0.14, 0.4], life: [0.3, 0.7], gravity: -3,
      });
      this.ctx.fx.ring(t.pos.x, t.pos.z, { radius: 3.2, color: t.hitColor, duration: 0.45, y: 0.5 });
    }
  }

  /** Cone sweep from (ox,oz) facing (dirX,dirZ). Returns the targets it hit. */
  meleeSweep(ox: number, oz: number, dirX: number, dirZ: number, arc: number, range: number, dmg: number, kb: number, heavy: boolean): Hittable[] {
    const hit: Hittable[] = [];
    const half = Math.cos(arc / 2);
    for (const t of this.targets()) {
      const dx = t.pos.x - ox;
      const dz = t.pos.z - oz;
      const d = Math.hypot(dx, dz);
      if (d > range + t.radius) continue;
      const nd = d || 1;
      const cos = (dx / nd) * dirX + (dz / nd) * dirZ;
      if (cos < half && d > t.radius) continue; // outside the cone (unless overlapping)
      // a melee swing crits the boss only if you're looking up at its core
      const weak = t.kind === "boss" && this.isAimingWeak();
      this.dealDamage(t, dmg, { heavy, knockback: kb, fromX: ox, fromZ: oz, weak });
      hit.push(t);
    }
    return hit;
  }

  /** Damage everything within `radius` of (x,z). */
  aoeDamage(x: number, z: number, radius: number, dmg: number, kb: number, heavy: boolean): void {
    for (const t of this.targets()) {
      if (Math.hypot(t.pos.x - x, t.pos.z - z) <= radius + t.radius) {
        this.dealDamage(t, dmg, { heavy, knockback: kb, fromX: x, fromZ: z });
      }
    }
  }

  /**
   * Instant hitscan laser: damage every target in a thin corridor from (ox,oz) along
   * (dirX,dirZ) out to `range`, plus the beam VFX. Crits the boss core when aiming weak.
   */
  beam(ox: number, oz: number, dirX: number, dirZ: number, range: number, width: number, dmg: number, kb: number, color: number): void {
    const weakAim = this.isAimingWeak();
    for (const t of this.targets()) {
      const tx = t.pos.x - ox, tz = t.pos.z - oz;
      const along = tx * dirX + tz * dirZ;
      if (along < 0 || along > range) continue;
      const perp = Math.abs(tx * dirZ - tz * dirX);
      if (perp <= width + t.radius) {
        const weak = t.kind === "boss" && weakAim;
        this.dealDamage(t, dmg, { heavy: true, knockback: kb, fromX: ox, fromZ: oz, weak });
      }
    }
    this.ctx.fx.laser(ox, 1.4, oz, dirX, dirZ, range, color, Math.max(0.2, width * 0.6));
    this.ctx.fx.laser(ox, 1.4, oz, dirX, dirZ, range, 0xffffff, Math.max(0.08, width * 0.22));
    this.ctx.cam.addTrauma(0.12);
  }

  /**
   * Schedule a called-down air strike: telegraph a circle now, detonate an AoE after
   * `delay`. Processed by update() so the wind-up reads before the blast lands.
   */
  scheduleStrike(x: number, z: number, radius: number, dmg: number, delay: number, color: number, kb = 6): void {
    this.strikes.push({ x, z, radius, dmg, delay, color, kb });
    this.ctx.tele.circle(x, z, radius, delay, color);
  }

  private strikes: { x: number; z: number; radius: number; dmg: number; delay: number; color: number; kb: number }[] = [];

  /** Per-frame: fire any air strikes whose wind-up has elapsed. */
  update(dt: number): void {
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i];
      s.delay -= dt;
      if (s.delay > 0) continue;
      this.strikes.splice(i, 1);
      this.aoeDamage(s.x, s.z, s.radius, s.dmg, s.kb, true);
      this.ctx.fx.beam(s.x, s.z, s.color);
      this.ctx.fx.ring(s.x, s.z, { radius: s.radius, color: s.color, duration: 0.4, y: 0.2, startRadius: 0.4 });
      // ponytail: colored core, no pure-white ring — overlapping strikes were stacking additive white into a full-frame washout
      this.ctx.fx.burst({ x: s.x, y: 0.5, z: s.z, count: 14, color: s.color, speed: [6, 16], up: 0.7, size: [0.16, 0.45], life: [0.3, 0.7] });
      this.ctx.cam.addTrauma(0.14);
      this.ctx.sfx.explosion();
    }
  }

  /** Drop any pending strikes (run reset). */
  reset(): void {
    this.strikes.length = 0;
  }

  /**
   * The combo payoff. Finishers fire FORWARD from the player (x,z) — a barrage comet,
   * a bolt fan, a rocket volley, a mega-beam, or an air-strike cluster — so the payoff
   * reads downrange, not as a flash in the player's face. Only the melee weapon's slam
   * lands a ground shockwave just ahead. Camera/sfx feel kept; the screen flash removed.
   */
  resolveCombo(combo: WeaponComboDef, x: number, z: number, aim: THREE.Vector3, baseDmg: number): void {
    const dmg = baseDmg * combo.damageMult;
    this.ctx.events.emit("COMBO_RESOLVE", { name: combo.name, tier: combo.tier });
    this.ctx.stage.punch(0.3 + combo.tier * 0.1);
    this.ctx.cam.addTrauma(0.32 + combo.tier * 0.1);
    this.ctx.cam.pulseFov(0.3);
    this.ctx.hitstop = Math.max(this.ctx.hitstop, 0.09);
    this.ctx.sfx.critical();
    if (combo.tier >= 3) this.ctx.sfx.bossRoar();
    // ground-projected heading for area/melee finishers; full 3D aim (incl. pitch) for
    // the shots, so a barrage/volley flies exactly where the crosshair points.
    const glen = Math.hypot(aim.x, aim.z) || 1;
    const dirX = aim.x / glen, dirZ = aim.z / glen;
    const dir = COMBO_DIR.set(aim.x, aim.y, aim.z).normalize();
    const my = 1.55;
    const muzzleX = x + dirX * 1.2, muzzleZ = z + dirZ * 1.2;

    switch (combo.effect) {
      case "barrage": {
        // a single colossal piercing comet along the look ray
        this.ctx.projectiles.spawn(muzzleX, my, muzzleZ, dir, 32, dmg, true, combo.color, 14, { scale: 3.4, pierce: true });
        this.ctx.fx.burst({ x: muzzleX, y: my, z: muzzleZ, count: 18, color: [combo.color, 0xffffff], speed: [3, 10], size: [0.14, 0.4], life: [0.2, 0.5] });
        break;
      }
      case "bolts": {
        // a wide fan of fast bolts sprayed forward (fanned in the horizontal plane, keeps pitch)
        const n = 9;
        for (let i = 0; i < n; i++) {
          const off = (i - (n - 1) / 2) * 0.12;
          const ca = Math.cos(off), sa = Math.sin(off);
          FAN_DIR.set(dir.x * ca - dir.z * sa, dir.y, dir.x * sa + dir.z * ca);
          this.ctx.projectiles.spawn(muzzleX, my, muzzleZ, FAN_DIR, 46, dmg / 3, true, combo.color, 3);
        }
        break;
      }
      case "rocketvolley": {
        // a fan of explosive rockets that bloom downrange
        const n = 5;
        for (let i = 0; i < n; i++) {
          const off = (i - (n - 1) / 2) * 0.16;
          const ca = Math.cos(off), sa = Math.sin(off);
          FAN_DIR.set(dir.x * ca - dir.z * sa, dir.y, dir.x * sa + dir.z * ca);
          this.ctx.projectiles.spawn(muzzleX, my, muzzleZ, FAN_DIR, 26, dmg / 2, true, combo.color, 8, { explode: combo.radius });
        }
        break;
      }
      case "megabeam": {
        // one huge instant hitscan corridor
        this.beam(x, z, dirX, dirZ, 60, combo.radius, dmg, 8, combo.color);
        this.ctx.fx.burst({ x: muzzleX, y: my, z: muzzleZ, count: 20, color: [combo.color, 0xffffff], speed: [3, 9], size: [0.12, 0.34], life: [0.18, 0.4] });
        break;
      }
      case "airstrike": {
        // a cluster of strikes rains across a zone well ahead
        const n = 6;
        const cx = x + dirX * 16, cz = z + dirZ * 16;
        for (let i = 0; i < n; i++) {
          const ang = this.ctx.rng.range(0, Math.PI * 2);
          const r = this.ctx.rng.range(0, combo.radius * 1.8);
          this.scheduleStrike(cx + Math.cos(ang) * r, cz + Math.sin(ang) * r, combo.radius, dmg / 2.5, 0.35 + this.ctx.rng.range(0, 0.45), combo.color, 6);
        }
        break;
      }
      case "slam": {
        // melee: a ground shockwave just AHEAD of the player (not at the face)
        const ax = x + dirX * combo.radius * 0.55, az = z + dirZ * combo.radius * 0.55;
        this.ctx.fx.ring(ax, az, { radius: combo.radius, color: combo.color, duration: 0.5, y: 0.3, startRadius: 0.4 });
        this.ctx.fx.ring(ax, az, { radius: combo.radius * 0.6, color: 0xffffff, duration: 0.3, y: 0.35, startRadius: 0.3 });
        this.ctx.fx.burst({ x: ax, y: 0.8, z: az, count: 36, color: [combo.color, 0xffffff], speed: [6, 16], up: 0.9, size: [0.16, 0.45], life: [0.3, 0.7] });
        this.aoeDamage(ax, az, combo.radius, dmg, 12, true);
        break;
      }
    }
  }

  /** The only inbound HP path for the player. */
  damagePlayer(dmg: number, srcX: number, srcZ: number): "hit" | "dodged" | "dead" {
    const p = this.ctx.player;
    if (!p.alive) return "dead";
    if (p.god) return "dodged";
    if (p.iframes > 0) {
      // Perfect dodge: i-frames only come from a dash, so dashing through a hit
      // rewards you — impact freeze, glyph cooldowns refunded for an instant counter.
      this.ctx.events.emit("DODGE", {});
      this.ctx.hitstop = Math.max(this.ctx.hitstop, 0.1);
      this.ctx.cam.pulseFov(0.22);
      this.ctx.floaters.spawn(p.pos.x, 1.9, p.pos.z, "PERFECT", "label", "#8affd0");
      this.ctx.sfx.critical();
      p.cooldowns.light = 0;
      p.cooldowns.heavy = 0;
      return "dodged";
    }
    dmg = Math.max(1, Math.round(dmg));
    p.hp -= dmg;
    this.ctx.events.emit("PLAYER_HIT", { dmg, srcX, srcZ });
    const dx = p.pos.x - srcX;
    const dz = p.pos.z - srcZ;
    const d = Math.hypot(dx, dz) || 1;
    this.ctx.cam.kick(-dx / d, -dz / d, Math.min(1, dmg / 16));
    this.ctx.stage.punch(Math.min(0.7, dmg / 20));
    this.ctx.floaters.spawn(p.pos.x, 1.6, p.pos.z, String(dmg), "playerdmg");
    if (p.hp <= 0) {
      p.hp = 0;
      p.alive = false;
      this.ctx.events.emit("PLAYER_DIED", {});
      return "dead";
    }
    return "hit";
  }
}
