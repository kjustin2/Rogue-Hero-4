import * as THREE from "three";
import type { Ctx } from "./ctx";
import type { Hittable, HitOpts } from "./combat";
import type { TelegraphHandle } from "../render/telegraphs";
import { GATES_Z, HALF_WIDTH } from "./level";
import { damp } from "../core/math";

export type EnemyKind = "husk" | "spitter" | "brute" | "wraith";

interface KindCfg {
  hp: number;
  radius: number;
  speed: number;
  contactDmg: number;
  attackRange: number;
  windup: number;
  color: number;
  bodyY: number;
}

const KIND: Record<EnemyKind, KindCfg> = {
  husk: { hp: 30, radius: 0.6, speed: 5.0, contactDmg: 10, attackRange: 2.4, windup: 0.45, color: 0x46e0ff, bodyY: 0 },
  spitter: { hp: 22, radius: 0.6, speed: 3.2, contactDmg: 9, attackRange: 13, windup: 0.7, color: 0xc28bff, bodyY: 1.0 },
  brute: { hp: 90, radius: 1.05, speed: 2.6, contactDmg: 26, attackRange: 4.4, windup: 1.0, color: 0xff7a3c, bodyY: 0 },
  wraith: { hp: 26, radius: 0.55, speed: 7.2, contactDmg: 15, attackRange: 9, windup: 0.5, color: 0xff5ea0, bodyY: 0.7 },
};

// Waves, one per gate (see level.ts GATES_Z). Cleared → the gate opens. Escalating:
// fodder → fodder + ranged + a lunger → an elite brute with support.
const WAVES: { kind: EnemyKind; count: number }[][] = [
  [{ kind: "husk", count: 3 }, { kind: "wraith", count: 1 }],
  [{ kind: "husk", count: 3 }, { kind: "spitter", count: 2 }, { kind: "wraith", count: 2 }],
  [{ kind: "brute", count: 1 }, { kind: "wraith", count: 2 }, { kind: "spitter", count: 2 }, { kind: "husk", count: 2 }],
];

let NEXT_ID = 1;

export class Enemy implements Hittable {
  readonly id = NEXT_ID++;
  readonly cfg: KindCfg;
  pos = new THREE.Vector3();
  radius: number;
  hp: number;
  maxHp: number;
  alive = true;
  kind: EnemyKind;
  hitColor: number;
  frozen = 0;

  private state: "approach" | "windup" | "recover" | "lunge" = "approach";
  private timer = 0;
  private fireTimer = 1.5;
  private lungeDir = new THREE.Vector3();
  private didHit = false;
  private flash = 0;
  private kb = new THREE.Vector3();
  private tele: TelegraphHandle | null = null;
  group = new THREE.Group();
  private coreMat: THREE.MeshStandardMaterial;
  dying = false;
  private deathT = 0;

  constructor(private ctx: Ctx, kind: EnemyKind, x: number, z: number) {
    this.kind = kind;
    this.cfg = KIND[kind];
    this.radius = this.cfg.radius;
    this.hp = this.maxHp = this.cfg.hp;
    this.hitColor = this.cfg.color;
    this.pos.set(x, 0, z);

    this.coreMat = new THREE.MeshStandardMaterial({ color: 0x05060d, emissive: this.cfg.color, emissiveIntensity: 1.6, roughness: 0.4, metalness: 0.2 });
    this.buildMesh();
    this.group.position.set(x, this.cfg.bodyY, z);
    this.ctx.stage.scene.add(this.group);
  }

