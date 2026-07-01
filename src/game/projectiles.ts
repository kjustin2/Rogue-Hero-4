import * as THREE from "three";
import type { Ctx } from "./ctx";
import { ARENA_CENTER, ARENA_RADIUS, HALF_WIDTH } from "./level";

type Shape = "dart" | "cannonball" | "comet";

interface Shot {
  group: THREE.Group;
  glow: THREE.Mesh;
  head: THREE.Mesh;
  tail: THREE.Mesh;
  ring: THREE.Mesh;
  dart: THREE.Mesh;
  runes: THREE.Group;
  shape: Shape;
  glowMat: THREE.MeshBasicMaterial;
  tailMat: THREE.MeshBasicMaterial;
  runeMat: THREE.MeshBasicMaterial;
  vel: THREE.Vector3;
  life: number;
  dmg: number;
  knockback: number;
  friendly: boolean;
  active: boolean;
  trailT: number;
  color: number;
  scale: number;
  pierce: boolean;
  /** Targets already hit by a piercing shot (so it damages each once). */
  hit: Set<object>;
  /** >0 → an explosive shot: detonates an AoE (radius) on impact/expiry instead of a point hit. */
  explodeRadius: number;
  /** Downward accel (grenade arc); 0 = straight flight. */
  grav: number;
}

const POOL = 56;
const RADIUS = 0.35; // collision radius (gameplay) — visual size is independent
const FWD = new THREE.Vector3(0, 0, 1);
const TAU = Math.PI * 2;

/**
 * One pooled set of animated energy bolts for the player's Bolt glyph (friendly) and
 * all enemy/boss fire (hostile). Each shot is a living comet: a pulsing white-hot core,
 * a colored glow + halo ring, three rune shards orbiting the travel axis, and a tail
 * cone streaking back along velocity, plus a throttled spark trail. Friendly hits route
 * through combat.dealDamage; hostile through combat.damagePlayer.
 */
export class Projectiles {
  private pool: Shot[] = [];
  private headGeo = new THREE.SphereGeometry(0.18, 12, 10);
  private glowGeo = new THREE.SphereGeometry(0.4, 12, 10);
  private ringGeo = new THREE.TorusGeometry(0.34, 0.05, 6, 18);
  private runeGeo = new THREE.TetrahedronGeometry(0.14);
  private tailGeo: THREE.ConeGeometry;
  private dartGeo: THREE.ConeGeometry;
  private headMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  private q = new THREE.Quaternion();
  private vn = new THREE.Vector3();

  constructor(private ctx: Ctx) {
    // comet tail: cone apex forward (+Z = travel dir), flaring back to -Z behind the head
    this.tailGeo = new THREE.ConeGeometry(0.3, 1.8, 12, 1, true);
    this.tailGeo.rotateX(Math.PI / 2);
    this.tailGeo.translate(0, 0, -0.9);
    // crossbow dart: a long thin spike, apex forward (+Z)
    this.dartGeo = new THREE.ConeGeometry(0.09, 1.1, 6);
    this.dartGeo.rotateX(Math.PI / 2);
    this.dartGeo.translate(0, 0, 0.2);

    for (let i = 0; i < POOL; i++) {
      const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
      const tailMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const runeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
      const group = new THREE.Group();
      const glow = new THREE.Mesh(this.glowGeo, glowMat);
      const head = new THREE.Mesh(this.headGeo, this.headMat);
      const tail = new THREE.Mesh(this.tailGeo, tailMat);
      const ring = new THREE.Mesh(this.ringGeo, glowMat); // halo encircling the travel axis (local +Z)
      const dart = new THREE.Mesh(this.dartGeo, tailMat); // solid spike for crossbow shots
      const runes = new THREE.Group(); // rune shards that orbit the head (spun in update)
      for (let k = 0; k < 3; k++) {
        const tet = new THREE.Mesh(this.runeGeo, runeMat);
        const a = (k / 3) * TAU;
        tet.position.set(Math.cos(a) * 0.44, Math.sin(a) * 0.44, 0);
        runes.add(tet);
      }
      group.add(glow, head, tail, ring, dart, runes);
      group.visible = false;
      group.frustumCulled = false;
      group.renderOrder = 5;
      this.ctx.stage.scene.add(group);
      this.pool.push({ group, glow, head, tail, ring, dart, runes, shape: "comet", glowMat, tailMat, runeMat, vel: new THREE.Vector3(), life: 0, dmg: 0, knockback: 0, friendly: false, active: false, trailT: 0, color: 0xffffff, scale: 1, pierce: false, hit: new Set(), explodeRadius: 0, grav: 0 });
    }
  }

