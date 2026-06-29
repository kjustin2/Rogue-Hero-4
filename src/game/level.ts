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

    // --- path floor: glossy reflective slab with a glowing neon-grid texture ---
    const pathLen = ARENA_BLEND_Z + 14;
    const grid = this.makeGridTexture();
    grid.repeat.set((HALF_WIDTH * 2) / 6, pathLen / 6);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0a0e1a, roughness: 0.3, metalness: 0.82,
      map: grid, emissive: 0x3370ff, emissiveMap: grid, emissiveIntensity: 0.6, envMapIntensity: 1.2,
    });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(HALF_WIDTH * 2, 1, pathLen), floorMat);
    floor.position.set(0, -0.5, pathLen / 2 - 8);
    floor.receiveShadow = true;
    this.group.add(floor);

    // arena floor disc (its own grid scale so the cells stay square)
    const agrid = this.makeGridTexture();
    agrid.repeat.set(ARENA_RADIUS / 4, ARENA_RADIUS / 4);
    const arenaMat = floorMat.clone();
    arenaMat.map = agrid;
    arenaMat.emissiveMap = agrid;
    const arena = new THREE.Mesh(new THREE.CylinderGeometry(ARENA_RADIUS + 3, ARENA_RADIUS + 3, 1, 56), arenaMat);
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
      // tall paneled containment wall: dark metal (reflects env) + glowing top trim + ribs
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 13, pathLen),
        new THREE.MeshStandardMaterial({ color: 0x070912, roughness: 0.55, metalness: 0.6, envMapIntensity: 0.9 }),
      );
      wall.position.set(sx * (HALF_WIDTH + 1.4), 5.5, pathLen / 2 - 8);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.group.add(wall);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, pathLen), this.emissiveMat(0x2b6cff, 1.7));
      trim.position.set(sx * (HALF_WIDTH + 0.95), 11.9, pathLen / 2 - 8);
      this.group.add(trim);
      for (let z = 14; z < ARENA_BLEND_Z; z += 24) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.35, 9, 0.5), this.emissiveMat(NEON[((z / 24) | 0) % NEON.length], 1.1));
        rib.position.set(sx * (HALF_WIDTH + 0.72), 5.5, z);
        this.group.add(rib);
      }
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

    // --- gradient sky dome behind everything ---
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(190, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: {
          top: { value: new THREE.Color(0x0b1838) },
          mid: { value: new THREE.Color(0x090a1a) },
          bot: { value: new THREE.Color(0x05060d) },
          horizon: { value: new THREE.Color(0x1a3f7e) },
        },
        vertexShader: "varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        fragmentShader:
          "varying vec3 vp; uniform vec3 top; uniform vec3 mid; uniform vec3 bot; uniform vec3 horizon;" +
          "void main(){ float h = normalize(vp).y;" +
          "vec3 c = h > 0.0 ? mix(mix(horizon, mid, clamp(h*3.0,0.0,1.0)), top, clamp(h,0.0,1.0)) : mix(horizon, bot, clamp(-h*2.0,0.0,1.0));" +
          "gl_FragColor = vec4(c, 1.0); }",
      }),
    );
    sky.position.set(ARENA_CENTER.x, 0, 110);
    this.group.add(sky);

    // --- horizon rift-glow behind the arena ---
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 80),
      new THREE.MeshBasicMaterial({ color: 0x2b59c8, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    glow.position.set(ARENA_CENTER.x, 22, ARENA_CENTER.y + 48);
    this.group.add(glow);

    // --- two starfield layers (fog-immune): bright tinted + faint dense ---
    this.group.add(this.makeStars(300, 1.6, true));
    this.group.add(this.makeStars(620, 0.7, false));

    scene.add(this.group);
  }

  private makeStars(count: number, size: number, tinted: boolean): THREE.Points {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const tints = [new THREE.Color(0xbfe0ff), new THREE.Color(0xc9a8ff), new THREE.Color(0xff9ec8), new THREE.Color(0xffffff)];
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const ang = this.ctx.rng.range(0, Math.PI * 2);
      const elev = this.ctx.rng.range(0.04, 0.95);
      const r = this.ctx.rng.range(130, 180);
      pos[i * 3] = Math.cos(ang) * r * Math.cos(elev);
      pos[i * 3 + 1] = Math.sin(elev) * r;
      pos[i * 3 + 2] = 110 + Math.sin(ang) * r * Math.cos(elev);
      c.copy(tinted ? tints[this.ctx.rng.int(0, tints.length - 1)] : tints[0]).multiplyScalar(this.ctx.rng.range(0.55, 1));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({ size, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.95, fog: false, depthWrite: false }));
  }

  private emissiveMat(color: number, intensity: number): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: 0x05060d, emissive: color, emissiveIntensity: intensity,
      roughness: 0.35, metalness: 0.45, envMapIntensity: 0.8,
    });
  }

  /** Canvas-painted neon grid — used as both map and emissiveMap so the lines glow. */
  private makeGridTexture(): THREE.CanvasTexture {
    const s = 256;
    const cv = document.createElement("canvas");
    cv.width = cv.height = s;
    const g = cv.getContext("2d")!;
    g.fillStyle = "#070a14";
    g.fillRect(0, 0, s, s);
    // soft inner glow
    const grad = g.createRadialGradient(s / 2, s / 2, 10, s / 2, s / 2, s / 1.4);
    grad.addColorStop(0, "rgba(40,90,200,0.10)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    // grid border + cross
    g.strokeStyle = "#3a78f0";
    g.lineWidth = 4;
    g.strokeRect(2, 2, s - 4, s - 4);
    g.globalAlpha = 0.5;
    g.beginPath();
    g.moveTo(s / 2, 0); g.lineTo(s / 2, s); g.moveTo(0, s / 2); g.lineTo(s, s / 2);
    g.stroke();
    g.globalAlpha = 1;
    // corner nodes
    g.fillStyle = "#6fb0ff";
    for (const [x, y] of [[2, 2], [s - 2, 2], [2, s - 2], [s - 2, s - 2]]) {
      g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    return tex;
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
