import * as THREE from "three";
import type { Ctx } from "./ctx";
import { ARENA_CENTER, ARENA_RADIUS, HALF_WIDTH } from "./level";

interface Shot {
  group: THREE.Group;
  glow: THREE.Mesh;
  glowMat: THREE.MeshBasicMaterial;
  tailMat: THREE.MeshBasicMaterial;
  vel: THREE.Vector3;
  life: number;
  dmg: number;
  knockback: number;
  friendly: boolean;
  active: boolean;
  trailT: number;
  color: number;
}

const POOL = 56;
const RADIUS = 0.35; // collision radius (gameplay) — visual size is independent
const FWD = new THREE.Vector3(0, 0, 1);

/**
 * One pooled set of energy tracers for the player's Bolt glyph (friendly) and all
 * enemy/boss fire (hostile). Each shot is a comet — a white-hot core, a colored glow,
 * and a tail cone streaking back along its velocity, with a throttled spark trail.
 * Friendly hits route through combat.dealDamage; hostile through combat.damagePlayer.
 */
export class Projectiles {
  private pool: Shot[] = [];
  private headGeo = new THREE.SphereGeometry(0.18, 10, 8);
  private glowGeo = new THREE.SphereGeometry(0.4, 12, 10);
  private tailGeo: THREE.ConeGeometry;
  private headMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  private q = new THREE.Quaternion();
  private vn = new THREE.Vector3();

  constructor(private ctx: Ctx) {
    // comet tail: cone apex forward (+Z = travel dir), flaring back to -Z behind the head
    this.tailGeo = new THREE.ConeGeometry(0.3, 1.8, 12, 1, true);
    this.tailGeo.rotateX(Math.PI / 2);
    this.tailGeo.translate(0, 0, -0.9);

    for (let i = 0; i < POOL; i++) {
      const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
      const tailMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const group = new THREE.Group();
      const glow = new THREE.Mesh(this.glowGeo, glowMat);
      group.add(glow);
      group.add(new THREE.Mesh(this.headGeo, this.headMat));
      group.add(new THREE.Mesh(this.tailGeo, tailMat));
      group.visible = false;
      group.frustumCulled = false;
      group.renderOrder = 5;
      this.ctx.stage.scene.add(group);
      this.pool.push({ group, glow, glowMat, tailMat, vel: new THREE.Vector3(), life: 0, dmg: 0, knockback: 0, friendly: false, active: false, trailT: 0, color: 0xffffff });
    }
  }

  spawn(x: number, y: number, z: number, dir: THREE.Vector3, speed: number, dmg: number, friendly: boolean, color: number, knockback = 3): void {
    const s = this.pool.find((p) => !p.active);
    if (!s) return;
    s.active = true;
    s.friendly = friendly;
    s.dmg = dmg;
    s.knockback = knockback;
    s.life = 3.2;
    s.trailT = 0;
    s.color = color;
    s.vel.copy(dir).normalize().multiplyScalar(speed);
    s.group.position.set(x, y, z);
    s.glowMat.color.setHex(color);
    s.tailMat.color.setHex(color);
    s.group.visible = true;
    this.orient(s);
    // muzzle flash
    this.ctx.fx.burst({ x, y, z, count: 6, color: [color, 0xffffff], speed: [3, 8], size: [0.12, 0.3], life: [0.12, 0.3] });
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
    for (const s of this.pool) {
      if (!s.active) continue;
      const p = s.group.position;
      p.addScaledVector(s.vel, dt);
      s.life -= dt;
      this.orient(s);
      // gentle core flicker so the bolt feels alive
      s.glow.scale.setScalar(0.85 + Math.sin((3.2 - s.life) * 32) * 0.15);
      // throttled trailing sparks
      s.trailT -= dt;
      if (s.trailT <= 0) {
        s.trailT = 0.035;
        this.ctx.fx.burst({ x: p.x, y: p.y, z: p.z, count: 1, color: s.color, speed: [0.2, 1.2], size: [0.12, 0.26], life: [0.18, 0.36], gravity: 0, drag: 3 });
      }

      // out of bounds / expired
      const outX = Math.abs(p.x) > HALF_WIDTH + 2 && p.z < ARENA_CENTER.y - ARENA_RADIUS;
      const inArenaOut = p.z >= ARENA_CENTER.y - ARENA_RADIUS && Math.hypot(p.x - ARENA_CENTER.x, p.z - ARENA_CENTER.y) > ARENA_RADIUS + 2;
      if (s.life <= 0 || p.z < -4 || outX || inArenaOut) { this.kill(s); continue; }

      if (s.friendly) {
        for (const t of this.ctx.combat.targets()) {
          const top = t.hitTop ?? 2.6;
          if (Math.hypot(p.x - t.pos.x, p.z - t.pos.z) <= t.radius + RADIUS && p.y >= 0.2 && p.y <= top) {
            const weak = t.isWeakHit ? t.isWeakHit(p.x, p.y, p.z) : false;
            this.ctx.combat.dealDamage(t, s.dmg, { knockback: s.knockback, fromX: p.x - s.vel.x, fromZ: p.z - s.vel.z, weak });
            this.impact(p, s.color);
            this.kill(s);
            break;
          }
        }
      } else if (player.alive) {
        if (Math.hypot(p.x - player.pos.x, p.z - player.pos.z) <= player.radius + RADIUS) {
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

  private impact(p: THREE.Vector3, color: number): void {
    this.ctx.fx.burst({ x: p.x, y: p.y, z: p.z, count: 16, color: [color, 0xffffff], speed: [3, 10], size: [0.12, 0.34], life: [0.2, 0.5] });
  }
}
