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

  const [playerGltf, flyerGltf, orbGltf] = await Promise.all([
    loader.loadAsync(url('models/player.glb')),
    loader.loadAsync(url('models/enemy-flyer.glb')),
    loader.loadAsync(url('models/orb.glb')),
  ]);

  const player = retint(playerGltf.scene, 0x9ff0ff, 0.5);
  player.scale.setScalar(1.7);

  const boss = retint(flyerGltf.scene, 0x36f9ff, 1.1);
  boss.scale.setScalar(3.4);

  const orbProto = retint(orbGltf.scene, 0x53ff8a, 1.4);
  orbProto.scale.setScalar(1.1);

  return { player, boss, orbProto, tex: { dot: tex('sprites/particle.png'), burst: tex('sprites/burst.png'), hit: tex('sprites/hit.png'), shadow: tex('sprites/shadow.png') } };
}

// Retint the (single) player instance to the chosen character colour.
export function tintPlayer(player: THREE.Object3D, color: number): void {
  retint(player, color, 0.55);
}

// Procedural neon polyhedron for minion enemies — shared geo/material per kind.
const geoCache = new Map<string, THREE.BufferGeometry>();
export function enemyGeo(kind: string): THREE.BufferGeometry {
  let g = geoCache.get(kind);
  if (!g) {
    switch (kind) {
      case 'darter': g = new THREE.TetrahedronGeometry(0.9); break;
      case 'brute': g = new THREE.IcosahedronGeometry(1.3, 0); break;
      case 'caster': g = new THREE.OctahedronGeometry(1.0, 0); break;
      case 'splitter': g = new THREE.DodecahedronGeometry(1.05, 0); break;
      default: g = new THREE.IcosahedronGeometry(1, 0);
    }
    geoCache.set(kind, g);
  }
  return g;
}
