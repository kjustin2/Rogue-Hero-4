import * as THREE from "three";
import type { Ctx } from "./ctx";
import type { Hittable, HitOpts } from "./combat";
import type { TelegraphHandle } from "../render/telegraphs";
import { BOSS_ANCHOR, ARENA_CENTER, ARENA_RADIUS } from "./level";
import { damp } from "../core/math";

const CORE_Y = 6.0; // world height of the weak-point core

type Attack = "slam" | "volley" | "sweep" | "collapse" | "beam" | null;

/**
 * The Rift Warden — the boss waiting at the end of the causeway. Mostly holds the
 * dais and punishes with telegraphed slams, bolt volleys and (phase 2) line sweeps,
 * summoning husks once when it breaks. Implements Hittable so the player's whole
 * moveset + combos work on it unchanged.
 */
export class Boss implements Hittable {
  pos = new THREE.Vector3().copy(BOSS_ANCHOR);
  radius = 2.6;
  maxHp = 820;
  hp = 820;
  alive = true;
  kind = "boss";
  hitColor = 0x4fe0d0; // cold soul-fire — an undead warden, contrasting the firelit keep
  hitTop = 9; // tall vertical hitbox so high bolts connect
  readonly weakRadius = 2.0;

  private phase = 1;
  private summoned = false;
  private rise = 0;
  private charge = 0; // attack wind-up inflate
  private lunge = 0; // strike snap
  private spots: THREE.Vector3[] = [];
  private teles: TelegraphHandle[] = [];
  private cd = 1.3;
  private attack: Attack = null;
  private windup = 0;
  private windupMax = 1;
  private aim = new THREE.Vector3();
  private aimAngle = 0;
  private tele: TelegraphHandle | null = null;
  private flash = 0;
  private dying = false;
  private deathT = 0;
  private t = 0;
  private risen = false;
  /** Held during a phase-transition cutscene — animates but does not attack. */
  paused = false;
  /** Staged-but-not-yet-fighting: built + shader-warmed at boot, hidden and inert
   *  until activate(). Excluded from targeting/HUD/tick while true. */
  dormant = true;

  group = new THREE.Group();
  private orbit = new THREE.Group(); // rune shards circling the core (animated)
  private cloak!: THREE.Mesh;        // ragged cloak — billows (animated)
  private blade = new THREE.Group();  // hovering warblade — raised on wind-up, slammed on strike
  private bladeBase = new THREE.Euler();
  private readonly bladeY = 4.6;
  private light!: THREE.PointLight;
  private coreMat: THREE.MeshStandardMaterial;

  constructor(private ctx: Ctx) {
    this.coreMat = new THREE.MeshStandardMaterial({ color: 0x05060d, emissive: this.hitColor, emissiveIntensity: 2.0, roughness: 0.35, metalness: 0.2 });
    this.buildMesh();
    this.group.position.copy(this.pos);
    this.group.scale.setScalar(0.001); // rises in on spawn (see tick)
    this.ctx.stage.scene.add(this.group);
  }

