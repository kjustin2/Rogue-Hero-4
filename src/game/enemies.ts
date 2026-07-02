import * as THREE from "three";
import type { Ctx } from "./ctx";
import type { Hittable, HitOpts } from "./combat";
import type { TelegraphHandle } from "../render/telegraphs";
import { GATES_Z, HALF_WIDTH } from "./level";
import { damp } from "../core/math";
import { PAL } from "../core/palette";
import { buildEnemyMesh } from "../render/enemyMeshes";

export type EnemyKind = "husk" | "spitter" | "brute" | "wraith" | "ghoul" | "archer" | "gargoyle" | "bomber";

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
  proj?: { speed: number; shape: "dart" | "cannonball" | "comet"; interval: number; gravity?: number; explode?: number };
}

// the rift-born are the cursed undead of the keep — cold, unholy colors against the firelight
const KIND: Record<EnemyKind, KindCfg> = {
  husk: { hp: 30, radius: 0.6, speed: 9.6, contactDmg: 10, attackRange: 2.4, windup: 0.22, color: 0xbfccd9, bodyY: 0 }, // bone-pale risen wight
  spitter: { hp: 22, radius: 0.6, speed: 6.0, contactDmg: 9, attackRange: 13, windup: 0.36, color: 0x8ad26a, bodyY: 1.0, proj: { speed: 17, shape: "comet", interval: 1.45 } }, // witchfire caster: slow lobbed orb
  brute: { hp: 90, radius: 1.05, speed: 5.6, contactDmg: 26, attackRange: 4.4, windup: 0.52, color: 0xff5a2a, bodyY: 0 }, // molten-iron ogre
  wraith: { hp: 26, radius: 0.55, speed: 13.5, contactDmg: 15, attackRange: 9, windup: 0.26, color: 0xb9a6ff, bodyY: 0.7 }, // spectral banshee
  ghoul: { hp: 20, radius: 0.5, speed: 15.5, contactDmg: 12, attackRange: 2.2, windup: 0.13, color: 0xd06a3a, bodyY: 0 }, // feral flesh-eater: sprints in, swings fast
  archer: { hp: 20, radius: 0.55, speed: 5.5, contactDmg: 12, attackRange: 17, windup: 0.3, color: 0x8fb4ff, bodyY: 0.5, proj: { speed: 42, shape: "dart", interval: 1.05 } }, // skeletal bowman: fast straight bolts
  gargoyle: { hp: 24, radius: 0.6, speed: 11, contactDmg: 15, attackRange: 11, windup: 0.55, color: 0xffa24a, bodyY: 0 }, // stone flyer: circles high, telegraphed dive
  bomber: { hp: 60, radius: 0.95, speed: 4.2, contactDmg: 18, attackRange: 17, windup: 0.6, color: 0xff8038, bodyY: 0, proj: { speed: 15, shape: "cannonball", interval: 2.6, gravity: 15, explode: 3.4 } }, // crypt bombard: lobbed exploding skulls
};

// Elite modifiers — a data catalog, rolled by the spawn director on gate 2+.
export type EliteKind = "shielded" | "frenzied" | "bursting";
const ELITE_NAMES: Record<EliteKind, string> = { shielded: "SHIELDED", frenzied: "FRENZIED", bursting: "BURSTING" };
const ELITE_KINDS: EliteKind[] = ["shielded", "frenzied", "bursting"];
const crownMat = new THREE.MeshStandardMaterial({ color: 0x05060d, emissive: 0xffc24a, emissiveIntensity: 2.2, roughness: 0.3, metalness: 0.4 });
crownMat.userData.shared = true;

