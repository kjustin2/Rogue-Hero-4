import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { EnemyKind } from "../game/enemies";

/**
 * Procedural enemy bodies, extracted from Enemy so art and logic live apart.
 * `core` is the emissive weak/eye mesh (animated + hit-flashed via the caller's
 * per-instance coreMat); `weapon` is the held sub-group swung on the strike;
 * `wings` (flyers) flap in Enemy.sync.
 *
 * Build language: BONE (pale matte) + CLOTH (near-black matte) + IRON (dark metal)
 * + RUST, with the kind color only on small emissive accents — silhouettes read
 * as medieval undead, not glowing cones.
 */
export interface EnemyMeshParts {
  group: THREE.Group;
  core: THREE.Mesh;
  weapon?: THREE.Group;
  wings?: { l: THREE.Object3D; r: THREE.Object3D };
  /** Articulated legs (rat quadruped / ghoul biped) — kept live for footfall stride. */
  legs?: THREE.Object3D[];
  /** Breakable armor parts promoted out of the merge (keyed: "shield" / "pauldron"). */
  parts?: Record<string, THREE.Object3D>;
}

// Shared materials — enemies are pooled and numerous; only the caller-owned
// coreMat stays per-instance (it carries the hit-flash).
const BONE = new THREE.MeshStandardMaterial({ color: 0xbfb49c, roughness: 0.88, metalness: 0.06, envMapIntensity: 0.5, emissive: 0x2a251c, emissiveIntensity: 0.5 });
const BONE_DK = new THREE.MeshStandardMaterial({ color: 0x8d8270, roughness: 0.92, metalness: 0.05, envMapIntensity: 0.4, emissive: 0x1c1812, emissiveIntensity: 0.45 });
const CLOTH = new THREE.MeshStandardMaterial({ color: 0x17141c, roughness: 0.96, metalness: 0.02, side: THREE.DoubleSide });
const CLOTH_RAG = new THREE.MeshStandardMaterial({ color: 0x241e28, roughness: 0.95, metalness: 0.02, side: THREE.DoubleSide });
const IRON = new THREE.MeshStandardMaterial({ color: 0x35322e, roughness: 0.48, metalness: 0.85, envMapIntensity: 1.1 });
const RUST = new THREE.MeshStandardMaterial({ color: 0x50301c, roughness: 0.78, metalness: 0.45, envMapIntensity: 0.7 });
const STONE = new THREE.MeshStandardMaterial({ color: 0x4c463e, roughness: 0.9, metalness: 0.08, envMapIntensity: 0.6, emissive: 0x14110c, emissiveIntensity: 0.4 });
const WOOD = new THREE.MeshStandardMaterial({ color: 0x4a341e, roughness: 0.9, metalness: 0.04, envMapIntensity: 0.4 });
const VOID = new THREE.MeshBasicMaterial({ color: 0x030204 });
const FLESH = new THREE.MeshStandardMaterial({ color: 0x515c44, roughness: 0.95, metalness: 0.03, envMapIntensity: 0.35, emissive: 0x121509, emissiveIntensity: 0.35 }); // sickly grey-green necrotic (ghoul)
for (const m of [BONE, BONE_DK, CLOTH, CLOTH_RAG, IRON, RUST, STONE, WOOD, VOID, FLESH]) m.userData.shared = true;

/** The shared medieval material language — bossMesh builds from the same box. */
export const MATS = { BONE, BONE_DK, CLOTH, CLOTH_RAG, IRON, RUST, STONE, WOOD, VOID } as const;

/**
 * PERF: collapse every STATIC mesh in a built body into one merged mesh per material
 * (a detailed husk was ~28 draw calls; merged it is ~6). Animated subtrees (core,
 * held weapon, wings) are listed in `keep` and stay live. Call once per built body.
 */
export function mergeStatic(group: THREE.Group, keep: (THREE.Object3D | undefined)[]): void {
  const keepSet = new Set<THREE.Object3D>();
  for (const k of keep) k?.traverse((o) => keepSet.add(o));
  group.updateMatrixWorld(true); // group sits at origin during build — matrixWorld = local chain
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const doomed: THREE.Mesh[] = [];
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!(m as THREE.Mesh).isMesh || keepSet.has(o)) return;
    // polyhedron primitives (octa/icosa/tetra) ship non-indexed — normalize so the
    // merge never fails on mixed indexing (a failed merge silently DELETES the parts)
    const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrixWorld);
    const list = byMat.get(m.material as THREE.Material);
    if (list) list.push(g);
    else byMat.set(m.material as THREE.Material, [g]);
    doomed.push(m);
  });
  for (const m of doomed) { m.removeFromParent(); m.geometry.dispose(); }
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    group.add(mesh);
  }
}

