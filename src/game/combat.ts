import * as THREE from "three";
import type { Ctx } from "./ctx";
import type { ComboDef } from "./combos";

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
export class Combat {
  private aimEye = new THREE.Vector3();
  private aimDir = new THREE.Vector3(0, 0, 1);
  private wp = new THREE.Vector3();
  private cp = new THREE.Vector3();

  constructor(private ctx: Ctx) {}

  /**
   * Is the live first-person aim ray on the boss weak point (core)? Read from the
   * camera each call so the gold crosshair tracks where you look, and melee crits
   * only when you're looking up at the core. Vertical aim matters.
   */
  isAimingWeak(): boolean {
    const b = this.ctx.boss;
    if (!b || !b.alive) return false;
    const cam = this.ctx.stage.camera;
    cam.getWorldPosition(this.aimEye);
    cam.getWorldDirection(this.aimDir);
    b.coreWorld(this.wp);
    const t = this.wp.clone().sub(this.aimEye).dot(this.aimDir);
    if (t < 0) return false;
    this.cp.copy(this.aimEye).addScaledVector(this.aimDir, t);
    return this.cp.distanceTo(this.wp) < b.weakRadius;
  }

  targets(): Hittable[] {
    const list: Hittable[] = [...this.ctx.enemies.living()];
    const boss = this.ctx.boss;
    if (boss && boss.alive) list.push(boss);
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

  /** The combo payoff: signature AoE + a big multi-channel fanfare. */
  resolveCombo(combo: ComboDef, x: number, z: number, dirX: number, dirZ: number, baseDmg: number): void {
    const dmg = baseDmg * combo.damageMult;
    // the combo name shows once, in the HUD splash (events → Hud.showComboSplash);
    // no in-world floater label here or it reads as a duplicate.
    this.ctx.events.emit("COMBO_RESOLVE", { name: combo.name, tier: combo.tier });
    this.ctx.stage.punch(0.35 + combo.tier * 0.12);
    this.ctx.cam.addTrauma(0.4 + combo.tier * 0.12);
    this.ctx.cam.pulseFov(0.35);
    this.ctx.hitstop = Math.max(this.ctx.hitstop, 0.1);
    this.ctx.sfx.critical();
    if (combo.tier >= 3) this.ctx.sfx.bossRoar();

    switch (combo.effect) {
      case "slam": {
        this.ctx.fx.ring(x, z, { radius: combo.radius, color: combo.color, duration: 0.5, y: 0.4 });
        this.ctx.fx.burst({ x, y: 1, z, count: 40, color: combo.color, speed: [6, 16], size: [0.16, 0.45], life: [0.3, 0.7], up: 1 });
        this.aoeDamage(x, z, combo.radius, dmg, 12, true);
        break;
      }
      case "quake": {
        this.ctx.fx.ring(x, z, { radius: combo.radius, color: combo.color, duration: 0.7, y: 0.1, startRadius: 0.5 });
        this.ctx.fx.burst({ x, y: 0.4, z, count: 48, color: combo.color, speed: [3, 9], vertical: 0.2, life: [0.4, 0.9] });
        for (const t of this.targets()) {
          if (Math.hypot(t.pos.x - x, t.pos.z - z) <= combo.radius + t.radius) {
            this.dealDamage(t, dmg, { heavy: true, knockback: 6, fromX: x, fromZ: z });
            // ponytail: stun via the optional `frozen` field enemies expose; boss has none.
            const f = t as unknown as { frozen?: number };
            if (typeof f.frozen === "number") f.frozen = 1.3;
          }
        }
        break;
      }
      case "nova": {
        this.ctx.fx.ring(x, z, { radius: combo.radius, color: combo.color, duration: 0.6, y: 1 });
        this.ctx.fx.burst({ x, y: 1.2, z, count: 60, color: [combo.color, 0xffffff], speed: [8, 20], size: [0.14, 0.4], life: [0.3, 0.8] });
        this.aoeDamage(x, z, combo.radius, dmg, 10, true);
        break;
      }
      case "lance": {
        const dir = new THREE.Vector3(dirX, 0, dirZ);
        for (let i = 0; i < 4; i++) {
          this.ctx.projectiles.spawn(x, 1.3, z, dir, 38, dmg * 0.5, true, combo.color, 6);
        }
        // instant corridor damage ahead
        for (const t of this.targets()) {
          const tx = t.pos.x - x, tz = t.pos.z - z;
          const along = tx * dirX + tz * dirZ;
          if (along < 0 || along > 26) continue;
          const perp = Math.abs(tx * dirZ - tz * dirX);
          if (perp <= combo.radius + t.radius) this.dealDamage(t, dmg, { heavy: true, knockback: 5, fromX: x, fromZ: z });
        }
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
      p.cooldowns.strike = 0;
      p.cooldowns.cleave = 0;
      p.cooldowns.bolt = 0;
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
