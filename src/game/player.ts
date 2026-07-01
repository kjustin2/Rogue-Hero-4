import * as THREE from "three";
import type { Ctx } from "./ctx";
import { WEAPONS, attackDuration, matchWeaponCombo, weaponById, type AttackDef, type Slot, type WeaponDef } from "./weapons";
import { clamp, damp, ease } from "../core/math";

const WALK_SPEED = 14;      // brisk, arcade-fast traversal
const DASH_SPEED = 46;
const DASH_TIME = 0.26;     // longer burst → the dodge covers more ground
const DASH_IFRAMES = 0.3;
const DASH_CD = 0.65;
const COMBO_WINDOW = 1.3;   // seconds allowed between attacks to keep the chain
const BUFFER_MAX = 6;

// ---- weapon viewmodel poses: [px, py, pz, rx, ry, rz] ----
type Pose = [number, number, number, number, number, number];
const REST: Pose = [0.52, -0.58, -0.95, 0.12, -0.2, 0.08];

interface SwingKey { t: number; pose: Pose; flash?: number; stretch?: number }
type PoseId =
  | "slashLight" | "slashHeavy"
  | "crossbowLight" | "crossbowHeavy"
  | "cannonLight" | "cannonHeavy"
  | "beamLight" | "beamHeavy"
  | "summonLight" | "summonHeavy";

/**
 * Per-weapon keyframed motions, picked by weapon + slot so each weapon FEELS distinct:
 * a greatsword slashes/chops, a crossbow draws + recoils, a bombard kicks hard, a prism
 * rod thrusts (heavy charges then unleashes), a storm staff raises + slams down a call.
 */
const SWINGS: Record<PoseId, SwingKey[]> = {
  // greatsword — fast diagonal slash
  slashLight: [
    { t: 0, pose: REST },
    { t: 0.16, pose: [0.74, -0.42, -0.8, -0.25, -0.9, 0.95] },
    { t: 0.42, pose: [0.2, -0.7, -1.42, 0.35, 1.15, -1.0], flash: 3.8, stretch: 1.7 },
    { t: 0.62, pose: [0.34, -0.66, -1.05, 0.2, 0.7, -0.5] },
    { t: 1, pose: REST },
  ],
  // greatsword — heavy overhead chop
  slashHeavy: [
    { t: 0, pose: REST },
    { t: 0.3, pose: [0.3, 0.22, -0.5, -2.1, -0.18, 0.22] },
    { t: 0.5, pose: [0.42, -0.92, -1.55, 1.6, -0.04, 0.0], flash: 6.5, stretch: 1.95 },
    { t: 0.66, pose: [0.46, -0.62, -1.0, 0.55, -0.1, 0.05] },
    { t: 1, pose: REST },
  ],
  // crossbow — settle aim, then kick back + muzzle-up on the loose
  crossbowLight: [
    { t: 0, pose: REST },
    { t: 0.18, pose: [0.52, -0.55, -1.0, 0.0, -0.2, 0.08] },
    { t: 0.34, pose: [0.5, -0.5, -0.78, -0.24, -0.2, 0.08], flash: 3.6 },
    { t: 0.55, pose: [0.52, -0.57, -0.95, 0.06, -0.2, 0.08] },
    { t: 1, pose: REST },
  ],
  // crossbow — long draw (charge) then a big recoil
  crossbowHeavy: [
    { t: 0, pose: REST },
    { t: 0.42, pose: [0.5, -0.5, -0.68, -0.1, -0.18, 0.08] },
    { t: 0.64, pose: [0.52, -0.44, -0.9, -0.4, -0.2, 0.08], flash: 6.0 },
    { t: 0.82, pose: [0.52, -0.56, -0.98, 0.05, -0.2, 0.08] },
    { t: 1, pose: REST },
  ],
  // bombard — a sharp backward boom-kick
  cannonLight: [
    { t: 0, pose: REST },
    { t: 0.16, pose: [0.52, -0.55, -0.98, -0.05, -0.2, 0.08] },
    { t: 0.3, pose: [0.5, -0.42, -0.62, -0.55, -0.2, 0.12], flash: 5.5 },
    { t: 0.6, pose: [0.52, -0.56, -0.96, 0.08, -0.2, 0.08] },
    { t: 1, pose: REST },
  ],
  // bombard — raise the muzzle to lob the mortar, then a heavy kick
  cannonHeavy: [
    { t: 0, pose: REST },
    { t: 0.34, pose: [0.5, -0.4, -0.85, -0.75, -0.2, 0.1] },
    { t: 0.54, pose: [0.48, -0.32, -0.7, -1.0, -0.2, 0.12], flash: 7.5 },
    { t: 0.78, pose: [0.52, -0.54, -0.95, 0.05, -0.2, 0.08] },
    { t: 1, pose: REST },
  ],
  // prism rod — a quick forward thrust
  beamLight: [
    { t: 0, pose: REST },
    { t: 0.22, pose: [0.52, -0.55, -1.18, 0.1, -0.2, 0.08], flash: 4.0 },
    { t: 0.45, pose: [0.52, -0.57, -1.0, 0.12, -0.2, 0.08] },
    { t: 1, pose: REST },
  ],
  // prism rod — wind back to charge, then unleash a sustained lance-beam
  beamHeavy: [
    { t: 0, pose: REST },
    { t: 0.36, pose: [0.56, -0.5, -0.78, -0.18, -0.32, 0.1] },
    { t: 0.52, pose: [0.52, -0.55, -1.22, 0.12, -0.2, 0.08], flash: 7.0 },
    { t: 0.82, pose: [0.52, -0.56, -1.12, 0.12, -0.2, 0.08], flash: 3.0 },
    { t: 1, pose: REST },
  ],
  // storm staff — raise the staff, then point down to call the strike
  summonLight: [
    { t: 0, pose: REST },
    { t: 0.26, pose: [0.5, -0.3, -0.8, -0.85, -0.2, 0.05] },
    { t: 0.46, pose: [0.5, -0.5, -1.02, 0.32, -0.2, 0.05], flash: 5.0 },
    { t: 0.72, pose: [0.52, -0.56, -0.96, 0.1, -0.2, 0.08] },
    { t: 1, pose: REST },
  ],
  // storm staff — raise high overhead, then slam down a cataclysm
  summonHeavy: [
    { t: 0, pose: REST },
    { t: 0.34, pose: [0.46, -0.14, -0.7, -1.35, -0.18, 0.05] },
    { t: 0.56, pose: [0.5, -0.5, -1.06, 0.55, -0.2, 0.05], flash: 8.0 },
    { t: 0.78, pose: [0.52, -0.56, -0.96, 0.1, -0.2, 0.08] },
    { t: 1, pose: REST },
  ],
};

