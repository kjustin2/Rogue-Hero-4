import * as THREE from "three";
import type { Ctx } from "./ctx";
import { weaponById } from "./weapons";

interface Shard {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  t: number;
  heal: number;
  alive: boolean;
}

interface WeaponDrop {
  group: THREE.Group;
  icon: THREE.Mesh;
  pillarMat: THREE.MeshBasicMaterial;
  id: string;
  t: number;
  alive: boolean;
}

import { PAL } from "../core/palette";

const COLOR = PAL.gold;
const MAGNET_R = 6;
const PICKUP_R = 1.4;
const WEAPON_PICKUP_R = 2.4;

/**
 * Health shards — dropped by slain enemies, magnet toward the player when close,
 * and heal on contact. They turn the long causeway into a risk/reward push instead
 * of pure attrition (kill aggressively to stay topped up).
 */
export class Pickups {
  private list: Shard[] = [];
  private drops: WeaponDrop[] = [];
  private geo = new THREE.OctahedronGeometry(0.38);

  constructor(private ctx: Ctx) {}

  maybeDrop(x: number, z: number, chance = 0.7, heal = 16): void {
    if (this.ctx.rng.chance(chance)) this.drop(x, z, heal);
  }

  /** Active (uncollected) shards on the field — test seam. */
  count(): number {
    let n = 0;
    for (const s of this.list) if (s.alive) n++;
    return n;
  }

  /** A distinct floating silhouette per weapon type so a drop reads at a glance. */
  private iconGeo(id: string): THREE.BufferGeometry {
    switch (id) {
      case "boltcaster": return new THREE.ConeGeometry(0.28, 1.0, 6);          // a bolt/dart
      case "greatsword": return new THREE.BoxGeometry(0.18, 1.1, 0.06);        // a blade
      case "rocketlance": return new THREE.SphereGeometry(0.42, 14, 12);       // a cannonball
      case "arclaser": return new THREE.OctahedronGeometry(0.5);               // a crystal
      case "stormcaller": return new THREE.IcosahedronGeometry(0.46, 0);       // a storm orb
      default: return new THREE.OctahedronGeometry(0.5);
    }
  }

  /** Place an unclaimed weapon on the causeway: a hovering icon under a light pillar. */
  dropWeapon(id: string, x: number, z: number): void {
    const w = weaponById(id);
    const group = new THREE.Group();
    const iconMat = new THREE.MeshStandardMaterial({ color: 0x05060d, emissive: w.color, emissiveIntensity: 2.6, roughness: 0.3, metalness: 0.4 });
    const icon = new THREE.Mesh(this.iconGeo(id), iconMat);
    icon.position.y = 1.5;
    const pillarMat = new THREE.MeshBasicMaterial({ color: w.color, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.85, 9, 14, 1, true), pillarMat);
    pillar.position.y = 4.5;
    const ringMat = new THREE.MeshBasicMaterial({ color: w.color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const ringGeo = new THREE.RingGeometry(1.1, 1.4, 36); ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.06;
    group.add(icon, pillar, ring);
    group.position.set(x, 0, z);
    this.ctx.stage.scene.add(group);
    this.drops.push({ group, icon, pillarMat, id, t: 0, alive: true });
    this.ctx.fx.beam(x, z, w.color);
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
    for (const d of this.drops) this.disposeDrop(d);
    this.drops.length = 0;
  }

  private disposeDrop(d: WeaponDrop): void {
    d.group.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
    this.ctx.stage.scene.remove(d.group);
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
      const magnetR = MAGNET_R * this.ctx.player.mods.magnetMult; // SHARD CALL boon
      if (d < magnetR) {
        const pull = (1 - d / magnetR) * 14 * dt;
        m.x += (dx / d) * pull;
        m.z += (dz / d) * pull;
      }
      if (d < PICKUP_R && p.alive) {
        // always collected — a rift shard counts toward weapon unlocks AND heals if hurt
        s.alive = false;
        const before = p.hp;
        p.addShard(s.heal);
        const healed = Math.round(p.hp - before);
        this.ctx.sfx.relicPickup();
        if (healed > 0) {
          this.ctx.events.emit("HEAL", { amount: healed });
          this.ctx.floaters.spawn(p.pos.x, 1.7, p.pos.z, "+" + healed, "heal");
        }
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

    // weapon drops: hover/spin + a dramatic claim when the player walks into the light
    for (const d of this.drops) {
      if (!d.alive) continue;
      d.t += dt;
      d.icon.rotation.y += dt * 1.7;
      d.icon.position.y = 1.5 + Math.sin(d.t * 2) * 0.2;
      d.pillarMat.opacity = 0.24 + Math.sin(d.t * 3) * 0.1;
      const gx = d.group.position.x, gz = d.group.position.z;
      if (Math.hypot(p.pos.x - gx, p.pos.z - gz) < WEAPON_PICKUP_R && p.alive && !p.weapons.includes(d.id)) {
        d.alive = false;
        p.unlockWeapon(d.id);
        const c = weaponById(d.id).color;
        this.ctx.fx.beam(gx, gz, c);
        this.ctx.fx.burst({ x: gx, y: 1.2, z: gz, count: 44, color: [c, 0xffffff], speed: [5, 17], up: 1, size: [0.16, 0.5], life: [0.4, 1.0] });
        this.ctx.fx.ring(gx, gz, { radius: 5, color: c, duration: 0.6, y: 0.2, startRadius: 0.5 });
        this.ctx.cam.addTrauma(0.3);
        this.ctx.hitstop = Math.max(this.ctx.hitstop, 0.12);
      }
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      if (!this.drops[i].alive) { this.disposeDrop(this.drops[i]); this.drops.splice(i, 1); }
    }
  }
}