// per-kind emissive accent (trim, runes) — shared per color
const accentCache = new Map<number, THREE.MeshStandardMaterial>();
function accent(c: number): THREE.MeshStandardMaterial {
  let m = accentCache.get(c);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: 0x05060d, emissive: c, emissiveIntensity: 0.8, roughness: 0.35, metalness: 0.3 });
    m.userData.shared = true;
    accentCache.set(c, m);
  }
  return m;
}

/** A skull: cranium + cheekbones + jaw + black eye sockets (glowing eyes = coreMat, added by caller). */
function skull(scale = 1): THREE.Group {
  const g = new THREE.Group();
  const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.24 * scale, 10, 8), BONE);
  cranium.scale.set(1, 1.08, 1.12);
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.3 * scale, 0.2 * scale, 0.16 * scale), BONE);
  face.position.set(0, -0.14 * scale, 0.14 * scale);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.22 * scale, 0.09 * scale, 0.16 * scale), BONE_DK);
  jaw.position.set(0, -0.28 * scale, 0.12 * scale);
  const socket = new THREE.Mesh(new THREE.BoxGeometry(0.26 * scale, 0.09 * scale, 0.06 * scale), VOID);
  socket.position.set(0, -0.04 * scale, 0.21 * scale);
  g.add(cranium, face, jaw, socket);
  return g;
}

/** An open, ragged-hemmed robe as a lathe — the smooth silhouette primitives can't fake. */
function robe(rTop: number, rBot: number, h: number, mat: THREE.Material, ragged = true): THREE.Mesh {
  const pts: THREE.Vector2[] = [];
  const STEPS = 7;
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    // slight belly + flare at the hem
    const r = rTop + (rBot - rTop) * (t * t * 0.6 + t * 0.4) + Math.sin(t * Math.PI) * rBot * 0.08;
    pts.push(new THREE.Vector2(r, h * (1 - t)));
  }
  const geo = new THREE.LatheGeometry(pts, 9);
  const mesh = new THREE.Mesh(geo, mat);
  if (ragged) mesh.rotation.y = 0.2; // seam offset so facets catch light unevenly
  mesh.castShadow = true;
  return mesh;
}

/** N hanging cloth tatters around a hem. */
function tatters(g: THREE.Group, r: number, y: number, n: number, len: number, mat: THREE.Material): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.3;
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.1, len * (0.7 + ((i * 37) % 10) / 18), 0.03), mat);
    t.position.set(Math.cos(a) * r, y - len * 0.4, Math.sin(a) * r);
    t.rotation.y = -a;
    t.rotation.x = 0.12;
    g.add(t);
  }
}