function poseFor(weaponId: string, slot: Slot, isMelee: boolean): PoseId {
  if (isMelee) return slot === "light" ? "slashLight" : "slashHeavy";
  const map: Record<string, [PoseId, PoseId]> = {
    boltcaster: ["crossbowLight", "crossbowHeavy"],
    rocketlance: ["cannonLight", "cannonHeavy"],
    arclaser: ["beamLight", "beamHeavy"],
    stormcaller: ["summonLight", "summonHeavy"],
  };
  const pair = map[weaponId] ?? ["beamLight", "beamHeavy"];
  return slot === "light" ? pair[0] : pair[1];
}

function samplePose(keys: SwingKey[], p: number): { pose: Pose; flash: number; stretch: number } {
  let a = keys[0];
  let b = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (p >= keys[i].t && p <= keys[i + 1].t) { a = keys[i]; b = keys[i + 1]; break; }
  }
  const span = b.t - a.t || 1;
  const easeFn = b.flash ? ease.inCubic : a.flash ? ease.outCubic : ease.inOutCubic;
  const k = easeFn(clamp((p - a.t) / span, 0, 1));
  const pose = a.pose.map((v, j) => v + (b.pose[j] - v) * k) as unknown as Pose;
  const imp = keys.find((kf) => kf.flash);
  let flash = 0;
  let stretch = 1;
  if (imp) {
    const bump = Math.max(0, 1 - Math.abs(p - imp.t) / 0.18);
    flash = (imp.flash ?? 0) * bump;
    stretch = 1 + ((imp.stretch ?? 1) - 1) * bump;
  }
  return { pose, flash, stretch };
}

interface ActiveAttack { a: AttackDef; slot: Slot; color: number; pose: PoseId }

/** A built first-person weapon model: its group, the emissive/additive bits to pulse on
 * attack, where its tip/base sit (trail + muzzle), and an optional stretch mesh (blade). */
interface ModelEntry {
  group: THREE.Group;
  glow: THREE.MeshStandardMaterial[];
  add: { mat: THREE.MeshBasicMaterial; mesh: THREE.Mesh }[];
  tip: [number, number, number];
  base: [number, number, number];
  stretch?: THREE.Object3D;
}