  spawn(x: number, y: number, z: number, dir: THREE.Vector3, speed: number, dmg: number, friendly: boolean, color: number, knockback = 3, opts?: { scale?: number; pierce?: boolean; explode?: number; gravity?: number; shape?: Shape }): void {
    const s = this.pool.find((p) => !p.active);
    if (!s) return;
    s.active = true;
    s.friendly = friendly;
    s.dmg = dmg;
    s.knockback = knockback;
    s.life = 3.2;
    s.trailT = 0;
    s.color = color;
    s.scale = opts?.scale ?? (opts?.explode ? 1.5 : 1);
    s.pierce = opts?.pierce ?? false;
    s.explodeRadius = opts?.explode ?? 0;
    s.grav = opts?.gravity ?? 0;
    s.hit.clear();
    s.vel.copy(dir).normalize().multiplyScalar(speed);
    s.group.position.set(x, y, z);
    s.group.scale.setScalar(s.scale);
    s.runes.rotation.z = 0;
    s.glowMat.color.setHex(color);
    s.tailMat.color.setHex(color);
    s.runeMat.color.setHex(color);
    // shape: a thin crossbow dart, a heavy iron cannonball, or the full runed comet
    s.shape = opts?.shape ?? "comet";
    s.dart.visible = s.shape === "dart";
    s.glow.visible = s.shape !== "dart";
    s.head.visible = s.shape !== "dart";
    s.ring.visible = s.shape === "comet";
    // ponytail: only the player's hero comet wears orbiting runes; hostile shots skip
    // them (3 fewer draws/bolt — a boss volley is 7 bolts) and read fine as plain comets.
    s.runes.visible = s.shape === "comet" && friendly;
    s.tail.visible = true;
    s.group.visible = true;
    this.orient(s);
    // muzzle flash — fatter for a big shot
    this.ctx.fx.burst({ x, y, z, count: s.scale > 1.5 ? 16 : 6, color: [color, 0xffffff], speed: [3, 8 * s.scale], size: [0.12, 0.3 * s.scale], life: [0.12, 0.3] });
  }

  private orient(s: Shot): void {
    this.vn.copy(s.vel);
    if (this.vn.lengthSq() < 1e-6) return;
    this.vn.normalize();
    this.q.setFromUnitVectors(FWD, this.vn);
    s.group.quaternion.copy(this.q);
  }

  clear(): void {
    for (const s of this.pool) { s.active = false; s.group.visible = false; }
  }