  private buildMesh(): void {
    const shell = new THREE.MeshStandardMaterial({ color: 0x0a0b16, roughness: 0.55, metalness: 0.5, emissive: this.hitColor, emissiveIntensity: 0.3 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.4, 6.5, 8), shell);
    body.position.y = 3.4; body.castShadow = true;
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3, 0), shell);
    head.position.y = 7.4; head.castShadow = true;
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(1.0), this.coreMat);
    core.position.y = 4.6;
    this.group.add(body, head, core);

    // ragged cloak/skirt flaring from the body — a looming warlord silhouette (billows in tick)
    const cloak = new THREE.Mesh(new THREE.ConeGeometry(3.2, 5.8, 10, 1, true), shell);
    cloak.position.y = 2.9; cloak.castShadow = true;
    this.cloak = cloak;
    this.group.add(cloak);

    // pauldron spikes off the shoulders
    for (const sx of [-1, 1]) {
      const pauldron = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.2, 5), this.coreMat);
      pauldron.position.set(sx * 2.0, 6.0, 0);
      pauldron.rotation.z = sx * 0.9;
      this.group.add(pauldron);
    }

    // glowing slit eyes on the head
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.2), this.coreMat);
      eye.position.set(sx * 0.5, 7.5, 1.05);
      this.group.add(eye);
    }

    // tall jagged crown of shards (two tiers)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const shard = new THREE.Mesh(new THREE.ConeGeometry(0.34, 2.6, 4), this.coreMat);
      shard.position.set(Math.cos(a) * 1.4, 8.7, Math.sin(a) * 1.4);
      this.group.add(shard);
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.5, 4), this.coreMat);
      inner.position.set(Math.cos(a + 0.39) * 0.8, 9.1, Math.sin(a + 0.39) * 0.8);
      this.group.add(inner);
    }

    // knightly plate: a great-helm crest ridge, a gorget collar, a breastplate + heraldic sigil
    const crest = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.1, 1.4), this.coreMat);
    crest.position.set(0, 8.35, 0); // comb/plume ridge atop the helm
    const gorget = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.24, 8, 16), shell);
    gorget.position.y = 6.5; gorget.rotation.x = Math.PI / 2;
    const breast = new THREE.Mesh(new THREE.BoxGeometry(2.7, 2.3, 1.0), shell);
    breast.position.set(0, 4.5, 0.95); breast.castShadow = true;
    const emblem = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), this.coreMat);
    emblem.position.set(0, 4.7, 1.55); emblem.scale.set(1, 1.5, 0.4); // sigil on the chest
    this.group.add(crest, gorget, breast, emblem);
    // tattered war-banners on iron poles planted behind the Warden (face the player)
    for (const sx of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 12, 6), shell);
      pole.position.set(sx * 3.7, 5, -2.0);
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 5.2), shell);
      banner.position.set(sx * 3.7, 7.4, -2.05); banner.rotation.y = Math.PI;
      const sigil = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 3.2), this.coreMat);
      sigil.position.set(sx * 3.7, 7.4, -1.98); sigil.rotation.y = Math.PI;
      this.group.add(pole, banner, sigil);
    }

    // a colossal soul-forged warblade hovering at the Warden's flank — raised on the
    // wind-up, hammered down on the strike (animated in tick from charge/lunge)
    const blade = this.blade;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.3, 6), shell);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.3, 0.42), this.coreMat);
    guard.position.y = 0.78;
    const blMesh = new THREE.Mesh(new THREE.BoxGeometry(0.62, 7.6, 0.2), shell);
    blMesh.position.y = 4.6; blMesh.castShadow = true;
    const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.16, 6.9, 0.26), this.coreMat); // glowing fuller down the blade
    fuller.position.y = 4.45;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.4, 4), shell);
    tip.position.y = 8.75;
    const pommel = new THREE.Mesh(new THREE.OctahedronGeometry(0.26), this.coreMat);
    pommel.position.y = -0.75;
    blade.add(grip, guard, blMesh, fuller, tip, pommel);
    blade.position.set(3.7, this.bladeY, 1.3);
    blade.rotation.set(0, 0, -0.22);
    this.bladeBase.copy(blade.rotation);
    this.group.add(blade);

    // rune shards orbiting the core (spun in tick) — menace + motion
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), this.coreMat);
      shard.position.set(Math.cos(a) * 3.6, 4.6 + Math.sin(a * 2) * 0.7, Math.sin(a) * 3.6);
      this.orbit.add(shard);
    }
    this.group.add(this.orbit);

    // The soul-fire light lives on the SCENE (not the group) so it is counted from
    // boot and STAYS counted while the boss is hidden. Adding a light mid-scene is what
    // forces a synchronous whole-scene material relink — the "boss cutscene lag" freeze.
    this.light = new THREE.PointLight(this.hitColor, 30, 40, 2);
    this.light.position.set(this.pos.x, 5, this.pos.z);
    this.ctx.stage.scene.add(this.light);
  }

  /**
   * Wake the staged boss for its fight. It was built + shader-warmed at boot and its
   * light has been in the scene since boot, so revealing it costs no shader compile and
   * no light-count relink — that eliminates the multi-second boss-cutscene lag spike.
   */
  activate(): void {
    this.dormant = false;
    this.group.visible = true;
  }

  /**
   * Return to a fresh, hidden, dormant pre-fight state. Reused across runs INSTEAD of
   * rebuilding, so the warmed shaders and the scene light-count never change (no re-lag
   * on a second run either).
   */
  reset(): void {
    this.tele?.cancel(); this.tele = null;
    for (const t of this.teles) t.cancel();
    this.teles = []; this.spots = [];
    this.hp = this.maxHp; this.alive = true;
    this.dying = false; this.deathT = 0;
    this.phase = 1; this.summoned = false;
    this.rise = 0; this.risen = false;
    this.charge = 0; this.lunge = 0; this.flash = 0; this.t = 0;
    this.attack = null; this.windup = 0; this.cd = 1.3; this.paused = false;
    this.light.intensity = 30; this.light.color.setHex(this.hitColor);
    this.coreMat.emissiveIntensity = 2.0;
    this.pos.copy(BOSS_ANCHOR);
    this.group.position.copy(this.pos);
    this.group.scale.setScalar(0.001);
    this.group.rotation.set(0, 0, 0);
    this.orbit.rotation.set(0, 0, 0);
    this.orbit.scale.setScalar(1);
    this.orbit.position.set(0, 0, 0);
    this.group.visible = false;
    this.dormant = true;
  }

  /** World position of the weak-point core (drives crosshair + crit aim). */
  coreWorld(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x, CORE_Y + this.group.position.y, this.pos.z);
  }

  isWeakHit(x: number, y: number, z: number): boolean {
    return Math.hypot(x - this.pos.x, y - (CORE_Y + this.group.position.y), z - this.pos.z) < this.weakRadius;
  }

  takeDamage(dmg: number, _opts: HitOpts): boolean {
    if (!this.alive) return false;
    this.hp -= dmg;
    this.flash = 1;
    this.ctx.events.emit("BOSS_HP", { hp: Math.max(0, this.hp), maxHp: this.maxHp });
    if (this.phase === 1 && this.hp <= this.maxHp * 0.5) this.enterPhase2();
    else if (this.phase === 2 && this.hp <= this.maxHp * 0.25) this.enterPhase3();
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.dying = true;
      this.tele?.cancel();
      this.ctx.events.emit("BOSS_DEFEATED", { x: this.pos.x, z: this.pos.z });
      return true;
    }
    return false;
  }

  /** Boss fully risen on spawn — a roar + ground shockwave + summoning beams. */
  private onRisen(): void {
    this.ctx.stage.punch(0.6);
    this.ctx.cam.addTrauma(0.7);
    this.ctx.sfx.bossRoar();
    this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 15, color: this.hitColor, duration: 0.7, y: 0.2, startRadius: 1 });
    this.ctx.fx.burst({ x: this.pos.x, y: 3, z: this.pos.z, count: 80, color: [this.hitColor, 0xffffff], speed: [8, 22], life: [0.5, 1.1], up: 0.6 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this.ctx.fx.beam(this.pos.x + Math.cos(a) * 5, this.pos.z + Math.sin(a) * 5, this.hitColor);
    }
  }

  private enterPhase2(): void {
    this.phase = 2;
    this.ctx.events.emit("BOSS_PHASE", { phase: 2 });
    this.ctx.stage.punch(0.6);
    this.ctx.cam.addTrauma(0.6);
    this.ctx.sfx.bossRoar();
    this.light.intensity = 42;
    this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 16, color: this.hitColor, duration: 0.6, y: 0.2, startRadius: 1 });
    this.ctx.fx.burst({ x: this.pos.x, y: 4.6, z: this.pos.z, count: 60, color: this.hitColor, speed: [6, 16], life: [0.4, 0.9] });
    if (!this.summoned) {
      this.summoned = true;
      this.ctx.enemies.spawn("husk", this.pos.x - 4, this.pos.z - 4);
      this.ctx.enemies.spawn("husk", this.pos.x + 4, this.pos.z - 4);
      this.ctx.enemies.spawn("ghoul", this.pos.x - 6, this.pos.z - 2);
      this.ctx.enemies.spawn("ghoul", this.pos.x + 6, this.pos.z - 2);
    }
  }

  private enterPhase3(): void {
    this.phase = 3;
    this.ctx.events.emit("BOSS_PHASE", { phase: 3 });
    this.ctx.stage.punch(0.9);
    this.ctx.cam.addTrauma(0.85);
    this.ctx.sfx.bossRoar();
    this.light.intensity = 55;
    this.light.color.setHex(0xa0fff0); // the Warden's soul-fire blazes white for the final phase
    this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 20, color: 0xffffff, duration: 0.7, y: 0.2, startRadius: 1 });
    this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 26, color: this.hitColor, duration: 0.9, y: 0.15, startRadius: 2 });
    this.ctx.fx.burst({ x: this.pos.x, y: 5, z: this.pos.z, count: 90, color: [this.hitColor, 0xffffff], speed: [8, 20], life: [0.5, 1.1] });
  }

  tick(dt: number): void {
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 3);
    const base = this.phase === 3 ? 3.2 : 2.0;
    this.coreMat.emissiveIntensity = base + this.flash * 4 + Math.sin(this.t * (this.phase === 3 ? 6 : 3)) * 0.4;
    // the shard halo wheels around the core, faster as the fight escalates
    this.orbit.rotation.y += dt * (this.phase >= 3 ? 1.7 : this.phase === 2 ? 1.1 : 0.7);
    // halo gathers inward + lifts as it charges an attack, flares out on the strike
    this.orbit.scale.setScalar(1 - this.charge * 0.34 + this.lunge * 0.22);
    this.orbit.position.y = this.charge * 0.7 - this.lunge * 0.4;
    // cloak billow — a slow living roll
    this.cloak.rotation.z = Math.sin(this.t * 1.1) * 0.05;
    this.cloak.rotation.x = Math.sin(this.t * 0.8 + 1) * 0.04;
    // the warblade hovers, raises on the wind-up, hammers down on the strike
    this.blade.position.y = this.bladeY + Math.sin(this.t * 1.3) * 0.3 + this.charge * 1.5 - this.lunge * 1.9;
    this.blade.rotation.set(
      this.bladeBase.x - this.charge * 0.9 + this.lunge * 2.3,
      this.bladeBase.y + Math.sin(this.t * 0.9) * 0.08,
      this.bladeBase.z,
    );

    // rising entrance: scale up from nothing; no attacks until fully risen
    if (this.rise < 1 && !this.dying) {
      this.rise = Math.min(1, this.rise + dt * 0.8);
      this.group.scale.setScalar((1 - (1 - this.rise) ** 3) * 1.3);
      this.group.position.y = Math.sin(this.t * 1.2) * 0.2;
      if (this.rise >= 1 && !this.risen) { this.risen = true; this.onRisen(); }
    } else if (!this.dying) {
      // attack tell via a steady hover that LIFTS on wind-up and DROPS on the strike —
      // scale stays locked at 1.3 (the old scale pulsing read as a weird grow/shrink).
      this.charge = this.attack ? 1 - this.windup / this.windupMax : damp(this.charge, 0, 6, dt);
      this.lunge = damp(this.lunge, 0, 7, dt);
      this.group.scale.setScalar(1.3);
      this.group.position.y = Math.sin(this.t * 1.2) * 0.15 + this.charge * 0.5 - this.lunge * 0.7;
      this.coreMat.emissiveIntensity += this.charge * 4;
    }

    // face the player
    const p = this.ctx.player;
    const dx = p.pos.x - this.pos.x;
    const dz = p.pos.z - this.pos.z;
    this.group.rotation.y = Math.atan2(dx, dz);
    this.group.rotation.z = Math.sin(this.t * 0.6) * 0.02; // faint menacing roll

    if (this.dying) {
      this.deathT += dt;
      this.group.scale.setScalar(1.3 * Math.max(0.001, 1 - this.deathT * 0.8));
      if (this.deathT > 0.4 && Math.random() < 0.4) {
        this.ctx.fx.burst({ x: this.pos.x + (Math.random() - 0.5) * 4, y: 1 + Math.random() * 6, z: this.pos.z + (Math.random() - 0.5) * 4, count: 18, color: this.hitColor, speed: [4, 12], life: [0.3, 0.7] });
      }
      return;
    }

    if (this.rise < 1) return; // still rising in
    if (this.paused) return;   // frozen for a phase-transition cutscene
    if (this.attack) this.progressAttack(dt);
    else {
      this.cd -= dt;
      if (this.cd <= 0) this.chooseAttack();
    }
  }

  private chooseAttack(): void {
    const pool: Attack[] =
      this.phase === 1 ? ["slam", "volley", "beam"]
        : this.phase === 2 ? ["slam", "volley", "sweep", "beam", "sweep"]
          : ["collapse", "sweep", "volley", "beam", "collapse"];
    this.attack = this.ctx.rng.pick(pool);
    this.windupMax = this.attack === "collapse" ? 0.95 : this.attack === "beam" ? 0.85 : this.attack === "sweep" ? 0.8 : this.attack === "slam" ? 0.65 : 0.52;
    if (this.phase === 2) this.windupMax *= 0.8;
    if (this.phase === 3) this.windupMax *= 0.65;
    this.windup = this.windupMax;

    const p = this.ctx.player;
    this.aim.copy(p.pos);
    this.aimAngle = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    const c = this.hitColor;
    if (this.attack === "slam") this.tele = this.ctx.tele.circle(this.aim.x, this.aim.z, 5, this.windupMax, c);
    else if (this.attack === "sweep") this.tele = this.ctx.tele.line(this.pos.x, this.pos.z, Math.atan2(p.pos.z - this.pos.z, p.pos.x - this.pos.x), 40, 5, this.windupMax, c);
    else if (this.attack === "beam") this.tele = this.ctx.tele.line(this.pos.x, this.pos.z, Math.atan2(p.pos.z - this.pos.z, p.pos.x - this.pos.x), 60, 4, this.windupMax, c);
    else if (this.attack === "collapse") {
      // rift collapse: several slam zones bloom across the arena at once — keep moving
      for (const t of this.teles) t.cancel();
      this.teles = [];
      this.spots = [];
      for (let i = 0; i < 5; i++) {
        const ang = this.ctx.rng.range(0, Math.PI * 2);
        const r = this.ctx.rng.range(0, ARENA_RADIUS - 6);
        const sx = i === 0 ? p.pos.x : ARENA_CENTER.x + Math.cos(ang) * r;
        const sz = i === 0 ? p.pos.z : ARENA_CENTER.y + Math.sin(ang) * r;
        this.spots.push(new THREE.Vector3(sx, 0, sz));
        this.teles.push(this.ctx.tele.circle(sx, sz, 4.5, this.windupMax, c));
      }
    }
    // volley has no ground telegraph; the wind-up glow on the core reads it
  }

  private progressAttack(dt: number): void {
    this.windup -= dt;
    if (this.windup > 0) return;
    const a = this.attack;
    this.attack = null;
    this.tele = null;
    this.charge = 0;
    this.lunge = 1; // snap the body forward/down on the strike
    this.cd = this.phase === 3 ? 0.55 : this.phase === 2 ? 0.85 : 1.25;
    const p = this.ctx.player;

    if (a === "slam") {
      this.ctx.fx.ring(this.aim.x, this.aim.z, { radius: 5, color: this.hitColor, duration: 0.4 });
      this.ctx.fx.burst({ x: this.aim.x, y: 0.5, z: this.aim.z, count: 30, color: this.hitColor, speed: [5, 13], life: [0.3, 0.7], up: 1 });
      this.ctx.cam.addTrauma(0.3);
      if (Math.hypot(p.pos.x - this.aim.x, p.pos.z - this.aim.z) <= 5) this.ctx.combat.damagePlayer(28, this.aim.x, this.aim.z);
    } else if (a === "volley") {
      const n = this.phase === 2 ? 7 : 5;
      // aim DOWN to the player's torso so bolts arrive at chest height, not over the head
      const sy = 4.4, ty = 1.3;
      const horiz = Math.max(2, Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z));
      const base = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
      for (let i = 0; i < n; i++) {
        const ang = base + (i - (n - 1) / 2) * 0.18;
        const dir = new THREE.Vector3(Math.sin(ang) * horiz, ty - sy, Math.cos(ang) * horiz);
        this.ctx.projectiles.spawn(this.pos.x, sy, this.pos.z, dir, 24, 14, false, this.hitColor, 3);
      }
    } else if (a === "beam") {
      // a searing lance fires ALONG THE TELEGRAPHED LINE (locked at wind-up on this.aim),
      // NOT the player's live position — so stepping off the strip actually dodges it.
      const dx = this.aim.x - this.pos.x, dz = this.aim.z - this.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const bx = dx / d, bz = dz / d;
      this.ctx.fx.laser(this.pos.x, 1.7, this.pos.z, bx, bz, 60, this.hitColor, 1.6);
      this.ctx.fx.laser(this.pos.x, 1.7, this.pos.z, bx, bz, 60, 0xffffff, 0.6);
      const px = p.pos.x - this.pos.x, pz = p.pos.z - this.pos.z;
      const along = px * bx + pz * bz;
      const perp = Math.abs(px * bz - pz * bx);
      this.ctx.cam.addTrauma(0.32);
      this.ctx.sfx.beamFire();
      if (along > 0 && perp <= 2.0) this.ctx.combat.damagePlayer(30, this.pos.x, this.pos.z); // corridor matches the width-4 strip
    } else if (a === "sweep") {
      // hit if player is within the swept band along aimAngle
      const dx = p.pos.x - this.pos.x;
      const dz = p.pos.z - this.pos.z;
      const along = dx * Math.cos(this.aimAngle) + dz * Math.sin(this.aimAngle);
      const perp = Math.abs(dx * Math.sin(this.aimAngle) - dz * Math.cos(this.aimAngle));
      this.ctx.fx.burst({ x: this.pos.x, y: 1, z: this.pos.z, count: 40, color: this.hitColor, speed: [8, 18], vertical: 0.3, life: [0.3, 0.6] });
      if (along > 0 && perp <= 3.0) this.ctx.combat.damagePlayer(32, this.pos.x, this.pos.z);
    } else if (a === "collapse") {
      for (const t of this.teles) t.cancel();
      this.teles = [];
      let hit = false;
      for (const s of this.spots) {
        this.ctx.fx.ring(s.x, s.z, { radius: 4.5, color: this.hitColor, duration: 0.4 });
        this.ctx.fx.burst({ x: s.x, y: 0.5, z: s.z, count: 22, color: this.hitColor, speed: [5, 13], life: [0.3, 0.7], up: 1 });
        if (Math.hypot(p.pos.x - s.x, p.pos.z - s.z) <= 4.5) hit = true;
      }
      this.ctx.cam.addTrauma(0.5);
      this.ctx.stage.punch(0.4);
      if (hit) this.ctx.combat.damagePlayer(30, this.pos.x, this.pos.z);
      this.spots = [];
    }
  }

  dispose(): void {
    this.tele?.cancel();
    for (const t of this.teles) t.cancel();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.ctx.stage.scene.remove(this.group);
    this.ctx.stage.scene.remove(this.light);
  }
}
