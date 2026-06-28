import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// CC0 GLB models (Kenney) + particle textures, retinted into the neon-arcane look.
const BASE = import.meta.env.BASE_URL;
const url = (p: string) => `${BASE}assets/${p}`;

const matCache = new Map<number, THREE.MeshStandardMaterial>();
export function neonMat(color: number, intensity = 0.75): THREE.MeshStandardMaterial {
  const key = (color << 4) | Math.round(intensity * 10);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: intensity,
      metalness: 0.25, roughness: 0.45,
    });
    matCache.set(key, m);
  }
  return m;
}

function retint(root: THREE.Object3D, color: number, intensity: number): THREE.Object3D {
  const mat = neonMat(color, intensity);
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = mat; });
  return root;
}

export interface Models {
  player: THREE.Object3D;
  boss: THREE.Object3D;
  orbProto: THREE.Object3D;
  tex: { dot: THREE.Texture; burst: THREE.Texture; hit: THREE.Texture; shadow: THREE.Texture };
}

export async function loadModels(): Promise<Models> {
  const loader = new GLTFLoader();
  const texLoader = new THREE.TextureLoader();
  const tex = (p: string) => texLoader.load(url(p));

  const [flyerGltf, orbGltf] = await Promise.all([
    loader.loadAsync(url('models/enemy-flyer.glb')),
    loader.loadAsync(url('models/orb.glb')),
  ]);

  const player = buildHero(0x9ff0ff); // procedural articulated hero (replaces the plain GLB blob)

  const boss = retint(flyerGltf.scene, 0x36f9ff, 1.8);
  boss.scale.setScalar(9.0);

  const orbProto = retint(orbGltf.scene, 0x53ff8a, 1.4);
  orbProto.scale.setScalar(1.1);

  return { player, boss, orbProto, tex: { dot: tex('sprites/particle.png'), burst: tex('sprites/burst.png'), hit: tex('sprites/hit.png'), shadow: tex('sprites/shadow.png') } };
}

// A designed "arcane sentinel": floating robe base + torso + shoulders, a glowing head core,
// halo, chest gem and a front focus orb. Named glowing parts animate (head bob, halo spin,
// orb recoil on cast). Far better silhouette + animation than a single retinted GLB blob.
function buildHero(color: number): THREE.Group {
  const g = new THREE.Group();
  const darkMat = () => new THREE.MeshStandardMaterial({ color: 0x171030, emissive: color, emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.65 });
  const glowMat = () => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.4, roughness: 0.3, metalness: 0.2 });
  const add = (mesh: THREE.Mesh, glow: boolean, name?: string) => { mesh.userData.glow = glow; if (name) mesh.name = name; g.add(mesh); return mesh; };
  add(new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.0, 8), darkMat()), false).position.y = 0.5;           // robe base
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.5, 0.75, 8), darkMat()), false).position.y = 1.05; // torso
  add(new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), glowMat()), true, 'gem').position.set(0, 1.1, 0.32); // chest gem
  for (const sx of [-0.46, 0.46]) add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), darkMat()), false).position.set(sx, 1.3, 0); // shoulders
  add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), glowMat()), true, 'head').position.y = 1.62;     // head core
  const halo = add(new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.045, 8, 22), glowMat()), true, 'halo'); halo.position.y = 1.96; halo.rotation.x = Math.PI / 2;
  add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), glowMat()), true, 'orb').position.set(0, 1.0, 0.72); // front focus orb
  g.scale.setScalar(1.7);
  return g;
}

// Recolour the procedural hero to the chosen character colour (glow parts get the full colour,
// dark parts keep their dark body with a colour-tinted emissive).
export function tintPlayer(player: THREE.Object3D, color: number): void {
  player.traverse((o) => {
    const m = o as THREE.Mesh; if (!m.isMesh) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    mat.emissive.setHex(color);
    if (m.userData.glow) mat.color.setHex(color);
  });
}

