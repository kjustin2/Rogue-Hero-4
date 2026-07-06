import * as THREE from "three";
import type { Ctx } from "./ctx";
import type { Hittable, HitOpts } from "./combat";
import type { TelegraphHandle } from "../render/telegraphs";
import { BOSS_ANCHOR, ARENA_CENTER, ARENA_RADIUS } from "./level";
import { damp } from "../core/math";
import { PAL } from "../core/palette";
import { buildBossMesh } from "../render/bossMesh";

const CORE_Y = 6.0; // world height of the weak-point core
const VOLLEY_DIR = new THREE.Vector3(); // scratch — projectiles.spawn copies it

// arena anchors the Warden shifts between (phase 2+) — the fight roams, camping dies
// the King PROWLS the arena (was 4 points clustered on the dais) — 8 wider anchors spread across the
// ~38-radius bowl so a reposition actually relocates the fight.
const ANCHORS: [number, number][] = [
  [0, 226], [-20, 220], [20, 220], [-24, 208], [24, 208], [-14, 200], [14, 200], [0, 204],
];
const SHIFT_DUR = 0.32;   // glide duration (was 0.5) — used in BOTH progressAttack and tick, keep in sync
const DRIFT_SPEED = 2.6;  // idle tangential prowl speed around the arena (so he's never a static target)

type Attack = "slam" | "volley" | "sweep" | "collapse" | "beam" | "fissure" | "harvest" | "shift" | null;

/**
 * The Rift Warden — the boss waiting at the end of the causeway. Mostly holds the
 * dais and punishes with telegraphed slams, bolt volleys and (phase 2) line sweeps,
 * summoning husks once when it breaks. Implements Hittable so the player's whole
 * moveset + combos work on it unchanged.
 */
export class Boss implements Hittable {
  pos = new THREE.Vector3().copy(BOSS_ANCHOR);
  radius = 2.6;
  maxHp = 980;
  hp = 980;
  alive = true;
  kind = "boss";
  hitColor = PAL.soulfire; // cold soul-fire — an undead warden, contrasting the firelit keep
  hitTop = 9; // tall vertical hitbox so high bolts connect
  readonly weakRadius = 2.0;
  /** Dynamic body-armor damage multiplier (combat.dealDamage reads it) — softens when both pauldrons break. */
  armorMult = 0.45;

  private phase = 1;
  private summoned = false;
  private attacksSinceShift = 0;
  private anchorIdx = 0;
  private shiftFrom = new THREE.Vector3();
  private shiftT = -1; // >0 = mid-glide
  // RIFT FISSURE: a line of eruptions marches down the telegraphed lane; each waits out its delay then erupts once
  private fissures: { x: number; z: number; t: number }[] = [];
  private fissHinted = false; // "SIDESTEP THE LINE" teaching floater, once per fight
  private spinT = 0;   // >0 = the warblade is mid 360° reap (sweep/harvest strike)
  private summonT = 25; // phase-3 recurring adds timer
  /** Phase-3 soulfire pools left by collapses — the safe floor shrinks. */
  private pools: { x: number; z: number; r: number; t: number; tick: number }[] = [];
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
  private faceYaw = 0; // damped facing — the King turns with the weight of a crypt door
  private risen = false;
  /** Held during a phase-transition cutscene — animates but does not attack. */
  paused = false;
  /** 0..1 cutscene surge — drives the blade-raise/orbit-gather pose while paused. */
  cineSurge = 0;
  /** Staged-but-not-yet-fighting: built + shader-warmed at boot, hidden and inert
   *  until activate(). Excluded from targeting/HUD/tick while true. */
  dormant = true;

  group: THREE.Group;
  private orbit: THREE.Group;  // rune shards circling the core (animated)
  private cloak: THREE.Mesh;   // ragged cloak — billows (animated)
  private blade: THREE.Group;  // hovering warblade — raised on wind-up, slammed on strike
  private bladeBase = new THREE.Euler();
  private readonly bladeY = 4.6;
  private light: THREE.PointLight;
  private coreMat: THREE.MeshStandardMaterial;
  private pauldronL!: THREE.Object3D;
  private pauldronR!: THREE.Object3D;
  private bossParts: { mesh: THREE.Object3D; offset: THREE.Vector3; radius: number; hp: number; kind: "pauldron" | "blade"; broken: boolean }[] = [];
  private pauldronsBroken = 0;
  private bladeBroken = false;