  private buildMesh(): void {
    const shellMat = new THREE.MeshStandardMaterial({ color: 0x0b0d18, roughness: 0.6, metalness: 0.4, emissive: this.cfg.color, emissiveIntensity: 0.25 });
    if (this.kind === "husk") {
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.6, 2.0, 6), shellMat);
      body.position.y = 1.0; body.castShadow = true;
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.34), this.coreMat);
      core.position.y = 1.3;
      this.group.add(body, core);
    } else if (this.kind === "spitter") {
      const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.7), shellMat);
      body.castShadow = true;
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), this.coreMat);
      this.group.add(body, core);
    } else if (this.kind === "wraith") {
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.7, 4), shellMat);
      body.rotation.x = Math.PI / 2; // arrowhead points forward (group yaw faces the player)
      body.castShadow = true;
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.26), this.coreMat);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.5), this.coreMat);
      this.group.add(body, core, fin);
    } else {
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.9, 1.2), shellMat);
      body.position.y = 1.0; body.castShadow = true;
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5), this.coreMat);
      core.position.y = 1.2;
      const eye = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.18, 0.1), this.coreMat);
      eye.position.set(0, 1.4, 0.6);
      this.group.add(body, core, eye);
    }
  }

  takeDamage(dmg: number, opts: HitOpts): boolean {
    if (!this.alive) return false;
    this.hp -= dmg;
    this.flash = 1;
    if (opts.knockback && opts.fromX !== undefined && opts.fromZ !== undefined) {
      const dx = this.pos.x - opts.fromX;
      const dz = this.pos.z - opts.fromZ;
      const d = Math.hypot(dx, dz) || 1;
      this.kb.x += (dx / d) * opts.knockback;
      this.kb.z += (dz / d) * opts.knockback;
    }
    if (this.hp <= 0) {
      this.alive = false;
      this.dying = true;
      this.tele?.cancel();
      return true;
    }
    return false;
  }

  tick(dt: number): void {
    this.flash = Math.max(0, this.flash - dt * 4);
    this.coreMat.emissiveIntensity = 1.6 + this.flash * 4;

    if (this.dying) {
      this.deathT += dt;
      const s = Math.max(0.001, 1 - this.deathT * 5);
      this.group.scale.setScalar(s);
      return;
    }

    // knockback slide
    this.pos.addScaledVector(this.kb, dt);
    this.kb.x = damp(this.kb.x, 0, 6, dt);
    this.kb.z = damp(this.kb.z, 0, 6, dt);

    if (this.frozen > 0) {
      this.frozen -= dt;
      this.sync();
      return;
    }

    const p = this.ctx.player;
    const dx = p.pos.x - this.pos.x;
    const dz = p.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const nx = dx / dist;
    const nz = dz / dist;

    switch (this.kind) {
      case "husk": this.tickMelee(dt, dist, nx, nz); break;
      case "brute": this.tickMelee(dt, dist, nx, nz); break;
      case "spitter": this.tickRanged(dt, dist, nx, nz); break;
      case "wraith": this.tickLunge(dt, dist, nx, nz); break;
    }
    this.ctx.level.clampPosition(this.pos, this.radius);
    this.sync(nx, nz);
  }

  private tickMelee(dt: number, dist: number, nx: number, nz: number): void {
    const cfg = this.cfg;
    if (this.state === "approach") {
      if (dist > cfg.attackRange) {
        this.pos.x += nx * cfg.speed * dt;
        this.pos.z += nz * cfg.speed * dt;
      } else {
        this.state = "windup";
        this.timer = cfg.windup;
        const angle = Math.atan2(nz, nx);
        if (this.kind === "brute") this.tele = this.ctx.tele.circle(this.pos.x, this.pos.z, cfg.attackRange, cfg.windup, cfg.color);
        else this.tele = this.ctx.tele.line(this.pos.x, this.pos.z, angle, cfg.attackRange + 0.5, 1.4, cfg.windup, cfg.color);
      }
    } else if (this.state === "windup") {
      this.timer -= dt;
      if (this.timer <= 0) {
        // strike lands
        if (dist <= cfg.attackRange + 0.8) this.ctx.combat.damagePlayer(cfg.contactDmg, this.pos.x, this.pos.z);
        if (this.kind === "brute") this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: cfg.attackRange, color: cfg.color, duration: 0.3 });
        this.state = "recover";
        this.timer = this.kind === "brute" ? 0.9 : 0.4;
        this.tele = null;
      }
    } else {
      this.timer -= dt;
      if (this.timer <= 0) this.state = "approach";
    }
  }

  private tickRanged(dt: number, dist: number, nx: number, nz: number): void {
    const cfg = this.cfg;
    // keep mid-range
    if (dist < 8) { this.pos.x -= nx * cfg.speed * dt; this.pos.z -= nz * cfg.speed * dt; }
    else if (dist > cfg.attackRange) { this.pos.x += nx * cfg.speed * dt; this.pos.z += nz * cfg.speed * dt; }
    this.fireTimer -= dt;
    if (this.fireTimer <= 0 && dist < cfg.attackRange + 2) {
      this.fireTimer = 2.2;
      const p = this.ctx.player;
      const dir = new THREE.Vector3(p.pos.x - this.pos.x, 1.4 - this.cfg.bodyY, p.pos.z - this.pos.z);
      this.ctx.projectiles.spawn(this.pos.x, this.cfg.bodyY + 0.2, this.pos.z, dir, 17, cfg.contactDmg, false, cfg.color, 2);
      this.ctx.fx.burst({ x: this.pos.x, y: this.cfg.bodyY + 0.2, z: this.pos.z, count: 6, color: cfg.color, speed: [2, 5], life: [0.2, 0.4] });
    }
  }

  // Wraith: stalk → telegraph a long line → commit to a fast forward lunge that
  // hits once if it passes through the player. Dodge it with a dash.
  private tickLunge(dt: number, dist: number, nx: number, nz: number): void {
    const cfg = this.cfg;
    if (this.state === "approach") {
      if (dist > cfg.attackRange) {
        this.pos.x += nx * cfg.speed * 0.7 * dt;
        this.pos.z += nz * cfg.speed * 0.7 * dt;
      } else {
        this.state = "windup";
        this.timer = cfg.windup;
        this.lungeDir.set(nx, 0, nz);
        this.tele = this.ctx.tele.line(this.pos.x, this.pos.z, Math.atan2(nz, nx), 12, 1.6, cfg.windup, cfg.color);
      }
    } else if (this.state === "windup") {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = "lunge";
        this.timer = 0.34;
        this.didHit = false;
        this.tele = null;
        this.ctx.fx.burst({ x: this.pos.x, y: 0.8, z: this.pos.z, count: 10, color: cfg.color, speed: [3, 7], life: [0.2, 0.4] });
      }
    } else if (this.state === "lunge") {
      this.timer -= dt;
      this.pos.x += this.lungeDir.x * 26 * dt;
      this.pos.z += this.lungeDir.z * 26 * dt;
      if (!this.didHit && dist < this.radius + this.ctx.player.radius + 0.8) {
        this.didHit = true;
        this.ctx.combat.damagePlayer(cfg.contactDmg, this.pos.x, this.pos.z);
      }
      if (this.timer <= 0) { this.state = "recover"; this.timer = 0.6; }
    } else {
      this.timer -= dt;
      if (this.timer <= 0) this.state = "approach";
    }
  }

  private sync(nx = 0, nz = 0): void {
    this.group.position.set(this.pos.x, this.cfg.bodyY, this.pos.z);
    if (nx || nz) this.group.rotation.y = Math.atan2(nx, nz);
  }

  dispose(): void {
    this.tele?.cancel();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.ctx.stage.scene.remove(this.group);
  }
}

