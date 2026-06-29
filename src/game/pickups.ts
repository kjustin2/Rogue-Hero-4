import * as THREE from "three";
import type { Ctx } from "./ctx";

interface Shard {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  t: number;
  heal: number;
  alive: boolean;
}

const COLOR = 0x6affa0;
const MAGNET_R = 6;
const PICKUP_R = 1.4;

/**
 * Health shards — dropped by slain enemies, magnet toward the player when close,
 * and heal on contact. They turn the long causeway into a risk/reward push instead
 * of pure attrition (kill aggressively to stay topped up).
 */
export class Pickups {
  private list: Shard[] = [];
  private geo = new THREE.OctahedronGeometry(0.38);

  constructor(private ctx: Ctx) {}

  maybeDrop(x: number, z: number, chance = 0.4, heal = 16): void {
    if (this.ctx.rng.chance(chance)) this.drop(x, z, heal);
  }

  drop(x: number, z: number, heal = 16): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x05130d, emissive: COLOR, emissiveIntensity: 2.4, roughness: 0.3 });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.position.set(x, 1, z);
    this.ctx.stage.scene.add(mesh);
    this.list.push({ mesh, mat, t: 0, heal, alive: true });
  }

  clear(): void {
    for (const s of this.list) this.ctx.stage.scene.remove(s.mesh);
    this.list.length = 0;
  }

  update(dt: number): void {
    const p = this.ctx.player;
    for (const s of this.list) {
      if (!s.alive) continue;
      s.t += dt;
      s.mesh.rotation.y += dt * 2.4;
      const m = s.mesh.position;
      m.y = 1 + Math.sin(s.t * 3) * 0.18;

      const dx = p.pos.x - m.x;
      const dz = p.pos.z - m.z;
      const d = Math.hypot(dx, dz) || 1;
      if (d < MAGNET_R) {
        const pull = (1 - d / MAGNET_R) * 14 * dt;
        m.x += (dx / d) * pull;
        m.z += (dz / d) * pull;
      }
      if (d < PICKUP_R && p.alive && p.hp < p.maxHp) {
        s.alive = false;
        p.hp = Math.min(p.maxHp, p.hp + s.heal);
        this.ctx.events.emit("HEAL", { amount: s.heal });
        this.ctx.floaters.spawn(p.pos.x, 1.7, p.pos.z, "+" + s.heal, "heal");
        this.ctx.fx.burst({ x: m.x, y: 1, z: m.z, count: 16, color: COLOR, speed: [3, 8], life: [0.2, 0.5] });
      }
    }
    // reap collected shards
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (!this.list[i].alive) {
        this.ctx.stage.scene.remove(this.list[i].mesh);
        this.list.splice(i, 1);
      }
    }
  }
}
