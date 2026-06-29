import * as THREE from "three";
import type { Ctx } from "../game/ctx";
import { clamp, damp } from "../core/math";

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

  private baseFov = 80;
  private fovPulse = 0;
  private trauma = 0;
  private recoil = 0; // upward pitch kick (weapon/hit recoil)
  private shoveX = 0;
  private shoveZ = 0;
  private bobPhase = 0;

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

  /** moveAmount 0..1 drives head-bob. */
  update(dt: number, moveAmount: number): void {
    // --- look input (locked pointer + right stick) ---
    const d = this.ctx.input.consumeMouseDelta();
    this.yaw -= d.dx * this.sensitivity;
    this.pitch -= d.dy * this.sensitivity;
    const gx = this.ctx.input.padAxis(2);
    const gy = this.ctx.input.padAxis(3);
    if (Math.abs(gx) > 0.2) this.yaw -= gx * 2.8 * dt;
    if (Math.abs(gy) > 0.2) this.pitch -= gy * 2.2 * dt;
    this.pitch = clamp(this.pitch, -1.2, 1.2);

    // --- decays ---
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
    this.recoil = damp(this.recoil, 0, 9, dt);
    this.shoveX = damp(this.shoveX, 0, 10, dt);
    this.shoveZ = damp(this.shoveZ, 0, 10, dt);
    this.fovPulse = damp(this.fovPulse, 0, 6, dt);

    // --- head bob ---
    this.bobPhase += dt * 11 * moveAmount;
    const bob = Math.sin(this.bobPhase) * 0.045 * moveAmount;
    const sway = Math.cos(this.bobPhase * 0.5) * 0.03 * moveAmount;

    // --- trauma shake ---
    const sh = this.trauma * this.trauma;
    const rng = this.ctx.rng;
    const shYaw = rng.range(-1, 1) * sh * 0.05;
    const shPitch = rng.range(-1, 1) * sh * 0.05;
    const shRoll = rng.range(-1, 1) * sh * 0.06;

    const p = this.ctx.player.pos;
    this.cam.position.set(p.x + this.shoveX + sway, EYE_HEIGHT + bob, p.z + this.shoveZ);
    this.cam.rotation.set(this.pitch + this.recoil + shPitch, this.yaw + shYaw, shRoll);

    const fov = this.baseFov + this.fovPulse * 14;
    if (Math.abs(this.cam.fov - fov) > 0.01) {
      this.cam.fov = fov;
      this.cam.updateProjectionMatrix();
    }
  }
}
