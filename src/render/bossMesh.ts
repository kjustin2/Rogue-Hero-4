import * as THREE from "three";

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

export function buildBossMesh(hitColor: number, coreMat: THREE.MeshStandardMaterial): BossMeshParts {
  return buildProcedural(hitColor, coreMat);
}

function buildBladeAndOrbit(hitColor: number, coreMat: THREE.MeshStandardMaterial): { blade: THREE.Group; orbit: THREE.Group } {
  const shell = new THREE.MeshStandardMaterial({ color: 0x0a0b16, roughness: 0.55, metalness: 0.5, emissive: hitColor, emissiveIntensity: 0.3 });
  const blade = new THREE.Group();
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.3, 6), shell);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.3, 0.42), coreMat);
  guard.position.y = 0.78;
  const blMesh = new THREE.Mesh(new THREE.BoxGeometry(0.62, 7.6, 0.2), shell);
  blMesh.position.y = 4.6; blMesh.castShadow = true;
  const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.16, 6.9, 0.26), coreMat);
  fuller.position.y = 4.45;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.4, 4), shell);
  tip.position.y = 8.75;
  const pommel = new THREE.Mesh(new THREE.OctahedronGeometry(0.26), coreMat);
  pommel.position.y = -0.75;
  blade.add(grip, guard, blMesh, fuller, tip, pommel);
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

function buildProcedural(hitColor: number, coreMat: THREE.MeshStandardMaterial): BossMeshParts {
  const group = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0x0a0b16, roughness: 0.55, metalness: 0.5, emissive: hitColor, emissiveIntensity: 0.3 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.4, 6.5, 8), shell);
  body.position.y = 3.4; body.castShadow = true;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3, 0), shell);
  head.position.y = 7.4; head.castShadow = true;
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(1.0), coreMat);
  core.position.y = 4.6;
  group.add(body, head, core);

  // ragged cloak/skirt flaring from the body — a looming warlord silhouette (billows in tick)
  const cloak = new THREE.Mesh(new THREE.ConeGeometry(3.2, 5.8, 10, 1, true), shell);
  cloak.position.y = 2.9; cloak.castShadow = true;
  group.add(cloak);

  // pauldron spikes off the shoulders
  for (const sx of [-1, 1]) {
    const pauldron = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.2, 5), coreMat);
    pauldron.position.set(sx * 2.0, 6.0, 0);
    pauldron.rotation.z = sx * 0.9;
    group.add(pauldron);
  }

  // glowing slit eyes on the head
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.2), coreMat);
    eye.position.set(sx * 0.5, 7.5, 1.05);
    group.add(eye);
  }

  // tall jagged crown of shards (two tiers)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const shard = new THREE.Mesh(new THREE.ConeGeometry(0.34, 2.6, 4), coreMat);
    shard.position.set(Math.cos(a) * 1.4, 8.7, Math.sin(a) * 1.4);
    group.add(shard);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.5, 4), coreMat);
    inner.position.set(Math.cos(a + 0.39) * 0.8, 9.1, Math.sin(a + 0.39) * 0.8);
    group.add(inner);
  }

  // knightly plate: a great-helm crest ridge, a gorget collar, a breastplate + heraldic sigil
  const crest = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.1, 1.4), coreMat);
  crest.position.set(0, 8.35, 0); // comb/plume ridge atop the helm
  const gorget = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.24, 8, 16), shell);
  gorget.position.y = 6.5; gorget.rotation.x = Math.PI / 2;
  const breast = new THREE.Mesh(new THREE.BoxGeometry(2.7, 2.3, 1.0), shell);
  breast.position.set(0, 4.5, 0.95); breast.castShadow = true;
  const emblem = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), coreMat);
  emblem.position.set(0, 4.7, 1.55); emblem.scale.set(1, 1.5, 0.4); // sigil on the chest
  group.add(crest, gorget, breast, emblem);
  // tattered war-banners on iron poles planted behind the Warden (face the player)
  for (const sx of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 12, 6), shell);
    pole.position.set(sx * 3.7, 5, -2.0);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 5.2), shell);
    banner.position.set(sx * 3.7, 7.4, -2.05); banner.rotation.y = Math.PI;
    const sigil = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 3.2), coreMat);
    sigil.position.set(sx * 3.7, 7.4, -1.98); sigil.rotation.y = Math.PI;
    group.add(pole, banner, sigil);
  }

  const { blade, orbit } = buildBladeAndOrbit(hitColor, coreMat);
  group.add(blade, orbit);

  return { group, cloak, blade, orbit };
}