function buildBody(kind: EnemyKind, color: number, coreMat: THREE.MeshStandardMaterial): EnemyMeshParts {
  const acc = accent(color);
  const group = new THREE.Group();
  let core: THREE.Mesh;
  let weapon: THREE.Group | undefined;
  let wings: EnemyMeshParts["wings"];
  let legs: THREE.Object3D[] | undefined;
  let parts: Record<string, THREE.Object3D> | undefined; // promoted breakable armor (knight shield / brute pauldron)

  if (kind === "husk") {
    // risen footman: skull under a rusted kettle-helm, mail shirt, tattered surcoat,
    // one pauldron, a notched falchion
    const skirt = robe(0.34, 0.62, 1.15, CLOTH);
    skirt.position.y = 0;
    const mail = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.75, 8), IRON);
    mail.position.y = 1.45; mail.castShadow = true;
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.09, 8), RUST);
    belt.position.y = 1.12;
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.04), RUST);
    buckle.position.set(0, 1.12, 0.34);
    const head = skull();
    head.position.y = 2.06;
    const helm = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.34, 9), RUST);
    helm.position.y = 2.26; helm.castShadow = true;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.38, 0.05, 9), RUST);
    brim.position.y = 2.12;
    core = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.045, 0.06), coreMat); // burning eye slits
    core.position.set(0, 2.04, 0.22);
    const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), IRON);
    pauldron.position.set(-0.36, 1.82, 0); pauldron.castShadow = true;
    // arms: a mail sleeve + a bare bone arm
    const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.75, 6), IRON);
    armL.position.set(-0.42, 1.4, 0.05); armL.rotation.z = 0.3;
    const armR = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.055, 0.7, 6), BONE_DK);
    armR.position.set(0.42, 1.42, 0.1); armR.rotation.z = -0.35;
    group.add(skirt, mail, belt, buckle, head, helm, brim, core, pauldron, armL, armR);
    // a battered heater shield on the left arm + a chevroned tabard panel
    const shield = new THREE.Group();
    const shieldFace = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.06, 0.72, 3, 1), CLOTH_RAG);
    shieldFace.scale.z = 0.14;
    const shieldRim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 4, 8), RUST);
    shieldRim.position.y = 0.1; shieldRim.scale.set(1.1, 0.9, 1);
    const shieldBoss = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), IRON);
    shieldBoss.position.z = 0.06;
    shield.add(shieldFace, shieldRim, shieldBoss);
    shield.position.set(-0.52, 1.3, 0.14);
    shield.rotation.set(0, 0.5, 0.1);
    const tabard = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, 0.03), CLOTH_RAG);
    tabard.position.set(0, 1.35, 0.36);
    // a faded heraldic PALE (single vertical bar) painted on the tabard — muted rust, not a bright
    // crossed-chevron "bowtie" (the old two-acc-box device read as a cartoon bowtie).
    const device = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.52, 0.035), RUST);
    device.position.set(0, 1.34, 0.37);
    group.add(shield, tabard, device);
    tatters(group, 0.56, 0.15, 6, 0.5, CLOTH_RAG);
    // the falchion: broad single-edge blade, iron guard, leather grip
    const sword = new THREE.Group();
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.28, 6), CLOTH);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.09), IRON);
    guard.position.y = 0.18;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.0, 0.035), IRON);
    blade.position.set(0.02, 0.72, 0);
    const bladeTip = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.22, 4), IRON);
    bladeTip.position.set(0.02, 1.32, 0); bladeTip.rotation.y = Math.PI / 4;
    sword.add(grip, guard, blade, bladeTip);
    sword.position.set(0.56, 1.28, 0.28);
    sword.rotation.set(0.5, 0, -0.3);
    group.add(sword);
    weapon = sword;
  } else if (kind === "spitter") {
    // witchfire necromancer: hooded lathe robe, rope belt, bone stole, the orb
    // cupped in skeletal hands, a skull-crowned staff. (Group floats at bodyY.)
    const gown = robe(0.2, 0.66, 1.9, CLOTH);
    gown.position.y = -1.0;
    const mantle = robe(0.24, 0.44, 0.5, CLOTH_RAG);
    mantle.position.y = 0.42;
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.72, 9), CLOTH);
    hood.position.y = 0.92; hood.castShadow = true;
    const hoodMouth = new THREE.Mesh(new THREE.SphereGeometry(0.19, 9, 7), VOID);
    hoodMouth.position.set(0, 0.72, 0.1);
    const rope = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.035, 6, 12), RUST);
    rope.position.y = -0.15; rope.rotation.x = Math.PI / 2;
    // bone stole: vertebrae beads down the chest
    for (let i = 0; i < 4; i++) {
      const bead = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), BONE);
      bead.position.set(0.09 - i * 0.02, 0.45 - i * 0.17, 0.3);
      group.add(bead);
    }
    core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 0), coreMat); // the witchfire orb it hurls
    core.position.set(0, 0.08, 0.5);
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.62, 5), BONE_DK);
      arm.position.set(sx * 0.26, 0.16, 0.3); arm.rotation.set(0.95, 0, sx * 0.45);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 5, 4), BONE);
      hand.position.set(sx * 0.14, 0.05, 0.46);
      group.add(arm, hand);
    }
    group.add(gown, mantle, hood, hoodMouth, rope, core);
    // a censer swinging from the rope belt — grave incense
    for (let l = 0; l < 3; l++) {
      const link = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.012, 4, 6), IRON);
      link.position.set(-0.34, -0.28 - l * 0.09, 0.22);
      link.rotation.x = l % 2 ? 0 : Math.PI / 2;
      group.add(link);
    }
    const censer = new THREE.Mesh(new THREE.SphereGeometry(0.09, 7, 6), RUST);
    censer.position.set(-0.34, -0.6, 0.22);
    const censerGlow = new THREE.Mesh(new THREE.SphereGeometry(0.045, 5, 4), acc);
    censerGlow.position.set(-0.34, -0.66, 0.22);
    group.add(censer, censerGlow);
    tatters(group, 0.6, -2.55, 7, 0.55, CLOTH_RAG);
    // skull-crowned staff
    const staff = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 2.1, 6), RUST);
    const staffSkull = skull(0.55);
    staffSkull.position.y = 1.14;
    const staffEye = new THREE.Mesh(new THREE.OctahedronGeometry(0.06), acc);
    staffEye.position.set(0, 1.1, 0.1);
    staff.add(shaft, staffSkull, staffEye);
    staff.position.set(0.52, -0.1, 0.02);
    staff.rotation.z = -0.1;
    group.add(staff);
    weapon = staff;
  } else if (kind === "wraith") {
    // banshee: a hollow cowl over one baleful eye, a shroud that TAPERS to a wisp,
    // long reaching claw-arms, a true curved scythe. (Group floats at bodyY.)
    const shroudPts: THREE.Vector2[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      shroudPts.push(new THREE.Vector2(0.52 * Math.pow(1 - t, 0.6) * (1 - t * 0.2) + 0.02, 0.7 - t * 2.0));
    }
    const shroud = new THREE.Mesh(new THREE.LatheGeometry(shroudPts, 9), CLOTH);
    shroud.castShadow = true;
    // a narrow, tall HOOD (not a wide traffic-cone) — the pointed cowl of a shrouded specter
    const cowl = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.98, 9), CLOTH_RAG);
    cowl.position.y = 1.0;
    const cowlMouth = new THREE.Mesh(new THREE.SphereGeometry(0.22, 9, 7), VOID);
    cowlMouth.position.set(0, 0.74, 0.08);
    core = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), coreMat); // a small baleful eye deep in the hood (not a bloom-blown blob)
    core.position.set(0, 0.74, 0.22);
    group.add(shroud, cowl, cowlMouth, core);
    // a shredded, drifting shroud — many long torn strips so the silhouette reads as tattered cloth, not a solid cone
    tatters(group, 0.44, -0.7, 9, 1.3, CLOTH_RAG);
    tatters(group, 0.3, 0.4, 6, 0.9, CLOTH);
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.035, 0.85, 5), CLOTH);
      arm.position.set(sx * 0.42, 0.35, 0.24); arm.rotation.set(0.7, 0, sx * 1.15);
      const handG = new THREE.Group();
      for (let f = 0; f < 3; f++) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.22, 4), BONE);
        claw.position.set((f - 1) * 0.05, -0.06, 0.05); claw.rotation.x = -0.9;
        handG.add(claw);
      }
      handG.position.set(sx * 0.72, 0.12, 0.5);
      group.add(arm, handG);
    }
    // the reaper scythe: long haft, angled tang, a real curved blade
    const scythe = new THREE.Group();
    const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 2.0, 6), RUST);
    const tang = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.05), IRON);
    tang.position.set(0.08, 1.02, 0); tang.rotation.z = -0.9;
    const bladeArc = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 5, 14, Math.PI * 0.75), IRON);
    bladeArc.position.set(0.6, 1.05, 0); bladeArc.rotation.z = Math.PI * 0.6;
    bladeArc.scale.set(1, 1, 0.35); // flattened = a blade, not a tube
    const bladeGlint = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.018, 4, 14, Math.PI * 0.75), acc);
    bladeGlint.position.copy(bladeArc.position); bladeGlint.rotation.copy(bladeArc.rotation);
    scythe.add(haft, tang, bladeArc, bladeGlint);
    // held forward and across the body so the curved blade breaks the cone outline (reads as a reaper)
    scythe.position.set(0.42, 0.0, 0.45);
    scythe.rotation.set(0.25, -0.5, 0.12);
    group.add(scythe);
    weapon = scythe;
  } else if (kind === "ghoul") {
    // feral flesh-eater: deep hunch, spine ridge, rib cage, skull with a hanging jaw,
    // knuckle-walking claw arms
    // gaunt necrotic torso — narrow (not a pale round marshmallow), sickly grey-green flesh
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.42, 9, 7), FLESH);
    torso.position.set(0, 0.9, 0); torso.scale.set(0.62, 1.2, 1.15); torso.rotation.x = 0.7;
    torso.castShadow = true;
    const hips = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), FLESH);
    hips.position.set(0, 0.62, -0.42); hips.scale.set(0.75, 1, 1);
    // spine ridge spikes
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22 - i * 0.02, 4), BONE);
      sp.position.set(0, 1.18 - i * 0.13, -0.1 - i * 0.15);
      sp.rotation.x = -0.5;
      group.add(sp);
    }
    for (let i = 0; i < 3; i++) { // exposed ribs
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.26 - i * 0.04, 0.025, 4, 8, Math.PI), BONE);
      rib.position.set(0, 0.86 + i * 0.14, 0.26); rib.rotation.set(Math.PI / 2 + 0.5, 0, 0);
      group.add(rib);
    }
    const head = skull(1.1);
    head.position.set(0, 1.22, 0.62); // lunged forward + low — the emaciated skull leads the silhouette
    head.rotation.x = 0.32;
    core = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.04, 0.05), coreMat); // burning glare
    core.position.set(0, 1.2, 0.86);
    // haunches (it crouches on digitigrade legs)
    legs = [];
    for (const sx of [-1, 1]) {
      const haunch = new THREE.Mesh(new THREE.SphereGeometry(0.2, 7, 6), BONE_DK);
      haunch.position.set(sx * 0.3, 0.5, -0.35); haunch.scale.set(0.8, 1.2, 1.3);
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.5, 5), BONE_DK);
      shin.position.set(sx * 0.34, 0.22, -0.2); shin.rotation.x = 0.7;
      group.add(haunch, shin);
      legs.push(shin); // the digitigrade shin strides
    }
    const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.95, 5), BONE_DK);
    armL.position.set(-0.4, 0.75, 0.3); armL.rotation.set(0.9, 0, -0.3);
    group.add(torso, hips, head, core, armL);
    // the raking right claw — the weapon
    const claws = new THREE.Group();
    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.9, 5), BONE_DK);
    forearm.position.set(0, -0.3, 0); forearm.rotation.x = 0.4;
    claws.add(forearm);
    for (let i = 0; i < 3; i++) {
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.42, 4), BONE);
      claw.position.set((i - 1) * 0.09, -0.74, 0.15); claw.rotation.x = -0.55;
      claws.add(claw);
    }
    claws.position.set(0.42, 1.0, 0.25);
    // broken manacles — a grave-robber's corpse that got up anyway
    for (const [mx, my, mz] of [[-0.42, 0.5, 0.42], [0.42, 0.72, 0.5]] as const) {
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.03, 4, 8), RUST);
      cuff.position.set(mx, my, mz);
      cuff.rotation.x = Math.PI / 2.4;
      group.add(cuff);
    }
    const dragLink = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.02, 4, 6), RUST);
    dragLink.position.set(-0.42, 0.36, 0.44);
    group.add(dragLink);
    group.add(claws);
    weapon = claws;
  } else if (kind === "archer") {
    // skeletal bowman: kettle hat, half-cloak, quiver, a REAL recurve bow held out
    const skirt = robe(0.28, 0.5, 1.0, CLOTH);
    const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.7, 8), CLOTH_RAG);
    chest.position.y = 1.32; chest.castShadow = true;
    // half-cloak over the left shoulder
    const cloak = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.95, 0.05), CLOTH_RAG);
    cloak.position.set(-0.26, 1.28, -0.2); cloak.rotation.set(0.1, 0.25, 0.12);
    const head = skull();
    head.position.y = 1.94;
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.24, 9), IRON);
    hat.position.y = 2.12;
    const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.4, 0.04, 9), IRON);
    hatBrim.position.y = 2.02;
    core = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.045, 0.05), coreMat);
    core.position.set(0, 1.94, 0.22);
    const quiver = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.075, 0.6, 6), RUST);
    quiver.position.set(-0.26, 1.5, -0.3); quiver.rotation.x = -0.35;
    for (let i = 0; i < 3; i++) {
      const fl = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 4), CLOTH_RAG);
      fl.position.set(-0.26 + (i - 1) * 0.06, 1.85, -0.42); fl.rotation.x = -0.35;
      group.add(fl);
    }
    group.add(skirt, chest, cloak, head, hat, hatBrim, core, quiver);
    // a real recurve: two mirrored arcs + grip + string + a nocked bolt
    const bow = new THREE.Group();
    for (const sy of [-1, 1]) {
      const limb = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.028, 5, 10, Math.PI * 0.62), BONE_DK);
      limb.rotation.set(0, 0, sy > 0 ? Math.PI * 0.28 : Math.PI - Math.PI * 0.28 - Math.PI * 0.62);
      limb.position.y = sy * 0.06;
      bow.add(limb);
    }
    const gripB = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 6), CLOTH);
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 1.06, 4), BONE);
    string.position.z = -0.12;
    const nocked = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 4), RUST);
    nocked.rotation.x = Math.PI / 2; nocked.position.set(0, 0, 0.08);
    const nockTip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.1, 4), acc);
    nockTip.rotation.x = Math.PI / 2; nockTip.position.set(0, 0, 0.36);
    bow.add(gripB, string, nocked, nockTip);
    bow.position.set(0.34, 1.5, 0.34);
    bow.rotation.y = -0.15;
    group.add(bow);
    weapon = bow;
  } else if (kind === "gargoyle") {
    // stone gargoyle on the wing: crouched granite beast, horned, ember eyes,
    // wide bat wings (flapped in Enemy.sync via `wings`)
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.38, 9, 7), STONE);
    body.scale.set(0.9, 0.8, 1.3); body.castShadow = true;
    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), STONE);
    chest.position.set(0, 0.12, 0.32);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.34), STONE);
    head.position.set(0, 0.3, 0.55); head.castShadow = true;
    const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.16), STONE);
    muzzle.position.set(0, 0.24, 0.74);
    core = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.045, 0.05), coreMat); // ember glare
    core.position.set(0, 0.34, 0.73);
    for (const sx of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.3, 5), STONE);
      horn.position.set(sx * 0.12, 0.48, 0.5); horn.rotation.z = sx * 0.5;
      const legF = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.4, 5), STONE);
      legF.position.set(sx * 0.24, -0.3, 0.3); legF.rotation.x = 0.4;
      const legB = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.4, 5), STONE);
      legB.position.set(sx * 0.26, -0.3, -0.25); legB.rotation.x = -0.3;
      group.add(horn, legF, legB);
    }
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.06, 0.8, 5), STONE);
    tail.position.set(0, -0.05, -0.62); tail.rotation.x = 1.2;
    const tailTip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 4), STONE);
    tailTip.position.set(0, -0.22, -0.98); tailTip.rotation.x = 2.2;
    group.add(body, chest, head, muzzle, core, tail, tailTip);
    // bat wings: a shoulder spar + a webbed triangle each, hinged at the shoulder
    const mkWing = (sx: number): THREE.Object3D => {
      const w = new THREE.Group();
      const spar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.0, 5), STONE);
      spar.rotation.z = Math.PI / 2;
      spar.position.x = sx * 0.5;
      const webGeo = new THREE.BufferGeometry();
      webGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
        0, 0.05, 0, sx * 1.0, 0.1, 0, sx * 0.85, -0.55, -0.15,
        0, 0.05, 0, sx * 0.85, -0.55, -0.15, sx * 0.3, -0.4, -0.1,
      ]), 3));
      webGeo.computeVertexNormals();
      const web = new THREE.Mesh(webGeo, CLOTH_RAG);
      w.add(spar, web);
      w.position.set(sx * 0.28, 0.18, -0.05);
      return w;
    };
    const lw = mkWing(-1), rw = mkWing(1);
    group.add(lw, rw);
    wings = { l: lw, r: rw };
  } else if (kind === "bomber") {
    // crypt bombard: a squat iron furnace-golem hauling a basket of skull-bombs;
    // its belly grate glows (the core) and it LOBS burning skulls in an arc
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 8), IRON);
    body.position.y = 0.85; body.scale.set(1, 1.05, 0.9); body.castShadow = true;
    const bandT = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.05, 6, 14), RUST);
    bandT.position.y = 1.1; bandT.rotation.x = Math.PI / 2;
    const bandB = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.05, 6, 14), RUST);
    bandB.position.y = 0.62; bandB.rotation.x = Math.PI / 2;
    core = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.1), coreMat); // furnace grate
    core.position.set(0, 0.85, 0.55);
    for (let i = 0; i < 3; i++) { // grate bars
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.32, 0.05), IRON);
      bar.position.set(-0.12 + i * 0.12, 0.85, 0.6);
      group.add(bar);
    }
    const head = skull(0.9);
    head.position.y = 1.62;
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), RUST);
    helm.position.y = 1.68;
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.5, 6), IRON);
      leg.position.set(sx * 0.3, 0.25, 0); leg.castShadow = true;
      const armC = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.7, 6), IRON);
      armC.position.set(sx * 0.66, 0.95, 0.1); armC.rotation.z = sx * 0.5;
      group.add(leg, armC);
    }
    // the powder keg strapped to its back — the sapper's whole job
    const keg = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.62, 9), WOOD);
    keg.position.set(0, 1.15, -0.62); keg.rotation.x = 0.25; keg.castShadow = true;
    for (const ky of [-0.2, 0.2]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 4, 10), IRON);
      hoop.position.set(0, 1.15 + ky * Math.cos(0.25), -0.62 - ky * Math.sin(0.25) * -1);
      hoop.rotation.x = Math.PI / 2 + 0.25;
      group.add(hoop);
    }
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.75, 0.05), CLOTH);
    strap.position.set(0, 1.0, 0.52); strap.rotation.x = -0.15;
    group.add(keg, strap, body, bandT, bandB, core, head, helm);
    // the throwing arm hefts a lit skull-bomb (the weapon — snaps forward on the lob)
    const lob = new THREE.Group();
    const bombSkull = skull(0.8);
    const fuse = new THREE.Mesh(new THREE.OctahedronGeometry(0.06), acc);
    fuse.position.y = 0.24;
    lob.add(bombSkull, fuse);
    lob.position.set(0.62, 1.7, 0.3);
    group.add(lob);
    weapon = lob;
  } else if (kind === "knight") {
    // revenant knight: full plate, great helm, a tall KITE SHIELD (his gimmick), arming sword
    const skirt = robe(0.36, 0.6, 1.0, CLOTH);
    const cuirass = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.85, 8), IRON);
    cuirass.position.y = 1.5; cuirass.castShadow = true;
    const plackart = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, 0.3, 8), RUST);
    plackart.position.y = 1.12;
    const helm = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.44, 8), IRON);
    helm.position.y = 2.14; helm.castShadow = true;
    const helmTop = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.2, 8), IRON);
    helmTop.position.y = 2.42;
    const visorSlit = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.08), VOID);
    visorSlit.position.set(0, 2.18, 0.22);
    core = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.06), coreMat); // grave-light through the slit
    core.position.set(0, 2.18, 0.24);
    const plume = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.42, 5), CLOTH_RAG);
    plume.position.set(0, 2.6, -0.08); plume.rotation.x = -0.5;
    for (const sx of [-1, 1]) {
      const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), IRON);
      pauldron.position.set(sx * 0.36, 1.86, 0);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.7, 6), IRON);
      arm.position.set(sx * 0.42, 1.45, 0.05); arm.rotation.z = sx * -0.28;
      group.add(pauldron, arm);
    }
    // the KITE SHIELD — tall, covers him knee to chin; the reason you flank
    const shield = new THREE.Group();
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.1, 1.3, 3, 1), IRON);
    face.scale.z = 0.16;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.035, 4, 10), RUST);
    rim.position.y = 0.2; rim.scale.set(1.05, 1.15, 1);
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 0.05), acc);
    cross.position.z = 0.06;
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.1, 0.05), acc);
    crossH.position.set(0, 0.2, 0.06);
    shield.add(face, rim, cross, crossH);
    shield.position.set(-0.52, 1.35, 0.3);
    shield.rotation.y = 0.35;
    group.add(skirt, cuirass, plackart, helm, helmTop, visorSlit, core, plume, shield);
    (parts ??= {}).shield = shield; // breakable → noblock
    tatters(group, 0.55, 0.1, 5, 0.42, CLOTH_RAG);
    // arming sword
    const sword = new THREE.Group();
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.24, 6), CLOTH);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.07), RUST);
    guard.position.y = 0.16;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.95, 0.03), IRON);
    blade.position.y = 0.68;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.16, 4), IRON);
    tip.position.y = 1.22; tip.rotation.y = Math.PI / 4;
    sword.add(grip, guard, blade, tip);
    sword.position.set(0.55, 1.4, 0.25);
    sword.rotation.set(0.45, 0, -0.28);
    group.add(sword);
    weapon = sword;
  } else if (kind === "rat") {
    // plague rat: a low, fast quadruped — matted hide, naked tail, ember eyes
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), CLOTH_RAG);
    body.position.y = 0.24; body.scale.set(0.8, 0.7, 1.5); body.castShadow = true;
    const rump = new THREE.Mesh(new THREE.SphereGeometry(0.2, 7, 5), CLOTH_RAG);
    rump.position.set(0, 0.26, -0.28); rump.scale.set(0.9, 0.8, 1);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.34, 6), BONE_DK);
    head.position.set(0, 0.26, 0.44); head.rotation.x = Math.PI / 2;
    core = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.035, 0.04), coreMat); // ember eyes
    core.position.set(0, 0.3, 0.42);
    for (const se of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.055, 5, 4), CLOTH_RAG);
      ear.position.set(se * 0.09, 0.4, 0.3);
      group.add(ear);
    }
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.035, 0.6, 5), BONE_DK);
    tail.position.set(0, 0.22, -0.62); tail.rotation.x = 1.35;
    legs = [];
    for (const [lx, lz] of [[-0.16, 0.22], [0.16, 0.22], [-0.18, -0.24], [0.18, -0.24]] as const) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.22, 4), BONE_DK);
      leg.position.set(lx, 0.1, lz);
      group.add(leg);
      legs.push(leg); // FL, FR, BL, BR — swung in diagonal pairs
    }
    group.add(body, rump, head, core, tail);
    // teeth = the weapon (snaps forward on the bite)
    const teeth = new THREE.Group();
    for (const tx of [-0.04, 0.04]) {
      const fang = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.08, 4), BONE);
      fang.position.set(tx, -0.03, 0.05); fang.rotation.x = Math.PI;
      teeth.add(fang);
    }
    teeth.position.set(0, 0.22, 0.56);
    group.add(teeth);
    weapon = teeth;
  } else {
    // brute: an ogre-sized executioner — stacked furnace plates with ember seams,
    // riveted pauldrons, horned great-helm, a chained colossal cleaver
    const hips2 = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.0, 1.0, 8), CLOTH);
    hips2.position.y = 0.6; hips2.castShadow = true;
    // stacked ANGULAR armor plates (octagonal drums), not round beach-balls
    const belly = new THREE.Mesh(new THREE.CylinderGeometry(0.98, 1.06, 0.95, 8), IRON);
    belly.position.y = 1.6; belly.scale.set(1, 1, 0.82); belly.castShadow = true;
    const chest2 = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.94, 0.9, 8), IRON);
    chest2.position.y = 2.4; chest2.scale.set(1.12, 1, 0.9); chest2.castShadow = true;
    // ember seams between the plates
    for (const [y, r] of [[1.98, 0.9], [1.16, 0.86]] as const) {
      const seam = new THREE.Mesh(new THREE.TorusGeometry(r, 0.04, 5, 20), acc);
      seam.position.y = y; seam.rotation.x = Math.PI / 2;
      group.add(seam);
    }
    core = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.56, 0.1), coreMat); // a vertical furnace CRACK (heat leaking from the plates) — not a grille "mouth" with teeth
    core.position.set(0, 1.75, 0.86);
    const aventail = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.62, 0.5, 8, 1, true), RUST);
    aventail.position.y = 2.78;
    group.add(aventail);
    const head2 = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.55, 8), IRON);
    head2.position.y = 3.05; head2.castShadow = true;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.1, 0.1), VOID);
    visor.position.set(0, 3.05, 0.4);
    const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.06, 0.08), coreMat);
    eyes.position.set(0, 3.05, 0.44);
    group.add(hips2, belly, chest2, core, head2, visor, eyes);
    for (const sx of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.65, 5), BONE_DK);
      horn.position.set(sx * 0.36, 3.4, 0); horn.rotation.z = sx * 0.75;
      const pauld = new THREE.Mesh(new THREE.SphereGeometry(0.52, 9, 7, 0, Math.PI * 2, 0, Math.PI / 2), IRON);
      pauld.position.set(sx * 1.05, 2.6, 0); pauld.castShadow = true;
      if (sx === -1) (parts ??= {}).pauldron = pauld; // breakable → expose
      for (let rv = 0; rv < 4; rv++) { // rivets
        const a = (rv / 4) * Math.PI - Math.PI / 2;
        const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 4), RUST);
        rivet.position.set(sx * (1.05 + Math.cos(a) * 0.44), 2.72, Math.sin(a) * 0.44);
        group.add(rivet);
      }
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 1.4, 7), IRON);
      arm.position.set(sx * 1.1, 1.55, 0); arm.castShadow = true;
      const fist = new THREE.Mesh(new THREE.SphereGeometry(0.34, 7, 6), RUST);
      fist.position.set(sx * 1.12, 0.75, 0.05);
      group.add(horn, pauld, arm, fist);
    }
    // chain girdle
    for (let i = 0; i < 7; i++) {
      const a = -0.9 + i * 0.3;
      const link = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.028, 4, 8), RUST);
      link.position.set(Math.sin(a) * 0.95, 1.05 - Math.abs(a) * 0.18, Math.cos(a) * 0.75);
      link.rotation.set(0.6, a, 0);
      group.add(link);
    }
    // the chained colossal cleaver
    const cleaver = new THREE.Group();
    const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.6, 6), RUST);
    const headC = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.25, 0.12), IRON);
    headC.position.set(0.28, 1.05, 0); headC.castShadow = true;
    const edgeC = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.25, 0.14), acc);
    edgeC.position.set(0.68, 1.05, 0);
    const notch = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.16), VOID);
    notch.position.set(0.66, 0.75, 0);
    cleaver.add(haft, headC, edgeC, notch);
    cleaver.position.set(1.15, 1.3, 0.5);
    cleaver.rotation.x = 0.5;
    group.add(cleaver);
    weapon = cleaver;
  }

  return { group, core, weapon, wings, legs, parts };
}

