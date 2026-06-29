import * as THREE from "three";
import type { Ctx } from "./ctx";
import type { Hittable, HitOpts } from "./combat";
import type { TelegraphHandle } from "../render/telegraphs";
import { BOSS_ANCHOR, ARENA_CENTER, ARENA_RADIUS } from "./level";

type Attack = "slam" | "volley" | "sweep" | "collapse" | null;

/**
 * The Rift Warden — the boss waiting at the end of the causeway. Mostly holds the
 * dais and punishes with telegraphed slams, bolt volleys and (phase 2) line sweeps,
 * summoning husks once when it breaks. Implements Hittable so the player's whole
 * moveset + combos work on it unchanged.
 */
export class Boss implements Hittable {
  pos = new THREE.Vector3().copy(BOSS_ANCHOR);
  radius = 2.6;
  maxHp = 520;
  hp = 520;
  alive = true;
  kind = "boss";
  hitColor = 0xff5ea0;

  private phase = 1;
  private summoned = false;
  private rise = 0;
  private spots: THREE.Vector3[] = [];
  private teles: TelegraphHandle[] = [];
  private cd = 2.2;
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

  group = new THREE.Group();
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
    // crown of shards
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const shard = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.6, 4), this.coreMat);
      shard.position.set(Math.cos(a) * 1.3, 8.2, Math.sin(a) * 1.3);
      shard.rotation.x = Math.PI;
      this.group.add(shard);
    }
    const light = new THREE.PointLight(this.hitColor, 30, 40, 2);
    light.position.y = 5;
    this.group.add(light);
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

  private enterPhase2(): void {
    this.phase = 2;
    this.ctx.stage.punch(0.6);
    this.ctx.cam.addTrauma(0.6);
    this.ctx.sfx.bossRoar();
    this.ctx.fx.burst({ x: this.pos.x, y: 4.6, z: this.pos.z, count: 60, color: this.hitColor, speed: [6, 16], life: [0.4, 0.9] });
    if (!this.summoned) {
      this.summoned = true;
      this.ctx.enemies.spawn("husk", this.pos.x - 4, this.pos.z - 4);
      this.ctx.enemies.spawn("husk", this.pos.x + 4, this.pos.z - 4);
    }
  }

  private enterPhase3(): void {
    this.phase = 3;
    this.ctx.stage.punch(0.8);
    this.ctx.cam.addTrauma(0.8);
    this.ctx.sfx.bossRoar();
    this.ctx.fx.burst({ x: this.pos.x, y: 5, z: this.pos.z, count: 90, color: this.hitColor, speed: [8, 20], life: [0.5, 1.1] });
  }

  tick(dt: number): void {
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 3);
    const base = this.phase === 3 ? 3.2 : 2.0;
    this.coreMat.emissiveIntensity = base + this.flash * 4 + Math.sin(this.t * (this.phase === 3 ? 6 : 3)) * 0.4;

    // rising entrance: scale up from nothing; no attacks until fully risen
    if (this.rise < 1 && !this.dying) {
      this.rise = Math.min(1, this.rise + dt * 0.8);
      this.group.scale.setScalar((1 - (1 - this.rise) ** 3) * 1.3);
    }
    this.group.position.y = Math.sin(this.t * 1.2) * 0.2;

    // face the player
    const p = this.ctx.player;
    const dx = p.pos.x - this.pos.x;
    const dz = p.pos.z - this.pos.z;
    this.group.rotation.y = Math.atan2(dx, dz);

    if (this.dying) {
      this.deathT += dt;
      this.group.scale.setScalar(1.3 * Math.max(0.001, 1 - this.deathT * 0.8));
      if (this.deathT > 0.4 && Math.random() < 0.4) {
        this.ctx.fx.burst({ x: this.pos.x + (Math.random() - 0.5) * 4, y: 1 + Math.random() * 6, z: this.pos.z + (Math.random() - 0.5) * 4, count: 18, color: this.hitColor, speed: [4, 12], life: [0.3, 0.7] });
      }
      return;
    }

    if (this.rise < 1) return; // still rising in
    if (this.attack) this.progressAttack(dt);
    else {
      this.cd -= dt;
      if (this.cd <= 0) this.chooseAttack();
    }
  }

  private chooseAttack(): void {
    const pool: Attack[] =
      this.phase === 1 ? ["slam", "volley"]
        : this.phase === 2 ? ["slam", "volley", "sweep", "sweep"]
          : ["collapse", "sweep", "volley", "collapse"];
    this.attack = this.ctx.rng.pick(pool);
    this.windupMax = this.attack === "collapse" ? 1.4 : this.attack === "sweep" ? 1.2 : this.attack === "slam" ? 1.0 : 0.8;
    if (this.phase === 2) this.windupMax *= 0.8;
    if (this.phase === 3) this.windupMax *= 0.65;
    this.windup = this.windupMax;

    const p = this.ctx.player;
    this.aim.copy(p.pos);
    this.aimAngle = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    const c = this.hitColor;
    if (this.attack === "slam") this.tele = this.ctx.tele.circle(this.aim.x, this.aim.z, 5, this.windupMax, c);
    else if (this.attack === "sweep") this.tele = this.ctx.tele.line(this.pos.x, this.pos.z, Math.atan2(p.pos.z - this.pos.z, p.pos.x - this.pos.x), 40, 5, this.windupMax, c);
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
    this.cd = this.phase === 3 ? 1.0 : this.phase === 2 ? 1.4 : 2.2;
    const p = this.ctx.player;

    if (a === "slam") {
      this.ctx.fx.ring(this.aim.x, this.aim.z, { radius: 5, color: this.hitColor, duration: 0.4 });
      this.ctx.fx.burst({ x: this.aim.x, y: 0.5, z: this.aim.z, count: 30, color: this.hitColor, speed: [5, 13], life: [0.3, 0.7], up: 1 });
      this.ctx.cam.addTrauma(0.3);
      if (Math.hypot(p.pos.x - this.aim.x, p.pos.z - this.aim.z) <= 5) this.ctx.combat.damagePlayer(28, this.aim.x, this.aim.z);
    } else if (a === "volley") {
      const n = this.phase === 2 ? 7 : 5;
      const base = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
      for (let i = 0; i < n; i++) {
        const ang = base + (i - (n - 1) / 2) * 0.18;
        const dir = new THREE.Vector3(Math.sin(ang), -0.05, Math.cos(ang));
        this.ctx.projectiles.spawn(this.pos.x, 4.4, this.pos.z, dir, 20, 14, false, this.hitColor, 3);
      }
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
  }
}
