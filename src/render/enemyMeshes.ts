import * as THREE from "three";
import type { EnemyKind } from "../game/enemies";

/**
 * Procedural enemy bodies, extracted from Enemy so art and logic live apart.
 * `core` is the emissive weak/eye mesh (animated + hit-flashed via the caller's
 * per-instance coreMat); `weapon` is the held sub-group swung on the strike.
 */
export interface EnemyMeshParts {
  group: THREE.Group;
  core: THREE.Mesh;
  weapon?: THREE.Group;
}

// Shared body materials, one set per kind color — enemies are pooled and numerous,
// so per-instance materials were both wasteful and a dispose() leak. Only the
// caller-owned coreMat stays per-instance (it carries the hit-flash).
const matCache = new Map<number, { shell: THREE.MeshStandardMaterial; plate: THREE.MeshStandardMaterial; edge: THREE.MeshStandardMaterial }>();
function mats(c: number) {
  let m = matCache.get(c);
  if (!m) {
    m = {
      shell: new THREE.MeshStandardMaterial({ color: 0x0b0d18, roughness: 0.45, metalness: 0.72, emissive: c, emissiveIntensity: 0.28, envMapIntensity: 1.1 }),
      plate: new THREE.MeshStandardMaterial({ color: 0x141826, roughness: 0.5, metalness: 0.8, emissive: c, emissiveIntensity: 0.2, envMapIntensity: 1.1 }),
      edge: new THREE.MeshStandardMaterial({ color: 0x05060d, emissive: c, emissiveIntensity: 1.7, roughness: 0.35, metalness: 0.3 }),
    };
    for (const mat of Object.values(m)) mat.userData.shared = true;
    matCache.set(c, m);
  }
  return m;
}
const voidMat = new THREE.MeshBasicMaterial({ color: 0x05060a });
voidMat.userData.shared = true;

