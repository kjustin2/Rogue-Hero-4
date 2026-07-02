import * as THREE from "three";
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
const VOID = new THREE.MeshBasicMaterial({ color: 0x030204 });
for (const m of [BONE, BONE_DK, CLOTH, CLOTH_RAG, IRON, RUST, STONE, VOID]) m.userData.shared = true;

/** The shared medieval material language — bossMesh builds from the same box. */
export const MATS = { BONE, BONE_DK, CLOTH, CLOTH_RAG, IRON, RUST, STONE, VOID } as const;

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

export function buildEnemyMesh(kind: EnemyKind, color: number, coreMat: THREE.MeshStandardMaterial): EnemyMeshParts {
  const acc = accent(color);
  const group = new THREE.Group();
  let core: THREE.Mesh;
  let weapon: THREE.Group | undefined;
  let wings: EnemyMeshParts["wings"];

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
    tatters(group, 0.6, -2.55, 7, 0.55, CLOTH_RAG);
    // skull-crowned staff
    const staff = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 2.1, 6), RUST);
    const staffSkull = skull(0.55);
    staffSkull.position.y = 1.14;
    const staffEye = new THREE.Mesh(new THREE.OctahedronGeometry(0.06), coreMat);
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
    const cowl = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.8, 9), CLOTH_RAG);
    cowl.position.y = 0.95;
    const cowlMouth = new THREE.Mesh(new THREE.SphereGeometry(0.2, 9, 7), VOID);
    cowlMouth.position.set(0, 0.72, 0.08);
    core = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), coreMat); // the baleful eye
    core.position.set(0, 0.72, 0.2);
    group.add(shroud, cowl, cowlMouth, core);
    tatters(group, 0.34, -0.9, 5, 0.8, CLOTH_RAG);
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
    scythe.position.set(0.5, 0.0, 0.15);
    scythe.rotation.set(0.2, 0, 0.15);
    group.add(scythe);
    weapon = scythe;
  } else if (kind === "ghoul") {
    // feral flesh-eater: deep hunch, spine ridge, rib cage, skull with a hanging jaw,
    // knuckle-walking claw arms
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.42, 9, 7), BONE_DK);
    torso.position.set(0, 0.9, 0); torso.scale.set(0.85, 1.15, 1.25); torso.rotation.x = 0.7;
    torso.castShadow = true;
    const hips = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), CLOTH_RAG);
    hips.position.set(0, 0.62, -0.42);
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
    head.position.set(0, 1.3, 0.5);
    head.rotation.x = 0.25;
    core = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.045, 0.05), coreMat); // burning glare
    core.position.set(0, 1.28, 0.74);
    // haunches (it crouches on digitigrade legs)
    for (const sx of [-1, 1]) {
      const haunch = new THREE.Mesh(new THREE.SphereGeometry(0.2, 7, 6), BONE_DK);
      haunch.position.set(sx * 0.3, 0.5, -0.35); haunch.scale.set(0.8, 1.2, 1.3);
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.5, 5), BONE_DK);
      shin.position.set(sx * 0.34, 0.22, -0.2); shin.rotation.x = 0.7;
      group.add(haunch, shin);
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
    group.add(body, bandT, bandB, core, head, helm);
    // the throwing arm hefts a lit skull-bomb (the weapon — snaps forward on the lob)
    const lob = new THREE.Group();
    const bombSkull = skull(0.8);
    const fuse = new THREE.Mesh(new THREE.OctahedronGeometry(0.06), coreMat);
    fuse.position.y = 0.24;
    lob.add(bombSkull, fuse);
    lob.position.set(0.62, 1.7, 0.3);
    group.add(lob);
    weapon = lob;
  } else {
    // brute: an ogre-sized executioner — stacked furnace plates with ember seams,
    // riveted pauldrons, horned great-helm, a chained colossal cleaver
    const hips2 = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.0, 1.0, 9), CLOTH);
    hips2.position.y = 0.6; hips2.castShadow = true;
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.95, 10, 8), IRON);
    belly.position.y = 1.6; belly.scale.set(1, 0.9, 0.85); belly.castShadow = true;
    const chest2 = new THREE.Mesh(new THREE.SphereGeometry(0.85, 10, 8), IRON);
    chest2.position.y = 2.35; chest2.scale.set(1.15, 0.8, 0.9); chest2.castShadow = true;
    // ember seams between the plates
    for (const [y, r] of [[1.98, 0.86], [1.22, 0.8]] as const) {
      const seam = new THREE.Mesh(new THREE.TorusGeometry(r, 0.04, 5, 14), acc);
      seam.position.y = y; seam.rotation.x = Math.PI / 2;
      group.add(seam);
    }
    core = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.12), coreMat); // furnace heart grate
    core.position.set(0, 1.75, 0.82);
    for (let i = 0; i < 4; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.06), IRON);
      bar.position.set(-0.18 + i * 0.12, 1.75, 0.9);
      group.add(bar);
    }
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

  return { group, core, weapon, wings };
}