  constructor(private ctx: Ctx) {
    this.coreMat = new THREE.MeshStandardMaterial({ color: 0x05060d, emissive: this.hitColor, emissiveIntensity: 2.0, roughness: 0.35, metalness: 0.2 });
    const parts = buildBossMesh(this.coreMat);
    this.group = parts.group;
    this.cloak = parts.cloak;
    this.blade = parts.blade;
    this.orbit = parts.orbit;
    this.pauldronL = parts.pauldronL;
    this.pauldronR = parts.pauldronR;
    // breakable armor (offsets pre-scaled by the boss's ~1.3 group scale, like CORE_Y). Break both
    // pauldrons → exposed (softer armorMult); break the blade → its sweep/harvest attacks drop out.
    this.bossParts = [
      { mesh: this.pauldronL, offset: new THREE.Vector3(-2.47, 8.3, 0), radius: 1.9, hp: 0, kind: "pauldron", broken: false },
      { mesh: this.pauldronR, offset: new THREE.Vector3(2.47, 8.3, 0), radius: 1.9, hp: 0, kind: "pauldron", broken: false },
      { mesh: this.blade, offset: new THREE.Vector3(4.8, 6.0, 1.7), radius: 2.4, hp: 0, kind: "blade", broken: false },
    ];
    this.blade.position.set(3.7, this.bladeY, 1.3);
    this.bladeBase.copy(this.blade.rotation);
    this.group.position.copy(this.pos);
    this.group.scale.setScalar(0.001); // rises in on spawn (see tick)
    this.ctx.stage.scene.add(this.group);

    // The soul-fire light lives on the SCENE (not the group) so it is counted from
    // boot and STAYS counted while the boss is hidden. Adding a light mid-scene is what
    // forces a synchronous whole-scene material relink — the "boss cutscene lag" freeze.
    this.light = new THREE.PointLight(this.hitColor, 42, 44, 2);
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
    this.attacksSinceShift = 0;
    this.anchorIdx = 0;
    this.shiftT = -1;
    this.spinT = 0; // else a leftover mid-swing reap-spin bleeds into the next boss's rise
    this.fissures.length = 0;
    this.fissHinted = false;
    this.summonT = 25;
    this.pools.length = 0;
    this.light.position.set(BOSS_ANCHOR.x, 5, BOSS_ANCHOR.z);
    this.hp = this.maxHp; this.alive = true;
    this.dying = false; this.deathT = 0;
    this.phase = 1; this.summoned = false;
    this.rise = 0; this.risen = false;
    this.charge = 0; this.lunge = 0; this.flash = 0; this.t = 0;
    this.attack = null; this.windup = 0; this.cd = 1.3; this.paused = false; this.cineSurge = 0;
    this.light.intensity = 42; this.light.color.setHex(this.hitColor);
    this.coreMat.emissiveIntensity = 2.0;
    this.pos.copy(BOSS_ANCHOR);
    this.group.position.copy(this.pos);
    this.group.scale.setScalar(0.001);
    this.faceYaw = 0;
    this.group.rotation.set(0, 0, 0);
    this.orbit.rotation.set(0, 0, 0);
    this.orbit.scale.setScalar(1);
    this.orbit.position.set(0, 0, 0);
    this.group.visible = false;
    this.dormant = true;
    // re-arm the breakable armor (the boss is reused across runs, never rebuilt)
    this.armorMult = 0.45;
    this.pauldronsBroken = 0;
    this.bladeBroken = false;
    for (const b of this.bossParts) { b.broken = false; b.hp = this.maxHp * (b.kind === "blade" ? 0.14 : 0.1); b.mesh.visible = true; }
  }

