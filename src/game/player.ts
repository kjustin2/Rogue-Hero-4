import * as THREE from "three";
import type { Ctx } from "./ctx";
import { WEAPONS, attackDuration, matchWeaponCombo, weaponById, type AttackDef, type Slot, type WeaponDef } from "./weapons";
import { clamp, damp, ease } from "../core/math";

const WALK_SPEED = 14;      // brisk, arcade-fast traversal
const DASH_SPEED = 46;
const DASH_TIME = 0.26;     // longer burst → the dodge covers more ground
const DASH_IFRAMES = 0.3;
const DASH_CD = 0.65;
const COMBO_WINDOW = 1.3;   // seconds allowed between attacks to keep the chain
const BUFFER_MAX = 6;

// ---- weapon viewmodel poses: [px, py, pz, rx, ry, rz] ----
type Pose = [number, number, number, number, number, number];
const REST: Pose = [0.52, -0.58, -0.95, 0.12, -0.2, 0.08];

interface SwingKey { t: number; pose: Pose; flash?: number; stretch?: number }
type PoseId = "light" | "heavy" | "cast";

/**
 * Keyframed swings: anticipation → a fast snap through the impact key → settle.
 * Three reusable motions — a quick light slash, a heavy overhead, and a ranged
 * cast-thrust — picked by attack type + slot (melee light/heavy vs projectile cast).
 */
const SWINGS: Record<PoseId, SwingKey[]> = {
  // fast diagonal slash
  light: [
    { t: 0, pose: REST },
    { t: 0.16, pose: [0.74, -0.42, -0.8, -0.25, -0.9, 0.95] },
    { t: 0.42, pose: [0.2, -0.7, -1.42, 0.35, 1.15, -1.0], flash: 3.8, stretch: 1.7 },
    { t: 0.62, pose: [0.34, -0.66, -1.05, 0.2, 0.7, -0.5] },
    { t: 1, pose: REST },
  ],
  // heavy overhead chop
  heavy: [
    { t: 0, pose: REST },
    { t: 0.3, pose: [0.3, 0.22, -0.5, -2.1, -0.18, 0.22] },
    { t: 0.5, pose: [0.42, -0.92, -1.55, 1.6, -0.04, 0.0], flash: 6.5, stretch: 1.95 },
    { t: 0.66, pose: [0.46, -0.62, -1.0, 0.55, -0.1, 0.05] },
    { t: 1, pose: REST },
  ],
  // ranged cast-thrust
  cast: [
    { t: 0, pose: REST },
    { t: 0.34, pose: [0.6, -0.48, -0.62, -0.2, -0.3, 0.12] },
    { t: 0.56, pose: [0.5, -0.55, -1.45, 0.3, -0.16, 0.04], flash: 4.5 },
    { t: 0.72, pose: [0.54, -0.55, -1.05, 0.1, -0.2, 0.06] },
    { t: 1, pose: REST },
  ],
};

function samplePose(keys: SwingKey[], p: number): { pose: Pose; flash: number; stretch: number } {
  let a = keys[0];
  let b = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (p >= keys[i].t && p <= keys[i + 1].t) { a = keys[i]; b = keys[i + 1]; break; }
  }
  const span = b.t - a.t || 1;
  const easeFn = b.flash ? ease.inCubic : a.flash ? ease.outCubic : ease.inOutCubic;
  const k = easeFn(clamp((p - a.t) / span, 0, 1));
  const pose = a.pose.map((v, j) => v + (b.pose[j] - v) * k) as unknown as Pose;
  const imp = keys.find((kf) => kf.flash);
  let flash = 0;
  let stretch = 1;
  if (imp) {
    const bump = Math.max(0, 1 - Math.abs(p - imp.t) / 0.18);
    flash = (imp.flash ?? 0) * bump;
    stretch = 1 + ((imp.stretch ?? 1) - 1) * bump;
  }
  return { pose, flash, stretch };
}

