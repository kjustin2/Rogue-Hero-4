import * as THREE from "three";
import type { Ctx } from "../game/ctx";
import { clamp, damp, dampAngle } from "../core/math";

const EYE_HEIGHT = 1.7;

/**
 * First-person camera. Owns yaw/pitch from locked-pointer mouse delta (+ right
 * stick), parks the shared stage camera at the player's eyes each frame, and keeps
 * the trauma / kick / FOV-pulse feel API the combat layer drives. Ground-projected
 * worldForward/worldRight give camera-relative WASD without ever using world -Z.
 */
export class FpsCamera {
  yaw = Math.PI; // face down the path (+Z) at spawn
  pitch = 0;
  sensitivity = 0.0022;
  /** Screen-shake multiplier (Settings → Screen Shake / Reduce Motion). */
  shakeScale = 1;

  private baseFov = 80;
  private fovPulse = 0;
  private trauma = 0;
  private recoil = 0; // upward pitch kick (weapon/hit recoil)
  private rollKick = 0; // camera roll — lean into a dodge
  private shoveX = 0;
  private shoveZ = 0;
  private bobPhase = 0;

  /** Cinematic look: while on, the camera eases toward cineTarget and ignores the mouse. */
  cinematic = false;
  private cineTarget = new THREE.Vector3();
  private tmp = new THREE.Vector3();

  private cam: THREE.PerspectiveCamera;

  constructor(private ctx: Ctx) {
    this.cam = ctx.stage.camera;
    this.cam.fov = this.baseFov;
    this.cam.near = 0.05;
    this.cam.rotation.order = "YXZ";
    this.cam.updateProjectionMatrix();
  }

  /** Ground-projected forward (XZ, normalized) for camera-relative movement. */
  worldForward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }
  worldRight(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }
  /** Full 3D look direction (includes pitch) — for aiming bolts. */
  forward(out: THREE.Vector3): THREE.Vector3 {
    return this.cam.getWorldDirection(out);
  }

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }
  /** Directional shove + recoil + shake — combat hit feel. */
  kick(dirX: number, dirZ: number, strength: number): void {
    this.trauma = Math.min(1, this.trauma + strength * 0.22);
    this.recoil += strength * 0.05;
    this.shoveX -= dirX * strength * 0.05;
    this.shoveZ -= dirZ * strength * 0.05;
  }
  pulseFov(amount: number): void {
    this.fovPulse = Math.min(0.7, this.fovPulse + amount);
  }
  /** Base field of view (Settings). */
  setBaseFov(fov: number): void {
    this.baseFov = fov;
  }
  /** Lean the view into a dodge: sideways component (vs facing) → a brief camera roll. */
  dodgeTilt(dirX: number, dirZ: number): void {
    this.worldRight(this.tmp);
    const lateral = dirX * this.tmp.x + dirZ * this.tmp.z;
    this.rollKick = -lateral * 0.14;
  }
  /** Drive a cutscene camera look toward a world point (ignores mouse while on). */
  setCinematic(on: boolean, target?: THREE.Vector3): void {
    this.cinematic = on;
    if (target) this.cineTarget.copy(target);
  }

  /** moveAmount 0..1 drives head-bob. */
  update(dt: number, moveAmount: number): void {
    // --- look input (cinematic auto-aim, else locked pointer + right stick) ---
    if (this.cinematic) {
      this.ctx.input.consumeMouseDelta(); // drain so control returns without a snap
      const px = this.ctx.player.pos.x, pz = this.ctx.player.pos.z;
      const dx = this.cineTarget.x - px;
      const dy = this.cineTarget.y - EYE_HEIGHT;
      const dz = this.cineTarget.z - pz;
      this.yaw = dampAngle(this.yaw, Math.atan2(-dx, -dz), 3.2, dt);
      this.pitch = clamp(damp(this.pitch, Math.atan2(dy, Math.hypot(dx, dz)), 3.2, dt), -1.2, 1.2);
    } else {
      const d = this.ctx.input.consumeMouseDelta();
      this.yaw -= d.dx * this.sensitivity;
      this.pitch -= d.dy * this.sensitivity;
      const gx = this.ctx.input.padAxis(2);
      const gy = this.ctx.input.padAxis(3);
      if (Math.abs(gx) > 0.2) this.yaw -= gx * 2.8 * dt;
      if (Math.abs(gy) > 0.2) this.pitch -= gy * 2.2 * dt;
      this.pitch = clamp(this.pitch, -1.2, 1.2);
    }

    // --- decays ---
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
    this.recoil = damp(this.recoil, 0, 9, dt);
    this.rollKick = damp(this.rollKick, 0, 8, dt);
    this.shoveX = damp(this.shoveX, 0, 10, dt);
    this.shoveZ = damp(this.shoveZ, 0, 10, dt);
    this.fovPulse = damp(this.fovPulse, 0, 6, dt);

    // --- head bob ---
    this.bobPhase += dt * 11 * moveAmount;
    const bob = Math.sin(this.bobPhase) * 0.045 * moveAmount;
    const sway = Math.cos(this.bobPhase * 0.5) * 0.03 * moveAmount;

    // --- trauma shake ---
    // Cosmetic ONLY, so it uses Math.random (never the seeded sim RNG) and samples nothing when
    // idle — drawing from ctx.rng every frame made spawn positions/elite rolls frame-count
    // dependent, silently breaking the seeded-repro contract the harness + dailies rely on.
    let shYaw = 0, shPitch = 0, shRoll = 0;
    if (this.trauma > 0) {
      const sh = this.trauma * this.trauma * this.shakeScale;
      shYaw = (Math.random() * 2 - 1) * sh * 0.05;
      shPitch = (Math.random() * 2 - 1) * sh * 0.05;
      shRoll = (Math.random() * 2 - 1) * sh * 0.06;
    }

    const p = this.ctx.player.pos;
    this.cam.position.set(p.x + this.shoveX + sway, EYE_HEIGHT + bob, p.z + this.shoveZ);
    this.cam.rotation.set(this.pitch + this.recoil + shPitch, this.yaw + shYaw, shRoll + this.rollKick);

    // cinematic frames zoom in (narrower FOV); eased so it pushes/pulls smoothly
    const fovTarget = (this.cinematic ? 64 : this.baseFov) + this.fovPulse * 14;
    const fov = damp(this.cam.fov, fovTarget, 5, dt);
    if (Math.abs(this.cam.fov - fov) > 0.01) {
      this.cam.fov = fov;
      this.cam.updateProjectionMatrix();
    }
  }
}