  /** World position of the weak-point core (drives crosshair + crit aim). */
  coreWorld(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x, CORE_Y + this.group.position.y, this.pos.z);
  }

  isWeakHit(x: number, y: number, z: number): boolean {
    return Math.hypot(x - this.pos.x, y - (CORE_Y + this.group.position.y), z - this.pos.z) < this.weakRadius;
  }

  /** Chip the breakable pauldrons / blade near the impact point (body HP is separate). */
  hitPart(px: number, py: number, pz: number, dmg: number): void {
    if (this.dormant || !this.alive) return;
    const ry = this.group.rotation.y, cy = Math.cos(ry), sy = Math.sin(ry), gy = this.group.position.y;
    for (const b of this.bossParts) {
      if (b.broken) continue;
      const wx = this.pos.x + b.offset.x * cy + b.offset.z * sy;
      const wz = this.pos.z + (-b.offset.x * sy + b.offset.z * cy);
      const wy = gy + b.offset.y;
      const dx = px - wx, dy = py - wy, dz = pz - wz;
      if (dx * dx + dy * dy + dz * dz > b.radius * b.radius) continue;
      b.hp -= dmg;
      if (b.hp <= 0) this.breakBossPart(b, wx, wy, wz);
    }
  }

  private breakBossPart(b: { mesh: THREE.Object3D; kind: "pauldron" | "blade"; broken: boolean }, wx: number, wy: number, wz: number): void {
    b.broken = true;
    b.mesh.visible = false;
    this.ctx.fx.burst({ x: wx, y: wy, z: wz, count: 24, color: 0x9aa2ac, speed: [4, 13], up: 0.5, size: [0.16, 0.44], life: [0.4, 0.9], gravity: -9 });
    this.ctx.fx.chunk(wx, wy, wz, 0x35322e, { count: 4 });
    this.ctx.cam.addTrauma(0.24);
    this.ctx.sfx.bossSlam();
    if (b.kind === "pauldron") {
      this.pauldronsBroken++;
      if (this.pauldronsBroken >= 2) {
        this.armorMult = 0.62; // both gone → the King is exposed, takes more chip everywhere
        this.ctx.floaters.spawn(this.pos.x, wy + 1, this.pos.z, "ARMOR SUNDERED", "label", "#ffc24a");
      } else {
        this.ctx.floaters.spawn(wx, wy + 0.5, wz, "PAULDRON", "label", "#cfd6e4");
      }
    } else {
      this.bladeBroken = true; // his reaping sweeps drop out of the rotation
      this.ctx.floaters.spawn(this.pos.x, wy, this.pos.z, "BLADE SHATTERED", "label", "#ffc24a");
    }
  }

  /** Test seam: break every remaining boss part now. */
  forceBreakParts(): void {
    for (const b of this.bossParts) if (!b.broken) this.breakBossPart(b, this.pos.x, this.group.position.y + b.offset.y, this.pos.z);
  }
  partState(): { armorMult: number; pauldronsBroken: number; bladeBroken: boolean; broken: number; total: number } {
    return { armorMult: this.armorMult, pauldronsBroken: this.pauldronsBroken, bladeBroken: this.bladeBroken, broken: this.bossParts.filter((b) => b.broken).length, total: this.bossParts.length };
  }

  takeDamage(dmg: number, _opts: HitOpts): boolean {
    if (!this.alive) return false;
    this.hp -= dmg;
    this.flash = 1;
    this.ctx.events.emit("BOSS_HP", { hp: Math.max(0, this.hp), maxHp: this.maxHp });
    // death is checked FIRST — a killing blow must never also trip a phase cutscene (which would
    // freeze the fight and stall/discard the victory killcam).
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.dying = true;
      this.tele?.cancel();
      this.ctx.events.emit("BOSS_DEFEATED", { x: this.pos.x, z: this.pos.z });
      return true;
    }
    if (this.phase === 1 && this.hp <= this.maxHp * 0.5) this.enterPhase2();
    else if (this.phase === 2 && this.hp <= this.maxHp * 0.25) this.enterPhase3();
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

  /** Telegraph color per phase: threat red → deep blood red → white-hot. */
  private teleColor(): number {
    return this.phase >= 3 ? 0xfff0e0 : this.phase === 2 ? 0xd01020 : PAL.threat;
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
    // eased anticipation drives the halo + blade together (defined here — this runs first)
    const cs = this.charge * this.charge * (3 - 2 * this.charge);
    this.orbit.scale.setScalar(1 - cs * 0.34 + this.lunge * 0.22);
    this.orbit.position.y = cs * 0.7 - this.lunge * 0.4;
    // cloak billow — a slow living roll
    this.cloak.rotation.z = Math.sin(this.t * 1.1) * 0.05;
    this.cloak.rotation.x = Math.sin(this.t * 0.8 + 1) * 0.04;
    // the warblade hovers, RAISES with an eased anticipation curve, hammers down on
    // the strike — and wheels a full 360° on the reaping attacks
    if (this.spinT > 0) this.spinT = Math.max(0, this.spinT - dt);
    const spinK = this.spinT > 0 ? 1 - this.spinT / 0.55 : 0;
    const spinYaw = spinK > 0 ? (spinK < 0.5 ? 2 * spinK * spinK : 1 - Math.pow(-2 * spinK + 2, 2) / 2) * Math.PI * 2 : 0;
    this.blade.position.y = this.bladeY + Math.sin(this.t * 1.3) * 0.3 + cs * 1.6 - this.lunge * 1.9;
    this.blade.rotation.set(
      this.bladeBase.x - cs * 1.0 + this.lunge * 2.2 + (this.spinT > 0 ? -0.9 : 0),
      this.bladeBase.y + Math.sin(this.t * 0.9) * 0.08 + spinYaw,
      this.bladeBase.z,
    );
    // his bulk pitches into the blow — follow-through, not a statue with a sword
    this.group.rotation.x = cs * 0.05 - this.lunge * 0.09;
    // physical hit WINCE — a fast, self-decaying recoil so strikes register on the body,
    // not just an emissive flash (driven by flash^2 so it snaps on hit and eases out fast).
    // '=' on orbit.x returns it to 0 as flash decays; blade.z '+=' is overwritten by the
    // rotation.set() above next frame. NEVER touch this.light (relink) or group.position (weak-point desync).
    const wince = this.flash * this.flash;
    this.orbit.position.x = Math.sin(this.t * 55) * wince * 0.12;
    this.blade.rotation.z += Math.sin(this.t * 48) * wince * 0.06;

    // rising entrance: scale up from nothing; no attacks until fully risen
    if (this.rise < 1 && !this.dying) {
      this.rise = Math.min(1, this.rise + dt * 0.8);
      this.group.scale.setScalar((1 - (1 - this.rise) ** 3) * 1.3);
      this.group.position.y = Math.sin(this.t * 1.2) * 0.2;
      if (this.rise >= 1 && !this.risen) { this.risen = true; this.onRisen(); }
    } else if (!this.dying) {
      // attack tell via a steady hover that LIFTS on wind-up and DROPS on the strike —
      // scale stays locked at 1.3 (the old scale pulsing read as a weird grow/shrink).
      this.charge = this.attack ? 1 - this.windup / this.windupMax : this.cineSurge > 0 ? damp(this.charge, this.cineSurge, 5, dt) : damp(this.charge, 0, 6, dt);
      this.lunge = damp(this.lunge, 0, 7, dt);
      this.group.scale.setScalar(1.3);
      this.group.position.y = Math.sin(this.t * 1.2) * 0.15 + this.charge * 0.5 - this.lunge * 0.7;
      this.coreMat.emissiveIntensity += this.charge * 4;
    }

    // face the player — slowly; his mass is part of the menace
    const p = this.ctx.player;
    const dx = p.pos.x - this.pos.x;
    const dz = p.pos.z - this.pos.z;
    const targetYaw = Math.atan2(dx, dz);
    let dy = targetYaw - this.faceYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.faceYaw += dy * Math.min(1, 4.5 * dt);
    this.group.rotation.y = this.faceYaw;
    this.group.rotation.z = Math.sin(this.t * 0.6) * 0.02; // faint menacing roll

    if (this.dying) {
      this.deathT += dt;
      this.group.scale.setScalar(1.3 * Math.max(0.001, 1 - this.deathT * 0.8));
      if (this.deathT > 0.4 && this.ctx.rng.next() < 0.4) {
        this.ctx.fx.burst({ x: this.pos.x + this.ctx.rng.range(-2, 2), y: 1 + this.ctx.rng.range(0, 6), z: this.pos.z + this.ctx.rng.range(-2, 2), count: 18, color: this.hitColor, speed: [4, 12], life: [0.3, 0.7] });
      }
      return;
    }

    if (this.rise < 1) return; // still rising in
    if (this.paused) return;   // frozen for a phase-transition cutscene

    // the soul-fire light rides with the Warden — thrown FORWARD of his facing so it
    // lights the face he shows the player (from inside his bulk it lit nothing)
    this.light.position.set(
      this.pos.x + Math.sin(this.faceYaw) * 6,
      4.2,
      this.pos.z + Math.cos(this.faceYaw) * 6,
    );
    // eye-level attack tell: his light burns the telegraph color through every wind-up
    const baseInt = this.phase >= 3 ? 70 : this.phase === 2 ? 54 : 42;
    if (this.attack && this.windup > 0) {
      this.light.color.setHex(this.teleColor());
      this.light.intensity = baseInt * 1.6;
    } else {
      this.light.color.setHex(this.phase >= 3 ? 0xa0fff0 : this.hitColor);
      this.light.intensity = baseInt;
    }

    // subtle constant PROWL: between attacks the King drifts tangentially around the arena so he is
    // never a static target (no player pursuit — just roaming). Clamped inside the bowl; a shift
    // snapshots pos into shiftFrom, so the drift and the glide never fight.
    if (!this.attack && this.shiftT <= 0) {
      const cx = this.pos.x - ARENA_CENTER.x, cz = this.pos.z - ARENA_CENTER.y;
      const d = Math.hypot(cx, cz) || 1;
      this.pos.x += (-cz / d) * DRIFT_SPEED * dt;
      this.pos.z += (cx / d) * DRIFT_SPEED * dt;
      const maxR = ARENA_RADIUS - 10;
      if (d > maxR) { this.pos.x = ARENA_CENTER.x + (cx / d) * maxR; this.pos.z = ARENA_CENTER.y + (cz / d) * maxR; }
    }

    // mid-glide shift: sweep to the target anchor, shockwave on arrival
    if (this.shiftT > 0) {
      this.shiftT -= dt;
      const [ax, az] = ANCHORS[this.anchorIdx];
      const k = 1 - Math.max(0, this.shiftT) / SHIFT_DUR;
      this.pos.x = this.shiftFrom.x + (ax - this.shiftFrom.x) * k;
      this.pos.z = this.shiftFrom.z + (az - this.shiftFrom.z) * k;
      this.group.position.x = this.pos.x;
      this.group.position.z = this.pos.z;
      this.ctx.fx.burst({ x: this.pos.x, y: 2, z: this.pos.z, count: 3, color: this.hitColor, speed: [1, 4], size: [0.2, 0.5], life: [0.2, 0.4] });
      if (this.shiftT <= 0) {
        this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 8, color: this.hitColor, duration: 0.4, y: 0.2 });
        this.ctx.cam.addTrauma(0.3);
        this.ctx.sfx.bossSlam();
        const p2 = this.ctx.player;
        if (Math.hypot(p2.pos.x - this.pos.x, p2.pos.z - this.pos.z) <= 6) this.ctx.combat.damagePlayer(24, this.pos.x, this.pos.z);
      }
      return; // committed to the glide
    } else {
      this.group.position.x = this.pos.x;
      this.group.position.z = this.pos.z;
    }

    // RIFT FISSURE eruptions: each waits out its delay, then erupts once — sidestep OFF the line
    if (this.fissures.length) {
      const p2 = this.ctx.player;
      for (let i = this.fissures.length - 1; i >= 0; i--) {
        const f = this.fissures[i];
        f.t -= dt;
        if (f.t > 0) continue;
        this.fissures.splice(i, 1);
        this.ctx.fx.ring(f.x, f.z, { radius: 3.4, color: this.teleColor(), duration: 0.35, y: 0.2, startRadius: 0.5 });
        this.ctx.fx.burst({ x: f.x, y: 0.4, z: f.z, count: 14, color: this.teleColor(), speed: [6, 15], up: 0.9, life: [0.25, 0.6] });
        this.ctx.cam.addTrauma(0.16);
        if (Math.hypot(p2.pos.x - f.x, p2.pos.z - f.z) <= 3.4) this.ctx.combat.damagePlayer(40, f.x, f.z);
      }
    }

    // phase-3 recurring adds: heal economy pressure — kill adds to heal, or focus the boss
    if (this.phase >= 3) {
      this.summonT -= dt;
      if (this.summonT <= 0) {
        this.summonT = 25;
        if (this.ctx.enemies.aliveCount() < 4) this.summonAdds();
      }
    }

    // soulfire pools: the collapsed floor burns for a while
    for (let i = this.pools.length - 1; i >= 0; i--) {
      const pool = this.pools[i];
      pool.t -= dt;
      pool.tick -= dt;
      if (pool.tick <= 0) {
        pool.tick = 0.45;
        this.ctx.fx.ring(pool.x, pool.z, { radius: pool.r, color: this.hitColor, duration: 0.45, y: 0.12, startRadius: pool.r * 0.5 });
        const p2 = this.ctx.player;
        if (Math.hypot(p2.pos.x - pool.x, p2.pos.z - pool.z) <= pool.r) this.ctx.combat.damagePlayer(4, pool.x, pool.z);
      }
      if (pool.t <= 0) this.pools.splice(i, 1);
    }

    if (this.attack) this.progressAttack(dt);
    else {
      this.cd -= dt;
      if (this.cd <= 0) this.chooseAttack();
    }
  }

  /** Boss-summoned adds always drop a shard — the heal economy of the fight. */
  private summonAdds(): void {
    const kinds = ["husk", "ghoul"] as const;
    for (let i = 0; i < 2; i++) {
      const a = this.ctx.rng.range(0, Math.PI * 2);
      const e = this.ctx.enemies.spawn(kinds[i % 2], this.pos.x + Math.cos(a) * 6, this.pos.z - 4 + Math.sin(a) * 3);
      e.guaranteedShard = true;
      this.ctx.fx.beam(e.pos.x, e.pos.z, this.hitColor);
    }
    this.ctx.sfx.bossRoar();
  }

  private chooseAttack(): void {
    // every ~4 attacks (phase 2+) the Warden SHIFTS to a new anchor — the fight roams
    this.attacksSinceShift++;
    if (this.attacksSinceShift >= 2) { // repositions from phase 1, every 2 attacks (was phase 2+, every 4)
      this.attack = "shift";
      this.attacksSinceShift = 0;
      this.windupMax = 0.36;
      this.windup = this.windupMax;
      let next = this.ctx.rng.int(0, ANCHORS.length - 1);
      if (next === this.anchorIdx) next = (next + 1) % ANCHORS.length;
      this.anchorIdx = next;
      const [ax, az] = ANCHORS[next];
      this.tele = this.ctx.tele.circle(ax, az, 7, this.windupMax, this.teleColor());
      this.ctx.sfx.tell("shift");
      return;
    }
    let pool: Attack[] =
      this.phase === 1 ? ["slam", "volley", "beam", "fissure"]
        : this.phase === 2 ? ["slam", "volley", "sweep", "beam", "sweep", "fissure", "harvest"]
          : ["collapse", "sweep", "volley", "beam", "collapse", "fissure", "harvest"];
    if (this.bladeBroken) pool = pool.filter((a) => a !== "sweep" && a !== "harvest"); // reaping attacks gone with the blade
    this.attack = this.ctx.rng.pick(pool);
    this.ctx.sfx.tell(this.attack as string);
    this.windupMax = this.attack === "collapse" ? 1.0 : this.attack === "fissure" ? 0.9 : this.attack === "beam" ? 0.9 : this.attack === "sweep" || this.attack === "harvest" ? 0.85 : this.attack === "slam" ? 0.78 : 0.72;
    if (this.phase === 2) this.windupMax *= 0.72;
    if (this.phase === 3) this.windupMax *= 0.52; // final phase strikes fast — still telegraphed (≥~0.4s, dodgeable)
    this.windup = this.windupMax;

    const p = this.ctx.player;
    this.aim.copy(p.pos);
    this.aimAngle = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    const c = this.teleColor();
    if (this.attack === "slam") this.tele = this.ctx.tele.circle(this.aim.x, this.aim.z, 5, this.windupMax, c);
    else if (this.attack === "sweep") this.tele = this.ctx.tele.line(this.pos.x, this.pos.z, this.aimAngle, 40, 5, this.windupMax, c);
    else if (this.attack === "beam") this.tele = this.ctx.tele.line(this.pos.x, this.pos.z, this.aimAngle, 60, 4, this.windupMax, c);
    else if (this.attack === "fissure") this.tele = this.ctx.tele.line(this.pos.x, this.pos.z, this.aimAngle, 30, 3.2, this.windupMax, c);
    else if (this.attack === "harvest") this.tele = this.ctx.tele.circle(this.pos.x, this.pos.z, 9, this.windupMax, c);
    else if (this.attack === "volley") {
      // the bolt fan is telegraphed as its actual lanes — no more untelegraphed volleys
      const n = this.phase === 2 ? 7 : 5;
      const base = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
      for (const t of this.teles) t.cancel();
      this.teles = [];
      for (let i = 0; i < n; i++) {
        // same (sin,cos) convention as the bolts themselves — lanes match flight paths
        this.teles.push(this.ctx.tele.line(this.pos.x, this.pos.z, base + (i - (n - 1) / 2) * 0.18, 26, 1.1, this.windupMax, c));
      }
    }
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
    this.cd = this.phase === 3 ? 0.3 : this.phase === 2 ? 0.58 : 1.0;
    const p = this.ctx.player;

    if (a === "slam") {
      this.ctx.fx.ring(this.aim.x, this.aim.z, { radius: 5, color: this.hitColor, duration: 0.4 });
      this.ctx.fx.burst({ x: this.aim.x, y: 0.5, z: this.aim.z, count: 30, color: this.hitColor, speed: [5, 13], life: [0.3, 0.7], up: 1 });
      this.ctx.cam.addTrauma(0.3);
      if (Math.hypot(p.pos.x - this.aim.x, p.pos.z - this.aim.z) <= 5) this.ctx.combat.damagePlayer(38, this.aim.x, this.aim.z, 6); // overhead pound → ABOVE cue
    } else if (a === "volley") {
      for (const t of this.teles) t.cancel();
      this.teles = [];
      const n = this.phase === 2 ? 7 : 5;
      // aim DOWN to the player's torso so bolts arrive at chest height, not over the head
      const sy = 4.4, ty = 1.3;
      // fire along the LANES LOCKED AT WIND-UP (this.aim/aimAngle), not the live position —
      // so strafing off the telegraphed fan actually dodges it (matches slam/beam/sweep)
      const horiz = Math.max(2, Math.hypot(this.aim.x - this.pos.x, this.aim.z - this.pos.z));
      const base = this.aimAngle;
      for (let i = 0; i < n; i++) {
        const ang = base + (i - (n - 1) / 2) * 0.18;
        VOLLEY_DIR.set(Math.sin(ang) * horiz, ty - sy, Math.cos(ang) * horiz);
        this.ctx.projectiles.spawn(this.pos.x, sy, this.pos.z, VOLLEY_DIR, 24, 18, false, this.hitColor, 3, { shape: "skull" });
      }
    } else if (a === "beam") {
      // a searing lance fires ALONG THE TELEGRAPHED LINE (locked at wind-up on this.aim),
      // NOT the player's live position — so stepping off the strip actually dodges it.
      const dx = this.aim.x - this.pos.x, dz = this.aim.z - this.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const bx = dx / d, bz = dz / d;
      this.ctx.fx.laser(this.pos.x, 1.7, this.pos.z, bx, 0, bz, 60, this.hitColor, 1.6);
      this.ctx.fx.laser(this.pos.x, 1.7, this.pos.z, bx, 0, bz, 60, 0xffffff, 0.6);
      const px = p.pos.x - this.pos.x, pz = p.pos.z - this.pos.z;
      const along = px * bx + pz * bz;
      const perp = Math.abs(px * bz - pz * bx);
      this.ctx.cam.addTrauma(0.32);
      this.ctx.sfx.beamFire();
      if (along > 0 && perp <= 2.0) this.ctx.combat.damagePlayer(40, this.pos.x, this.pos.z); // corridor matches the width-4 strip
    } else if (a === "sweep") {
      this.spinT = 0.55;
      // hit if player is within the swept band along aimAngle
      const dx = p.pos.x - this.pos.x;
      const dz = p.pos.z - this.pos.z;
      // aimAngle is atan2(x,z): forward = (sin a, cos a) — project on THAT axis pair
      const along = dx * Math.sin(this.aimAngle) + dz * Math.cos(this.aimAngle);
      const perp = Math.abs(dx * Math.cos(this.aimAngle) - dz * Math.sin(this.aimAngle));
      this.ctx.fx.burst({ x: this.pos.x, y: 1, z: this.pos.z, count: 40, color: this.hitColor, speed: [8, 18], vertical: 0.3, life: [0.3, 0.6] });
      if (along > 0 && perp <= 2.5) this.ctx.combat.damagePlayer(42, this.pos.x, this.pos.z); // match the width-5 telegraph strip (half-width 2.5) — was 3.0 = hit 0.5u outside the red lane
    } else if (a === "collapse") {
      for (const t of this.teles) t.cancel();
      this.teles = [];
      let hit = false;
      for (const s of this.spots) {
        this.ctx.fx.ring(s.x, s.z, { radius: 4.5, color: this.hitColor, duration: 0.4 });
        this.ctx.fx.burst({ x: s.x, y: 0.5, z: s.z, count: 22, color: this.hitColor, speed: [5, 13], life: [0.3, 0.7], up: 1 });
        if (Math.hypot(p.pos.x - s.x, p.pos.z - s.z) <= 4.5) hit = true;
        // phase 3: every collapse leaves a burning soulfire pool — the floor shrinks
        if (this.phase >= 3) this.pools.push({ x: s.x, z: s.z, r: 4.0, t: 6, tick: 0 });
      }
      this.ctx.cam.addTrauma(0.5);
      this.ctx.stage.punch(0.4);
      if (hit) this.ctx.combat.damagePlayer(40, this.pos.x, this.pos.z, 6.5); // pillars from above → ABOVE cue
      this.spots = [];
    } else if (a === "fissure") {
      // RIFT FISSURE: eruptions march down the telegraphed lane (aimAngle locked at wind-up) —
      // sidestep OFF the line. Each schedules its own delay, resolved in tick().
      const dx = Math.sin(this.aimAngle), dz = Math.cos(this.aimAngle);
      const reach = Math.min(30, Math.max(14, Math.hypot(this.aim.x - this.pos.x, this.aim.z - this.pos.z) + 8));
      const n = 7, step = reach / n;
      for (let i = 1; i <= n; i++) {
        const ex = this.pos.x + dx * step * i, ez = this.pos.z + dz * step * i;
        this.fissures.push({ x: ex, z: ez, t: 0.12 + i * 0.08 });
        this.ctx.tele.circle(ex, ez, 3.4, 0.12 + i * 0.08, this.teleColor()); // each eruption pre-telegraphed
      }
      this.ctx.sfx.bossSlam();
      this.ctx.cam.addTrauma(0.3);
      // teach the counter the first time each fight — step off the line, don't outrun it
      if (!this.fissHinted) {
        this.fissHinted = true;
        this.ctx.floaters.spawn(p.pos.x, 2.4, p.pos.z, "SIDESTEP THE LINE", "label", "#ff5a4a");
      }
    } else if (a === "harvest") {
      this.spinT = 0.55; // the blade wheels a full circle
      // a full-circle reap that punishes hugging the Warden
      this.ctx.fx.slash(this.pos.x, 2.2, this.pos.z, this.ctx.rng.range(0, Math.PI * 2), { color: this.hitColor, radius: 9.5, tilt: -0.02, duration: 0.32, spin: 6 });
      this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 9, color: this.hitColor, duration: 0.4, y: 1.2 });
      this.ctx.sfx.bossSlam();
      this.ctx.cam.addTrauma(0.35);
      if (Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) <= 9) this.ctx.combat.damagePlayer(34, this.pos.x, this.pos.z);
    } else if (a === "shift") {
      // begin the glide (resolved over time in tick)
      this.shiftFrom.copy(this.pos);
      this.shiftT = SHIFT_DUR;
      this.ctx.sfx.bossDash();
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
