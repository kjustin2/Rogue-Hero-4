import * as THREE from "three";
import type { Ctx } from "./ctx";
import type { Hittable, HitOpts } from "./combat";
import type { TelegraphHandle } from "../render/telegraphs";
import { GATES_Z, HALF_WIDTH } from "./level";
import { damp } from "../core/math";
import { buildEnemyVisual } from "../render/enemyMeshes";
import type { RiggedInstance } from "../render/models";

export type EnemyKind = "husk" | "spitter" | "brute" | "wraith" | "ghoul" | "archer";

interface KindCfg {
  hp: number;
  radius: number;
  speed: number;
  contactDmg: number;
  attackRange: number;
  windup: number;
  color: number;
  bodyY: number;
  /** Ranged kinds only: what they hurl and how often (tickRanged reads this). */
  proj?: { speed: number; shape: "dart" | "cannonball" | "comet"; interval: number };
}

// the rift-born are the cursed undead of the keep — cold, unholy colors against the firelight
const KIND: Record<EnemyKind, KindCfg> = {
  husk: { hp: 30, radius: 0.6, speed: 9.6, contactDmg: 10, attackRange: 2.4, windup: 0.22, color: 0xbfccd9, bodyY: 0 }, // bone-pale risen wight
  spitter: { hp: 22, radius: 0.6, speed: 6.0, contactDmg: 9, attackRange: 13, windup: 0.36, color: 0x8ad26a, bodyY: 1.0, proj: { speed: 17, shape: "comet", interval: 1.45 } }, // witchfire caster: slow lobbed orb
  brute: { hp: 90, radius: 1.05, speed: 5.6, contactDmg: 26, attackRange: 4.4, windup: 0.52, color: 0xff5a2a, bodyY: 0 }, // molten-iron ogre
  wraith: { hp: 26, radius: 0.55, speed: 13.5, contactDmg: 15, attackRange: 9, windup: 0.26, color: 0xb9a6ff, bodyY: 0.7 }, // spectral banshee
  ghoul: { hp: 20, radius: 0.5, speed: 15.5, contactDmg: 12, attackRange: 2.2, windup: 0.13, color: 0xd06a3a, bodyY: 0 }, // feral flesh-eater: sprints in, swings fast
  archer: { hp: 20, radius: 0.55, speed: 5.5, contactDmg: 12, attackRange: 17, windup: 0.3, color: 0x8fb4ff, bodyY: 0.5, proj: { speed: 42, shape: "dart", interval: 1.05 } }, // skeletal bowman: fast straight bolts
};

// Waves, one per gate (see level.ts GATES_Z). Cleared → the gate opens. Escalating:
// fodder + rushers → a ranged line + lungers → an elite brute with a full support pack.
const WAVES: { kind: EnemyKind; count: number }[][] = [
  [{ kind: "husk", count: 3 }, { kind: "ghoul", count: 2 }, { kind: "wraith", count: 1 }],
  [{ kind: "husk", count: 3 }, { kind: "spitter", count: 2 }, { kind: "archer", count: 2 }, { kind: "wraith", count: 2 }, { kind: "ghoul", count: 2 }],
  [{ kind: "brute", count: 1 }, { kind: "wraith", count: 2 }, { kind: "spitter", count: 2 }, { kind: "archer", count: 2 }, { kind: "ghoul", count: 3 }, { kind: "husk", count: 2 }],
];

