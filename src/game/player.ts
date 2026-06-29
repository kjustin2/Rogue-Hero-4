import * as THREE from "three";
import type { Ctx } from "./ctx";
import { MOVES, GLYPH_ORDER, moveDuration, type GlyphId, type MoveDef } from "./moves";
import { matchCombo } from "./combos";
import { clamp, damp, ease } from "../core/math";

const WALK_SPEED = 9;
const DASH_SPEED = 30;
const DASH_TIME = 0.22;
const DASH_IFRAMES = 0.28;
const DASH_CD = 0.85;
const COMBO_WINDOW = 1.4; // seconds allowed between glyphs to keep the chain
const BUFFER_MAX = 6;

// ---- weapon viewmodel poses: [px, py, pz, rx, ry, rz] ----
type Pose = [number, number, number, number, number, number];
const REST: Pose = [0.52, -0.58, -0.95, 0.12, -0.2, 0.08];

interface SwingKey { t: number; pose: Pose; flash?: number; stretch?: number }

/**
 * Keyframed swings: anticipation → a fast snap through the impact key → settle.
 * `flash`/`stretch` on the impact key drive a blade emissive pop + length stretch
 * so the hit reads in first person.
 */
const SWINGS: Record<GlyphId, SwingKey[]> = {
  // fast diagonal slash: big wind-up up-right (blade rolled) → rip through to low-left → follow-through
  strike: [
    { t: 0, pose: REST },
    { t: 0.14, pose: [0.74, -0.42, -0.8, -0.25, -0.9, 0.95] },
    { t: 0.34, pose: [0.2, -0.7, -1.42, 0.35, 1.15, -1.0], flash: 3.8, stretch: 1.7 },
    { t: 0.5, pose: [0.34, -0.66, -1.05, 0.2, 0.7, -0.5] },
    { t: 1, pose: REST },
  ],
  // overhead chop: wind WAY back overhead (anticipation) → heavy two-hand slam → recoil → settle
  cleave: [
    { t: 0, pose: REST },
    { t: 0.28, pose: [0.3, 0.22, -0.5, -2.1, -0.18, 0.22] },
    { t: 0.46, pose: [0.42, -0.92, -1.55, 1.6, -0.04, 0.0], flash: 6.5, stretch: 1.95 },
    { t: 0.62, pose: [0.46, -0.62, -1.0, 0.55, -0.1, 0.05] },
    { t: 1, pose: REST },
  ],
  // ranged thrust: draw back + up → punch forward (flash) → settle
  bolt: [
    { t: 0, pose: REST },
    { t: 0.38, pose: [0.6, -0.48, -0.62, -0.2, -0.3, 0.12] },
    { t: 0.58, pose: [0.5, -0.55, -1.55, 0.3, -0.16, 0.04], flash: 4.5 },
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
  // accelerate INTO an impact key, decelerate out of it
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

/**
 * First-person player: camera-relative movement, the limited glyph moveset with a
 * rolling combo buffer, dash i-frames, and an animated weapon viewmodel parented to
 * the camera. The camera owns look; this owns position + actions.
 */
export class Player {
  pos = new THREE.Vector3();
  radius = 0.5;
  maxHp = 120;
  hp = 120;
  alive = true;
  iframes = 0;
  /** Debug invulnerability (smoke/screenshot harness). */
  god = false;
  /** Frozen during cutscenes — no actions, no movement (camera takes over). */
  frozen = false;

  /** Recent glyph casts (combo buffer) — HUD reads this for the chain readout. */
  buffer: GlyphId[] = [];
  cooldowns: Record<GlyphId, number> = { strike: 0, cleave: 0, bolt: 0 };
  current: MoveDef | null = null;
  /** Name + timer of the last resolved combo (HUD banner). */
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
  private weapon = new THREE.Group();
  private blade!: THREE.Group;
  private bladeMat!: THREE.MeshStandardMaterial;
  private tipMarker = new THREE.Object3D();
  private baseMarker = new THREE.Object3D();
  private tip = new THREE.Vector3();
  private base = new THREE.Vector3();

  // scratch
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private aim = new THREE.Vector3();

  constructor(private ctx: Ctx) {
    this.buildViewmodel();
    this.ctx.stage.camera.add(this.vm);
  }

  reset(spawn: THREE.Vector3): void {
    this.pos.copy(spawn);
    this.hp = this.maxHp;
    this.alive = true;
    this.iframes = 0;
    this.buffer.length = 0;
    this.current = null;
    this.moveT = 0;
    this.dashTime = 0;
    this.dashCd = 0;
    this.lastCombo = "";
    this.cooldowns.strike = this.cooldowns.cleave = this.cooldowns.bolt = 0;
  }

  // ----------------------------------------------------------------- viewmodel
  private buildViewmodel(): void {
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x14161f, roughness: 0.38, metalness: 0.88, emissive: 0x14306a, emissiveIntensity: 0.3, envMapIntensity: 1.1 });
    const gemMat = new THREE.MeshStandardMaterial({ color: 0x0a0c16, emissive: 0x9fe8ff, emissiveIntensity: 2.2, roughness: 0.2, metalness: 0.2 });
    // emissive blade material — recolored per glyph in startMove(), drives the flash
    this.bladeMat = new THREE.MeshStandardMaterial({ color: 0x0a0c16, emissive: 0x46e0ff, emissiveIntensity: 1.8, roughness: 0.3, metalness: 0.2 });

    // gauntlet / forearm with knuckle gem
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.5), darkMetal);
    arm.position.set(0, -0.05, 0.3);
    const knuckles = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.2), darkMetal);
    knuckles.position.set(0, 0.0, 0.06);
    const knuckleGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.06), gemMat);
    knuckleGem.position.set(0, 0.07, 0.06);
    this.weapon.add(arm, knuckles, knuckleGem);

    // hilt + winged crossguard + central gem
    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.28, 8), darkMetal);
    hilt.rotation.x = Math.PI / 2;
    hilt.position.set(0, 0.02, -0.08);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.13), darkMetal);
    guard.position.set(0, 0.02, -0.22);
    const guardGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.08), this.bladeMat);
    guardGem.position.set(0, 0.02, -0.22);
    this.weapon.add(hilt, guard, guardGem);
    for (const sx of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 4), this.bladeMat);
      wing.position.set(sx * 0.18, 0.02, -0.22);
      wing.rotation.z = sx * Math.PI / 2;
      this.weapon.add(wing);
    }

    // blade: dark metal core + two bright emissive edges + a pointed tip (scalable group)
    this.blade = new THREE.Group();
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 1.05), darkMetal);
    core.position.set(0, 0.02, -0.78);
    for (const sx of [-1, 1]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.13, 1.05), this.bladeMat);
      edge.position.set(sx * 0.03, 0.02, -0.78);
      this.blade.add(edge);
    }
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.32, 4), this.bladeMat);
    tip.rotation.x = -Math.PI / 2;
    tip.position.set(0, 0.02, -1.36);
    this.blade.add(core, tip);
    this.weapon.add(this.blade);

    this.tipMarker.position.set(0, 0.02, -1.4);
    this.baseMarker.position.set(0, 0.02, -0.25);
    this.weapon.add(this.tipMarker, this.baseMarker);

    this.weapon.position.set(0.52, -0.56, -0.95);
    this.weapon.rotation.set(0.12, -0.2, 0.08);
    this.vm.add(this.weapon);

    this.vm.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
    this.vm.renderOrder = 10;
  }

  // ----------------------------------------------------------------- update
  update(dt: number): void {
    this.iframes = Math.max(0, this.iframes - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.lastComboT = Math.max(0, this.lastComboT - dt);
    for (const g of GLYPH_ORDER) this.cooldowns[g] = Math.max(0, this.cooldowns[g] - dt);

    // combo buffer decays if you wait too long between glyphs
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
    if (this.current) return; // committed to a move
    if (input.actionPressed("light") && this.cooldowns.strike <= 0) this.startMove("strike");
    else if (input.actionPressed("heavy") && this.cooldowns.cleave <= 0) this.startMove("cleave");
    else if (input.actionPressed("bolt") && this.cooldowns.bolt <= 0) this.startMove("bolt");
  }

  private startMove(id: GlyphId): void {
    const m = MOVES[id];
    this.current = m;
    this.moveT = 0;
    this.hitDone = false;
    this.cooldowns[id] = m.cooldown;
    this.bladeMat.emissive.setHex(m.color);
  }

  private advanceMove(dt: number): void {
    const m = this.current;
    if (!m) return;
    this.moveT += dt;
    if (!this.hitDone && this.moveT >= m.windup) {
      this.hitDone = true;
      this.fireHit(m);
    }
    if (this.moveT >= moveDuration(m)) this.current = null;
  }

  private fireHit(m: MoveDef): void {
    this.ctx.cam.worldForward(this.fwd);
    const fx = this.fwd.x, fz = this.fwd.z;

    if (m.kind === "melee") {
      this.ctx.sfx.meleeSwing(m.id === "cleave");
      this.ctx.combat.meleeSweep(this.pos.x, this.pos.z, fx, fz, m.arc, m.range, m.damage, m.knockback, m.id === "cleave");
      this.ctx.cam.kick(-fx, -fz, m.id === "cleave" ? 0.5 : 0.2);
      // a slash crescent sweeps ahead so the swing reads (cleave = overhead, strike = diagonal)
      const reach = m.range * 0.55;
      const cleave = m.id === "cleave";
      this.ctx.fx.slash(this.pos.x + fx * reach, 1.3, this.pos.z + fz * reach, Math.atan2(fx, fz), {
        color: m.color, radius: cleave ? 3.6 : 2.2, tilt: cleave ? -0.08 : -0.7, duration: cleave ? 0.26 : 0.2, spin: cleave ? 1.5 : 4,
      });
      if (cleave) {
        // the heavy chop cracks the ground: a forward shockwave ring + ember plume + a real hit on the camera
        const wx = this.pos.x + fx * m.range * 0.8;
        const wz = this.pos.z + fz * m.range * 0.8;
        this.ctx.fx.ring(wx, wz, { radius: m.range + 2.5, color: m.color, duration: 0.5, y: 0.12, startRadius: 0.6 });
        this.ctx.fx.ring(wx, wz, { radius: m.range + 1, color: 0xffffff, duration: 0.32, y: 0.14, startRadius: 0.4 });
        this.ctx.fx.burst({ x: wx, y: 0.5, z: wz, count: 28, color: [m.color, 0xffffff], speed: [5, 15], up: 0.9, size: [0.16, 0.42], life: [0.3, 0.7] });
        this.ctx.cam.addTrauma(0.34);
        this.ctx.cam.pulseFov(0.3);
        this.ctx.stage.punch(0.3);
      }
    } else {
      // bolt fires along the full 3D look direction from ~eye height, so it travels
      // straight down the crosshair ray (aim up → bolt rises toward the boss core)
      this.ctx.sfx.boltCast();
      this.ctx.cam.forward(this.aim);
      this.ctx.projectiles.spawn(this.pos.x, 1.55, this.pos.z, this.aim, 34, m.damage, true, m.color, m.knockback);
      this.ctx.cam.kick(-fx, -fz, 0.15);
      // muzzle flash at the blade tip
      this.tipMarker.getWorldPosition(this.tip);
      this.ctx.fx.burst({ x: this.tip.x, y: this.tip.y, z: this.tip.z, count: 10, color: [m.color, 0xffffff], speed: [2, 7], size: [0.1, 0.3], life: [0.12, 0.3] });
    }

    // record glyph + test the chain
    this.buffer.push(m.id);
    if (this.buffer.length > BUFFER_MAX) this.buffer.shift();
    this.bufferTimer = 0;

    const combo = matchCombo(this.buffer);
    if (combo) {
      const ix = this.pos.x + fx * 2.6;
      const iz = this.pos.z + fz * 2.6;
      this.ctx.combat.resolveCombo(combo, ix, iz, fx, fz, m.damage);
      this.lastCombo = combo.name;
      this.lastComboT = 2.4;
      this.buffer.length = 0;
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
      // dodge in the direction you're MOVING (camera-relative WASD), not where you look —
      // strafe-dodge left/right/back all roll off the input vector, the FPS standard.
      const fwdAmt = -mv.z;
      this.dashDir.set(
        this.fwd.x * fwdAmt + this.right.x * mv.x,
        0,
        this.fwd.z * fwdAmt + this.right.z * mv.x,
      ).normalize();
    } else {
      // no input: a backstep away from the threat ahead, not a lunge toward your look
      this.dashDir.copy(this.fwd).multiplyScalar(-1);
    }
    this.ctx.cam.dodgeTilt(this.dashDir.x, this.dashDir.z); // lean the view into the dodge
    this.ctx.events.emit("DODGE", {});
    this.ctx.sfx.dashWhoosh();
    this.ctx.cam.pulseFov(0.4);
    this.ctx.fx.burst({ x: this.pos.x, y: 0.6, z: this.pos.z, count: 14, color: 0x9fe8ff, speed: [4, 9], vertical: 0.3, life: [0.2, 0.5] });
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
      if (this.current && this.current.kind === "melee") speed *= 0.4; // committed swing roots you
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
    const m = this.current;
    let pose: Pose;
    let flash = 0;
    let stretch = 1;
    let trailActive = false;

    if (!m) {
      // rest + breathing / locomotion sway
      pose = [...REST] as Pose;
      pose[0] += this.moveAmount * 0.03 * Math.cos(t * 5.5);
      pose[1] += -this.moveAmount * 0.03;
      pose[2] += this.moveAmount * 0.04 * Math.sin(t * 11);
      pose[3] += Math.sin(t * 1.3) * 0.02;
    } else {
      const p = clamp(this.moveT / moveDuration(m), 0, 1);
      const s = samplePose(SWINGS[m.id], p);
      pose = s.pose;
      flash = s.flash;
      stretch = s.stretch;
      trailActive = m.kind === "melee" && p > 0.18 && p < 0.62;
    }

    this.weapon.position.set(pose[0], pose[1], pose[2]);
    this.weapon.rotation.set(pose[3], pose[4], pose[5]);
    this.blade.scale.z = stretch;
    this.bladeMat.emissiveIntensity = 1.8 + flash;

    // feed the sword trail (world-space tip/base of the blade)
    this.tipMarker.getWorldPosition(this.tip);
    this.baseMarker.getWorldPosition(this.base);
    this.ctx.trail.setColor(m ? m.color : 0x46e0ff);
    this.ctx.trail.update(dt, this.tip, this.base, trailActive);
  }
}