/**
 * First-person player. Camera-relative movement; a swappable arsenal of weapons
 * (E cycles the unlocked set), each with a fast LIGHT (LMB) + strong HEAVY (RMB)
 * attack and its own light/heavy combos; dash i-frames; rift shards collected from
 * kills unlock new weapons. The weapon viewmodel is parented to the camera.
 */
export class Player {
  pos = new THREE.Vector3();
  radius = 0.5;
  maxHp = 120;
  hp = 120;
  alive = true;
  iframes = 0;
  god = false;
  frozen = false;

  /** Unlocked weapon ids (index into WEAPONS by id); starts with the bolt caster. */
  weapons: string[] = [WEAPONS[0].id];
  wi = 0;
  /** Rift shards collected this run — the unlock currency + HUD counter. */
  shards = 0;

  /** Recent light/heavy casts (combo buffer) — HUD reads this for the chain readout. */
  buffer: Slot[] = [];
  cooldowns: { light: number; heavy: number } = { light: 0, heavy: 0 };
  private cur: ActiveAttack | null = null;
  lastCombo = "";
  lastComboT = 0;
  moveAmount = 0;

  private moveT = 0;
  private hitDone = false;
  private bufferTimer = 0;
  private dashTime = 0;
  private dashCd = 0;
  private dashDir = new THREE.Vector3();

  // viewmodel — one distinct model per weapon, swapped on equip
  private vm = new THREE.Group();
  private weaponGrp = new THREE.Group();
  private models: Record<string, ModelEntry> = {};
  private active!: ModelEntry;
  private tipMarker = new THREE.Object3D();
  private baseMarker = new THREE.Object3D();
  private tip = new THREE.Vector3();
  private base = new THREE.Vector3();

  // scratch
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private aim = new THREE.Vector3();
  private dir = new THREE.Vector3();

  constructor(private ctx: Ctx) {
    this.buildViewmodel();
    this.ctx.stage.camera.add(this.vm);
    this.applyWeaponLook();
  }

  get weapon(): WeaponDef {
    return weaponById(this.weapons[this.wi]);
  }

  reset(spawn: THREE.Vector3): void {
    this.pos.copy(spawn);
    this.hp = this.maxHp;
    this.alive = true;
    this.iframes = 0;
    this.buffer.length = 0;
    this.cur = null;
    this.moveT = 0;
    this.dashTime = 0;
    this.dashCd = 0;
    this.lastCombo = "";
    this.cooldowns.light = this.cooldowns.heavy = 0;
    // fresh run: back to the starter weapon, shards zeroed
    this.weapons = [WEAPONS[0].id];
    this.wi = 0;
    this.shards = 0;
    this.applyWeaponLook();
    this.ctx.events.emit("SHARD", { total: 0 });
    this.ctx.events.emit("WEAPON_SWITCH", { id: this.weapon.id, name: this.weapon.name });
  }

  // ----------------------------------------------------------------- viewmodel
  private buildViewmodel(): void {
    this.models.boltcaster = this.buildCrossbow();
    this.models.greatsword = this.buildGreatsword();
    this.models.rocketlance = this.buildBombard();
    this.models.arclaser = this.buildPrismRod();
    this.models.stormcaller = this.buildStormStaff();
    for (const id in this.models) {
      const e = this.models[id];
      e.group.visible = false;
      this.weaponGrp.add(e.group);
    }
    this.weaponGrp.add(this.tipMarker, this.baseMarker);
    this.weaponGrp.position.set(0.52, -0.56, -0.95);
    this.weaponGrp.rotation.set(0.12, -0.2, 0.08);
    this.vm.add(this.weaponGrp);
    this.vm.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
    this.vm.renderOrder = 10;
  }

