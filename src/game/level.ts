import * as THREE from "three";
import type { Ctx } from "./ctx";
import { clamp } from "../core/math";

/**
 * The Rift Causeway — one long, wide path running down +Z that opens into a circular
 * boss arena at the far end. Built once from these constants (level-as-data); the
 * same numbers drive the Three scene and the movement bounds. Gates are emissive
 * barriers that seal the path until their wave is cleared, so the run is a string of
 * fights leading to the boss you can see waiting at the end.
 */
export const START_Z = 0;
export const HALF_WIDTH = 18; // path is 36 wide
export const GATES_Z = [50, 100, 150];
export const ARENA_BLEND_Z = 184;
export const ARENA_CENTER = new THREE.Vector2(0, 214);
export const ARENA_RADIUS = 38;
export const PLAYER_SPAWN = new THREE.Vector3(0, 0, 4);
export const BOSS_ANCHOR = new THREE.Vector3(0, 0, 226);

export interface Gate {
  z: number;
  /** Player z that triggers this gate's wave (a little before the barrier). */
  triggerZ: number;
  open: boolean;
  barrier: THREE.Mesh;
  light: THREE.PointLight;
}

const NEON = [0x46e0ff, 0xc28bff, 0xff7a3c, 0x4affc4];

export class Level {
  readonly group = new THREE.Group();
  readonly gates: Gate[] = [];
  private barrierMat: THREE.MeshBasicMaterial[] = [];

  constructor(private ctx: Ctx) {}

