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
  private blade!: THREE.Mesh;
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
    // dark gauntlet (fist) tucked into the lower-right corner
    const gaunt = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.2, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x12131d, roughness: 0.5, metalness: 0.6, emissive: 0x163b7a, emissiveIntensity: 0.5 }),
    );
    gaunt.position.set(0, -0.04, 0.16);
    this.weapon.add(gaunt);

    // blade of light angled across the view, pointing forward
    this.bladeMat = new THREE.MeshStandardMaterial({ color: 0x0a0c16, emissive: 0x46e0ff, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.1 });
    this.blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 1.2), this.bladeMat);
    this.blade.position.set(0, 0.03, -0.62);
    this.weapon.add(this.blade);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.1), this.bladeMat);
    guard.position.set(0, 0.03, 0.0);
    this.weapon.add(guard);

    this.tipMarker.position.set(0, 0.03, -1.2);
    this.baseMarker.position.set(0, 0.03, 0.0);
    this.weapon.add(this.tipMarker, this.baseMarker);

    this.weapon.position.set(0.52, -0.58, -0.95);
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

    if (this.alive) {
      this.handleActions();
      this.advanceMove(dt);
    }
    this.move(dt);
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
      this.ctx.combat.meleeSweep(this.pos.x, this.pos.z, fx, fz, m.arc, m.range, m.damage, m.knockback, m.id === "cleave");
      this.ctx.cam.kick(-fx, -fz, m.id === "cleave" ? 0.5 : 0.2);
    } else {
      // bolt fires along the full 3D look direction from eye height
      this.ctx.cam.forward(this.aim);
      this.ctx.projectiles.spawn(this.pos.x, 1.35, this.pos.z, this.aim, 34, m.damage, true, m.color, m.knockback);
      this.ctx.cam.kick(-fx, -fz, 0.15);
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
    const fwdAmt = -mv.z;
    if (Math.hypot(mv.x, mv.z) > 0.1) {
      this.dashDir.set(
        this.fwd.x * fwdAmt + this.right.x * mv.x,
        0,
        this.fwd.z * fwdAmt + this.right.z * mv.x,
      ).normalize();
    } else {
      this.dashDir.copy(this.fwd);
    }
    this.ctx.events.emit("DODGE", {});
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
    // resting pose + breathing/bob
    const t = performance.now() / 1000;
    let rx = 0.12 + Math.sin(t * 1.3) * 0.02;
    let ry = -0.2;
    let rz = 0.08;
    let pz = -0.95 + this.moveAmount * 0.04 * Math.sin(t * 11);
    let px = 0.52 + this.moveAmount * 0.03 * Math.cos(t * 5.5);
    let py = -0.58 - this.moveAmount * 0.03;

    const m = this.current;
    let trailActive = false;
    if (m) {
      const p = clamp(this.moveT / moveDuration(m), 0, 1);
      if (m.id === "strike") {
        // fast horizontal slash R->L
        const s = ease.outCubic(clamp(p / 0.6, 0, 1));
        ry = -0.2 + s * 1.0;
        rz = 0.08 - s * 0.7;
        pz = -0.95 - Math.sin(p * Math.PI) * 0.4;
        trailActive = p > m.windup / moveDuration(m) && p < 0.7;
      } else if (m.id === "cleave") {
        // big overhead chop
        const wind = clamp(p / 0.32, 0, 1);
        const fall = ease.inCubic(clamp((p - 0.32) / 0.5, 0, 1));
        rx = 0.12 - wind * 1.4 + fall * 2.2;
        pz = -0.95 - Math.sin(p * Math.PI) * 0.3;
        py = -0.58 + wind * 0.2 - fall * 0.25;
        trailActive = p > 0.3 && p < 0.8;
      } else {
        // bolt: pull back then thrust
        const wind = clamp(p / 0.4, 0, 1);
        const thrust = ease.outQuart(clamp((p - 0.4) / 0.3, 0, 1));
        pz = -0.95 + wind * 0.25 - thrust * 0.6;
        rx = 0.12 - wind * 0.2 + thrust * 0.15;
      }
    }

    this.weapon.position.set(px, py, pz);
    this.weapon.rotation.set(rx, ry, rz);

    // feed the sword trail (world-space tip/base of the blade)
    this.tipMarker.getWorldPosition(this.tip);
    this.baseMarker.getWorldPosition(this.base);
    this.ctx.trail.setColor(m ? m.color : 0x46e0ff);
    this.ctx.trail.update(dt, this.tip, this.base, trailActive);
  }
}
