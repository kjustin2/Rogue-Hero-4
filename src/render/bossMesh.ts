import * as THREE from "three";
import { MATS } from "./enemyMeshes";

/**
 * The Barrow King's procedural body, extracted from Boss so art and logic live
 * apart. The PointLight is NOT built here — it must stay scene-owned in Boss
 * (light-count relink fix). Animated parts are returned by name; Boss drives
 * them in tick().
 */
export interface BossMeshParts {
  group: THREE.Group;
  cloak: THREE.Mesh;
  blade: THREE.Group;
  orbit: THREE.Group;
}

export function buildBossMesh(coreMat: THREE.MeshStandardMaterial): BossMeshParts {
  return buildProcedural(coreMat);
}

function buildBladeAndOrbit(coreMat: THREE.MeshStandardMaterial): { blade: THREE.Group; orbit: THREE.Group } {
  const { BONE, CLOTH } = MATS;
  const IRON = MATS.IRON.clone();
  IRON.emissive = new THREE.Color(0x0d1a18);
  IRON.emissiveIntensity = 0.8;
  IRON.userData.shared = true;
  const blade = new THREE.Group();
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.3, 6), CLOTH);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.28, 0.44), IRON);
  guard.position.y = 0.78;
  // a skull set where guard meets blade
  const guardSkull = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), BONE);
  guardSkull.scale.set(1, 1.1, 1.1);
  guardSkull.position.y = 1.0;
  const blMesh = new THREE.Mesh(new THREE.BoxGeometry(0.68, 7.6, 0.16), IRON);
  blMesh.position.y = 4.9; blMesh.castShadow = true;
  const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.16, 6.7, 0.2), coreMat); // the soul-lit fuller
  fuller.position.y = 4.75;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.37, 1.5, 4), IRON);
  tip.position.y = 9.4; tip.scale.set(0.92, 1, 0.45);
  const pommel = new THREE.Mesh(new THREE.OctahedronGeometry(0.26), coreMat);
  pommel.position.y = -0.75;
  blade.add(grip, guard, guardSkull, blMesh, fuller, tip, pommel);
  blade.rotation.set(0, 0, -0.22);
  const orbit = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), coreMat);
    shard.position.set(Math.cos(a) * 3.6, 4.6 + Math.sin(a * 2) * 0.7, Math.sin(a) * 3.6);
    orbit.add(shard);
  }
  return { blade, orbit };
}

