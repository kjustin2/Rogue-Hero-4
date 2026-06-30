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
  /** Iron portcullis grille — raised (hidden) when the gate opens. */
  portcullis: THREE.Group;
}

// warm, flame-lit palette — torch orange, amber, ember-red, gold
const EMBER = [0xff7a2c, 0xffb24a, 0xff5022, 0xffd480];

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
  private starMats: THREE.ShaderMaterial[] = [];
  private flames: { obj: THREE.Object3D; mat: THREE.MeshBasicMaterial; phase: number; light?: THREE.PointLight; lightBase: number }[] = [];
  private motes?: THREE.Points;
  private moteVel?: Float32Array;

  constructor(private ctx: Ctx) {}

  build(): void {
    const scene = this.ctx.stage.scene;
    this.group.clear();

    // --- path floor: damp flagstone with warm cracks glowing like buried embers ---
    const pathLen = ARENA_BLEND_Z + 14;
    const grid = this.makeStoneTexture();
    grid.repeat.set((HALF_WIDTH * 2) / 6, pathLen / 6);
    const gridN = this.makeStoneNormal();
    gridN.repeat.copy(grid.repeat);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x141015, roughness: 0.62, metalness: 0.2,
      map: grid, emissive: 0xff5a1e, emissiveMap: grid, emissiveIntensity: 0.85, envMapIntensity: 0.9,
      normalMap: gridN, normalScale: new THREE.Vector2(0.85, 0.85),
    });
    this.floorMats.push(floorMat);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(HALF_WIDTH * 2, 1, pathLen), floorMat);
    floor.position.set(0, -0.5, pathLen / 2 - 8);
    floor.receiveShadow = true;
    this.group.add(floor);

    // arena floor disc (its own stone scale so the flags stay square)
    const agrid = this.makeStoneTexture();
    agrid.repeat.set(ARENA_RADIUS / 4, ARENA_RADIUS / 4);
    const arenaMat = floorMat.clone();
    arenaMat.map = agrid;
    arenaMat.emissiveMap = agrid;
    const agridN = this.makeStoneNormal();
    agridN.repeat.copy(agrid.repeat);
    arenaMat.normalMap = agridN;
    this.floorMats.push(arenaMat);
    const arena = new THREE.Mesh(new THREE.CylinderGeometry(ARENA_RADIUS + 3, ARENA_RADIUS + 3, 1, 56), arenaMat);
    arena.position.set(ARENA_CENTER.x, -0.5, ARENA_CENTER.y);
    arena.receiveShadow = true;
    this.group.add(arena);

    // --- molten central channel running the path (a seam of fire toward the boss) ---
    const seam = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, pathLen), this.emissiveMat(0xff5a1e, 2.6));
    seam.position.set(0, 0.04, pathLen / 2 - 8);
    this.group.add(seam);

    // --- castle walls: mortared stone block texture (map + subtle emissive cracks) ---
    const wallTex = this.makeStoneWallTexture();
    wallTex.repeat.set(3, pathLen / 16);
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x2a221d, roughness: 0.92, metalness: 0.04,
      map: wallTex, emissive: 0xff5a1e, emissiveMap: wallTex, emissiveIntensity: 0.32, envMapIntensity: 0.7,
    });
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x100c0a, roughness: 0.6, metalness: 0.7, envMapIntensity: 1.0 });
    const bannerTex = this.makeBannerTexture();
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, pathLen), new THREE.MeshStandardMaterial({ color: 0x241d18, roughness: 0.9, metalness: 0.05 }));
      rail.position.set(sx * HALF_WIDTH, 0.45, pathLen / 2 - 8);
      this.group.add(rail);
      // tall stone containment wall + a stone crenellated top course + iron base band
      const wall = new THREE.Mesh(new THREE.BoxGeometry(1.4, 13, pathLen), wallMat);
      wall.position.set(sx * (HALF_WIDTH + 1.4), 5.5, pathLen / 2 - 8);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.group.add(wall);
      const cope = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, pathLen), ironMat);
      cope.position.set(sx * (HALF_WIDTH + 1.4), 12.1, pathLen / 2 - 8);
      this.group.add(cope);
      // crenellated battlements: stone merlons with gaps between them (castle silhouette)
      for (let z = 8; z < ARENA_BLEND_Z; z += 4.4) {
        const merlon = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.3, 1.9), wallMat);
        merlon.position.set(sx * (HALF_WIDTH + 1.4), 13.1, z);
        this.group.add(merlon);
      }
      const baseBand = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, pathLen), ironMat);
      baseBand.position.set(sx * (HALF_WIDTH + 1.3), 1.0, pathLen / 2 - 8);
      this.group.add(baseBand);
      // stone buttress pilasters every so often
      for (let z = 14; z < ARENA_BLEND_Z; z += 24) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.6, 11, 1.6), wallMat);
        rib.position.set(sx * (HALF_WIDTH + 0.5), 5.5, z);
        rib.castShadow = true;
        this.group.add(rib);
      }
      // wall sconce torches lining the causeway (emissive flame, bloom carries the glow)
      for (let z = 12; z < ARENA_BLEND_Z; z += 18) {
        const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.5), ironMat);
        bracket.position.set(sx * (HALF_WIDTH - 0.3), 6.4, z);
        this.group.add(bracket);
        const flame = this.makeFlame(0.85, false);
        flame.position.set(sx * (HALF_WIDTH - 0.55), 6.7, z);
        this.group.add(flame);
      }
      // hanging cloth banners with a sigil, between sconces
      for (let z = 30; z < ARENA_BLEND_Z; z += 54) {
        const banner = new THREE.Mesh(
          new THREE.PlaneGeometry(2.4, 5.5),
          new THREE.MeshStandardMaterial({ map: bannerTex, emissive: 0xff5a1e, emissiveMap: bannerTex, emissiveIntensity: 0.5, roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide }),
        );
        banner.position.set(sx * (HALF_WIDTH - 0.15), 7.4, z);
        banner.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
        this.group.add(banner);
      }
    }

    // --- stone path pillars topped with flaming braziers (the warm path light) ---
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x2a221d, roughness: 0.9, metalness: 0.05, envMapIntensity: 0.7 });
    let li = 0;
    for (let z = 18; z < ARENA_BLEND_Z; z += 28) {
      for (const sx of [-1, 1]) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.85, 9, 8), stoneMat);
        pillar.position.set(sx * (HALF_WIDTH - 0.6), 4.5, z);
        pillar.castShadow = true;
        const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.45, 0.7, 10), ironMat);
        bowl.position.set(sx * (HALF_WIDTH - 0.6), 9.2, z);
        const flame = this.makeFlame(1.15, li++ % 2 === 0); // alternate which braziers cast a real light
        flame.position.set(sx * (HALF_WIDTH - 0.6), 9.5, z);
        this.group.add(pillar, bowl, flame);
      }
    }

    // --- gate barriers ---
    for (let i = 0; i < GATES_Z.length; i++) {
      const z = GATES_Z[i];
      const color = EMBER[i % EMBER.length];
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

      // iron portcullis grille in front of the energy barrier — a real castle gate
      const portcullis = new THREE.Group();
      const nBars = 11;
      for (let b = 0; b < nBars; b++) {
        const bx = -HALF_WIDTH + (b / (nBars - 1)) * HALF_WIDTH * 2;
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 8, 6), ironMat);
        bar.position.set(bx, 4, 0);
        portcullis.add(bar);
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.6, 6), ironMat);
        spike.position.set(bx, -0.1, 0); spike.rotation.x = Math.PI;
        portcullis.add(spike);
      }
      for (const hy of [7.5, 4, 0.5]) {
        const cross = new THREE.Mesh(new THREE.BoxGeometry(HALF_WIDTH * 2, 0.24, 0.24), ironMat);
        cross.position.set(0, hy, 0);
        portcullis.add(cross);
      }
      portcullis.position.set(0, 0, z - 0.35);
      this.group.add(portcullis);

      this.gates.push({ z, triggerZ: z - 30, open: false, barrier, light, portcullis });
    }

    // --- arena ring of tall pillars + a central dais ---
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      const color = EMBER[a % EMBER.length];
      const px = ARENA_CENTER.x + Math.cos(ang) * (ARENA_RADIUS + 1.5);
      const pz = ARENA_CENTER.y + Math.sin(ang) * (ARENA_RADIUS + 1.5);
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.0, 14, 8), this.emissiveMat(color, 0.9));
      pillar.position.set(px, 7, pz);
      pillar.castShadow = true;
      this.group.add(pillar);
    }
    const dais = new THREE.Mesh(
      new THREE.CylinderGeometry(8, 9, 0.6, 40),
      this.emissiveMat(0xff5a1e, 0.8),
    );
    dais.position.set(BOSS_ANCHOR.x, 0.3, BOSS_ANCHOR.z);
    this.group.add(dais);

    // great stone braziers flanking the dais (emissive + bloom carry the light; no new PointLights)
    for (const sx of [-1, 1]) {
      const px = BOSS_ANCHOR.x + sx * 7;
      const pz = BOSS_ANCHOR.z - 9;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.1, 5.5, 8), stoneMat);
      col.position.set(px, 2.75, pz); col.castShadow = true;
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 0.6, 0.9, 12), ironMat);
      bowl.position.set(px, 5.7, pz);
      const fl = this.makeFlame(1.8, false);
      fl.position.set(px, 6.1, pz);
      this.group.add(col, bowl, fl);
    }

    // --- warm iron inlay strips across the flags (depth cue + wayfinding) ---
    for (let z = 6; z < ARENA_BLEND_Z; z += 10) {
      const rung = new THREE.Mesh(new THREE.BoxGeometry(HALF_WIDTH * 2 - 1, 0.05, 0.16), this.emissiveMat(0xff5a1e, 0.5));
      rung.position.set(0, 0.03, z);
      this.group.add(rung);
    }

    // --- gradient sky dome behind everything ---
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(190, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: {
          top: { value: new THREE.Color(0x140a06) },
          mid: { value: new THREE.Color(0x0c0704) },
          bot: { value: new THREE.Color(0x070403) },
          horizon: { value: new THREE.Color(0x5a2308) },
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

    // --- horizon fire-glow behind the arena (distant burning sky) ---
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(210, 100),
      new THREE.MeshBasicMaterial({ color: 0xff5a1e, transparent: true, opacity: 0.24, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
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

    // --- overhead stone arches spanning the causeway (grandeur + detail) ---
    const archDark = new THREE.MeshStandardMaterial({ color: 0x251e19, roughness: 0.9, metalness: 0.05, envMapIntensity: 0.7 });
    let ai = 0;
    for (let z = 30; z < ARENA_BLEND_Z; z += 36) {
      const color = EMBER[ai++ % EMBER.length];
      const r = HALF_WIDTH + 1.5;
      const arch = new THREE.Mesh(new THREE.TorusGeometry(r, 0.55, 8, 28, Math.PI), archDark);
      arch.position.set(0, 0, z); arch.castShadow = true;
      const archGlow = new THREE.Mesh(new THREE.TorusGeometry(r, 0.18, 8, 28, Math.PI), this.emissiveMat(color, 1.6));
      archGlow.position.set(0, 0, z + 0.02);
      const key = new THREE.Mesh(new THREE.OctahedronGeometry(0.6), this.emissiveMat(color, 2.4));
      key.position.set(0, r, z);
      this.group.add(arch, archGlow, key);
      // a hanging iron chandelier of flames under every other arch
      const idx = Math.round((z - 30) / 36);
      if (idx % 2 === 1) {
        const cy = 10.5;
        const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, r - cy, 4), archDark);
        chain.position.set(0, (r + cy) / 2, z);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.13, 6, 20), archDark);
        ring.rotation.x = Math.PI / 2; ring.position.set(0, cy, z);
        this.group.add(chain, ring);
        for (let c = 0; c < 4; c++) {
          const a = (c / 4) * Math.PI * 2;
          const fl = this.makeFlame(0.7, false);
          fl.position.set(Math.cos(a) * 1.7, cy + 0.05, z + Math.sin(a) * 1.7);
          this.group.add(fl);
        }
      }
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
    this.portalGlowMat = new THREE.MeshBasicMaterial({ map: this.makeGlowTexture(), color: 0xff5a1e, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.portalGlow = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), this.portalGlowMat);
    this.portalGlow.position.z = -0.6;
    portal.add(this.portalGlow);
    const pcore = new THREE.Mesh(new THREE.CircleGeometry(5, 48), new THREE.MeshBasicMaterial({ color: 0x1a0a04, side: THREE.DoubleSide }));
    portal.add(pcore);
    for (let i = 0; i < 5; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(5 + i * 2.1, 0.38 - i * 0.045, 10, 48), this.emissiveMat(EMBER[i % EMBER.length], 2.5 - i * 0.28));
      this.portalRings.push(ring);
      portal.add(ring);
    }
    portal.position.set(ARENA_CENTER.x, 12, ARENA_CENTER.y + 22);
    this.group.add(portal);

    // --- glowing arrow-slit windows high on the walls (inner firelight) ---
    for (const sx of [-1, 1]) {
      for (let z = 21; z < ARENA_BLEND_Z; z += 36) {
        const slitMat = this.emissiveMat(0xff7a2c, 1.1);
        this.panes.push(slitMat);
        const slit = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3, 0.5), slitMat);
        slit.position.set(sx * (HALF_WIDTH - 0.35), 8.6, z);
        this.group.add(slit);
      }
    }

    // --- rising embers drifting off the firelit causeway ---
    const M = 200;
    const mp = new Float32Array(M * 3);
    this.moteVel = new Float32Array(M);
    for (let i = 0; i < M; i++) {
      mp[i * 3] = this.ctx.rng.range(-HALF_WIDTH, HALF_WIDTH);
      mp[i * 3 + 1] = this.ctx.rng.range(0.5, 12);
      mp[i * 3 + 2] = this.ctx.rng.range(0, ARENA_BLEND_Z);
      this.moteVel[i] = this.ctx.rng.range(0.6, 1.6);
    }
    const mgeo = new THREE.BufferGeometry();
    mgeo.setAttribute("position", new THREE.BufferAttribute(mp, 3));
    this.motes = new THREE.Points(mgeo, new THREE.PointsMaterial({ color: 0xff9a44, size: 0.16, sizeAttenuation: true, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
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
    // twinkling / drifting stars
    for (let i = 0; i < this.starMats.length; i++) this.starMats[i].uniforms.uTime.value = t;
    // torch + brazier flicker (two incommensurate sines per flame = organic, not jitter)
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      const fl = 0.78 + 0.16 * Math.sin(t * 13 + f.phase) + 0.1 * Math.sin(t * 23 + f.phase * 1.7);
      f.obj.scale.set(0.9 + 0.1 * fl, fl, 0.9 + 0.1 * fl);
      f.mat.opacity = 0.6 + 0.35 * fl;
      if (f.light) f.light.intensity = f.lightBase * (0.65 + 0.5 * fl);
    }
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

  /** Canvas-painted mortared stone blocks, with a few faintly ember-lit cracks. */
  private makeStoneWallTexture(): THREE.CanvasTexture {
    const w = 256, h = 256;
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const g = cv.getContext("2d")!;
    g.fillStyle = "#1a1410";
    g.fillRect(0, 0, w, h);
    // running-bond courses: each course offset by half a block
    const rowH = 42, blockW = 64;
    for (let row = 0, y = 0; y < h; row++, y += rowH) {
      const off = (row % 2) * (blockW / 2);
      for (let x = -blockW; x < w + blockW; x += blockW) {
        const bx = x + off + 2, by = y + 2, bw = blockW - 4, bh = rowH - 4;
        // block face — slight per-block value variation for a hewn look
        const v = 26 + ((row * 7 + x) % 5) * 4;
        g.fillStyle = `rgb(${v + 12},${v + 4},${v - 2})`;
        g.fillRect(bx, by, bw, bh);
        // top-left highlight + bottom-right shadow bevel
        g.fillStyle = "rgba(255,210,170,0.06)"; g.fillRect(bx, by, bw, 3);
        g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(bx, by + bh - 3, bw, 3);
      }
    }
    // a handful of ember-lit cracks (these glow via emissiveMap)
    g.strokeStyle = "rgba(255,110,40,0.8)"; g.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const x = (i * 53) % w, y = (i * 97) % h;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 18 - i * 4, y + 26); g.lineTo(x + 6, y + 48); g.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    return tex;
  }

  /** Hanging cloth banner: dark field, gold border, a simple chevron sigil. */
  private makeBannerTexture(): THREE.CanvasTexture {
    const w = 128, h = 256;
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const g = cv.getContext("2d")!;
    g.fillStyle = "#3a1208"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#5a1c0a"; g.fillRect(8, 0, w - 16, h);
    g.strokeStyle = "#ffb24a"; g.lineWidth = 5; g.strokeRect(12, 6, w - 24, h - 12);
    // sigil: stacked chevrons + a central diamond
    g.fillStyle = "#ffce6a";
    for (let i = 0; i < 3; i++) {
      const cy = 70 + i * 46;
      g.beginPath();
      g.moveTo(w / 2, cy); g.lineTo(w / 2 + 26, cy + 22); g.lineTo(w / 2 + 18, cy + 22);
      g.lineTo(w / 2, cy + 8); g.lineTo(w / 2 - 18, cy + 22); g.lineTo(w / 2 - 26, cy + 22);
      g.closePath(); g.fill();
    }
    g.beginPath(); g.moveTo(w / 2, 30); g.lineTo(w / 2 + 16, 48); g.lineTo(w / 2, 66); g.lineTo(w / 2 - 16, 48); g.closePath(); g.fill();
    return new THREE.CanvasTexture(cv);
  }

  /** Low-poly stylized flame (stacked additive cones) + optional flickering torch light. */
  private makeFlame(scale: number, withLight: boolean): THREE.Group {
    const grp = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xff7a1e, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const outer = new THREE.Mesh(new THREE.ConeGeometry(0.34 * scale, 1.2 * scale, 7), mat);
    outer.position.y = 0.6 * scale;
    const inner = new THREE.Mesh(
      new THREE.ConeGeometry(0.17 * scale, 0.74 * scale, 7),
      new THREE.MeshBasicMaterial({ color: 0xffe39a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    inner.position.y = 0.46 * scale;
    grp.add(outer, inner);
    const lightBase = 15 * scale;
    let light: THREE.PointLight | undefined;
    if (withLight) {
      light = new THREE.PointLight(0xff7a2c, lightBase, 22, 2);
      light.position.y = 0.9 * scale;
      grp.add(light);
    }
    this.flames.push({ obj: grp, mat, phase: this.ctx.rng.range(0, Math.PI * 2), light, lightBase });
    return grp;
  }

  /** Twinkling, drifting starfield material (per-star phase) — uTime advanced in update. */
  private makeStarMaterial(size: number): THREE.ShaderMaterial {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uTime: { value: 0 }, uSize: { value: size } },
      vertexShader:
        "attribute float aPhase; attribute vec3 color; uniform float uTime; uniform float uSize;" +
        "varying vec3 vColor; varying float vTw;" +
        "void main(){ vColor = color; float tw = 0.5 + 0.5 * sin(uTime * 1.8 + aPhase * 6.2831); vTw = tw;" +
        "vec3 p = position; p.y += sin(uTime * 0.15 + aPhase * 6.2831) * 1.5;" +
        "vec4 mv = modelViewMatrix * vec4(p, 1.0);" +
        "gl_PointSize = max(1.0, uSize * (0.55 + 0.9 * tw) * (260.0 / -mv.z));" +
        "gl_Position = projectionMatrix * mv; }",
      fragmentShader:
        "varying vec3 vColor; varying float vTw;" +
        "void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard;" +
        "float a = smoothstep(0.5, 0.0, r) * (0.3 + 0.7 * vTw); gl_FragColor = vec4(vColor, a); }",
    });
    this.starMats.push(mat);
    return mat;
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

  /** Painted nebula blotches (ember/amber/smoke) — additive burning-sky band behind the arena. */
  private makeNebulaTexture(): THREE.CanvasTexture {
    const w = 512, h = 256;
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const g = cv.getContext("2d")!;
    g.fillStyle = "#000";
    g.fillRect(0, 0, w, h);
    const cols = ["rgba(220,110,40,", "rgba(180,60,30,", "rgba(240,170,70,", "rgba(120,50,120,"];
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
      grad.addColorStop(0.5, "rgba(255,170,70,0.95)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(w * 0.28, y - 44, w * 0.44, 88);
    }
    return new THREE.CanvasTexture(cv);
  }

  private makeStars(count: number, size: number, tinted: boolean): THREE.Points {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    const tints = [new THREE.Color(0xffd9a0), new THREE.Color(0xffb46a), new THREE.Color(0xff8a4a), new THREE.Color(0xfff0d8)];
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
      phase[i] = this.ctx.rng.next();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    return new THREE.Points(geo, this.makeStarMaterial(size));
  }

  private emissiveMat(color: number, intensity: number): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: 0x05060d, emissive: color, emissiveIntensity: intensity,
      roughness: 0.35, metalness: 0.45, envMapIntensity: 0.8,
    });
  }

  // Shared flagstone layout (running bond) so the albedo + normal map align exactly.
  private static readonly STONE_S = 512;
  private static readonly STONE_ROW = 104;
  private static readonly STONE_COL = 128;
  private static readonly STONE_GAP = 9;
  /** Walk every flagstone rect once; fn paints into whichever canvas. Deterministic. */
  private eachFlag(fn: (bx: number, by: number, bw: number, bh: number, row: number, col: number) => void): void {
    const { STONE_S: s, STONE_ROW: rowH, STONE_COL: blockW, STONE_GAP: gap } = Level;
    for (let row = 0, y = 0; y < s; row++, y += rowH) {
      const off = (row % 2) * (blockW / 2);
      for (let col = 0, x = -blockW; x < s + blockW; col++, x += blockW) {
        fn(x + off + gap / 2, y + gap / 2, blockW - gap, rowH - gap, row, col);
      }
    }
  }

  /**
   * Canvas-painted flagstone floor — hewn ashlar blocks in a running-bond course with
   * grime speckle, hewn bevels and ember-lit mortar/cracks (used as emissiveMap), so the
   * floor reads as old cracked stone lit from within by buried embers, not a neon grid.
   */
  private makeStoneTexture(): THREE.CanvasTexture {
    const s = Level.STONE_S;
    const cv = document.createElement("canvas");
    cv.width = cv.height = s;
    const g = cv.getContext("2d")!;
    // mortar base (glows warm via emissiveMap)
    g.fillStyle = "#52210f";
    g.fillRect(0, 0, s, s);
    this.eachFlag((bx, by, bw, bh, row, col) => {
      // hewn stone face — per-block value + slight warm/cool grain
      const v = 28 + ((row * 7 + col * 3) % 5) * 5;
      g.fillStyle = `rgb(${v + 8},${v + 1},${v - 5})`;
      g.fillRect(bx, by, bw, bh);
      // grime / aggregate speckle scattered over the face
      for (let i = 0; i < 26; i++) {
        const px = bx + ((row * 31 + col * 17 + i * 53) % bw);
        const py = by + ((col * 29 + row * 19 + i * 37) % bh);
        const d = (i % 3) - 1; // -1 dark fleck, 0 mid, +1 light fleck
        g.fillStyle = d < 0 ? "rgba(0,0,0,0.22)" : d > 0 ? "rgba(255,210,160,0.07)" : "rgba(120,70,40,0.10)";
        g.fillRect(px, py, 2, 2);
      }
      // hewn bevel: warm top-left highlight, deep bottom-right shadow
      g.fillStyle = "rgba(255,205,155,0.08)"; g.fillRect(bx, by, bw, 4); g.fillRect(bx, by, 4, bh);
      g.fillStyle = "rgba(0,0,0,0.42)"; g.fillRect(bx, by + bh - 4, bw, 4); g.fillRect(bx + bw - 4, by, 4, bh);
      // a worn ember-lit crack across about a third of the blocks (glows via emissiveMap)
      if ((row * 5 + col * 3) % 3 === 0) {
        g.strokeStyle = "rgba(255,120,45,0.55)"; g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(bx + bw * 0.28, by); g.lineTo(bx + bw * 0.42, by + bh * 0.45);
        g.lineTo(bx + bw * 0.34, by + bh * 0.72); g.lineTo(bx + bw * 0.5, by + bh); g.stroke();
      }
    });
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    return tex;
  }

  /**
   * Matching tangent-space normal map for the flagstones (aligned to makeStoneTexture
   * via eachFlag): each block is pillowed with beveled edges so the stone catches the
   * moving torch/brazier light in real relief. Flat = (128,128,255).
   */
  private makeStoneNormal(): THREE.CanvasTexture {
    const s = Level.STONE_S;
    const cv = document.createElement("canvas");
    cv.width = cv.height = s;
    const g = cv.getContext("2d")!;
    g.fillStyle = "rgb(128,128,255)"; // flat
    g.fillRect(0, 0, s, s);
    const bvl = 11;
    this.eachFlag((bx, by, bw, bh) => {
      g.fillStyle = "rgb(128,128,255)"; g.fillRect(bx, by, bw, bh); // flat face
      g.fillStyle = "rgb(128,184,236)"; g.fillRect(bx, by, bw, bvl);            // top edge → +Y
      g.fillStyle = "rgb(128,72,236)";  g.fillRect(bx, by + bh - bvl, bw, bvl); // bottom edge → -Y
      g.fillStyle = "rgb(184,128,236)"; g.fillRect(bx, by, bvl, bh);            // left edge → +X
      g.fillStyle = "rgb(72,128,236)";  g.fillRect(bx + bw - bvl, by, bvl, bh); // right edge → -X
    });
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.NoColorSpace; // normal data, not color — don't sRGB-decode
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
    g.portcullis.visible = false; // grille raises out of sight
  }

  /** Reset all gates to sealed (retry). */
  reset(): void {
    for (let i = 0; i < this.gates.length; i++) {
      const g = this.gates[i];
      g.open = false;
      g.light.intensity = 26;
      g.barrier.visible = true;
      g.portcullis.visible = true;
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