let NEXT_ID = 1;
const SHOT_DIR = new THREE.Vector3(); // scratch — projectiles.spawn copies it

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

  private state: "approach" | "windup" | "recover" | "lunge" = "approach";
  private timer = 0;
  private fireTimer = 1.5;
  private lungeDir = new THREE.Vector3();
  private didHit = false;
  private flash = 0;
  private flinch = 0; // hit-reaction recoil (0→1 on hit, decays) — leans the body back
  private kb = new THREE.Vector3();
  private tele: TelegraphHandle | null = null;
  group = new THREE.Group();
  private coreMat: THREE.MeshStandardMaterial;
  private core: THREE.Mesh;
  private weapon?: THREE.Group;     // held weapon, swung on the strike
  private weaponBase = new THREE.Euler();
  private rigged?: RiggedInstance;  // GLB skeleton — clips replace the scale-pulse body language
  private clip = "";                // current animation clip label
  private vt = 0;
  private atkCharge = 0; // wind-up inflate (0→1 across the telegraph)
  private atkLunge = 0;  // strike snap forward (set to 1, decays)
  private moveAmt = 0;   // 0..1 stride signal (drives lean + bob), from actual displacement
  private prevX = 0;
  private prevZ = 0;
  dying = false;
  private deathT = 0;

  /** Death animation finished — the manager parks the body back into the pool. */
  reapReady(): boolean {
    return this.dying && (this.rigged ? this.deathT > 1.6 : this.group.scale.x <= 0.02);
  }

  constructor(private ctx: Ctx, kind: EnemyKind, x: number, z: number) {
    this.kind = kind;
    this.cfg = KIND[kind];
    this.radius = this.cfg.radius;
    this.hp = this.maxHp = this.cfg.hp;
    this.hitColor = this.cfg.color;

    this.coreMat = new THREE.MeshStandardMaterial({ color: 0x05060d, emissive: this.cfg.color, emissiveIntensity: 1.6, roughness: 0.4, metalness: 0.2 });
    const parts = buildEnemyVisual(ctx.models, kind, this.cfg.color, this.coreMat, this.cfg.bodyY);
    this.group = parts.group;
    this.core = parts.core;
    this.weapon = parts.weapon;
    this.rigged = parts.rigged;
    if (this.weapon) this.weaponBase.copy(this.weapon.rotation);
    this.ctx.stage.scene.add(this.group);
    this.reset(x, z);
  }

  /** Fresh combat state at (x,z) — called on construct AND on reuse from the pool. */
  reset(x: number, z: number): void {
    this.pos.set(x, 0, z);
    this.prevX = x; this.prevZ = z;
    this.hp = this.maxHp;
    this.alive = true;
    this.dying = false;
    this.deathT = 0;
    this.state = "approach";
    this.timer = 0;
    this.fireTimer = 1.5;
    this.didHit = false;
    this.flash = 0; this.flinch = 0;
    this.atkCharge = 0; this.atkLunge = 0;
    this.moveAmt = 0; this.vt = 0;
    this.kb.set(0, 0, 0);
    this.coreMat.emissiveIntensity = 1.6;
    this.group.visible = true;
    this.group.scale.setScalar(1);
    this.group.rotation.set(0, 0, 0);
    this.group.position.set(x, this.cfg.bodyY, z);
    if (this.rigged) {
      this.rigged.mixer.stopAllAction();
      this.clip = "";
      this.playClip("idle");
    }
  }

  /** Crossfade to a clip; one-shots (attack/flinch/death) clamp at their last frame. */
  private playClip(label: string, once = false): void {
    const a = this.rigged?.actions[label];
    if (!a || this.clip === label) return;
    const prev = this.rigged!.actions[this.clip];
    a.reset();
    if (once) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    else a.setLoop(THREE.LoopRepeat, Infinity);
    if (prev) a.crossFadeFrom(prev, 0.18, false);
    a.play();
    this.clip = label;
  }

  /** Which clip the current AI state wants (priority: death > attack > flinch > locomotion). */
  private desiredClip(): { label: string; once: boolean } {
    if (this.dying) return { label: "death", once: true };
    if (this.state === "windup" || this.state === "lunge" || this.atkLunge > 0.5) return { label: "attack", once: true };
    if (this.flinch > 0.55) return { label: "flinch", once: true };
    return this.moveAmt > 0.22 ? { label: "walk", once: false } : { label: "idle", once: false };
  }

  /** Hide + deactivate, keeping mesh in-scene (shaders stay warm) for pool reuse. */
  park(): void {
    this.tele?.cancel(); this.tele = null;
    this.alive = false;
    this.dying = false;
    this.group.visible = false;
  }

  takeDamage(dmg: number, opts: HitOpts): boolean {
    if (!this.alive) return false;
    this.hp -= dmg;
    this.flash = 1;
    this.flinch = 1; // snap-back hit reaction
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
    // hit-reaction stagger: a solid hit CANCELS a winding-up attack — the payoff for
    // aggressive counterplay. Fodder buckles to anything; the brute only to heavy/big hits.
    if (this.state === "windup") {
      const tanky = this.kind === "brute";
      const solid = !!opts.heavy || dmg >= this.maxHp * 0.14;
      if (!tanky || solid) {
        this.tele?.cancel(); this.tele = null;
        this.state = "recover";
        this.timer = tanky ? 0.35 : 0.5;
        this.atkCharge = 0;
        this.ctx.fx.burst({ x: this.pos.x, y: this.cfg.bodyY + 1.1, z: this.pos.z, count: 8, color: 0xffffff, speed: [2, 6], size: [0.1, 0.28], life: [0.12, 0.3] });
      }
    }
    return false;
  }

  tick(dt: number): void {
    this.vt += dt;
    this.flash = Math.max(0, this.flash - dt * 4);
    this.flinch = Math.max(0, this.flinch - dt * 5);
    // ponytail: charge glow capped lower (2.0, was 3.5) — a clustered pack winding up at 5x emissive bloomed to a full-white frame
    this.coreMat.emissiveIntensity = 1.6 + this.flash * 4 + this.atkCharge * 2.0;
    if (this.core) { this.core.rotation.y += dt * 2.2; this.core.rotation.x += dt * 1.4; }

    if (this.dying) {
      this.deathT += dt;
      if (this.rigged) {
        const want = this.desiredClip();
        this.playClip(want.label, want.once);
        this.rigged.mixer.update(dt);
        if (this.deathT > 1.1) this.group.position.y -= dt * 1.5; // sink into the barrow
      } else {
        this.group.scale.setScalar(Math.max(0.001, 1 - this.deathT * 5));
      }
      return;
    }

    // knockback slide
    this.pos.addScaledVector(this.kb, dt);
    this.kb.x = damp(this.kb.x, 0, 6, dt);
    this.kb.z = damp(this.kb.z, 0, 6, dt);

    const p = this.ctx.player;
    const dx = p.pos.x - this.pos.x;
    const dz = p.pos.z - this.pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz) || 1;
    const nx = dx / dist;
    const nz = dz / dist;

    switch (this.kind) {
      case "husk": case "brute": case "ghoul": this.tickMelee(dt, dist, nx, nz); break;
      case "spitter": case "archer": this.tickRanged(dt, dist, nx, nz); break;
      case "wraith": this.tickLunge(dt, dist, nx, nz); break;
    }
    this.ctx.level.clampPosition(this.pos, this.radius);

    // attack body language: inflate + glow through the wind-up, snap forward on the strike
    const chargeTarget = this.state === "windup" ? 1 - Math.max(0, this.timer) / Math.max(0.001, this.cfg.windup) : 0;
    this.atkCharge = damp(this.atkCharge, chargeTarget, 10, dt);
    this.atkLunge = damp(this.atkLunge, 0, 7, dt);

    // stride signal from actual displacement (drives forward lean + a livelier bob)
    const sdx = this.pos.x - this.prevX, sdz = this.pos.z - this.prevZ;
    const sp = Math.sqrt(sdx * sdx + sdz * sdz) / Math.max(dt, 1e-3);
    this.moveAmt = damp(this.moveAmt, Math.min(1, sp / this.cfg.speed), 8, dt);
    this.prevX = this.pos.x; this.prevZ = this.pos.z;

    // a winding-up / lunging wraith commits to its telegraphed line — face + shove along
    // THAT, not the live player angle (the mismatch read as "dashing sideways").
    let fnx = nx, fnz = nz;
    if (this.kind === "wraith" && (this.state === "windup" || this.state === "lunge")) {
      fnx = this.lungeDir.x; fnz = this.lungeDir.z;
    }
    if (this.rigged) {
      const want = this.desiredClip();
      this.playClip(want.label, want.once);
      const walk = this.rigged.actions.walk;
      if (walk) walk.timeScale = 0.7 + this.moveAmt * 0.7; // stride pace tracks actual speed
      this.rigged.mixer.update(dt);
    }
    this.sync(fnx, fnz);
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

  // Ranged: reposition to mid-range → TELEGRAPH the shot lane (a wind-up you can react to,
  // by dodging or breaking line with cover) → loose along it → recover. Firing with no tell
  // was the unfair part; the aim line is the fairness contract.
  private tickRanged(dt: number, dist: number, nx: number, nz: number): void {
    const cfg = this.cfg;
    const pj = cfg.proj ?? { speed: 17, shape: "comet" as const, interval: 1.45 };

    if (this.state === "windup") {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.flash = 0.9;  // iris/eye flares as it looses
        this.atkLunge = 1; // staff thrusts / bow snaps forward on the shot
        const p = this.ctx.player;
        SHOT_DIR.set(p.pos.x - this.pos.x, 1.4 - this.cfg.bodyY, p.pos.z - this.pos.z);
        this.ctx.projectiles.spawn(this.pos.x, this.cfg.bodyY + 0.2, this.pos.z, SHOT_DIR, pj.speed, cfg.contactDmg, false, cfg.color, 2, { shape: pj.shape });
        this.tele = null;
        this.state = "recover";
        this.timer = 0.3;
        this.fireTimer = pj.interval;
      }
      return; // brace while aiming — don't drift
    }
    if (this.state === "recover") {
      this.timer -= dt;
      if (this.timer <= 0) this.state = "approach";
    }

    // keep mid-range
    if (dist < 8) { this.pos.x -= nx * cfg.speed * dt; this.pos.z -= nz * cfg.speed * dt; }
    else if (dist > cfg.attackRange) { this.pos.x += nx * cfg.speed * dt; this.pos.z += nz * cfg.speed * dt; }

    this.fireTimer -= dt;
    if (this.state === "approach" && this.fireTimer <= 0 && dist < cfg.attackRange + 2) {
      // wind up a telegraphed shot: paint the lane toward the player, then loose when it fills
      this.state = "windup";
      this.timer = cfg.windup;
      const len = Math.min(dist + 2, pj.shape === "dart" ? 22 : 15);
      this.tele = this.ctx.tele.line(this.pos.x, this.pos.z, Math.atan2(nz, nx), len, 1.5, cfg.windup, cfg.color);
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
      this.pos.x += this.lungeDir.x * 42 * dt;
      this.pos.z += this.lungeDir.z * 42 * dt;
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
    const fwd = this.atkLunge * 0.7; // lunge shoves the body toward the player on the strike
    if (this.rigged) {
      // real clips carry the body language — keep only facing, the strike shove and a hit snap
      this.group.position.set(this.pos.x + nx * fwd, this.cfg.bodyY, this.pos.z + nz * fwd);
      if (nx || nz) this.group.rotation.y = Math.atan2(nx, nz);
      this.group.rotation.x = -this.flinch * 0.18;
      return;
    }
    // bob grows with movement so a charging wight reads as striding, not gliding
    const bob = Math.sin(this.vt * (2.5 + this.moveAmt * 3) + this.id) * (0.1 + this.moveAmt * 0.14);
    this.group.position.set(this.pos.x + nx * fwd, this.cfg.bodyY + bob, this.pos.z + nz * fwd);
    this.group.scale.setScalar(1 + this.atkCharge * 0.14 - this.atkLunge * 0.12 - this.flinch * 0.1);
    if (nx || nz) this.group.rotation.y = Math.atan2(nx, nz);
    // lean into the advance (toward the player), faint living sway, recoil on strike, snap back on a hit
    this.group.rotation.x = this.moveAmt * 0.17 - this.atkLunge * 0.1 - this.flinch * 0.4;
    this.group.rotation.z = Math.sin(this.vt * 1.7 + this.id) * 0.04;
    // weapon: cocked back through the wind-up, swung hard on the strike, idle drift otherwise
    if (this.weapon) {
      const b = this.weaponBase;
      const idle = Math.sin(this.vt * 2 + this.id) * 0.07 * (1 - this.atkCharge);
      this.weapon.rotation.set(
        b.x - this.atkCharge * 0.8 + this.atkLunge * 1.9,
        b.y,
        b.z + idle - this.atkLunge * 0.3,
      );
    }
  }

  /** Full teardown (not used by the pool — park() is). Body materials are shared; only
   *  the per-instance coreMat is owned here. */
  dispose(): void {
    this.tele?.cancel();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.coreMat.dispose();
    this.ctx.stage.scene.remove(this.group);
  }
}