  build(): void {
    const scene = this.ctx.stage.scene;
    this.group.clear();

    // --- path floor (dark PBR slab with a faint emissive sheen) ---
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0a0c16, roughness: 0.55, metalness: 0.35,
      emissive: 0x0a1830, emissiveIntensity: 0.35,
    });
    const pathLen = ARENA_BLEND_Z + 14;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(HALF_WIDTH * 2, 1, pathLen), floorMat);
    floor.position.set(0, -0.5, pathLen / 2 - 8);
    floor.receiveShadow = true;
    this.group.add(floor);

    // arena floor disc
    const arena = new THREE.Mesh(new THREE.CylinderGeometry(ARENA_RADIUS + 3, ARENA_RADIUS + 3, 1, 56), floorMat);
    arena.position.set(ARENA_CENTER.x, -0.5, ARENA_CENTER.y);
    arena.receiveShadow = true;
    this.group.add(arena);

    // --- glowing center seam down the path (emissive strip) ---
    const seam = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.06, pathLen),
      this.emissiveMat(0x2b6cff, 1.4),
    );
    seam.position.set(0, 0.04, pathLen / 2 - 8);
    this.group.add(seam);

    // --- side rails (low emissive curbs) ---
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, pathLen), this.emissiveMat(0x1b4fd0, 1.1));
      rail.position.set(sx * HALF_WIDTH, 0.35, pathLen / 2 - 8);
      this.group.add(rail);
      // tall dark containment wall behind the rail (reads as the void edge)
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 9, pathLen),
        new THREE.MeshStandardMaterial({ color: 0x05060d, roughness: 1, metalness: 0 }),
      );
      wall.position.set(sx * (HALF_WIDTH + 1.2), 4, pathLen / 2 - 8);
      this.group.add(wall);
    }

    // --- arch pillars along the path: emissive + co-located point light (light = glow) ---
    let ci = 0;
    for (let z = 18; z < ARENA_BLEND_Z; z += 28) {
      const color = NEON[ci++ % NEON.length];
      for (const sx of [-1, 1]) {
        const pillar = new THREE.Mesh(
          new THREE.CylinderGeometry(0.55, 0.8, 9, 8),
          this.emissiveMat(color, 1.0),
        );
        pillar.position.set(sx * (HALF_WIDTH - 0.6), 4.5, z);
        pillar.castShadow = true;
        this.group.add(pillar);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 10), this.emissiveMat(color, 2.2));
        cap.position.set(sx * (HALF_WIDTH - 0.6), 9, z);
        this.group.add(cap);
      }
      const light = new THREE.PointLight(color, 22, 34, 2);
      light.position.set(0, 7, z);
      this.group.add(light);
    }

    // --- gate barriers ---
    for (let i = 0; i < GATES_Z.length; i++) {
      const z = GATES_Z[i];
      const color = NEON[i % NEON.length];
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      this.barrierMat.push(mat);
      const barrier = new THREE.Mesh(new THREE.PlaneGeometry(HALF_WIDTH * 2, 8), mat);
      barrier.position.set(0, 4, z);
      this.group.add(barrier);
      // bright frame posts
      for (const sx of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, 0.6), this.emissiveMat(color, 2.4));
        post.position.set(sx * HALF_WIDTH, 4, z);
        this.group.add(post);
      }
      const light = new THREE.PointLight(color, 26, 30, 2);
      light.position.set(0, 4, z);
      this.group.add(light);
      this.gates.push({ z, triggerZ: z - 30, open: false, barrier, light });
    }

    // --- arena ring of tall pillars + a central dais ---
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      const color = NEON[a % NEON.length];
      const px = ARENA_CENTER.x + Math.cos(ang) * (ARENA_RADIUS + 1.5);
      const pz = ARENA_CENTER.y + Math.sin(ang) * (ARENA_RADIUS + 1.5);
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.0, 14, 8), this.emissiveMat(color, 0.9));
      pillar.position.set(px, 7, pz);
      pillar.castShadow = true;
      this.group.add(pillar);
    }
    const dais = new THREE.Mesh(
      new THREE.CylinderGeometry(8, 9, 0.6, 40),
      this.emissiveMat(0x7a3cff, 0.7),
    );
    dais.position.set(BOSS_ANCHOR.x, 0.3, BOSS_ANCHOR.z);
    this.group.add(dais);

    // --- glowing floor rungs down the path (depth cue + circuit read) ---
    for (let z = 6; z < ARENA_BLEND_Z; z += 10) {
      const rung = new THREE.Mesh(new THREE.BoxGeometry(HALF_WIDTH * 2 - 1, 0.05, 0.16), this.emissiveMat(0x1b4fd0, 0.7));
      rung.position.set(0, 0.03, z);
      this.group.add(rung);
    }

    // --- starfield backdrop (fog-immune so it reads behind the rift) ---
    const N = 520;
    const arr = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const ang = this.ctx.rng.range(0, Math.PI * 2);
      const elev = this.ctx.rng.range(0.05, 0.9);
      const r = this.ctx.rng.range(130, 175);
      arr[i * 3] = Math.cos(ang) * r * Math.cos(elev);
      arr[i * 3 + 1] = Math.sin(elev) * r;
      arr[i * 3 + 2] = ARENA_CENTER.y * 0.5 + Math.sin(ang) * r * Math.cos(elev);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x9fc8ff, size: 1.1, sizeAttenuation: true, transparent: true, opacity: 0.9, fog: false }));
    this.group.add(stars);

    scene.add(this.group);
  }

  private emissiveMat(color: number, intensity: number): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: 0x05060d, emissive: color, emissiveIntensity: intensity,
      roughness: 0.4, metalness: 0.2,
    });
  }

  /** Open a gate's barrier (wave cleared) — fade the plane, kill its light. */
  openGate(i: number): void {
    const g = this.gates[i];
    if (!g || g.open) return;
    g.open = true;
    g.light.intensity = 0;
    (g.barrier.material as THREE.MeshBasicMaterial).opacity = 0;
    g.barrier.visible = false;
  }

  /** Reset all gates to sealed (retry). */
  reset(): void {
    for (let i = 0; i < this.gates.length; i++) {
      const g = this.gates[i];
      g.open = false;
      g.light.intensity = 26;
      g.barrier.visible = true;
      (g.barrier.material as THREE.MeshBasicMaterial).opacity = 0.5;
    }
  }

  firstClosedGate(): Gate | null {
    for (const g of this.gates) if (!g.open) return g;
    return null;
  }

  inArena(z: number): boolean {
    return z >= ARENA_BLEND_Z;
  }

  /** Keep a body (player or enemy) inside the playable causeway + arena. Mutates pos. */
  clampPosition(pos: THREE.Vector3, radius: number): void {
    pos.z = Math.max(pos.z, START_Z + radius);
    const closed = this.firstClosedGate();
    if (closed && pos.z > closed.z - radius - 0.6) pos.z = closed.z - radius - 0.6;

    if (pos.z < ARENA_BLEND_Z) {
      pos.x = clamp(pos.x, -HALF_WIDTH + radius, HALF_WIDTH - radius);
    } else {
      const dx = pos.x - ARENA_CENTER.x;
      const dz = pos.z - ARENA_CENTER.y;
      const maxR = ARENA_RADIUS - radius;
      const d = Math.hypot(dx, dz);
      if (d > maxR) {
        pos.x = ARENA_CENTER.x + (dx / d) * maxR;
        pos.z = ARENA_CENTER.y + (dz / d) * maxR;
      }
    }
  }
}