export class EnemyManager {
  private list: Enemy[] = [];

  constructor(private ctx: Ctx) {}

  spawnWave(gateIndex: number): void {
    const wave = WAVES[gateIndex];
    if (!wave) return;
    const z0 = GATES_Z[gateIndex] - 22;
    const z1 = GATES_Z[gateIndex] - 6;
    for (const entry of wave) {
      for (let i = 0; i < entry.count; i++) {
        const x = this.ctx.rng.range(-HALF_WIDTH + 2, HALF_WIDTH - 2);
        const z = this.ctx.rng.range(z0, z1);
        this.spawn(entry.kind, x, z);
      }
    }
  }

  spawn(kind: EnemyKind, x: number, z: number): Enemy {
    const e = new Enemy(this.ctx, kind, x, z);
    this.list.push(e);
    return e;
  }

  /** Alive, non-dying enemies — combat targets + wave-clear count. */
  living(): Enemy[] {
    return this.list.filter((e) => e.alive && !e.dying);
  }

  aliveCount(): number {
    let n = 0;
    for (const e of this.list) if (e.alive && !e.dying) n++;
    return n;
  }

  clear(): void {
    for (const e of this.list) e.dispose();
    this.list.length = 0;
  }

  update(dt: number): void {
    for (const e of this.list) e.tick(dt);
    this.separate();
    // reap finished death animations
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (e.dying && e.group.scale.x <= 0.02) {
        e.dispose();
        this.list.splice(i, 1);
      }
    }
  }

  // ponytail: O(n²) push-apart, fine for the handful of enemies a wave spawns.
  private separate(): void {
    const live = this.living();
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], b = live[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        const min = a.radius + b.radius;
        if (d < min) {
          const push = (min - d) * 0.5;
          a.pos.x -= (dx / d) * push; a.pos.z -= (dz / d) * push;
          b.pos.x += (dx / d) * push; b.pos.z += (dz / d) * push;
        }
      }
    }
  }
}