export class EnemyManager {
  private list: Enemy[] = [];
  // parked instances per kind — reused instead of rebuilt (meshes stay in-scene, shaders warm)
  private parked: Record<EnemyKind, Enemy[]> = { husk: [], spitter: [], brute: [], wraith: [], ghoul: [], archer: [] };
  private live: Enemy[] = []; // living() scratch — refilled every call, never retained

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
    const pooled = this.parked[kind].pop();
    const e = pooled ?? new Enemy(this.ctx, kind, x, z);
    if (pooled) e.reset(x, z);
    this.list.push(e);
    return e;
  }

  /** Alive, non-dying enemies — combat targets + wave-clear count.
   *  Returns a reusable scratch array: consume immediately, never retain. */
  living(): Enemy[] {
    this.live.length = 0;
    for (const e of this.list) if (e.alive && !e.dying) this.live.push(e);
    return this.live;
  }

  aliveCount(): number {
    let n = 0;
    for (const e of this.list) if (e.alive && !e.dying) n++;
    return n;
  }

  clear(): void {
    for (const e of this.list) { e.park(); this.parked[e.kind].push(e); }
    this.list.length = 0;
  }

  update(dt: number): void {
    for (const e of this.list) e.tick(dt);
    this.separate();
    // reap finished death animations back into the pool
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (e.reapReady()) {
        e.park();
        this.parked[e.kind].push(e);
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
        const d = Math.sqrt(dx * dx + dz * dz) || 1;
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