interface ActiveAttack { a: AttackDef; slot: Slot; color: number; pose: PoseId }

/**
 * First-person player. Camera-relative movement; a swappable arsenal of weapons
 * (E cycles the unlocked set), each with a fast LIGHT (LMB) + strong HEAVY (RMB)
 * attack and its own light/heavy combos; dash i-frames; rift shards collected from
 * kills unlock new weapons. The weapon viewmodel is parented to the camera.
 */
export class Player {
  pos = new THREE.Vector3();
  radius = 0.5;
  maxHp = 120;
  hp = 120;
  alive = true;
  iframes = 0;
  god = false;
  frozen = false;

  /** Unlocked weapon ids (index into WEAPONS by id); starts with the bolt caster. */
  weapons: string[] = [WEAPONS[0].id];
  wi = 0;
  /** Rift shards collected this run — the unlock currency + HUD counter. */
  shards = 0;

  /** Recent light/heavy casts (combo buffer) — HUD reads this for the chain readout. */
  buffer: Slot[] = [];
  cooldowns: { light: number; heavy: number } = { light: 0, heavy: 0 };
  private cur: ActiveAttack | null = null;
  lastCombo = "";
  lastComboT = 0;
  moveAmount = 0;

  private moveT = 0;
  private hitDone = false;
  private bufferTimer = 0;
  private dashTime = 0;
  private dashCd = 0;
  private dashDir = new THREE.Vector3();

  // viewmodel
  private vm = new THREE.Group();
  private weaponGrp = new THREE.Group();
  private blade!: THREE.Group;
  private bladeMat!: THREE.MeshStandardMaterial;
  private castOrb!: THREE.Mesh;
  private castOrbMat!: THREE.MeshBasicMaterial;
  private gemMats: THREE.MeshStandardMaterial[] = [];
  private tipMarker = new THREE.Object3D();
  private baseMarker = new THREE.Object3D();
  private tip = new THREE.Vector3();
  private base = new THREE.Vector3();

  // scratch
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private aim = new THREE.Vector3();
  private dir = new THREE.Vector3();

  constructor(private ctx: Ctx) {
    this.buildViewmodel();
    this.ctx.stage.camera.add(this.vm);
    this.applyWeaponLook();
  }

  get weapon(): WeaponDef {
    return weaponById(this.weapons[this.wi]);
  }

  reset(spawn: THREE.Vector3): void {
    this.pos.copy(spawn);
    this.hp = this.maxHp;
    this.alive = true;
    this.iframes = 0;
    this.buffer.length = 0;
    this.cur = null;
    this.moveT = 0;
    this.dashTime = 0;
    this.dashCd = 0;
    this.lastCombo = "";
    this.cooldowns.light = this.cooldowns.heavy = 0;
    // fresh run: back to the starter weapon, shards zeroed
    this.weapons = [WEAPONS[0].id];
    this.wi = 0;
    this.shards = 0;
    this.applyWeaponLook();
    this.ctx.events.emit("SHARD", { total: 0 });
    this.ctx.events.emit("WEAPON_SWITCH", { id: this.weapon.id, name: this.weapon.name });
  }

