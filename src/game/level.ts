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
  private vt = 0;
  private flowTex?: THREE.Texture;
  private portalRings: THREE.Mesh[] = [];
  private portalGlow?: THREE.Mesh;
  private portalGlowMat?: THREE.MeshBasicMaterial;
  private floorMats: THREE.MeshStandardMaterial[] = [];
  private panes: THREE.MeshStandardMaterial[] = [];
  private motes?: THREE.Points;
  private moteVel?: Float32Array;

  constructor(private ctx: Ctx) {}

  build(): void {
    const scene = this.ctx.stage.scene;
    this.group.clear();

    // --- path floor: glossy reflective slab with a glowing neon-grid texture ---
    const pathLen = ARENA_BLEND_Z + 14;
    const grid = this.makeGridTexture();
    grid.repeat.set((HALF_WIDTH * 2) / 6, pathLen / 6);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x080c18, roughness: 0.18, metalness: 0.88,
      map: grid, emissive: 0x3a86ff, emissiveMap: grid, emissiveIntensity: 1.05, envMapIntensity: 1.5,
    });
    this.floorMats.push(floorMat);
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
    this.floorMats.push(arenaMat);
    const arena = new THREE.Mesh(new THREE.CylinderGeometry(ARENA_RADIUS + 3, ARENA_RADIUS + 3, 1, 56), arenaMat);
    arena.position.set(ARENA_CENTER.x, -0.5, ARENA_CENTER.y);
    arena.receiveShadow = true;
    this.group.add(arena);

    // --- glowing center seam down the path (emissive strip) ---
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, pathLen), this.emissiveMat(0x3a86ff, 2.4));
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
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, pathLen), this.emissiveMat(0x4a9bff, 2.6));
      trim.position.set(sx * (HALF_WIDTH + 0.95), 11.9, pathLen / 2 - 8);
      this.group.add(trim);
      // a second, lower accent line of light running the wall
      const accent = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, pathLen), this.emissiveMat(0x2b6cff, 1.8));
      accent.position.set(sx * (HALF_WIDTH + 0.95), 2.4, pathLen / 2 - 8);
      this.group.add(accent);
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
      new THREE.PlaneGeometry(210, 100),
      new THREE.MeshBasicMaterial({ color: 0x3a6cff, transparent: true, opacity: 0.26, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    glow.position.set(ARENA_CENTER.x, 26, ARENA_CENTER.y + 48);
    this.group.add(glow);

    // --- big soft nebula band high behind the arena (color + depth) ---
    const nebula = new THREE.Mesh(
      new THREE.PlaneGeometry(260, 120),
      new THREE.MeshBasicMaterial({ map: this.makeNebulaTexture(), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    nebula.position.set(ARENA_CENTER.x, 36, ARENA_CENTER.y + 54);
    this.group.add(nebula);

    // --- two starfield layers (fog-immune): bright tinted + faint dense ---
    this.group.add(this.makeStars(340, 2.2, true));
    this.group.add(this.makeStars(660, 1.0, false));

    // --- overhead arches spanning the causeway (grandeur + detail) ---
    const archDark = new THREE.MeshStandardMaterial({ color: 0x0c0e18, roughness: 0.5, metalness: 0.72, envMapIntensity: 1.0 });
    let ai = 0;
    for (let z = 30; z < ARENA_BLEND_Z; z += 36) {
      const color = NEON[ai++ % NEON.length];
      const r = HALF_WIDTH + 1.5;
      const arch = new THREE.Mesh(new THREE.TorusGeometry(r, 0.55, 8, 28, Math.PI), archDark);
      arch.position.set(0, 0, z); arch.castShadow = true;
      const archGlow = new THREE.Mesh(new THREE.TorusGeometry(r, 0.18, 8, 28, Math.PI), this.emissiveMat(color, 1.6));
      archGlow.position.set(0, 0, z + 0.02);
      const key = new THREE.Mesh(new THREE.OctahedronGeometry(0.6), this.emissiveMat(color, 2.4));
      key.position.set(0, r, z);
      this.group.add(arch, archGlow, key);
    }

    // --- flowing energy layer over the central seam (scrolls toward the boss) ---
    this.flowTex = this.makeFlowTexture();
    this.flowTex.wrapS = this.flowTex.wrapT = THREE.RepeatWrapping;
    this.flowTex.repeat.set(1, pathLen / 10);
    const flow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, pathLen),
      new THREE.MeshBasicMaterial({ map: this.flowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85, fog: false }),
    );
    flow.rotation.x = -Math.PI / 2;
    flow.position.set(0, 0.08, pathLen / 2 - 8);
    this.group.add(flow);

    // --- giant rift portal behind the boss ---
    const portal = new THREE.Group();
    // soft additive glow disc behind the rings (pulses in update)
    this.portalGlowMat = new THREE.MeshBasicMaterial({ map: this.makeGlowTexture(), color: 0x7a4cff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.portalGlow = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), this.portalGlowMat);
    this.portalGlow.position.z = -0.6;
    portal.add(this.portalGlow);
    const pcore = new THREE.Mesh(new THREE.CircleGeometry(5, 48), new THREE.MeshBasicMaterial({ color: 0x1a0b34, side: THREE.DoubleSide }));
    portal.add(pcore);
    for (let i = 0; i < 5; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(5 + i * 2.1, 0.38 - i * 0.045, 10, 48), this.emissiveMat(NEON[i % NEON.length], 2.5 - i * 0.28));
      this.portalRings.push(ring);
      portal.add(ring);
    }
    portal.position.set(ARENA_CENTER.x, 12, ARENA_CENTER.y + 22);
    this.group.add(portal);

    // --- wall buttresses + emissive window panels ---
    for (const sx of [-1, 1]) {
      for (let z = 8; z < ARENA_BLEND_Z; z += 18) {
        const but = new THREE.Mesh(new THREE.BoxGeometry(0.8, 11, 1.6), archDark);
        but.position.set(sx * (HALF_WIDTH + 0.2), 5.5, z); but.castShadow = true;
        const paneMat = this.emissiveMat(NEON[((z / 18) | 0) % NEON.length], 1.3);
        this.panes.push(paneMat);
        const pane = new THREE.Mesh(new THREE.BoxGeometry(0.2, 5, 1.2), paneMat);
        pane.position.set(sx * (HALF_WIDTH - 0.4), 6.2, z + 9);
        this.group.add(but, pane);
      }
    }

    // --- drifting ambient motes ---
    const M = 160;
    const mp = new Float32Array(M * 3);
    this.moteVel = new Float32Array(M);
    for (let i = 0; i < M; i++) {
      mp[i * 3] = this.ctx.rng.range(-HALF_WIDTH, HALF_WIDTH);
      mp[i * 3 + 1] = this.ctx.rng.range(0.5, 12);
      mp[i * 3 + 2] = this.ctx.rng.range(0, ARENA_BLEND_Z);
      this.moteVel[i] = this.ctx.rng.range(0.3, 1.0);
    }
    const mgeo = new THREE.BufferGeometry();
    mgeo.setAttribute("position", new THREE.BufferAttribute(mp, 3));
    this.motes = new THREE.Points(mgeo, new THREE.PointsMaterial({ color: 0x7fb4ff, size: 0.13, sizeAttenuation: true, transparent: true, opacity: 0.7, depthWrite: false, fog: false }));
    this.group.add(this.motes);

    scene.add(this.group);
  }

  /** Animate the living environment — flowing floor energy, portal, panels, motes. */
  update(dt: number): void {
    this.vt += dt;
    const t = this.vt;
    if (this.flowTex) this.flowTex.offset.y = (this.flowTex.offset.y - dt * 0.4) % 1;
    for (let i = 0; i < this.portalRings.length; i++) {
      const r = this.portalRings[i];
      r.rotation.z += dt * (0.2 + i * 0.1) * (i % 2 ? -1 : 1);
      (r.material as THREE.MeshStandardMaterial).emissiveIntensity = (2.5 - i * 0.28) * (0.8 + 0.3 * Math.sin(t * 1.6 + i));
    }
    if (this.portalGlow && this.portalGlowMat) {
      this.portalGlow.scale.setScalar(1 + 0.07 * Math.sin(t * 1.3));
      this.portalGlowMat.opacity = 0.7 + 0.25 * (0.5 + 0.5 * Math.sin(t * 1.3));
    }
    // subtle floor + wall-panel breathing so the whole map feels alive
    for (let i = 0; i < this.floorMats.length; i++) this.floorMats[i].emissiveIntensity = 0.95 + 0.22 * Math.sin(t * 0.8);
    for (let i = 0; i < this.panes.length; i++) this.panes[i].emissiveIntensity = 1.0 + 0.8 * (0.5 + 0.5 * Math.sin(t * 1.5 + i * 0.7));
    if (this.motes && this.moteVel) {
      const pos = this.motes.geometry.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < this.moteVel.length; i++) {
        arr[i * 3 + 1] += this.moteVel[i] * dt;
        if (arr[i * 3 + 1] > 13) arr[i * 3 + 1] = 0.3;
      }
      pos.needsUpdate = true;
    }
  }

  /** Soft white radial — tinted per-material for the portal glow disc. */
  private makeGlowTexture(): THREE.CanvasTexture {
    const s = 128;
    const cv = document.createElement("canvas");
    cv.width = cv.height = s;
    const g = cv.getContext("2d")!;
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, "rgba(255,255,255,0.95)");
    grad.addColorStop(0.4, "rgba(255,255,255,0.32)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    return new THREE.CanvasTexture(cv);
  }

  /** Painted nebula blotches (purple/blue/pink) — additive band behind the arena. */
  private makeNebulaTexture(): THREE.CanvasTexture {
    const w = 512, h = 256;
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const g = cv.getContext("2d")!;
    g.fillStyle = "#000";
    g.fillRect(0, 0, w, h);
    const cols = ["rgba(96,64,205,", "rgba(44,92,210,", "rgba(205,72,162,", "rgba(64,184,212,"];
    for (let i = 0; i < 28; i++) {
      const x = this.ctx.rng.range(0, w);
      const y = this.ctx.rng.range(h * 0.08, h * 0.92);
      const r = this.ctx.rng.range(42, 128);
      const a = this.ctx.rng.range(0.05, 0.22);
      const c = cols[this.ctx.rng.int(0, cols.length - 1)];
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, c + a.toFixed(3) + ")");
      grad.addColorStop(1, c + "0)");
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    return new THREE.CanvasTexture(cv);
  }

  private makeFlowTexture(): THREE.CanvasTexture {
    const w = 64, h = 256;
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const g = cv.getContext("2d")!;
    g.fillStyle = "#000";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5; i++) {
      const y = (i / 5) * h + 12;
      const grad = g.createLinearGradient(0, y - 44, 0, y + 44);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(0.5, "rgba(130,205,255,0.95)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(w * 0.28, y - 44, w * 0.44, 88);
    }
    return new THREE.CanvasTexture(cv);
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
