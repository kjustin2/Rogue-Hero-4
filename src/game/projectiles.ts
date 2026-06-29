import * as THREE from "three";
import type { Ctx } from "./ctx";
import { ARENA_CENTER, ARENA_RADIUS, HALF_WIDTH } from "./level";

interface Shot {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  vel: THREE.Vector3;
  life: number;
  dmg: number;
  knockback: number;
  friendly: boolean;
  active: boolean;
}

const POOL = 56;
const RADIUS = 0.35;

/**
 * One pooled set of glowing bolts for both the player's Bolt glyph (friendly) and
 * enemy/boss fire (hostile). Friendly bolts route hits through combat.dealDamage;
 * hostile bolts through combat.damagePlayer. Additive, bloom-friendly spheres.
 */
export class Projectiles {
  private pool: Shot[] = [];
  private geo = new THREE.SphereGeometry(RADIUS, 10, 8);

  constructor(private ctx: Ctx) {
    for (let i = 0; i < POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.visible = false;
      this.ctx.stage.scene.add(mesh);
      this.pool.push({ mesh, mat, vel: new THREE.Vector3(), life: 0, dmg: 0, knockback: 0, friendly: false, active: false });
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
    s.vel.copy(dir).normalize().multiplyScalar(speed);
    s.mesh.position.set(x, y, z);
    s.mat.color.setHex(color);
    s.mesh.visible = true;
  }

  clear(): void {
    for (const s of this.pool) { s.active = false; s.mesh.visible = false; }
  }

  update(dt: number): void {
    const player = this.ctx.player;
    for (const s of this.pool) {
      if (!s.active) continue;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.life -= dt;
      const p = s.mesh.position;
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
            this.burst(p, s.mat.color.getHex());
            this.kill(s);
            break;
          }
        }
      } else if (player.alive) {
        if (Math.hypot(p.x - player.pos.x, p.z - player.pos.z) <= player.radius + RADIUS) {
          this.ctx.combat.damagePlayer(s.dmg, p.x, p.z);
          this.burst(p, s.mat.color.getHex());
          this.kill(s);
        }
      }
    }
  }

  private kill(s: Shot): void {
    s.active = false;
    s.mesh.visible = false;
  }

  private burst(p: THREE.Vector3, color: number): void {
    this.ctx.fx.burst({ x: p.x, y: p.y, z: p.z, count: 8, color, speed: [2, 6], size: [0.1, 0.25], life: [0.2, 0.45] });
  }
}