// Spawn-director budgets, one per gate (replaces the old fixed wave tables): each
// wave spends `budget` on a weighted pack, trickling reinforcements while under
// `cap` — pacing reads the player (dominating → pour it on, hurting → ease off).
interface GateWaveCfg { budget: number; cap: number; eliteChance: number; pack: [EnemyKind, number][] }
const GATE_WAVES: GateWaveCfg[] = [
  { budget: 12, cap: 5, eliteChance: 0, pack: [["husk", 3], ["ghoul", 2], ["wraith", 1]] },
  { budget: 22, cap: 6, eliteChance: 0.2, pack: [["husk", 3], ["spitter", 2], ["archer", 2], ["wraith", 2], ["ghoul", 2], ["gargoyle", 2]] },
  { budget: 36, cap: 7, eliteChance: 0.28, pack: [["brute", 2], ["wraith", 2], ["spitter", 2], ["archer", 2], ["ghoul", 3], ["husk", 2], ["gargoyle", 2], ["bomber", 2]] },
];
const COST: Record<EnemyKind, number> = { husk: 2, ghoul: 2, wraith: 3, spitter: 3, archer: 3, brute: 6, gargoyle: 3, bomber: 5 };

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
  elite: EliteKind | null = null;
  /** Boss-summoned adds always drop a shard (the boss-fight heal economy). */
  guaranteedShard = false;
  private speedMult = 1;
  private baseScale = 1;
  private crown?: THREE.Mesh;
  private burstT = -1; // bursting elite: fuse after death (-1 = none)

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
  private wings?: { l: THREE.Object3D; r: THREE.Object3D };
  /** Flyer altitude (gargoyle) — cruise high, dive to strike. */
  private alt = 0;
  /** Vertical hit column (projectiles) — flyers move theirs with altitude. */
  hitTop?: number;
  hitBottom?: number;
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
    return this.dying && this.group.scale.x <= 0.02;
  }

  constructor(private ctx: Ctx, kind: EnemyKind, x: number, z: number) {
    this.kind = kind;
    this.cfg = KIND[kind];
    this.radius = this.cfg.radius;
    this.hp = this.maxHp = this.cfg.hp;
    this.hitColor = this.cfg.color;

    this.coreMat = new THREE.MeshStandardMaterial({ color: 0x05060d, emissive: this.cfg.color, emissiveIntensity: 1.6, roughness: 0.4, metalness: 0.2 });
    const parts = buildEnemyMesh(kind, this.cfg.color, this.coreMat);
    this.group = parts.group;
    this.core = parts.core;
    this.weapon = parts.weapon;
    this.wings = parts.wings;
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
    this.alt = this.kind === "gargoyle" ? 4.5 : 0;
    this.hitTop = undefined;
    this.hitBottom = undefined;
    this.kb.set(0, 0, 0);
    this.elite = null;
    this.guaranteedShard = false;
    this.speedMult = 1;
    this.baseScale = 1;
    this.burstT = -1;
    if (this.crown) this.crown.visible = false;
    this.radius = this.cfg.radius;
    this.coreMat.emissiveIntensity = 1.6;
    this.group.visible = true;
    this.group.scale.setScalar(1);
    this.group.rotation.set(0, 0, 0);
    this.group.position.set(x, this.cfg.bodyY, z);
  }

  /** Promote to an elite: bigger, 2.5x hp, a gold crown, one twist per kind. */
  makeElite(kind: EliteKind): void {
    this.elite = kind;
    this.hp = this.maxHp = Math.round(this.cfg.hp * 2.5);
    this.baseScale = 1.3;
    this.radius = this.cfg.radius * 1.25;
    if (kind === "frenzied") this.speedMult = 1.45;
    this.group.scale.setScalar(this.baseScale);
    if (!this.crown) {
      this.crown = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), crownMat);
      this.group.add(this.crown);
    }
    // hover the crown above whatever body this kind has
    this.crown.position.set(0, this.kind === "brute" ? 3.6 : 2.3 - this.cfg.bodyY, 0);
    this.crown.visible = true;
    this.ctx.floaters.spawn(this.pos.x, this.cfg.bodyY + 2.2, this.pos.z, ELITE_NAMES[kind], "label", "#ffc24a");
  }

  /** Damage-funnel hook: a shielded elite shrugs off frontal hits — flank it. */
  modifyIncoming(dmg: number, opts: HitOpts): number {
    if (this.elite !== "shielded" || opts.fromX === undefined || opts.fromZ === undefined) return dmg;
    const fy = this.group.rotation.y; // facing (toward the player, usually)
    const hx = opts.fromX - this.pos.x, hz = opts.fromZ - this.pos.z;
    const d = Math.hypot(hx, hz) || 1;
    const frontal = (hx / d) * Math.sin(fy) + (hz / d) * Math.cos(fy) > 0.25;
    if (frontal) {
      this.ctx.fx.burst({ x: this.pos.x, y: this.cfg.bodyY + 1.3, z: this.pos.z, count: 6, color: 0xcfd6e4, speed: [2, 5], size: [0.08, 0.2], life: [0.1, 0.25] });
      return dmg * 0.3;
    }
    return dmg;
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
      if (this.elite === "bursting") {
        this.burstT = 0.7;
        this.ctx.tele.circle(this.pos.x, this.pos.z, 3.6, 0.7, PAL.threat);
      }
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
    this.coreMat.emissiveIntensity = 1.4 + this.flash * 2.2 + this.atkCharge * 1.2;
    if (this.core) { this.core.rotation.y += dt * 2.2; this.core.rotation.x += dt * 1.4; }
    if (this.crown?.visible) this.crown.rotation.y += dt * 3;

    if (this.dying) {
      this.deathT += dt;
      if (this.burstT > 0) {
        this.burstT -= dt;
        if (this.burstT <= 0) {
          // the bursting elite detonates — telegraphed at death, dodgeable
          const p = this.ctx.player;
          this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 3.6, color: PAL.threat, duration: 0.4, y: 0.3 });
          this.ctx.fx.burst({ x: this.pos.x, y: 1, z: this.pos.z, count: 30, color: [PAL.threat, 0xffffff], speed: [5, 14], up: 0.8, life: [0.3, 0.6] });
          this.ctx.sfx.explosion();
          this.ctx.cam.addTrauma(0.2);
          if (Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) <= 3.6) this.ctx.combat.damagePlayer(20, this.pos.x, this.pos.z);
        }
      }
      this.group.scale.setScalar(Math.max(0.001, 1 - this.deathT * 5));
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
      case "spitter": case "archer": case "bomber": this.tickRanged(dt, dist, nx, nz); break;
      case "wraith": this.tickLunge(dt, dist, nx, nz); break;
      case "gargoyle": this.tickFly(dt, dist, nx, nz); break;
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
    if ((this.kind === "wraith" || this.kind === "gargoyle") && (this.state === "windup" || this.state === "lunge")) {
      fnx = this.lungeDir.x; fnz = this.lungeDir.z;
    }
    this.sync(fnx, fnz);
  }

  private tickMelee(dt: number, dist: number, nx: number, nz: number): void {
    const cfg = this.cfg;
    if (this.state === "approach") {
      if (dist > cfg.attackRange) {
        // ghouls flank: their approach bends into a curving arc that straightens close-in
        let mx = nx, mz = nz;
        if (this.kind === "ghoul" && dist > 5) {
          const bend = (this.id % 2 === 0 ? 1 : -1) * 0.8 * Math.min(1, (dist - 5) / 12);
          const cb = Math.cos(bend), sb = Math.sin(bend);
          mx = nx * cb - nz * sb;
          mz = nx * sb + nz * cb;
        }
        this.pos.x += mx * cfg.speed * this.speedMult * dt;
        this.pos.z += mz * cfg.speed * this.speedMult * dt;
      } else {
        this.state = "windup";
        this.timer = cfg.windup;
        const angle = Math.atan2(nz, nx);
        if (this.kind === "brute") this.tele = this.ctx.tele.circle(this.pos.x, this.pos.z, cfg.attackRange, cfg.windup, PAL.threat);
        else this.tele = this.ctx.tele.line(this.pos.x, this.pos.z, angle, cfg.attackRange + 0.5, 1.4, cfg.windup, PAL.threat);
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
          color: PAL.threat, radius: heavy ? 2.2 : 1.3, tilt: heavy ? -0.05 : -0.6, duration: 0.16,
        });
        this.ctx.fx.burst({ x: this.pos.x + nx * 1.4, y: sy, z: this.pos.z + nz * 1.4, count: heavy ? 12 : 8, color: PAL.threat, speed: [3, heavy ? 10 : 7], life: [0.2, 0.4] });
        if (dist <= cfg.attackRange + 0.8) this.ctx.combat.damagePlayer(cfg.contactDmg, this.pos.x, this.pos.z);
        if (heavy) this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: cfg.attackRange, color: PAL.threat, duration: 0.3 });
        this.state = "recover";
        this.timer = (this.kind === "brute" ? 0.9 : 0.4) / this.speedMult;
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
        if (pj.gravity) {
          // mortar lob: launch up-and-out; gravity brings it down on the player
          SHOT_DIR.set(p.pos.x - this.pos.x, dist * 0.55, p.pos.z - this.pos.z);
          this.ctx.projectiles.spawn(this.pos.x, this.cfg.bodyY + 1.6, this.pos.z, SHOT_DIR, pj.speed, cfg.contactDmg, false, PAL.threat, 2, { shape: pj.shape, gravity: pj.gravity, explode: pj.explode });
        } else {
          SHOT_DIR.set(p.pos.x - this.pos.x, 1.4 - this.cfg.bodyY, p.pos.z - this.pos.z);
          this.ctx.projectiles.spawn(this.pos.x, this.cfg.bodyY + 0.2, this.pos.z, SHOT_DIR, pj.speed, cfg.contactDmg, false, PAL.threat, 2, { shape: pj.shape });
        }
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

    // keep mid-range; in the band, strafe perpendicular so the ranged line drifts
    // apart and flanks instead of stacking into one lane
    const sp = cfg.speed * this.speedMult;
    if (dist < 8) { this.pos.x -= nx * sp * dt; this.pos.z -= nz * sp * dt; }
    else if (dist > cfg.attackRange) { this.pos.x += nx * sp * dt; this.pos.z += nz * sp * dt; }
    else {
      const sdir = this.id % 2 === 0 ? 1 : -1;
      this.pos.x += -nz * sdir * sp * 0.45 * dt;
      this.pos.z += nx * sdir * sp * 0.45 * dt;
    }

    this.fireTimer -= dt;
    if (this.state === "approach" && this.fireTimer <= 0 && dist < cfg.attackRange + 2) {
      // wind up a telegraphed shot: paint the lane toward the player, then loose when it fills
      this.state = "windup";
      this.timer = cfg.windup;
      const len = Math.min(dist + 2, pj.shape === "dart" ? 22 : 15);
      this.tele = this.ctx.tele.line(this.pos.x, this.pos.z, Math.atan2(nz, nx), len, 1.5, cfg.windup, PAL.threat);
    }
  }

  // Wraith: stalk → telegraph a long line → commit to a fast forward lunge that
  // hits once if it passes through the player. Dodge it with a dash.
  private tickLunge(dt: number, dist: number, nx: number, nz: number): void {
    const cfg = this.cfg;
    if (this.state === "approach") {
      if (dist > cfg.attackRange) {
        this.pos.x += nx * cfg.speed * this.speedMult * 0.7 * dt;
        this.pos.z += nz * cfg.speed * this.speedMult * 0.7 * dt;
      } else {
        this.state = "windup";
        this.timer = cfg.windup;
        this.lungeDir.set(nx, 0, nz);
        this.tele = this.ctx.tele.line(this.pos.x, this.pos.z, Math.atan2(nz, nx), 12, 1.6, cfg.windup, PAL.threat);
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
      this.pos.x += this.lungeDir.x * 42 * this.speedMult * dt;
      this.pos.z += this.lungeDir.z * 42 * this.speedMult * dt;
      // streak trail behind the blur
      this.ctx.fx.burst({ x: this.pos.x, y: 0.8, z: this.pos.z, count: 2, color: cfg.color, speed: [0.5, 2], size: [0.16, 0.36], life: [0.12, 0.28], gravity: 0, drag: 4 });
      if (!this.didHit && dist < this.radius + this.ctx.player.radius + 0.8) {
        this.didHit = true;
        this.ctx.combat.damagePlayer(cfg.contactDmg, this.pos.x, this.pos.z);
        this.ctx.fx.slash(this.pos.x, 1.0, this.pos.z, Math.atan2(this.lungeDir.x, this.lungeDir.z), { color: PAL.threat, radius: 2.0, tilt: -0.4, duration: 0.2 });
      }
      if (this.timer <= 0) { this.state = "recover"; this.timer = 0.6; }
    } else {
      this.timer -= dt;
      if (this.timer <= 0) this.state = "approach";
    }
  }

  // Gargoyle: circle HIGH over the fight → telegraph a dive lane → swoop through the
  // player (dodge with a dash) → climb back to cruise. Its hit column rides its altitude.
  private tickFly(dt: number, dist: number, nx: number, nz: number): void {
    const cfg = this.cfg;
    const cruise = 4.5 + Math.sin(this.vt * 1.3 + this.id) * 0.5;
    if (this.state === "approach") {
      this.alt = damp(this.alt, cruise, 3, dt);
      // spiral in: approach with a sideways bias so it ORBITS rather than hovers
      const sdir = this.id % 2 === 0 ? 1 : -1;
      const mx = nx * 0.75 + -nz * sdir * 0.65;
      const mz = nz * 0.75 + nx * sdir * 0.65;
      this.pos.x += mx * cfg.speed * this.speedMult * dt;
      this.pos.z += mz * cfg.speed * this.speedMult * dt;
      if (dist < cfg.attackRange && dist > 4) {
        this.state = "windup";
        this.timer = cfg.windup;
        this.lungeDir.set(nx, 0, nz);
        this.tele = this.ctx.tele.line(this.pos.x, this.pos.z, Math.atan2(nz, nx), dist + 6, 1.7, cfg.windup, PAL.threat);
      }
    } else if (this.state === "windup") {
      this.alt = damp(this.alt, cruise + 1.2, 4, dt); // rears up before the stoop
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = "lunge";
        this.timer = 0.55;
        this.didHit = false;
        this.tele = null;
        this.ctx.sfx.enemyDive();
      }
    } else if (this.state === "lunge") {
      this.timer -= dt;
      this.atkLunge = 1;
      this.alt = damp(this.alt, 1.1, 9, dt); // the stoop
      this.pos.x += this.lungeDir.x * 26 * this.speedMult * dt;
      this.pos.z += this.lungeDir.z * 26 * this.speedMult * dt;
      this.ctx.fx.burst({ x: this.pos.x, y: this.alt, z: this.pos.z, count: 2, color: PAL.threat, speed: [0.5, 2], size: [0.12, 0.28], life: [0.1, 0.24], gravity: 0, drag: 4 });
      if (!this.didHit && this.alt < 2.4 && dist < this.radius + this.ctx.player.radius + 0.9) {
        this.didHit = true;
        this.ctx.combat.damagePlayer(cfg.contactDmg, this.pos.x, this.pos.z);
        this.ctx.fx.slash(this.pos.x, 1.4, this.pos.z, Math.atan2(this.lungeDir.x, this.lungeDir.z), { color: PAL.threat, radius: 1.6, tilt: -0.3, duration: 0.18 });
      }
      if (this.timer <= 0) { this.state = "recover"; this.timer = 1.0; }
    } else {
      this.alt = damp(this.alt, cruise, 2.5, dt); // climb out
      this.timer -= dt;
      if (this.timer <= 0) this.state = "approach";
    }
    // the hit column rides the body so grounded swings miss a cruising flyer
    this.hitTop = this.alt + 1.2;
    this.hitBottom = Math.max(0.2, this.alt - 1.3);
  }

  private sync(nx = 0, nz = 0): void {
    const fwd = this.atkLunge * 0.7; // lunge shoves the body toward the player on the strike
    // bob grows with movement so a charging wight reads as striding, not gliding
    const bob = Math.sin(this.vt * (2.5 + this.moveAmt * 3) + this.id) * (0.1 + this.moveAmt * 0.14);
    this.group.position.set(this.pos.x + nx * fwd, this.cfg.bodyY + this.alt + bob, this.pos.z + nz * fwd);
    if (this.wings) {
      // wingbeat: deep slow strokes on the cruise, swept tight in the stoop
      const diving = this.state === "lunge";
      const flap = diving ? -0.55 : Math.sin(this.vt * (this.state === "windup" ? 16 : 9) + this.id) * 0.55;
      this.wings.l.rotation.z = -flap - 0.15;
      this.wings.r.rotation.z = flap + 0.15;
    }
    this.group.scale.setScalar(this.baseScale * (1 + this.atkCharge * 0.14 - this.atkLunge * 0.12 - this.flinch * 0.1));
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
  private parked: Record<EnemyKind, Enemy[]> = { husk: [], spitter: [], brute: [], wraith: [], ghoul: [], archer: [], gargoyle: [], bomber: [] };
  private live: Enemy[] = []; // living() scratch — refilled every call, never retained
  // spawn-director state for the active gate wave
  private waveCfg: GateWaveCfg | null = null;
  private waveBudget = 0;
  private waveGate = 0;
  private waveElite = false;
  private trickleT = 0;

  constructor(private ctx: Ctx) {}

  /** Arm the director for a gate: spend part of the budget up front, trickle the rest. */
  spawnWave(gateIndex: number): void {
    const cfg = GATE_WAVES[Math.min(gateIndex, GATE_WAVES.length - 1)];
    this.waveCfg = cfg;
    this.waveBudget = cfg.budget;
    this.waveGate = gateIndex;
    this.waveElite = gateIndex >= 1; // elites only past the first gate
    this.trickleT = 0;
    const burst = Math.min(cfg.cap, 4);
    for (let i = 0; i < burst && this.waveBudget > 0; i++) this.directorSpawn();
  }

  /** Test seam: dump the remaining wave budget (smoke fast-forwards a gate). */
  drainBudget(): void {
    this.waveBudget = 0;
  }

  /** All budget spent AND the field cleared — the gate may open. */
  waveDone(): boolean {
    return this.waveBudget <= 0 && this.aliveCount() === 0;
  }

  private directorSpawn(): void {
    const cfg = this.waveCfg;
    if (!cfg || this.waveBudget <= 0) return;
    // weighted pick among what the remaining budget can afford
    const affordable = cfg.pack.filter(([k]) => COST[k] <= this.waveBudget);
    if (!affordable.length) { this.waveBudget = 0; return; }
    let total = 0;
    for (const [, w] of affordable) total += w;
    let roll = this.ctx.rng.range(0, total);
    let kind = affordable[0][0];
    for (const [k, w] of affordable) { roll -= w; if (roll <= 0) { kind = k; break; } }
    this.waveBudget -= COST[kind];
    const x = this.ctx.rng.range(-HALF_WIDTH + 2, HALF_WIDTH - 2);
    const z = this.ctx.rng.range(GATES_Z[this.waveGate] - 22, GATES_Z[this.waveGate] - 6);
    const e = this.spawn(kind, x, z);
    if (this.waveElite && this.ctx.rng.next() < cfg.eliteChance) {
      e.makeElite(ELITE_KINDS[this.ctx.rng.int(0, ELITE_KINDS.length - 1)]);
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
    this.waveCfg = null;
    this.waveBudget = 0;
  }

  update(dt: number): void {
    // director trickle: pour on reinforcements while under cap — the cap reads the
    // player (healthy → +1 pressure, hurting → back off two)
    if (this.waveCfg && this.waveBudget > 0) {
      this.trickleT -= dt;
      const hpFrac = this.ctx.player.hp / this.ctx.player.maxHp;
      const cap = this.waveCfg.cap + (hpFrac > 0.7 ? 1 : hpFrac < 0.35 ? -2 : 0);
      if (this.trickleT <= 0 && this.aliveCount() < cap) {
        this.directorSpawn();
        this.trickleT = 0.5;
      }
    }
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
    // personal space: bodies never overlap the player (they were walking into the
    // camera's near plane); attack ranges all carry +0.8 slack so strikes still land
    const p = this.ctx.player;
    for (const e of live) {
      const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const min = e.radius + p.radius + 0.6;
      if (d < min) {
        e.pos.x = p.pos.x + (dx / d) * min;
        e.pos.z = p.pos.z + (dz / d) * min;
      }
    }
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