export function buildEnemyMesh(kind: EnemyKind, color: number, coreMat: THREE.MeshStandardMaterial): EnemyMeshParts {
  const { shell: shellMat, plate: plateMat, edge: edgeMat } = mats(color);
  const group = new THREE.Group();
  let core: THREE.Mesh;
  let weapon: THREE.Group | undefined;

  if (kind === "husk") {
    // hooded shard-wraith: tapered body, cowl, cracked core behind it, crown + fins + tatters
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.72, 1.7, 6), shellMat);
    body.position.y = 0.95; body.castShadow = true;
    const cowl = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.0, 6), plateMat);
    cowl.position.y = 1.7; cowl.castShadow = true;
    core = new THREE.Mesh(new THREE.OctahedronGeometry(0.32), coreMat);
    core.position.y = 1.3;
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.12), coreMat);
    eye.position.set(0, 1.12, 0.46);
    group.add(body, cowl, core, eye);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.5, 4), edgeMat);
      spike.position.set(Math.cos(a) * 0.42, 2.15, Math.sin(a) * 0.42);
      group.add(spike);
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const fin = new THREE.Mesh(new THREE.ConeGeometry(0.1, 1.0, 4), edgeMat);
      fin.position.set(Math.cos(a) * 0.55, 1.4, Math.sin(a) * 0.55);
      fin.rotation.set(-Math.sin(a) * 0.7, 0, Math.cos(a) * 0.7);
      const tatter = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 0.16), edgeMat);
      tatter.position.set(Math.cos(a) * 0.5, 0.4, Math.sin(a) * 0.5);
      group.add(fin, tatter);
    }
    // a notched rusted falchion gripped at its side — a risen footman, not just a wisp
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6), plateMat);
    const crossguard = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.1), plateMat);
    crossguard.position.y = 0.2;
    const swordBlade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.1, 0.05), shellMat);
    swordBlade.position.y = 0.78;
    const swordEdge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.1, 0.06), edgeMat);
    swordEdge.position.set(0.085, 0.78, 0);
    const sword = new THREE.Group();
    sword.add(grip, crossguard, swordBlade, swordEdge);
    sword.position.set(0.62, 0.92, 0.32);
    sword.rotation.set(0.55, 0, -0.32);
    group.add(sword);
    weapon = sword;
  } else if (kind === "spitter") {
    // hooded witchfire caster: a drooping robe, a cowl over a dark void, an orb it conjures
    const robe = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.7, 7, 1, true), shellMat);
    robe.position.y = -0.2; robe.castShadow = true;
    const cowl = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.85, 7), plateMat);
    cowl.position.y = 0.7;
    const voidHead = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), voidMat);
    voidHead.position.y = 0.52;
    core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), coreMat); // the witchfire orb it hurls
    core.position.set(0, 0.15, 0.45);
    group.add(robe, cowl, voidHead, core);
    // two skeletal arms cupping the orb
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.7, 5), edgeMat);
      arm.position.set(sx * 0.28, 0.15, 0.28); arm.rotation.set(0.9, 0, sx * 0.5);
      group.add(arm);
    }
    // ragged robe hem
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const tatter = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.05), plateMat);
      tatter.position.set(Math.cos(a) * 0.5, -0.85, Math.sin(a) * 0.5);
      group.add(tatter);
    }
    // a gnarled bone staff crowned with a witchfire ring — the necromancer's focus
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 1.9, 6), plateMat);
    staff.position.set(0.46, 0.2, 0.06); staff.rotation.z = -0.12;
    const finial = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 6, 10), edgeMat);
    finial.position.set(0.34, 1.12, 0.06); finial.rotation.x = Math.PI / 2;
    const ember = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), coreMat);
    ember.position.set(0.34, 1.12, 0.06);
    const focus = new THREE.Group();
    focus.add(staff, finial, ember);
    group.add(focus);
    weapon = focus;
  } else if (kind === "wraith") {
    // hooded banshee: a cowl over a baleful eye, a tapering spectral body, trailing tatters + reaching arms
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.6, 6, 1, true), shellMat);
    body.position.y = -0.1; body.rotation.x = Math.PI; body.castShadow = true; // wide shoulders → wisp tail
    const cowl = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.85, 6), plateMat);
    cowl.position.y = 0.7;
    core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), coreMat); // single baleful eye
    core.position.set(0, 0.5, 0.28);
    group.add(body, cowl, core);
    for (let i = 0; i < 4; i++) {
      const a = -0.5 + (i / 3) * 1.0;
      const tatter = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 0.04), edgeMat);
      tatter.position.set(Math.sin(a) * 0.35, -0.5, -0.3 + Math.cos(a) * 0.1); tatter.rotation.x = -0.3;
      group.add(tatter);
    }
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.8, 4), shellMat);
      arm.position.set(sx * 0.5, 0.25, 0.2); arm.rotation.z = sx * 1.3;
      group.add(arm);
    }
    // a spectral scythe — a long haft with a hooked, curved blade trailing the reaper
    const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.8, 5), plateMat);
    haft.position.set(0.5, 0.05, 0.12); haft.rotation.set(0.25, 0, 0.18);
    const scytheBlade = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.045, 6, 12, Math.PI * 0.85), edgeMat);
    scytheBlade.position.set(0.34, 0.86, 0.2); scytheBlade.rotation.set(Math.PI / 2, 0, 0.7);
    const reaper = new THREE.Group();
    reaper.add(haft, scytheBlade);
    group.add(reaper);
    weapon = reaper;
  } else if (kind === "ghoul") {
    // feral flesh-eater: a hunched gaunt ghoul — lean ribbed torso, cracked skull, long raking claws
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.5, 1.1, 6), shellMat);
    torso.position.set(0, 0.85, 0.06); torso.rotation.x = 0.35; torso.castShadow = true; // hunched forward
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.9, 0.13), plateMat);
    spine.position.set(0, 1.12, -0.26); spine.rotation.x = 0.4;
    const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), plateMat);
    skull.position.set(0, 1.5, 0.26); skull.castShadow = true;
    const jaw = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 4), plateMat);
    jaw.position.set(0, 1.32, 0.36); jaw.rotation.x = Math.PI;
    core = new THREE.Mesh(new THREE.OctahedronGeometry(0.15), coreMat); // hollow glowing eye-socket
    core.position.set(0, 1.56, 0.42);
    group.add(torso, spine, skull, jaw, core);
    for (let i = 0; i < 3; i++) { // exposed ribs
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.22 - i * 0.03, 0.028, 4, 8, Math.PI), edgeMat);
      rib.position.set(0, 0.72 + i * 0.22, 0.18); rib.rotation.set(Math.PI / 2, 0, 0);
      group.add(rib);
    }
    const larm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.9, 5), shellMat);
    larm.position.set(-0.42, 0.9, 0.18); larm.rotation.set(0.5, 0, -0.5);
    group.add(larm);
    // the right claw-arm is the "weapon" — it rakes forward on the strike
    const claws = new THREE.Group();
    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.9, 5), shellMat);
    forearm.position.set(0, -0.3, 0); forearm.rotation.x = 0.4;
    claws.add(forearm);
    for (let i = 0; i < 3; i++) {
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.038, 0.4, 4), edgeMat);
      claw.position.set((i - 1) * 0.1, -0.72, 0.14); claw.rotation.x = -0.5;
      claws.add(claw);
    }
    claws.position.set(0.44, 1.08, 0.2);
    group.add(claws);
    weapon = claws;
  } else if (kind === "archer") {
    // skeletal bowman: upright thin body, hooded skull, a recurve bow held out, a quiver on the back
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.42, 1.5, 6), shellMat);
    body.position.y = 0.55; body.castShadow = true;
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.7, 6), plateMat);
    hood.position.y = 1.32;
    core = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), coreMat); // baleful eye under the hood
    core.position.set(0, 1.18, 0.3);
    group.add(body, hood, core);
    const quiver = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.6, 6), plateMat);
    quiver.position.set(-0.24, 0.9, -0.26); quiver.rotation.x = -0.4;
    group.add(quiver);
    for (let i = 0; i < 3; i++) { // arrow fletchings poking from the quiver
      const fl = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 4), edgeMat);
      fl.position.set(-0.24 + (i - 1) * 0.06, 1.2, -0.34); fl.rotation.x = -0.4;
      group.add(fl);
    }
    // a spectral recurve bow held forward — the "weapon", snaps on the loose
    const bow = new THREE.Group();
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.035, 6, 14, Math.PI * 1.15), edgeMat);
    arc.rotation.z = Math.PI * 0.42;
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.9, 4), plateMat);
    const knock = new THREE.Mesh(new THREE.OctahedronGeometry(0.08), coreMat); // nocked witch-bolt
    knock.position.z = 0.03;
    bow.add(arc, string, knock);
    bow.position.set(0.3, 0.9, 0.32);
    group.add(bow);
    weapon = bow;
  } else {
    // brute: hulking golem — stacked torso plates, spiked pauldrons, grated chest core
    const lower = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 1.3), shellMat);
    lower.position.y = 0.65; lower.castShadow = true;
    const upper = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.0, 1.4), plateMat);
    upper.position.y = 1.7; upper.castShadow = true;
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), plateMat);
    head.position.y = 2.6; head.castShadow = true;
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.1), coreMat);
    eye.position.set(0, 2.62, 0.45);
    core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42), coreMat);
    core.position.set(0, 1.55, 0.6);
    group.add(lower, upper, head, eye, core);
    for (let i = 0; i < 4; i++) { // chest grate bars over the core
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.08), shellMat);
      bar.position.set(-0.3 + i * 0.2, 1.55, 0.72);
      group.add(bar);
    }
    for (const sx of [-1, 1]) {
      const pauld = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 1.3), plateMat);
      pauld.position.set(sx * 1.15, 2.0, 0); pauld.castShadow = true;
      for (let i = 0; i < 3; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 4), edgeMat);
        spike.position.set(sx * 1.15, 2.45, -0.4 + i * 0.4); spike.rotation.x = -0.3;
        group.add(spike);
      }
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.3, 0.5), shellMat);
      arm.position.set(sx * 1.15, 1.1, 0); arm.castShadow = true;
      const fist = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), plateMat);
      fist.position.set(sx * 1.15, 0.4, 0);
      group.add(pauld, arm, fist);
    }
    // jagged iron horns crowning the helm
    for (const sx of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.7, 4), edgeMat);
      horn.position.set(sx * 0.32, 3.05, 0); horn.rotation.z = sx * 0.7;
      group.add(horn);
    }
    // a colossal notched cleaver hefted in the right fist — an executioner's blade
    const cleaverHaft = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.5, 6), shellMat);
    cleaverHaft.position.set(1.15, 1.1, 0.55); cleaverHaft.rotation.x = 0.55;
    const cleaverHead = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.14), plateMat);
    cleaverHead.position.set(1.15, 1.95, 1.05);
    const cleaverEdge = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.1, 0.16), edgeMat);
    cleaverEdge.position.set(1.5, 1.95, 1.05);
    const cleaver = new THREE.Group();
    cleaver.add(cleaverHaft, cleaverHead, cleaverEdge);
    group.add(cleaver);
    weapon = cleaver;
  }

  return { group, core, weapon };
}
