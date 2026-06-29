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
  private core!: THREE.Mesh;
  private vt = 0;
  private atkCharge = 0; // wind-up inflate (0→1 across the telegraph)
  private atkLunge = 0;  // strike snap forward (set to 1, decays)
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
    const c = this.cfg.color;
    const shellMat = new THREE.MeshStandardMaterial({ color: 0x0b0d18, roughness: 0.45, metalness: 0.72, emissive: c, emissiveIntensity: 0.28, envMapIntensity: 1.1 });
    const plateMat = new THREE.MeshStandardMaterial({ color: 0x141826, roughness: 0.5, metalness: 0.8, emissive: c, emissiveIntensity: 0.2, envMapIntensity: 1.1 });
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x05060d, emissive: c, emissiveIntensity: 1.7, roughness: 0.35, metalness: 0.3 });

    if (this.kind === "husk") {
      // hooded shard-wraith: tapered body, cowl, cracked core behind it, crown + fins + tatters
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.72, 1.7, 6), shellMat);
      body.position.y = 0.95; body.castShadow = true;
      const cowl = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.0, 6), plateMat);
      cowl.position.y = 1.7; cowl.castShadow = true;
      this.core = new THREE.Mesh(new THREE.OctahedronGeometry(0.32), this.coreMat);
      this.core.position.y = 1.3;
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.12), this.coreMat);
      eye.position.set(0, 1.12, 0.46);
      this.group.add(body, cowl, this.core, eye);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.5, 4), edgeMat);
        spike.position.set(Math.cos(a) * 0.42, 2.15, Math.sin(a) * 0.42);
        this.group.add(spike);
      }
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.5;
        const fin = new THREE.Mesh(new THREE.ConeGeometry(0.1, 1.0, 4), edgeMat);
        fin.position.set(Math.cos(a) * 0.55, 1.4, Math.sin(a) * 0.55);
        fin.rotation.set(-Math.sin(a) * 0.7, 0, Math.cos(a) * 0.7);
        const tatter = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 0.16), edgeMat);
        tatter.position.set(Math.cos(a) * 0.5, 0.4, Math.sin(a) * 0.5);
        this.group.add(fin, tatter);
      }
    } else if (this.kind === "spitter") {
      // armored eye: split shell, glowing iris, energy ring, antennae, orbiting shards
      const back = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), plateMat);
      back.rotation.x = -Math.PI / 2; back.castShadow = true;
      const brow = new THREE.Mesh(new THREE.SphereGeometry(0.64, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.32), plateMat);
      brow.rotation.x = Math.PI / 2; brow.position.z = 0.02;
      this.core = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), this.coreMat);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.05, 8, 30), edgeMat);
      ring.rotation.x = Math.PI / 2;
      this.group.add(back, brow, this.core, ring);
      for (const sx of [-1, 1]) {
        const ant = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.6, 4), edgeMat);
        ant.position.set(sx * 0.35, 0.55, -0.1); ant.rotation.z = sx * 0.4;
        this.group.add(ant);
      }
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const sh = new THREE.Mesh(new THREE.TetrahedronGeometry(0.16), edgeMat);
        sh.position.set(Math.cos(a) * 1.0, Math.sin(a * 1.7) * 0.2, Math.sin(a) * 1.0);
        this.group.add(sh);
      }
    } else if (this.kind === "wraith") {
      // sleek delta: layered arrowhead, swept fins, elongated trailing core, edge lines
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.5, 4), shellMat);
      head.rotation.x = Math.PI / 2; head.castShadow = true; // points forward; group yaw aims it
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.9, 4), plateMat);
      tail.rotation.x = -Math.PI / 2; tail.position.z = -0.7;
      this.core = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.9, 6), this.coreMat);
      this.core.rotation.x = Math.PI / 2; this.core.position.z = -0.3;
      this.group.add(head, tail, this.core);
      for (const sx of [-1, 1]) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.75, 0.8), shellMat);
        fin.position.set(sx * 0.36, 0, 0.4); fin.rotation.z = sx * 0.45;
        const edge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.4), edgeMat);
        edge.position.set(sx * 0.16, 0, 0);
        this.group.add(fin, edge);
      }
    } else {
      // brute: hulking golem — stacked torso plates, spiked pauldrons, grated chest core
      const lower = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 1.3), shellMat);
      lower.position.y = 0.65; lower.castShadow = true;
      const upper = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.0, 1.4), plateMat);
      upper.position.y = 1.7; upper.castShadow = true;
      const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), plateMat);
      head.position.y = 2.6; head.castShadow = true;
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.1), this.coreMat);
      eye.position.set(0, 2.62, 0.45);
      this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42), this.coreMat);
      this.core.position.set(0, 1.55, 0.6);
      this.group.add(lower, upper, head, eye, this.core);
      for (let i = 0; i < 4; i++) { // chest grate bars over the core
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.08), shellMat);
        bar.position.set(-0.3 + i * 0.2, 1.55, 0.72);
        this.group.add(bar);
      }
      for (const sx of [-1, 1]) {
        const pauld = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 1.3), plateMat);
        pauld.position.set(sx * 1.15, 2.0, 0); pauld.castShadow = true;
        for (let i = 0; i < 3; i++) {
          const spike = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 4), edgeMat);
          spike.position.set(sx * 1.15, 2.45, -0.4 + i * 0.4); spike.rotation.x = -0.3;
          this.group.add(spike);
        }
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.3, 0.5), shellMat);
        arm.position.set(sx * 1.15, 1.1, 0); arm.castShadow = true;
        const fist = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), plateMat);
        fist.position.set(sx * 1.15, 0.4, 0);
        this.group.add(pauld, arm, fist);
      }
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
    this.vt += dt;
    this.flash = Math.max(0, this.flash - dt * 4);
    this.coreMat.emissiveIntensity = 1.6 + this.flash * 4 + this.atkCharge * 3.5;
    if (this.core) { this.core.rotation.y += dt * 2.2; this.core.rotation.x += dt * 1.4; }

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

    // attack body language: inflate + glow through the wind-up, snap forward on the strike
    const chargeTarget = this.state === "windup" ? 1 - Math.max(0, this.timer) / Math.max(0.001, this.cfg.windup) : 0;
    this.atkCharge = damp(this.atkCharge, chargeTarget, 10, dt);
    this.atkLunge = damp(this.atkLunge, 0, 7, dt);

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
        // strike lands — snap forward + a slash arc + sparks so the swing reads even on a whiff
        this.atkLunge = 1;
        this.flash = 1;
        const yaw = Math.atan2(nx, nz);
        const heavy = this.kind === "brute";
        const sy = this.cfg.bodyY + (heavy ? 1.8 : 1.2);
        this.ctx.fx.slash(this.pos.x + nx * 0.9, sy, this.pos.z + nz * 0.9, yaw, {
          color: cfg.color, radius: heavy ? 3.4 : 2.3, tilt: heavy ? -0.05 : -0.6, duration: 0.26,
        });
        this.ctx.fx.burst({ x: this.pos.x + nx * 1.4, y: sy, z: this.pos.z + nz * 1.4, count: heavy ? 16 : 11, color: cfg.color, speed: [3, heavy ? 11 : 8], life: [0.2, 0.45] });
        if (dist <= cfg.attackRange + 0.8) this.ctx.combat.damagePlayer(cfg.contactDmg, this.pos.x, this.pos.z);
        if (heavy) this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: cfg.attackRange, color: cfg.color, duration: 0.3 });
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
      this.flash = 0.9; // iris flares as it spits
      const p = this.ctx.player;
      const dir = new THREE.Vector3(p.pos.x - this.pos.x, 1.4 - this.cfg.bodyY, p.pos.z - this.pos.z);
      this.ctx.projectiles.spawn(this.pos.x, this.cfg.bodyY + 0.2, this.pos.z, dir, 17, cfg.contactDmg, false, cfg.color, 2);
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
      this.atkLunge = 1; // stay stretched through the dash
      this.pos.x += this.lungeDir.x * 26 * dt;
      this.pos.z += this.lungeDir.z * 26 * dt;
      // streak trail behind the blur
      this.ctx.fx.burst({ x: this.pos.x, y: 0.8, z: this.pos.z, count: 2, color: cfg.color, speed: [0.5, 2], size: [0.16, 0.36], life: [0.12, 0.28], gravity: 0, drag: 4 });
      if (!this.didHit && dist < this.radius + this.ctx.player.radius + 0.8) {
        this.didHit = true;
        this.ctx.combat.damagePlayer(cfg.contactDmg, this.pos.x, this.pos.z);
        this.ctx.fx.slash(this.pos.x, 1.0, this.pos.z, Math.atan2(this.lungeDir.x, this.lungeDir.z), { color: cfg.color, radius: 2.4, tilt: -0.4, duration: 0.22 });
      }
      if (this.timer <= 0) { this.state = "recover"; this.timer = 0.6; }
    } else {
      this.timer -= dt;
      if (this.timer <= 0) this.state = "approach";
    }
  }

  private sync(nx = 0, nz = 0): void {
    const bob = Math.sin(this.vt * 2.5 + this.id) * 0.1;
    const fwd = this.atkLunge * 0.7; // lunge shoves the body toward the player on the strike
    this.group.position.set(this.pos.x + nx * fwd, this.cfg.bodyY + bob, this.pos.z + nz * fwd);
    this.group.scale.setScalar(1 + this.atkCharge * 0.14 - this.atkLunge * 0.12);
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