  update(dt: number): void {
    const player = this.ctx.player;
    // Build the target list ONCE per frame, not once per projectile per frame (a barrage
    // has 10-40 shots in flight). The per-hit `!t.alive` guards below reproduce living()'s
    // filter so a corpse killed earlier this frame can't take a phantom second hit.
    const targets = this.ctx.combat.targets();
    for (const s of this.pool) {
      if (!s.active) continue;
      const p = s.group.position;
      if (s.grav) s.vel.y -= s.grav * dt; // grenade arc
      p.addScaledVector(s.vel, dt);
      s.life -= dt;
      this.orient(s);
      // grenades detonate when they hit the ground
      if (s.grav && p.y <= 0.25) { this.detonate(s); continue; }
      // living-bolt animation: pulsing glow + core, rune shards orbiting the travel axis
      const age = 3.2 - s.life;
      const ball = s.shape === "cannonball"; // heavy iron shot reads bigger + smokier
      s.glow.scale.setScalar((ball ? 1.5 : 0.85) + Math.sin(age * 30) * 0.15);
      s.head.scale.setScalar((ball ? 1.7 : 0.9) + Math.sin(age * 46) * 0.22);
      s.runes.rotation.z += dt * 9;
      // throttled trailing sparks (a thicker, sootier trail behind a cannonball)
      s.trailT -= dt;
      if (s.trailT <= 0) {
        s.trailT = ball ? 0.022 : 0.035;
        this.ctx.fx.burst({ x: p.x, y: p.y, z: p.z, count: ball ? 2 : 1, color: ball ? [s.color, 0x442018] : s.color, speed: [0.2, 1.2], size: ball ? [0.2, 0.42] : [0.12, 0.26], life: [0.18, 0.36], gravity: 0, drag: 3 });
      }

      // out of bounds / expired (squared-distance arena test — no sqrt)
      const outX = Math.abs(p.x) > HALF_WIDTH + 2 && p.z < ARENA_CENTER.y - ARENA_RADIUS;
      const ax = p.x - ARENA_CENTER.x, az = p.z - ARENA_CENTER.y;
      const inArenaOut = p.z >= ARENA_CENTER.y - ARENA_RADIUS && ax * ax + az * az > (ARENA_RADIUS + 2) * (ARENA_RADIUS + 2);
      if (s.life <= 0 || p.z < -4 || outX || inArenaOut) { if (s.explodeRadius > 0) this.detonate(s); else this.kill(s); continue; }

      const r = RADIUS * s.scale;
      if (s.friendly) {
        if (s.explodeRadius > 0) {
          // explosive: detonate on touching any target (splash handles the kill)
          for (const t of targets) {
            if (!t.alive) continue;
            const dx = p.x - t.pos.x, dz = p.z - t.pos.z, rr = t.radius + r, top = t.hitTop ?? 2.6;
            if (dx * dx + dz * dz <= rr * rr && p.y >= 0.2 && p.y <= top) { this.detonate(s); break; }
          }
        } else {
          for (const t of targets) {
            if (!t.alive) continue;
            const dx = p.x - t.pos.x, dz = p.z - t.pos.z, rr = t.radius + r, top = t.hitTop ?? 2.6;
            if (dx * dx + dz * dz <= rr * rr && p.y >= 0.2 && p.y <= top) {
              if (s.pierce && s.hit.has(t)) continue; // a piercing shot hits each target once
              const weak = t.isWeakHit ? t.isWeakHit(p.x, p.y, p.z) : false;
              this.ctx.combat.dealDamage(t, s.dmg, { knockback: s.knockback, fromX: p.x - s.vel.x, fromZ: p.z - s.vel.z, weak });
              this.impact(p, s.color);
              if (s.pierce) { s.hit.add(t); } else { this.kill(s); break; }
            }
          }
        }
      } else if (player.alive) {
        const dx = p.x - player.pos.x, dz = p.z - player.pos.z, rr = player.radius + r;
        if (dx * dx + dz * dz <= rr * rr) {
          this.ctx.combat.damagePlayer(s.dmg, p.x, p.z);
          this.impact(p, s.color);
          this.kill(s);
        }
      }
    }
  }

  private kill(s: Shot): void {
    s.active = false;
    s.group.visible = false;
  }

  /** Explosive shot detonation: an AoE blast (friendly only) + a punchy boom. */
  private detonate(s: Shot): void {
    const p = s.group.position;
    const rad = s.explodeRadius;
    if (s.friendly) this.ctx.combat.aoeDamage(p.x, p.z, rad, s.dmg, s.knockback, true);
    this.ctx.fx.ring(p.x, p.z, { radius: rad, color: s.color, duration: 0.4, y: 0.3, startRadius: 0.4 });
    this.ctx.fx.ring(p.x, p.z, { radius: rad * 0.55, color: 0xffffff, duration: 0.26, y: 0.35, startRadius: 0.3 });
    this.ctx.fx.burst({ x: p.x, y: 0.6, z: p.z, count: 30, color: [s.color, 0xffffff], speed: [5, 16], up: 0.8, size: [0.16, 0.5], life: [0.3, 0.7] });
    this.ctx.cam.addTrauma(0.18);
    this.ctx.sfx.explosion();
    this.kill(s);
  }

  private impact(p: THREE.Vector3, color: number): void {
    this.ctx.fx.burst({ x: p.x, y: p.y, z: p.z, count: 18, color: [color, 0xffffff], speed: [3, 11], size: [0.12, 0.36], life: [0.2, 0.5] });
  }
}