  // ----------------------------------------------------------------- viewmodel
  private buildViewmodel(): void {
    const iron = new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.5, metalness: 0.85, emissive: 0x1a0f06, emissiveIntensity: 0.25, envMapIntensity: 1.1 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xaab2c0, roughness: 0.28, metalness: 0.98, emissive: 0x10151f, emissiveIntensity: 0.2, envMapIntensity: 1.4 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x2c1a0e, roughness: 0.85, metalness: 0.1, envMapIntensity: 0.5 });
    const gemMat = new THREE.MeshStandardMaterial({ color: 0x140a04, emissive: 0xffb24a, emissiveIntensity: 2.2, roughness: 0.25, metalness: 0.3 });
    this.gemMats.push(gemMat);
    // glowing rune metal on the blade — recolored per weapon, drives the attack flash
    this.bladeMat = new THREE.MeshStandardMaterial({ color: 0x0a0c10, emissive: 0xff7a2c, emissiveIntensity: 1.7, roughness: 0.3, metalness: 0.4 });

    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.5), iron);
    arm.position.set(0, -0.06, 0.32);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 0.22, 8), iron);
    cuff.rotation.x = Math.PI / 2; cuff.position.set(0, -0.04, 0.12);
    const knuckles = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.22), steel);
    knuckles.position.set(0, 0.02, 0.04);
    const knuckleGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.055), gemMat);
    knuckleGem.position.set(0, 0.1, 0.04);
    this.weaponGrp.add(arm, cuff, knuckles, knuckleGem);

    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.3, 8), leather);
    grip.rotation.x = Math.PI / 2; grip.position.set(0, 0.02, -0.02);
    const pommel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.07, 10), steel);
    pommel.rotation.x = Math.PI / 2; pommel.position.set(0, 0.02, 0.14);
    const pommelGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.055), gemMat);
    pommelGem.position.set(0, 0.02, 0.14);
    this.weaponGrp.add(grip, pommel, pommelGem);

    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.16), steel);
    guard.position.set(0, 0.02, -0.2);
    this.weaponGrp.add(guard);
    for (const sx of [-1, 1]) {
      const quillon = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), steel);
      quillon.position.set(sx * 0.27, 0.02, -0.2);
      this.weaponGrp.add(quillon);
    }
    const guardGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.07), this.bladeMat);
    guardGem.position.set(0, 0.02, -0.2);
    this.weaponGrp.add(guardGem);

    // blade group: steel blade with glowing edges + a rune fuller (scalable for the swing stretch)
    this.blade = new THREE.Group();
    const flat = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 1.15), steel);
    flat.position.set(0, 0.02, -0.82);
    for (const sy of [-1, 1]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.06, 1.15), this.bladeMat);
      edge.position.set(0, 0.02 + sy * 0.1, -0.82);
      this.blade.add(edge);
    }
    const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.0), this.bladeMat);
    fuller.position.set(0, 0.02, -0.8);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.42, 4), steel);
    tip.rotation.x = -Math.PI / 2;
    tip.position.set(0, 0.02, -1.46);
    tip.scale.set(0.42, 1, 1);
    this.blade.add(flat, fuller, tip);
    this.weaponGrp.add(this.blade);

    // a focusing orb that hovers at the blade tip for projectile weapons (hidden for melee)
    this.castOrbMat = new THREE.MeshBasicMaterial({ color: 0xffc24a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.castOrb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), this.castOrbMat);
    this.castOrb.position.set(0, 0.02, -1.62);
    this.blade.add(this.castOrb);

    this.tipMarker.position.set(0, 0.02, -1.5);
    this.baseMarker.position.set(0, 0.02, -0.25);
    this.weaponGrp.add(this.tipMarker, this.baseMarker);

    this.weaponGrp.position.set(0.52, -0.56, -0.95);
    this.weaponGrp.rotation.set(0.12, -0.2, 0.08);
    this.vm.add(this.weaponGrp);

    this.vm.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
    this.vm.renderOrder = 10;
  }

  /** Recolor the viewmodel to the equipped weapon + show the cast-orb on projectile weapons. */
  private applyWeaponLook(): void {
    const w = this.weapon;
    this.bladeMat.emissive.setHex(w.color);
    for (const g of this.gemMats) g.emissive.setHex(w.color);
    this.castOrbMat.color.setHex(w.color);
    this.castOrb.visible = w.kind === "projectile";
  }

  // ----------------------------------------------------------------- update
  update(dt: number): void {
    this.iframes = Math.max(0, this.iframes - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.lastComboT = Math.max(0, this.lastComboT - dt);
    this.cooldowns.light = Math.max(0, this.cooldowns.light - dt);
    this.cooldowns.heavy = Math.max(0, this.cooldowns.heavy - dt);

    if (this.buffer.length) {
      this.bufferTimer += dt;
      if (this.bufferTimer > COMBO_WINDOW) this.buffer.length = 0;
    }

    if (this.alive && !this.frozen) {
      this.handleActions();
      this.advanceMove(dt);
    }
    if (this.frozen) this.moveAmount = damp(this.moveAmount, 0, 8, dt);
    else this.move(dt);
    this.animate(dt);
  }

  private handleActions(): void {
    const input = this.ctx.input;
    if (input.actionPressed("dash") && this.dashCd <= 0) this.startDash();
    if (input.actionPressed("switch") && this.weapons.length > 1) this.cycleWeapon();
    if (this.cur) return; // committed to an attack
    if (input.actionPressed("light") && this.cooldowns.light <= 0) this.startAttack("light");
    else if (input.actionPressed("heavy") && this.cooldowns.heavy <= 0) this.startAttack("heavy");
  }

  cycleWeapon(dir = 1): void {
    this.wi = (this.wi + dir + this.weapons.length) % this.weapons.length;
    this.cooldowns.light = this.cooldowns.heavy = 0;
    this.buffer.length = 0;
    this.cur = null;
    this.applyWeaponLook();
    this.ctx.sfx.cardReady();
    this.ctx.events.emit("WEAPON_SWITCH", { id: this.weapon.id, name: this.weapon.name });
  }

  private startAttack(slot: Slot): void {
    const a = this.weapon[slot];
    const pose: PoseId = a.type === "melee" ? slot : "cast";
    this.cur = { a, slot, color: this.weapon.color, pose };
    this.moveT = 0;
    this.hitDone = false;
    this.cooldowns[slot] = a.cooldown;
    this.bladeMat.emissive.setHex(this.weapon.color);
  }

  private advanceMove(dt: number): void {
    const c = this.cur;
    if (!c) return;
    this.moveT += dt;
    if (!this.hitDone && this.moveT >= c.a.windup) {
      this.hitDone = true;
      this.fireHit(c);
    }
    if (this.moveT >= attackDuration(c.a)) this.cur = null;
  }

  private fireHit(c: ActiveAttack): void {
    const a = c.a;
    const color = c.color;
    this.ctx.cam.worldForward(this.fwd);
    const fx = this.fwd.x, fz = this.fwd.z;
    const heavy = c.slot === "heavy";

    if (a.type === "melee") {
      this.ctx.sfx.meleeSwing(heavy);
      this.ctx.combat.meleeSweep(this.pos.x, this.pos.z, fx, fz, a.arc, a.range, a.damage, a.knockback, heavy);
      this.ctx.cam.kick(-fx, -fz, heavy ? 0.5 : 0.2);
      const reach = a.range * 0.55;
      const sx = this.pos.x + fx * reach, sz = this.pos.z + fz * reach;
      this.ctx.fx.slash(sx, 1.3, sz, Math.atan2(fx, fz), {
        color, radius: heavy ? 3.6 : 2.2, tilt: heavy ? -0.08 : -0.7, duration: heavy ? 0.26 : 0.2, spin: heavy ? 1.5 : 4,
      });
      this.ctx.fx.burst({ x: sx, y: 1.3, z: sz, count: heavy ? 16 : 10, color: [color, 0xffffff], speed: [4, heavy ? 13 : 9], vertical: 0.5, size: [0.1, 0.32], life: [0.15, 0.4] });
      if (!heavy) {
        this.ctx.fx.slash(sx, 1.25, sz, Math.atan2(fx, fz), { color: 0xffffff, radius: 1.8, tilt: 0.55, duration: 0.18, spin: -5 });
        this.ctx.fx.ring(sx, sz, { radius: a.range + 0.5, color, duration: 0.3, y: 0.1, startRadius: 0.3 });
      } else {
        const wx = this.pos.x + fx * a.range * 0.8, wz = this.pos.z + fz * a.range * 0.8;
        this.ctx.fx.ring(wx, wz, { radius: a.range + 2.5, color, duration: 0.5, y: 0.12, startRadius: 0.6 });
        this.ctx.fx.ring(wx, wz, { radius: a.range + 1, color: 0xffffff, duration: 0.32, y: 0.14, startRadius: 0.4 });
        this.ctx.fx.burst({ x: wx, y: 0.5, z: wz, count: 28, color: [color, 0xffffff], speed: [5, 15], up: 0.9, size: [0.16, 0.42], life: [0.3, 0.7] });
        this.ctx.cam.addTrauma(0.34);
        this.ctx.cam.pulseFov(0.3);
        this.ctx.stage.punch(0.3);
      }
    } else {
      // projectile: fire `pellets` along the look ray, fanned by `spread`
      this.ctx.sfx.boltCast();
      this.ctx.cam.forward(this.aim);
      const n = Math.max(1, a.pellets);
      const opts = a.big ? { scale: 1.9, pierce: a.pierce } : a.pierce ? { pierce: true } : undefined;
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * a.spread;
        const ca = Math.cos(off), sa = Math.sin(off);
        this.dir.set(this.aim.x * ca - this.aim.z * sa, this.aim.y, this.aim.x * sa + this.aim.z * ca);
        this.ctx.projectiles.spawn(this.pos.x, 1.55, this.pos.z, this.dir, a.speed, a.damage, true, color, a.knockback, opts);
      }
      this.ctx.cam.kick(-fx, -fz, heavy ? 0.3 : 0.15);
      this.tipMarker.getWorldPosition(this.tip);
      this.ctx.fx.burst({ x: this.tip.x, y: this.tip.y, z: this.tip.z, count: heavy ? 22 : 14, color: [color, 0xffffff], speed: [3, 10], size: [0.1, 0.34], life: [0.12, 0.34] });
      this.ctx.fx.ring(this.tip.x, this.tip.z, { radius: 1.6, color, duration: 0.22, y: this.tip.y, startRadius: 0.2 });
      this.ctx.cam.pulseFov(0.12);
    }

    // record the attack + test the combo for THIS weapon
    this.buffer.push(c.slot);
    if (this.buffer.length > BUFFER_MAX) this.buffer.shift();
    this.bufferTimer = 0;

    const combo = matchWeaponCombo(this.buffer, this.weapon);
    if (combo) {
      const ix = this.pos.x + fx * 2.6;
      const iz = this.pos.z + fz * 2.6;
      this.ctx.combat.resolveCombo(combo, ix, iz, fx, fz, a.damage);
      this.lastCombo = combo.name;
      this.lastComboT = 2.4;
      this.buffer.length = 0;
    }
  }

  /** Collect a rift shard: bump the counter, heal overflow if hurt, unlock at thresholds. */
  addShard(heal: number): void {
    this.shards++;
    this.ctx.events.emit("SHARD", { total: this.shards });
    if (this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + heal);
    for (const w of WEAPONS) {
      if (w.unlockAt > 0 && this.shards >= w.unlockAt && !this.weapons.includes(w.id)) {
        this.weapons.push(w.id);
        this.ctx.events.emit("WEAPON_UNLOCK", { id: w.id, name: w.name });
        this.ctx.sfx.unlockFanfare();
      }
    }
  }

  private startDash(): void {
    this.dashCd = DASH_CD;
    this.dashTime = DASH_TIME;
    this.iframes = DASH_IFRAMES;
    const mv = this.ctx.input.moveVector();
    this.ctx.cam.worldForward(this.fwd);
    this.ctx.cam.worldRight(this.right);
    if (Math.hypot(mv.x, mv.z) > 0.1) {
      const fwdAmt = -mv.z;
      this.dashDir.set(
        this.fwd.x * fwdAmt + this.right.x * mv.x,
        0,
        this.fwd.z * fwdAmt + this.right.z * mv.x,
      ).normalize();
    } else {
      this.dashDir.copy(this.fwd).multiplyScalar(-1);
    }
    this.ctx.cam.dodgeTilt(this.dashDir.x, this.dashDir.z);
    this.ctx.events.emit("DODGE", {});
    this.ctx.sfx.dashWhoosh();
    this.ctx.cam.pulseFov(0.4);
    this.ctx.fx.burst({ x: this.pos.x, y: 0.6, z: this.pos.z, count: 14, color: 0xffd9a0, speed: [4, 9], vertical: 0.3, life: [0.2, 0.5] });
  }

  private move(dt: number): void {
    if (this.dashTime > 0) {
      this.dashTime -= dt;
      this.vel.copy(this.dashDir).multiplyScalar(DASH_SPEED);
    } else {
      const mv = this.ctx.input.moveVector();
      this.ctx.cam.worldForward(this.fwd);
      this.ctx.cam.worldRight(this.right);
      const fwdAmt = -mv.z;
      this.vel.set(
        this.fwd.x * fwdAmt + this.right.x * mv.x,
        0,
        this.fwd.z * fwdAmt + this.right.z * mv.x,
      );
      const len = Math.hypot(this.vel.x, this.vel.z);
      if (len > 1) this.vel.multiplyScalar(1 / len);
      let speed = WALK_SPEED;
      if (this.cur && this.cur.a.type === "melee") speed *= 0.5; // committed melee swing roots you a bit
      this.vel.multiplyScalar(this.alive ? speed : 0);
    }
    this.pos.addScaledVector(this.vel, dt);
    this.ctx.level.clampPosition(this.pos, this.radius);
    const target = this.dashTime > 0 ? 1 : clamp(Math.hypot(this.vel.x, this.vel.z) / WALK_SPEED, 0, 1);
    this.moveAmount = damp(this.moveAmount, target, 8, dt);
  }

  // ----------------------------------------------------------------- viewmodel anim
  private animate(dt: number): void {
    const t = performance.now() / 1000;
    const c = this.cur;
    let pose: Pose;
    let flash = 0;
    let stretch = 1;
    let trailActive = false;

    if (!c) {
      pose = [...REST] as Pose;
      pose[0] += this.moveAmount * 0.03 * Math.cos(t * 5.5);
      pose[1] += -this.moveAmount * 0.03;
      pose[2] += this.moveAmount * 0.04 * Math.sin(t * 11);
      pose[3] += Math.sin(t * 1.3) * 0.02;
    } else {
      const p = clamp(this.moveT / attackDuration(c.a), 0, 1);
      const s = samplePose(SWINGS[c.pose], p);
      pose = s.pose;
      flash = s.flash;
      stretch = s.stretch;
      trailActive = c.a.type === "melee" && p > 0.18 && p < 0.62;
    }

    this.weaponGrp.position.set(pose[0], pose[1], pose[2]);
    this.weaponGrp.rotation.set(pose[3], pose[4], pose[5]);
    this.blade.scale.z = stretch;
    this.bladeMat.emissiveIntensity = 1.8 + flash;
    // the cast orb breathes + flares when a projectile attack fires
    if (this.castOrb.visible) {
      const pulse = 0.85 + Math.sin(t * 6) * 0.15 + flash * 0.4;
      this.castOrb.scale.setScalar(pulse);
      this.castOrbMat.opacity = 0.6 + Math.min(0.4, flash * 0.4);
    }

    this.tipMarker.getWorldPosition(this.tip);
    this.baseMarker.getWorldPosition(this.base);
    this.ctx.trail.setColor(c ? c.color : this.weapon.color);
    this.ctx.trail.update(dt, this.tip, this.base, trailActive);
  }
}