  // shared medieval materials (one set; models reuse them)
  private mIron = new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.55, metalness: 0.8, emissive: 0x140c06, emissiveIntensity: 0.25, envMapIntensity: 1.1 });
  private mDark = new THREE.MeshStandardMaterial({ color: 0x14151c, roughness: 0.6, metalness: 0.7, envMapIntensity: 1.0 });
  private mSteel = new THREE.MeshStandardMaterial({ color: 0xaab2c0, roughness: 0.28, metalness: 0.98, emissive: 0x10151f, emissiveIntensity: 0.2, envMapIntensity: 1.4 });
  private mWood = new THREE.MeshStandardMaterial({ color: 0x3a2412, roughness: 0.85, metalness: 0.06, envMapIntensity: 0.5 });
  private mBrass = new THREE.MeshStandardMaterial({ color: 0x8a6a2a, roughness: 0.4, metalness: 0.85, emissive: 0x2a1c06, emissiveIntensity: 0.4, envMapIntensity: 1.2 });

  private glowMat(color: number, int = 1.9): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0x0a0c10, emissive: color, emissiveIntensity: int, roughness: 0.3, metalness: 0.4 });
  }
  private addMat(color: number): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  }

  /** boltcaster → a heavy crossbow: stock, recurved prod + string, a glowing loaded bolt. */
  private buildCrossbow(): ModelEntry {
    const g = new THREE.Group();
    const C = 0xffc24a;
    const glow = this.glowMat(C);
    const orb = this.addMat(C);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.85), this.mWood); stock.position.set(0, -0.02, -0.05);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.7), this.mIron); rail.position.set(0, 0.07, -0.25);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.12), this.mWood); grip.position.set(0, -0.13, 0.2); grip.rotation.x = 0.3;
    const prod = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.05, 0.07), this.mSteel); prod.position.set(0, 0.08, -0.55);
    g.add(stock, rail, grip, prod);
    for (const sx of [-1, 1]) {
      const limb = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.06), this.mSteel);
      limb.position.set(sx * 0.5, 0.1, -0.52); limb.rotation.z = sx * 0.5; limb.rotation.y = sx * -0.3;
      g.add(limb);
    }
    const string = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.02, 0.02), this.mDark); string.position.set(0, 0.09, -0.44);
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.75, 6), glow); bolt.rotation.x = Math.PI / 2; bolt.position.set(0, 0.09, -0.78);
    const boltTip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 6), glow); boltTip.rotation.x = -Math.PI / 2; boltTip.position.set(0, 0.09, -1.18);
    const sight = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 0), orb); sight.position.set(0, 0.16, 0.05);
    g.add(string, bolt, boltTip, sight);
    return { group: g, glow: [glow], add: [{ mat: orb, mesh: sight }], tip: [0, 0.09, -1.25], base: [0, 0.05, -0.2] };
  }

  /** greatsword → the steel two-hander: gauntlet, crossguard + quillons, glowing rune blade. */
  private buildGreatsword(): ModelEntry {
    const g = new THREE.Group();
    const blade = new THREE.Group();
    const bladeMat = this.glowMat(0xff7a2c, 1.7);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.5), this.mIron); arm.position.set(0, -0.06, 0.32);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 0.22, 8), this.mIron); cuff.rotation.x = Math.PI / 2; cuff.position.set(0, -0.04, 0.12);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.3, 8), this.mWood); grip.rotation.x = Math.PI / 2; grip.position.set(0, 0.02, -0.02);
    const pommel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.07, 10), this.mSteel); pommel.rotation.x = Math.PI / 2; pommel.position.set(0, 0.02, 0.14);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.16), this.mSteel); guard.position.set(0, 0.02, -0.2);
    g.add(arm, cuff, grip, pommel, guard);
    for (const sx of [-1, 1]) {
      const q = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), this.mSteel); q.position.set(sx * 0.27, 0.02, -0.2); g.add(q);
    }
    const guardGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.07), bladeMat); guardGem.position.set(0, 0.02, -0.2); g.add(guardGem);
    const flat = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 1.15), this.mSteel); flat.position.set(0, 0.02, -0.82);
    for (const sy of [-1, 1]) { const edge = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.06, 1.15), bladeMat); edge.position.set(0, 0.02 + sy * 0.1, -0.82); blade.add(edge); }
    const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.0), bladeMat); fuller.position.set(0, 0.02, -0.8);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.42, 4), this.mSteel); tip.rotation.x = -Math.PI / 2; tip.position.set(0, 0.02, -1.46); tip.scale.set(0.42, 1, 1);
    blade.add(flat, fuller, tip);
    g.add(blade);
    return { group: g, glow: [bladeMat], add: [], tip: [0, 0.02, -1.5], base: [0, 0.02, -0.25], stretch: blade };
  }

  /** rocketlance → a hand bombard: thick iron barrel, brass bands, flared muzzle, ember bore. */
  private buildBombard(): ModelEntry {
    const g = new THREE.Group();
    const C = 0xff5530;
    const glow = this.glowMat(C, 2.0);
    const bore = this.addMat(C);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.85, 14), this.mDark); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.05, -0.5);
    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.14, 0.2, 14), this.mIron); muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, 0.05, -0.95);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.16, 0.5), this.mWood); stock.position.set(0, -0.04, 0.12);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.12), this.mWood); grip.position.set(0, -0.16, 0.04); grip.rotation.x = 0.3;
    g.add(barrel, muzzle, stock, grip);
    for (const z of [-0.3, -0.62]) { const band = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 6, 16), this.mBrass); band.position.set(0, 0.05, z); g.add(band); }
    const boreGlow = new THREE.Mesh(new THREE.CircleGeometry(0.12, 14), bore); boreGlow.position.set(0, 0.05, -1.04); boreGlow.rotation.y = Math.PI;
    const ember = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), glow); ember.position.set(0, 0.05, -0.96);
    g.add(boreGlow, ember);
    return { group: g, glow: [glow], add: [{ mat: bore, mesh: boreGlow }], tip: [0, 0.05, -1.05], base: [0, 0, 0.05] };
  }

  /** arclaser → a prism rod: a slim haft tipped with a faceted glowing crystal in steel claws. */
  private buildPrismRod(): ModelEntry {
    const g = new THREE.Group();
    const C = 0x49f0ff;
    const glow = this.glowMat(C, 2.4);
    const cr = this.addMat(C);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.26, 8), this.mWood); grip.rotation.x = Math.PI / 2; grip.position.set(0, 0, 0.1);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 1.25, 10), this.mDark); rod.rotation.x = Math.PI / 2; rod.position.set(0, 0.03, -0.55);
    const midGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.07), glow); midGem.position.set(0, 0.03, -0.5);
    g.add(grip, rod, midGem);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.26, 4), this.mSteel);
      claw.position.set(Math.cos(a) * 0.1, 0.03 + Math.sin(a) * 0.1, -1.12); claw.rotation.x = -Math.PI / 2 - 0.3;
      g.add(claw);
    }
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), glow); crystal.position.set(0, 0.04, -1.28);
    const crystalGlow = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), cr); crystalGlow.position.set(0, 0.04, -1.28);
    g.add(crystal, crystalGlow);
    return { group: g, glow: [glow], add: [{ mat: cr, mesh: crystalGlow }], tip: [0, 0.04, -1.4], base: [0, 0, 0.1] };
  }

  /** stormcaller → a storm staff: a long shaft, a clawed finial cupping a crackling orb. */
  private buildStormStaff(): ModelEntry {
    const g = new THREE.Group();
    const C = 0xb46cff;
    const glow = this.glowMat(C, 2.5);
    const orb = this.addMat(C);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 1.4, 8), this.mWood); shaft.rotation.x = Math.PI / 2; shaft.position.set(0, 0.02, -0.5);
    const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.24, 8), this.mDark); wrap.rotation.x = Math.PI / 2; wrap.position.set(0, 0.02, 0.06);
    g.add(shaft, wrap);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const prong = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.4, 4), this.mSteel);
      prong.position.set(Math.cos(a) * 0.14, 0.06 + Math.sin(a) * 0.14, -1.12); prong.rotation.set(Math.PI / 2 - 0.6, 0, a);
      g.add(prong);
    }
    const orbCore = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), glow); orbCore.position.set(0, 0.06, -1.22);
    const orbGlow = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), orb); orbGlow.position.set(0, 0.06, -1.22);
    g.add(orbCore, orbGlow);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const shard = new THREE.Mesh(new THREE.TetrahedronGeometry(0.05), glow);
      shard.position.set(Math.cos(a) * 0.26, 0.06 + Math.sin(a) * 0.26, -1.22);
      g.add(shard);
    }
    return { group: g, glow: [glow], add: [{ mat: orb, mesh: orbGlow }], tip: [0, 0.06, -1.25], base: [0, 0, 0.06] };
  }

  /** Swap the visible weapon model + move the tip/base markers to it. */
  private applyWeaponLook(): void {
    const e = this.models[this.weapon.id] ?? this.models.boltcaster;
    for (const id in this.models) this.models[id].group.visible = false;
    e.group.visible = true;
    this.active = e;
    this.tipMarker.position.set(...e.tip);
    this.baseMarker.position.set(...e.base);
  }

  // ----------------------------------------------------------------- update
  update(dt: number): void {
    this.iframes = Math.max(0, this.iframes - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.lastComboT = Math.max(0, this.lastComboT - dt);
    this.cooldowns.light = Math.max(0, this.cooldowns.light - dt);
    this.cooldowns.heavy = Math.max(0, this.cooldowns.heavy - dt);

    if (this.buffer.length) {
      this.bufferTimer += dt;
      if (this.bufferTimer > COMBO_WINDOW) this.buffer.length = 0;
    }

    if (this.alive && !this.frozen) {
      this.handleActions();
      this.advanceMove(dt);
    }
    if (this.frozen) this.moveAmount = damp(this.moveAmount, 0, 8, dt);
    else this.move(dt);
    this.animate(dt);
  }

  private handleActions(): void {
    const input = this.ctx.input;
    if (input.actionPressed("dash") && this.dashCd <= 0) this.startDash();
    if (input.actionPressed("switch") && this.weapons.length > 1) this.cycleWeapon();
    const wheel = input.consumeWheelStep();
    if (wheel && this.weapons.length > 1) this.cycleWeapon(wheel > 0 ? 1 : -1);
    if (this.cur) return; // committed to an attack
    if (input.actionPressed("light") && this.cooldowns.light <= 0) this.startAttack("light");
    else if (input.actionPressed("heavy") && this.cooldowns.heavy <= 0) this.startAttack("heavy");
  }

  cycleWeapon(dir = 1): void {
    this.wi = (this.wi + dir + this.weapons.length) % this.weapons.length;
    this.cooldowns.light = this.cooldowns.heavy = 0;
    this.buffer.length = 0;
    this.cur = null;
    this.applyWeaponLook();
    this.ctx.sfx.cardReady();
    this.ctx.events.emit("WEAPON_SWITCH", { id: this.weapon.id, name: this.weapon.name });
  }

  private startAttack(slot: Slot): void {
    const a = this.weapon[slot];
    const pose = poseFor(this.weapon.id, slot, a.type === "melee");
    this.cur = { a, slot, color: this.weapon.color, pose };
    this.moveT = 0;
    this.hitDone = false;
    this.cooldowns[slot] = a.cooldown;
  }

  private advanceMove(dt: number): void {
    const c = this.cur;
    if (!c) return;
    this.moveT += dt;
    if (!this.hitDone && this.moveT >= c.a.windup) {
      this.hitDone = true;
      this.fireHit(c);
    }
    if (this.moveT >= attackDuration(c.a)) this.cur = null;
  }

  private fireHit(c: ActiveAttack): void {
    const a = c.a;
    const color = c.color;
    this.ctx.cam.worldForward(this.fwd);
    const fx = this.fwd.x, fz = this.fwd.z;
    // full 3D look ray (includes pitch) — projectiles AND combo finishers fire here so
    // everything goes exactly where the crosshair points, not flat down the lane.
    this.ctx.cam.forward(this.aim);
    const heavy = c.slot === "heavy";

    if (a.type === "melee") {
      this.ctx.sfx.meleeSwing(heavy);
      this.ctx.combat.meleeSweep(this.pos.x, this.pos.z, fx, fz, a.arc, a.range, a.damage, a.knockback, heavy);
      this.ctx.cam.kick(-fx, -fz, heavy ? 0.5 : 0.2);
      const reach = a.range * 0.55;
      const sx = this.pos.x + fx * reach, sz = this.pos.z + fz * reach;
      this.ctx.fx.slash(sx, 1.3, sz, Math.atan2(fx, fz), {
        color, radius: heavy ? 3.6 : 2.2, tilt: heavy ? -0.08 : -0.7, duration: heavy ? 0.26 : 0.2, spin: heavy ? 1.5 : 4,
      });
      this.ctx.fx.burst({ x: sx, y: 1.3, z: sz, count: heavy ? 16 : 10, color: [color, 0xffffff], speed: [4, heavy ? 13 : 9], vertical: 0.5, size: [0.1, 0.32], life: [0.15, 0.4] });
      if (!heavy) {
        this.ctx.fx.slash(sx, 1.25, sz, Math.atan2(fx, fz), { color: 0xffffff, radius: 1.8, tilt: 0.55, duration: 0.18, spin: -5 });
        this.ctx.fx.ring(sx, sz, { radius: a.range + 0.5, color, duration: 0.3, y: 0.1, startRadius: 0.3 });
      } else {
        const wx = this.pos.x + fx * a.range * 0.8, wz = this.pos.z + fz * a.range * 0.8;
        this.ctx.fx.ring(wx, wz, { radius: a.range + 2.5, color, duration: 0.5, y: 0.12, startRadius: 0.6 });
        this.ctx.fx.ring(wx, wz, { radius: a.range + 1, color: 0xffffff, duration: 0.32, y: 0.14, startRadius: 0.4 });
        this.ctx.fx.burst({ x: wx, y: 0.5, z: wz, count: 28, color: [color, 0xffffff], speed: [5, 15], up: 0.9, size: [0.16, 0.42], life: [0.3, 0.7] });
        this.ctx.cam.addTrauma(0.34);
        this.ctx.cam.pulseFov(0.3);
        this.ctx.stage.punch(0.3);
      }
    } else if (a.mode === "laser") {
      // instant hitscan beam down the look ray
      this.ctx.sfx.boltCast();
      this.ctx.combat.beam(this.pos.x, this.pos.z, fx, fz, a.beamRange, a.beamWidth, a.damage, a.knockback, color);
      this.ctx.cam.kick(-fx, -fz, heavy ? 0.3 : 0.15);
      this.muzzleFx(color, heavy);
    } else if (a.mode === "airstrike") {
      // call down strike(s) on the zone ahead
      this.ctx.sfx.boltCast();
      const cx = this.pos.x + fx * a.strikeRange, cz = this.pos.z + fz * a.strikeRange;
      for (let i = 0; i < Math.max(1, a.strikeCount); i++) {
        const ang = this.ctx.rng.range(0, Math.PI * 2);
        // scatter multi-strikes on a wide ring so they pepper a zone instead of stacking on one spot
        const r = a.strikeCount > 1 ? a.strikeRadius * (1.0 + this.ctx.rng.range(0, 0.8)) : 0;
        this.ctx.combat.scheduleStrike(cx + Math.cos(ang) * r, cz + Math.sin(ang) * r, a.strikeRadius, a.damage, a.strikeDelay, color, a.knockback);
      }
      this.ctx.cam.kick(-fx, -fz, 0.15);
      this.muzzleFx(color, heavy);
    } else {
      // bolt / rocket: fire `pellets` along the look ray, fanned by `spread`
      this.ctx.sfx.boltCast();
      const n = Math.max(1, a.pellets);
      const opts = {
        scale: a.big ? 1.9 : 1,
        pierce: a.pierce,
        explode: a.mode === "rocket" ? a.explodeRadius : 0,
        gravity: a.gravity,
        shape: a.shape,
      };
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * a.spread;
        const ca = Math.cos(off), sa = Math.sin(off);
        this.dir.set(this.aim.x * ca - this.aim.z * sa, this.aim.y, this.aim.x * sa + this.aim.z * ca);
        if (a.gravity > 0) this.dir.y += 0.5; // mortar: launch upward, then arc down
        this.ctx.projectiles.spawn(this.pos.x, 1.55, this.pos.z, this.dir, a.speed, a.damage, true, color, a.knockback, opts);
      }
      this.ctx.cam.kick(-fx, -fz, heavy ? 0.3 : 0.15);
      this.muzzleFx(color, heavy);
    }

    // record the attack + test the combo for THIS weapon (fired forward from the player)
    this.buffer.push(c.slot);
    if (this.buffer.length > BUFFER_MAX) this.buffer.shift();
    this.bufferTimer = 0;

    const combo = matchWeaponCombo(this.buffer, this.weapon);
    if (combo) {
      this.ctx.combat.resolveCombo(combo, this.pos.x, this.pos.z, this.aim, a.damage);
      this.lastCombo = combo.name;
      this.lastComboT = 2.4;
      this.buffer.length = 0;
    }
  }

  /** Muzzle flash at the blade tip for ranged casts. */
  private muzzleFx(color: number, heavy: boolean): void {
    this.tipMarker.getWorldPosition(this.tip);
    this.ctx.fx.burst({ x: this.tip.x, y: this.tip.y, z: this.tip.z, count: heavy ? 22 : 14, color: [color, 0xffffff], speed: [3, 10], size: [0.1, 0.34], life: [0.12, 0.34] });
    this.ctx.fx.ring(this.tip.x, this.tip.z, { radius: 1.1, color, duration: 0.22, y: this.tip.y, startRadius: 0.2 });
    this.ctx.cam.pulseFov(0.12);
  }

  /** Collect a rift shard: bump the counter + heal overflow if hurt (weapons come from pickups now). */
  addShard(heal: number): void {
    this.shards++;
    this.ctx.events.emit("SHARD", { total: this.shards });
    if (this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + heal);
  }

  /** Claim a weapon found on the causeway: add it, equip it immediately, fanfare. */
  unlockWeapon(id: string): void {
    if (this.weapons.includes(id)) return;
    this.weapons.push(id);
    this.wi = this.weapons.length - 1;
    this.cooldowns.light = this.cooldowns.heavy = 0;
    this.buffer.length = 0;
    this.cur = null;
    this.applyWeaponLook();
    this.ctx.sfx.unlockFanfare();
    this.ctx.events.emit("WEAPON_UNLOCK", { id, name: this.weapon.name });
    this.ctx.events.emit("WEAPON_SWITCH", { id, name: this.weapon.name });
  }

  private startDash(): void {
    this.dashCd = DASH_CD;
    this.dashTime = DASH_TIME;
    this.iframes = DASH_IFRAMES;
    const mv = this.ctx.input.moveVector();
    this.ctx.cam.worldForward(this.fwd);
    this.ctx.cam.worldRight(this.right);
    if (Math.hypot(mv.x, mv.z) > 0.1) {
      const fwdAmt = -mv.z;
      this.dashDir.set(
        this.fwd.x * fwdAmt + this.right.x * mv.x,
        0,
        this.fwd.z * fwdAmt + this.right.z * mv.x,
      ).normalize();
    } else {
      this.dashDir.copy(this.fwd).multiplyScalar(-1);
    }
    this.ctx.cam.dodgeTilt(this.dashDir.x, this.dashDir.z);
    this.ctx.events.emit("DODGE", {});
    this.ctx.sfx.dashWhoosh();
    this.ctx.cam.pulseFov(0.4);
    this.ctx.fx.burst({ x: this.pos.x, y: 0.6, z: this.pos.z, count: 14, color: 0xffd9a0, speed: [4, 9], vertical: 0.3, life: [0.2, 0.5] });
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
      if (this.cur && this.cur.a.type === "melee") speed *= 0.5; // committed melee swing roots you a bit
      this.vel.multiplyScalar(this.alive ? speed : 0);
    }
    this.pos.addScaledVector(this.vel, dt);
    this.ctx.level.clampPosition(this.pos, this.radius);
    const target = this.dashTime > 0 ? 1 : clamp(Math.hypot(this.vel.x, this.vel.z) / WALK_SPEED, 0, 1);
    this.moveAmount = damp(this.moveAmount, target, 8, dt);
  }

  // ----------------------------------------------------------------- viewmodel anim
  private animate(dt: number): void {
    const t = performance.now() / 1000;
    const c = this.cur;
    let pose: Pose;
    let flash = 0;
    let stretch = 1;
    let trailActive = false;

    if (!c) {
      pose = [...REST] as Pose;
      pose[0] += this.moveAmount * 0.03 * Math.cos(t * 5.5);
      pose[1] += -this.moveAmount * 0.03;
      pose[2] += this.moveAmount * 0.04 * Math.sin(t * 11);
      pose[3] += Math.sin(t * 1.3) * 0.02;
    } else {
      const p = clamp(this.moveT / attackDuration(c.a), 0, 1);
      const s = samplePose(SWINGS[c.pose], p);
      pose = s.pose;
      flash = s.flash;
      stretch = s.stretch;
      trailActive = c.a.type === "melee" && p > 0.18 && p < 0.62;
    }

    this.weaponGrp.position.set(pose[0], pose[1], pose[2]);
    this.weaponGrp.rotation.set(pose[3], pose[4], pose[5]);

    // pulse the active model's emissive metal + its additive glow bits on the attack flash
    const e = this.active;
    if (e.stretch) e.stretch.scale.z = stretch;
    for (const m of e.glow) m.emissiveIntensity = 1.9 + flash;
    for (const ad of e.add) {
      ad.mat.opacity = 0.5 + Math.min(0.45, flash * 0.5) + Math.sin(t * 6) * 0.1;
      ad.mesh.scale.setScalar(0.85 + Math.sin(t * 6) * 0.15 + flash * 0.35);
    }

    this.tipMarker.getWorldPosition(this.tip);
    this.baseMarker.getWorldPosition(this.base);
    this.ctx.trail.setColor(c ? c.color : this.weapon.color);
    this.ctx.trail.update(dt, this.tip, this.base, trailActive);
  }
}
