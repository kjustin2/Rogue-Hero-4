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
  icon: THREE.Object3D;
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

  /**
   * A recognizable mini-model of the ACTUAL weapon (a few primitives) so a drop reads at a
   * glance — not an abstract shape. One emissive material per drop, tinted the weapon hue.
   */
  private weaponPickupModel(id: string): THREE.Group {
    const w = weaponById(id);
    const mat = new THREE.MeshStandardMaterial({ color: 0x0a0b12, emissive: w.color, emissiveIntensity: 1.4, roughness: 0.35, metalness: 0.5 });
    const g = new THREE.Group();
    const part = (geo: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): void => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m);
    };
    switch (id) {
      case "boltcaster": // crossbow: stock + bow limbs + a nocked bolt
        part(new THREE.BoxGeometry(0.11, 0.7, 0.11)); // stock
        part(new THREE.BoxGeometry(0.95, 0.09, 0.09), 0, 0.28, 0); // bow limbs
        part(new THREE.CylinderGeometry(0.03, 0.03, 0.6), 0, 0.28, 0.25, Math.PI / 2, 0, 0); // bolt shaft
        part(new THREE.ConeGeometry(0.07, 0.16, 6), 0, 0.28, 0.58, Math.PI / 2, 0, 0); // bolt head
        break;
      case "greatsword": // long blade + crossguard + grip + pommel
        part(new THREE.BoxGeometry(0.15, 1.1, 0.05), 0, 0.35, 0); // blade
        part(new THREE.ConeGeometry(0.11, 0.22, 4), 0, 0.95, 0); // tip
        part(new THREE.BoxGeometry(0.62, 0.1, 0.12), 0, -0.22, 0); // crossguard
        part(new THREE.CylinderGeometry(0.05, 0.05, 0.32), 0, -0.42, 0); // grip
        part(new THREE.SphereGeometry(0.09, 10, 8), 0, -0.6, 0); // pommel
        break;
      case "rocketlance": // hand bombard: a banded tube with a flared muzzle
        part(new THREE.CylinderGeometry(0.2, 0.2, 0.95), 0, 0, 0, Math.PI / 2, 0, 0);
        part(new THREE.CylinderGeometry(0.26, 0.26, 0.08), 0, 0, 0.2, Math.PI / 2, 0, 0); // band
        part(new THREE.CylinderGeometry(0.26, 0.26, 0.08), 0, 0, -0.15, Math.PI / 2, 0, 0); // band
        part(new THREE.CylinderGeometry(0.3, 0.22, 0.14), 0, 0, 0.52, Math.PI / 2, 0, 0); // muzzle flare
        break;
      case "arclaser": // prism rod: a slim staff capped by a crystal
        part(new THREE.CylinderGeometry(0.05, 0.05, 1.0), 0, -0.1, 0);
        part(new THREE.OctahedronGeometry(0.26), 0, 0.5, 0);
        break;
      case "stormcaller": // storm staff: a staff, a clawed finial, a crackling orb
        part(new THREE.CylinderGeometry(0.05, 0.05, 1.0), 0, -0.1, 0);
        part(new THREE.TorusGeometry(0.18, 0.03, 8, 16), 0, 0.46, 0, Math.PI / 2, 0, 0); // finial ring
        part(new THREE.IcosahedronGeometry(0.2, 0), 0, 0.46, 0); // orb
        break;
      case "warhammer": // grave maul: a haft topped by a big blocky head
        part(new THREE.CylinderGeometry(0.055, 0.055, 1.1), 0, -0.15, 0);
        part(new THREE.BoxGeometry(0.52, 0.42, 0.42), 0, 0.5, 0); // head
        part(new THREE.BoxGeometry(0.16, 0.46, 0.46), 0.3, 0.5, 0); // striking face
        break;
      case "francisca": { // twin crossed throwing axes
        for (const s of [-1, 1]) {
          part(new THREE.BoxGeometry(0.05, 0.8, 0.05), s * 0.14, 0, 0, 0, 0, s * 0.32); // haft
          part(new THREE.CylinderGeometry(0.3, 0.08, 0.42, 3), s * 0.14 + s * 0.32, 0.3, 0, 0, 0, s * 0.32 - Math.PI / 2); // blade
        }
        break;
      }
      default:
        part(new THREE.OctahedronGeometry(0.5));
    }
    return g;
  }

  /** Place an unclaimed weapon on the causeway: a hovering icon under a light pillar. */
  dropWeapon(id: string, x: number, z: number): void {
    const group = new THREE.Group();
    const icon = this.weaponPickupModel(id);
    icon.scale.setScalar(1.35); // the weapon model is the hero — read it clearly
    icon.position.y = 1.7;
    // a SLIM, faint beacon shaft: the old wide/bright pillar washed the model out entirely
    const pillarMat = new THREE.MeshBasicMaterial({ color: PAL.gold, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }); // gold = the economy color; the icon keeps the weapon hue
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.5, 9, 14, 1, true), pillarMat);
    pillar.position.y = 4.5;
    const ringMat = new THREE.MeshBasicMaterial({ color: PAL.gold, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const ringGeo = new THREE.RingGeometry(1.1, 1.4, 36); ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.06;
    group.add(icon, pillar, ring);
    group.position.set(x, 0, z);
    this.ctx.stage.scene.add(group);
    this.drops.push({ group, icon, pillarMat, id, t: 0, alive: true });
    this.ctx.fx.beam(x, z, PAL.gold);
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
        this.ctx.fx.burst({ x: m.x, y: 1, z: m.z, count: 16, color: COLOR, speed: [3, 8], size: [0.08, 0.24], life: [0.2, 0.5] });
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
      d.icon.position.y = 1.7 + Math.sin(d.t * 2) * 0.2;
      d.pillarMat.opacity = 0.13 + Math.sin(d.t * 3) * 0.05;
      const gx = d.group.position.x, gz = d.group.position.z;
      if (Math.hypot(p.pos.x - gx, p.pos.z - gz) < WEAPON_PICKUP_R && p.alive && !p.weapons.includes(d.id)) {
        d.alive = false;
        if (p.weapons.length >= 5) this.ctx.events.emit("WEAPON_OFFER", { id: d.id });
        else p.unlockWeapon(d.id);
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