/** Merged body template per kind — built ONCE; instances share every geometry. */
interface BodyTemplate {
  statics: THREE.Mesh[];
  core: THREE.Mesh;
  weapon?: THREE.Group;
  wings?: { l: THREE.Object3D; r: THREE.Object3D };
  legs?: THREE.Object3D[];
  parts?: Record<string, THREE.Object3D>;
}
const TEMPLATES = new Map<EnemyKind, BodyTemplate>();

/**
 * Instantiate a body from its (lazily built) merged template. Merging happens once
 * per KIND, not per spawn — per-spawn merging was a mid-wave GC/stall spike. Only the
 * core is a fresh mesh (it carries the per-instance hit-flash material).
 */
export function buildEnemyMesh(kind: EnemyKind, color: number, coreMat: THREE.MeshStandardMaterial): EnemyMeshParts {
  let t = TEMPLATES.get(kind);
  if (!t) {
    const built = buildBody(kind, color, accent(color));
    const builtLegs = built.legs ?? [];
    const builtParts = built.parts ? Object.values(built.parts) : [];
    mergeStatic(built.group, [built.core, built.weapon, built.wings?.l, built.wings?.r, ...builtLegs, ...builtParts]);
    const keepSet = new Set<THREE.Object3D>([...builtLegs, ...builtParts]);
    const statics: THREE.Mesh[] = [];
    for (const child of built.group.children) {
      const m = child as THREE.Mesh;
      if (m.isMesh && m !== built.core && !keepSet.has(m)) statics.push(m);
    }
    t = { statics, core: built.core, weapon: built.weapon, wings: built.wings, legs: builtLegs, parts: built.parts };
    TEMPLATES.set(kind, t);
  }
  const group = new THREE.Group();
  for (const s of t.statics) {
    const m = new THREE.Mesh(s.geometry, s.material);
    m.castShadow = true;
    group.add(m);
  }
  const core = new THREE.Mesh(t.core.geometry, coreMat);
  core.position.copy(t.core.position);
  core.rotation.copy(t.core.rotation);
  core.scale.copy(t.core.scale);
  group.add(core);
  let weapon: THREE.Group | undefined;
  if (t.weapon) {
    weapon = t.weapon.clone(true); // deep clone shares geometry + materials
    group.add(weapon);
  }
  let wings: EnemyMeshParts["wings"];
  if (t.wings) {
    const l = t.wings.l.clone(true), r = t.wings.r.clone(true);
    group.add(l, r);
    wings = { l, r };
  }
  let legs: THREE.Object3D[] | undefined;
  if (t.legs && t.legs.length) {
    legs = t.legs.map((l) => { const c = l.clone(true); group.add(c); return c; });
  }
  let parts: Record<string, THREE.Object3D> | undefined;
  if (t.parts) {
    parts = {};
    for (const k in t.parts) { const c = t.parts[k].clone(true); group.add(c); parts[k] = c; }
  }
  return { group, core, weapon, wings, legs, parts };
}