// Distinct, designed enemy creatures (WoW-ish unique silhouettes) built from primitives, fresh
// per enemy so each owns its materials (hit-flash + disposal). The main hittable shell is named
// 'body'; the glowing core is 'core'; decorative parts are tagged userData.wing/.orbit/.pod so
// the renderer can animate them. Returned facing +Z (the renderer turns it toward the player).
// shared per-kind part geometries (created once, reused across every enemy — materials stay
// per-instance for hit-flash/disposal; geometries must NOT be per-enemy or they leak).
const eGeo = new Map<string, THREE.BufferGeometry>();
const cg = (key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry => {
  let g = eGeo.get(key); if (!g) { g = make(); eGeo.set(key, g); } return g;
};
export function buildEnemy(kind: string, color: number): THREE.Group {
  const g = new THREE.Group();
  const dark = () => new THREE.MeshStandardMaterial({ color: 0x160d2e, emissive: color, emissiveIntensity: 0.7, roughness: 0.35, metalness: 0.6, transparent: true, opacity: 0.92 });
  const glow = (i = 2.8) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: i, roughness: 0.3 });
  const shell = (geo: THREE.BufferGeometry) => { const m = new THREE.Mesh(geo, dark()); m.name = 'body'; g.add(m); return m; };
  const core = (geo: THREE.BufferGeometry, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, glow(3.2)); m.name = 'core'; m.position.set(x, y, z); g.add(m); return m; };
  switch (kind) {
    case 'darter': { // sleek dart/wasp
      shell(cg('d-body', () => new THREE.ConeGeometry(0.55, 1.8, 6))).rotation.x = Math.PI / 2;
      for (const s of [-1, 1]) { const wing = new THREE.Mesh(cg('d-wing', () => new THREE.BoxGeometry(0.06, 0.55, 1.1)), glow(1.7)); wing.position.set(s * 0.5, 0, -0.25); wing.rotation.y = s * 0.5; wing.userData.wing = s; g.add(wing); }
      core(cg('d-core', () => new THREE.IcosahedronGeometry(0.24, 0)), 0, 0, 0.7);
      break;
    }
    case 'brute': { // hulking bruiser with shoulder plates + a glowing maw
      shell(cg('b-body', () => new THREE.IcosahedronGeometry(1.05, 0)));
      for (const s of [-1, 1]) { const pl = new THREE.Mesh(cg('b-plate', () => new THREE.BoxGeometry(0.75, 0.55, 0.75)), dark()); pl.position.set(s * 1.0, 0.45, 0); pl.rotation.z = s * 0.45; g.add(pl); }
      core(cg('b-maw', () => new THREE.BoxGeometry(0.8, 0.28, 0.35)), 0, -0.1, 0.9);
      break;
    }
    case 'caster': { // floating sorcerer: tall crystal + orbiting runes + focus core
      shell(cg('c-body', () => new THREE.OctahedronGeometry(0.82, 0))).scale.y = 1.5;
      core(cg('c-core', () => new THREE.IcosahedronGeometry(0.32, 0)));
      for (let i = 0; i < 3; i++) { const rune = new THREE.Mesh(cg('c-rune', () => new THREE.TorusGeometry(0.2, 0.045, 6, 14)), glow(2.4)); rune.userData.orbit = i; g.add(rune); }
      break;
    }
    case 'splitter':
    default: { // pod cluster, visibly ready to split apart
      shell(cg('s-body', () => new THREE.DodecahedronGeometry(0.72, 0)));
      for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; const pod = new THREE.Mesh(cg('s-pod', () => new THREE.IcosahedronGeometry(0.42, 0)), dark()); pod.position.set(Math.cos(a) * 0.72, 0, Math.sin(a) * 0.72); pod.userData.pod = i; g.add(pod); }
      core(cg('s-core', () => new THREE.IcosahedronGeometry(0.36, 0)));
      break;
    }
  }
  return g;
}

// Procedural neon polyhedron for minion enemies — shared geo/material per kind.
const geoCache = new Map<string, THREE.BufferGeometry>();
export function enemyGeo(kind: string): THREE.BufferGeometry {
  let g = geoCache.get(kind);
  if (!g) {
    switch (kind) {
      case 'darter': g = new THREE.ConeGeometry(0.7, 1.7, 4); break;        // sharp dart/spike
      case 'brute': g = new THREE.IcosahedronGeometry(1.4, 0); break;        // big bruiser
      case 'caster': g = new THREE.OctahedronGeometry(1.05, 0); break;       // floating crystal
      case 'splitter': g = new THREE.DodecahedronGeometry(1.1, 0); break;    // splits apart
      default: g = new THREE.IcosahedronGeometry(1, 0);
    }
    geoCache.set(kind, g);
  }
  return g;
}