function buildProcedural(coreMat: THREE.MeshStandardMaterial): BossMeshParts {
  const group = new THREE.Group();
  const { BONE, BONE_DK, CLOTH_RAG, VOID } = MATS;
  // boss-local variants: the King's iron carries a faint soulfire sheen so his bulk
  // reads against the dark instead of vanishing into it
  const IRON = MATS.IRON.clone();
  IRON.emissive = new THREE.Color(0x16302c);
  IRON.emissiveIntensity = 1.1;
  IRON.userData.shared = true;
  const CLOTH = MATS.CLOTH.clone();
  CLOTH.emissive = new THREE.Color(0x0a1210);
  CLOTH.emissiveIntensity = 0.6;
  CLOTH.userData.shared = true;
  const RUST = MATS.RUST.clone();
  RUST.emissive = new THREE.Color(0x120d08);
  RUST.emissiveIntensity = 0.6;
  RUST.userData.shared = true;
  const trim = new THREE.MeshStandardMaterial({ color: 0x6a5a2a, roughness: 0.4, metalness: 0.9, emissive: 0x3a2808, emissiveIntensity: 0.9, envMapIntensity: 1.2 }); // verdigris-bronze filigree
  trim.userData.shared = true;

  // ---- the dead king's bulk: layered plate skirt over a ragged under-robe ----
  const underRobe = new THREE.Mesh(new THREE.ConeGeometry(3.2, 5.8, 12, 1, true), CLOTH);
  underRobe.position.y = 2.9; underRobe.castShadow = true;
  for (let i = 0; i < 3; i++) { // three tiers of hanging plate
    const tier = new THREE.Mesh(new THREE.CylinderGeometry(1.7 + i * 0.55, 2.1 + i * 0.6, 1.5, 10, 1, true), IRON);
    tier.position.y = 4.1 - i * 1.35;
    tier.castShadow = true;
    group.add(tier);
    const tierTrim = new THREE.Mesh(new THREE.TorusGeometry(2.08 + i * 0.6, 0.07, 5, 16), trim);
    tierTrim.position.y = 3.38 - i * 1.35; tierTrim.rotation.x = Math.PI / 2;
    group.add(tierTrim);
  }
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.8, 2.4, 10), IRON);
  torso.position.y = 5.4; torso.castShadow = true;
  // engraved breastplate: bronze frame + a burning rune sigil
  const breast = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.9, 0.5), IRON);
  breast.position.set(0, 5.5, 1.35); breast.castShadow = true;
  const breastFrame = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.14, 0.54), trim);
  breastFrame.position.set(0, 6.35, 1.35);
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.85), coreMat); // the weak point — his caged soul
  core.position.set(0, 4.6, 1.5);
  const cage = new THREE.Group(); // rib-bars over the soul
  for (let i = 0; i < 4; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.4, 0.07), BONE_DK);
    bar.position.set(-0.45 + i * 0.3, 4.6, 1.75);
    cage.add(bar);
  }
  group.add(underRobe, torso, breast, breastFrame, core, cage);

  // ---- the crowned great-helm: deep black visor, burning eyes, tall bronze crown ----
  const helm = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.0, 1.5, 10), IRON);
  helm.position.y = 7.5; helm.castShadow = true;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.34, 0.4), VOID);
  visor.position.set(0, 7.55, 0.85);
  const eyes = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.16, 0.2), coreMat);
  eyes.position.set(0, 7.55, 0.95);
  const gorget = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.35, 0.7, 10), RUST);
  gorget.position.y = 6.6;
  group.add(helm, visor, eyes, gorget);
  for (let i = 0; i < 8; i++) { // the crown: alternating tall/short bronze points
    const a = (i / 8) * Math.PI * 2;
    const tall = i % 2 === 0;
    const point = new THREE.Mesh(new THREE.ConeGeometry(tall ? 0.16 : 0.11, tall ? 1.5 : 0.8, 4), trim);
    point.position.set(Math.cos(a) * 0.8, 8.3 + (tall ? 0.7 : 0.36), Math.sin(a) * 0.8);
    group.add(point);
    if (tall) { // a soulfire jewel between the tall points
      const jewel = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), coreMat);
      jewel.position.set(Math.cos(a) * 0.8, 8.42, Math.sin(a) * 0.8);
      group.add(jewel);
    }
  }

  // ---- broad pauldrons with hanging chain + skull mount ----
  for (const sx of [-1, 1]) {
    const pauld = new THREE.Mesh(new THREE.SphereGeometry(1.05, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), IRON);
    pauld.position.set(sx * 1.9, 6.4, 0); pauld.castShadow = true;
    const pauldTrim = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.07, 5, 14), trim);
    pauldTrim.position.set(sx * 1.9, 6.42, 0); pauldTrim.rotation.x = Math.PI / 2;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.1, 5), BONE_DK);
    spike.position.set(sx * 2.35, 7.25, 0); spike.rotation.z = sx * 0.7;
    group.add(pauld, pauldTrim, spike);
    // a mounted skull on the right pauldron, chain links swinging beneath both
    if (sx > 0) {
      const trophy = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), BONE);
      trophy.scale.set(1, 1.1, 1.15);
      trophy.position.set(sx * 1.9, 6.9, 0.55);
      const trophyEyes = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.06), VOID);
      trophyEyes.position.set(sx * 1.9, 6.9, 0.85);
      group.add(trophy, trophyEyes);
    }
    for (let l = 0; l < 3; l++) {
      const link = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.035, 4, 8), RUST);
      link.position.set(sx * 2.5, 5.9 - l * 0.24, 0.25);
      link.rotation.x = l % 2 ? 0 : Math.PI / 2;
      group.add(link);
    }
  }

  // ---- the ragged royal cloak (billows in tick) ----
  const cloak = new THREE.Mesh(new THREE.ConeGeometry(2.6, 5.2, 10, 1, true), CLOTH_RAG);
  cloak.position.set(0, 4.4, -1.1);
  cloak.rotation.x = 0.22;
  cloak.castShadow = true;
  group.add(cloak);

  // ---- tattered war-banners on iron poles planted behind the King ----
  for (const sx of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 12, 6), IRON);
    pole.position.set(sx * 3.7, 5, -2.0);
    const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 5), IRON);
    crossbar.rotation.z = Math.PI / 2;
    crossbar.position.set(sx * 3.7, 10.4, -2.0);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 5.2), CLOTH);
    banner.position.set(sx * 3.7, 7.6, -2.05); banner.rotation.y = Math.PI;
    const sigil = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 3.2), coreMat);
    sigil.position.set(sx * 3.7, 7.6, -1.98); sigil.rotation.y = Math.PI;
    const finial = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), trim);
    finial.position.set(sx * 3.7, 11.2, -2.0);
    group.add(pole, crossbar, banner, sigil, finial);
  }

  const { blade, orbit } = buildBladeAndOrbit(coreMat);
  group.add(blade, orbit);

  return { group, cloak, blade, orbit };
}
