import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Ctx } from "./ctx";
import { ARENA_CENTER, ARENA_RADIUS, HALF_WIDTH } from "./level";

type Shape = "dart" | "cannonball" | "comet" | "skull" | "axe";

interface Shot {
  group: THREE.Group;
  bomb: THREE.Group;
  skullG: THREE.Group;
  axeG: THREE.Group;
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

const POOL = 72; // headroom for a boss volley (7) overlapping player finishers (bolts 9 / rocketvolley 5)
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
  private dartGeo: THREE.BufferGeometry;
  private headMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  // the iron bomb (bombard shells + crypt-bomber skulls): solid lit metal, not energy
  private bombIron = new THREE.MeshStandardMaterial({ color: 0x26221e, roughness: 0.55, metalness: 0.85, envMapIntensity: 1.0 });
  private bombBand = new THREE.MeshStandardMaterial({ color: 0x50301c, roughness: 0.7, metalness: 0.5 });
  private fuseMat = new THREE.MeshBasicMaterial({ color: 0xffc060, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  private skullBone = new THREE.MeshStandardMaterial({ color: 0xb8ac92, roughness: 0.85, metalness: 0.05, emissive: 0x2a251c, emissiveIntensity: 0.6 });
  private axeSteel = new THREE.MeshStandardMaterial({ color: 0x9aa2ac, roughness: 0.35, metalness: 0.9, emissive: 0x10151a, emissiveIntensity: 0.4 });
  private axeWood = new THREE.MeshStandardMaterial({ color: 0x4a341e, roughness: 0.9, metalness: 0.04 });
  private q = new THREE.Quaternion();
  private vn = new THREE.Vector3();

  constructor(private ctx: Ctx) {
    // comet tail: cone apex forward (+Z = travel dir), flaring back to -Z behind the head
    this.tailGeo = new THREE.ConeGeometry(0.3, 1.8, 12, 1, true);
    this.tailGeo.rotateX(Math.PI / 2);
    this.tailGeo.translate(0, 0, -0.9);
    // crossbow bolt: a slim shaft + a barbed head + 3 fletching vanes at the tail, merged
    // into one geometry (1 draw) — reads as a real medieval bolt, spun in flight (update).
    const shaft = new THREE.CylinderGeometry(0.035, 0.03, 0.95, 6).rotateX(Math.PI / 2);
    const head = new THREE.ConeGeometry(0.085, 0.36, 6).rotateX(Math.PI / 2).translate(0, 0, 0.62);
    const boltParts: THREE.BufferGeometry[] = [shaft, head];
    for (let k = 0; k < 3; k++) {
      const vane = new THREE.BoxGeometry(0.02, 0.2, 0.3)
        .translate(0, 0.13, 0)          // fin sits off the shaft
        .rotateZ((k / 3) * TAU)         // spread three around the axis
        .translate(0, 0, -0.4);         // at the tail
      boltParts.push(vane);
    }
    this.dartGeo = mergeGeometries(boltParts);
    boltParts.forEach((g) => g.dispose());

    for (let i = 0; i < POOL; i++) {
      const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
      const tailMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const runeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
      const group = new THREE.Group();
      // the bomb: a fat iron sphere, a rust girdle, a stub neck and a burning fuse tip
      const bomb = new THREE.Group();
      const shellM = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), this.bombIron);
      const girdle = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.04, 5, 12), this.bombBand);
      girdle.rotation.x = Math.PI / 2;
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.12, 6), this.bombBand);
      neck.position.y = 0.32;
      const fuse = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), this.fuseMat);
      fuse.position.y = 0.44;
      bomb.add(shellM, girdle, neck, fuse);
      group.add(bomb);
      // the witch-skull: a screaming bone skull, eyes lit in the caster's color
      const skullG = new THREE.Group();
      const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.22, 9, 7), this.skullBone);
      cranium.scale.set(1, 1.05, 1.15);
      const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.16), this.skullBone);
      jaw.position.set(0, -0.2, 0.08);
      const eyesM = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.05), glowMat);
      eyesM.position.set(0, 0.02, 0.2);
      skullG.add(cranium, jaw, eyesM);
      group.add(skullG);
      // the whirling francisca: short haft + bearded steel blade
      const axeG = new THREE.Group();
      const axHaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.8, 6), this.axeWood);
      const axBlade = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.08, 0.42, 3, 1), this.axeSteel);
      axBlade.scale.z = 0.16;
      axBlade.position.set(0.2, 0.32, 0);
      axBlade.rotation.z = -Math.PI / 2;
      axeG.add(axHaft, axBlade);
      group.add(axeG);
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
      this.pool.push({ group, bomb, skullG, axeG, glow, head, tail, ring, dart, runes, shape: "comet", glowMat, tailMat, runeMat, vel: new THREE.Vector3(), life: 0, dmg: 0, knockback: 0, friendly: false, active: false, trailT: 0, color: 0xffffff, scale: 1, pierce: false, hit: new Set(), explodeRadius: 0, grav: 0 });
    }
  }

  spawn(x: number, y: number, z: number, dir: THREE.Vector3, speed: number, dmg: number, friendly: boolean, color: number, knockback = 3, opts?: { scale?: number; pierce?: boolean; explode?: number; gravity?: number; shape?: Shape }): void {
    let s = this.pool.find((p) => !p.active);
    if (!s) {
      // pool saturated (a boss volley overlapping a big player finisher): steal the shot
      // closest to expiry instead of silently dropping this one — a fired shot must always
      // spawn its tracer + damage. spawn() below fully re-inits the reused slot.
      s = this.pool.reduce((a, b) => (b.life < a.life ? b : a));
    }
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
    // shape: a bare iron crossbow bolt, a fused iron BOMB, or the runed arcane comet
    s.shape = opts?.shape ?? "comet";
    const isBomb = s.shape === "cannonball";
    s.bomb.visible = isBomb;
    s.bomb.rotation.set(0, 0, 0);
    s.skullG.visible = s.shape === "skull";
    s.skullG.rotation.set(0, 0, 0);
    s.axeG.visible = s.shape === "axe";
    s.axeG.rotation.set(0, 0, 0);
    s.dart.visible = s.shape === "dart";
    s.glow.visible = s.shape === "comet";
    s.head.visible = s.shape === "comet";
    s.ring.visible = s.shape === "comet";
    // ponytail: only the player's hero comet wears orbiting runes; hostile shots skip
    // them (3 fewer draws/bolt — a boss volley is 7 bolts) and read fine as plain comets.
    s.runes.visible = s.shape === "comet" && friendly;
    s.tail.visible = s.shape === "comet"; // bolts and bombs are METAL — no energy tracer
    s.group.visible = true;
    this.orient(s);
    // muzzle flash — fatter for a big shot, a bare wisp for a bolt
    this.ctx.fx.burst({ x, y, z, count: s.shape === "dart" ? 3 : s.scale > 1.5 ? 16 : 6, color: [color, 0xffffff], speed: [3, 8 * s.scale], size: [0.1, 0.3 * s.scale], life: [0.1, 0.28] });
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
      // gravity shots meet the ground: bombs detonate, axes bite the flags
      if (s.grav && p.y <= 0.25) {
        if (s.explodeRadius > 0) { this.detonate(s); continue; }
        this.impact(s.group.position, s.color);
        this.kill(s);
        continue;
      }
      // nothing sails through the flags: any shot that dips below the floor impacts it
      if (p.y <= 0.1) {
        if (s.explodeRadius > 0) { this.detonate(s); continue; }
        p.y = 0.12;
        this.ctx.fx.burst({ x: p.x, y: 0.15, z: p.z, count: 8, color: s.color, speed: [2, 6], up: 1.2, size: [0.1, 0.26], life: [0.15, 0.35] });
        this.ctx.fx.ring(p.x, p.z, { radius: 0.9, color: s.color, duration: 0.22, y: 0.1, startRadius: 0.2 });
        this.kill(s);
        continue;
      }
      // living-bolt animation: pulsing glow + core, rune shards orbiting the travel axis
      const age = 3.2 - s.life;
      const isBomb = s.shape === "cannonball";
      if (isBomb) {
        // the bomb TUMBLES end over end, fuse hissing
        s.bomb.rotation.x += dt * 6.5;
        s.bomb.rotation.z += dt * 4.2;
      } else if (s.shape === "comet") {
        s.glow.scale.setScalar(0.85 + Math.sin(age * 30) * 0.15);
        s.head.scale.setScalar(0.9 + Math.sin(age * 46) * 0.22);
      } else if (s.shape === "skull") {
        // the skull wails as it flies — a slow roll + a wisp of grave-light
        s.skullG.rotation.z = Math.sin(age * 7) * 0.35;
        s.skullG.rotation.x = Math.sin(age * 5) * 0.2;
      } else if (s.shape === "axe") {
        s.axeG.rotation.x -= dt * 16; // end-over-end axe spin
      }
      s.runes.rotation.z += dt * 9;
      if (s.shape === "dart") s.dart.rotation.z += dt * 16; // fletched bolt spins in flight
      // throttled trail: hissing fuse embers + coal smoke on a bomb, a faint wisp on a bolt
      s.trailT -= dt;
      if (s.trailT <= 0) {
        s.trailT = isBomb ? 0.02 : 0.05;
        this.ctx.fx.burst({
          x: p.x, y: p.y, z: p.z, count: isBomb ? 3 : 1,
          color: isBomb ? [0xffd070, 0xff5020, 0x3a3230] : s.shape === "skull" ? s.color : 0x8a8078,
          speed: isBomb ? [0.5, 2.2] : [0.1, 0.6], up: isBomb ? 0.6 : 0,
          size: isBomb ? [0.14, 0.3] : [0.08, 0.16],
          life: isBomb ? [0.18, 0.36] : [0.1, 0.22], gravity: 0, drag: 3,
        });
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
            const dx = p.x - t.pos.x, dz = p.z - t.pos.z, rr = t.radius + r, top = t.hitTop ?? 2.6, bot = t.hitBottom ?? 0.2;
            if (dx * dx + dz * dz <= rr * rr && p.y >= bot && p.y <= top) { this.detonate(s); break; }
          }
        } else {
          for (const t of targets) {
            if (!t.alive) continue;
            const dx = p.x - t.pos.x, dz = p.z - t.pos.z, rr = t.radius + r, top = t.hitTop ?? 2.6, bot = t.hitBottom ?? 0.2;
            if (dx * dx + dz * dz <= rr * rr && p.y >= bot && p.y <= top) {
              if (s.pierce && s.hit.has(t)) continue; // a piercing shot hits each target once
              const weak = t.isWeakHit ? t.isWeakHit(p.x, p.y, p.z) : false;
              this.ctx.combat.dealDamage(t, s.dmg, { knockback: s.knockback, fromX: p.x - s.vel.x, fromZ: p.z - s.vel.z, weak });
              t.hitPart?.(p.x, p.y, p.z, s.dmg); // exact impact point → chip whatever armor/limb you aimed at
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

  /** Explosive shot detonation: a REAL boom — fireball, shockwaves, debris column. */
  private detonate(s: Shot): void {
    const p = s.group.position;
    const rad = s.explodeRadius;
    if (s.friendly) this.ctx.combat.aoeDamage(p.x, p.z, rad, s.dmg, s.knockback, true);
    else {
      // hostile mortar: the blast itself is the hit
      const pl = this.ctx.player;
      if (pl.alive && Math.hypot(pl.pos.x - p.x, pl.pos.z - p.z) <= rad + pl.radius) {
        this.ctx.combat.damagePlayer(s.dmg, p.x, p.z);
      }
    }
    this.ctx.fx.ring(p.x, p.z, { radius: rad, color: s.color, duration: 0.4, y: 0.3, startRadius: 0.4 });
    this.ctx.fx.ring(p.x, p.z, { radius: rad * 1.4, color: s.color, duration: 0.5, y: 0.2, startRadius: rad * 0.5 });
    this.ctx.fx.ring(p.x, p.z, { radius: rad * 0.55, color: 0xffffff, duration: 0.26, y: 0.35, startRadius: 0.3 });
    this.ctx.fx.burst({ x: p.x, y: 0.6, z: p.z, count: 34, color: [s.color, 0xffd070], speed: [5, 17], up: 0.8, size: [0.16, 0.5], life: [0.3, 0.7] });
    this.ctx.fx.burst({ x: p.x, y: 0.4, z: p.z, count: 14, color: 0xffb060, speed: [3, 9], up: 2.2, size: [0.2, 0.5], life: [0.4, 0.8] }); // debris column
    this.ctx.cam.addTrauma(0.26);
    // ponytail: no hit-stop on your own blasts (it slowed the frame when you attack); a hostile
    // mortar that hits the player still crunches via damagePlayer's wound hit-stop.
    this.ctx.sfx.explosion();
    this.kill(s);
  }

  /** Blunt (non-explosive) impact: a dull THUNK + dust — clearly a dud, not a boom. */
  private impact(p: THREE.Vector3, color: number): void {
    this.ctx.fx.burst({ x: p.x, y: p.y, z: p.z, count: 9, color, speed: [2, 7], size: [0.1, 0.26], life: [0.14, 0.32] });
    this.ctx.fx.burst({ x: p.x, y: p.y, z: p.z, count: 6, color: 0x9a8a78, speed: [1, 4], size: [0.14, 0.3], life: [0.2, 0.42], gravity: -2 }); // dust
    this.ctx.fx.ring(p.x, p.z, { radius: 0.8, color, duration: 0.15, y: p.y, startRadius: 0.2 });
    this.ctx.sfx.thud();
  }
}
