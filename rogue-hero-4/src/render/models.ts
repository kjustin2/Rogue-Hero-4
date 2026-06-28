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

// Shared "tech-armour" decal: white circuit/panel traces on black. As an emissiveMap the BLACK
// reads as zero emissive (so the chrome/IBL reflection shows) and only the traces glow the part's
// emissive colour — premium "lit metal with glowing circuitry". As a bumpMap the same lines give
// etched-panel relief that catches the lighting = real surface detail (the VLM's "detail" frontier).
// Created once (perf: one shared texture, never per-entity).
let _armorTex: THREE.CanvasTexture | null = null;
function armorTex(): THREE.CanvasTexture {
  if (_armorTex) return _armorTex;
  const s = 256, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000'; g.fillRect(0, 0, s, s);
  const line = (a: number, wdt: number) => { g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = wdt; };
  line(0.85, 5); g.strokeRect(12, 12, s - 24, s - 24);                 // outer panel frame
  line(0.55, 3); g.strokeRect(34, 34, s - 68, s - 68);                 // inner frame
  line(0.7, 2);                                                        // horizontal circuit runs
  for (let i = 1; i < 6; i++) { const y = 34 + i * ((s - 68) / 6); g.beginPath(); g.moveTo(40, y); g.lineTo(s - 40, y); g.stroke(); }
  line(0.5, 2);                                                        // a couple of vertical taps
  for (const x of [s * 0.32, s * 0.68]) { g.beginPath(); g.moveTo(x, 40); g.lineTo(x, s - 40); g.stroke(); }
  g.fillStyle = 'rgba(255,255,255,0.95)';                              // glowing nodes on the grid
  for (let i = 0; i < 4; i++) for (let j = 0; j < 5; j++) { if ((i + j) % 2) g.fillRect(50 + i * 48, 44 + j * 34, 6, 6); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  _armorTex = t; return t;
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

  const [orbGltf] = await Promise.all([
    loader.loadAsync(url('models/orb.glb')),
  ]);

  const player = buildHero(0x9ff0ff); // procedural articulated hero (replaces the plain GLB blob)

  const boss = buildBoss(0x36f9ff);   // procedural "Conductor" — big, distinct, multi-part

  const orbProto = retint(orbGltf.scene, 0x53ff8a, 1.4);
  orbProto.scale.setScalar(1.1);

  return { player, boss, orbProto, tex: { dot: tex('sprites/particle.png'), burst: tex('sprites/burst.png'), hit: tex('sprites/hit.png'), shadow: tex('sprites/shadow.png') } };
}

// A designed "arcane sentinel": floating robe base + torso + shoulders, a glowing head core,
// halo, chest gem and a front focus orb. Named glowing parts animate (head bob, halo spin,
// orb recoil on cast). Far better silhouette + animation than a single retinted GLB blob.
function buildHero(color: number): THREE.Group {
  const g = new THREE.Group();
  // Body = polished neon-chrome that READS as a hard silhouette under the IBL (metalness 1 +
  // envMapIntensity picks up the magenta/cyan environment). It is NOT emissive, so bloom doesn't
  // dissolve it into a glow blob — only the named accent parts bloom. This is the fix for the
  // "featureless glowing capsule" read: contrast between a lit chassis and a few bright accents.
  const bodyMat = () => new THREE.MeshStandardMaterial({ color: 0xc2ccec, emissive: color, emissiveIntensity: 0.9, emissiveMap: armorTex(), bumpMap: armorTex(), bumpScale: 0.014, roughness: 0.28, metalness: 1.0, envMapIntensity: 2.0 });
  const trimMat = () => new THREE.MeshStandardMaterial({ color: 0x2a2350, emissive: color, emissiveIntensity: 1.1, emissiveMap: armorTex(), bumpMap: armorTex(), bumpScale: 0.014, roughness: 0.3, metalness: 0.9, envMapIntensity: 1.4 });
  const glowMat = () => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.1, roughness: 0.25, metalness: 0.2 });
  const add = (mesh: THREE.Mesh, glow: boolean, name?: string) => { mesh.userData.glow = glow; if (name) mesh.name = name; g.add(mesh); return mesh; };
  add(new THREE.Mesh(new THREE.ConeGeometry(0.64, 1.15, 8), bodyMat()), false).position.y = 0.55;            // armoured robe base
  add(new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.08, 6, 16), trimMat()), false).position.y = 0.95;        // waist ring (layer)
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.5, 0.8, 8), bodyMat()), false).position.y = 1.12;    // torso
  add(new THREE.Mesh(new THREE.OctahedronGeometry(0.21, 0), glowMat()), true, 'gem').position.set(0, 1.16, 0.34); // chest gem
  for (const sx of [-1, 1]) {
    add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), bodyMat()), false).position.set(sx * 0.5, 1.42, 0);            // pauldron
    const vane = add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.62, 0.18), trimMat()), false); vane.position.set(sx * 0.62, 1.18, -0.05); vane.rotation.z = sx * 0.4; // arm vane (silhouette width)
  }
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 0.34, 8), bodyMat()), false).position.y = 1.74;  // neck/gorget
  add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), glowMat()), true, 'head').position.y = 1.98;    // head core (accent)
  add(new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 5), bodyMat()), false).position.y = 2.32;             // crown spike (knightly silhouette)
  const halo = add(new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.05, 8, 22), glowMat()), true, 'halo'); halo.position.y = 2.36; halo.rotation.x = Math.PI / 2;
  add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), glowMat()), true, 'orb').position.set(0, 1.05, 0.78); // front focus orb
  g.scale.setScalar(1.7);
  return g;
}

// The Conductor — the climax boss. A LARGE, cold, armoured entity built to read as a clear
// size + silhouette threat distinct from the warm hero (warm chrome vs cold dark armour): a
// dark-metal diamond core, a single glaring eye, shoulder pylons, an outer ring of conductor
// "batons", and a halo crown. Multi-part + lit-metal so it never reads as a glowing blob.
function buildBoss(color: number): THREE.Group {
  const g = new THREE.Group();
  // armour is BRIGHT steel-teal (reads under the IBL) and carries the silhouette; the glow accents
  // are kept MODEST so the whole stack of batons+eye+crown doesn't cumulatively bloom to a white
  // smear (the first pass blew the boss out to pure white — readability lost).
  const armor = () => new THREE.MeshStandardMaterial({ color: 0x3d6378, emissive: color, emissiveIntensity: 0.7, emissiveMap: armorTex(), bumpMap: armorTex(), bumpScale: 0.02, roughness: 0.3, metalness: 1.0, envMapIntensity: 1.9 });
  const glow = (i = 1.6) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: i, roughness: 0.25, metalness: 0.3 });
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(1.5, 0), armor()); core.scale.y = 1.2; g.add(core);
  const eye = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 0), glow(1.9)); eye.position.set(0, 0.2, 1.25); eye.name = 'bossEye'; g.add(eye);
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.ConeGeometry(0.52, 1.9, 5), armor()); p.position.set(s * 1.7, 0.7, 0); p.rotation.z = s * -0.55; g.add(p); }
  const ring = new THREE.Group(); ring.name = 'bossRing';
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const b = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.6, 0.22), glow(1.1)); b.position.set(Math.cos(a) * 2.6, Math.sin(i * 1.7) * 0.5, Math.sin(a) * 2.6); b.lookAt(0, 0, 0); ring.add(b); }
  g.add(ring);
  const crown = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.14, 8, 28), glow(1.4)); crown.position.y = 1.9; crown.rotation.x = Math.PI / 2; g.add(crown);
  g.scale.setScalar(2.3);
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
  // Shell = the enemy colour as LIT metallic armour (a darkened tint of the colour, not near-black)
  // so each creature reads as a solid coloured silhouette catching the neon IBL — with a brighter
  // glowing core for the menace. Opaque (transparency washed them out / merged with the floor).
  const shellHex = new THREE.Color(color).multiplyScalar(0.55).getHex();
  // bumpMap (relief) only — NOT emissiveMap — so the hit-flash (emissive→white) still whitens the
  // whole shell, while the etched panel lines add crafted surface detail.
  const dark = () => new THREE.MeshStandardMaterial({ color: shellHex, emissive: color, emissiveIntensity: 0.5, bumpMap: armorTex(), bumpScale: 0.018, roughness: 0.38, metalness: 0.9, envMapIntensity: 1.5 });
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
