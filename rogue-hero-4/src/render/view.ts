import * as THREE from 'three';
import { World } from '../sim/world';
import { Bus } from '../bus';
import { ARENA, NEON } from '../content';
import { GLYPHS } from '../sim/weave';
import { loadModels, neonMat, tintPlayer, buildEnemy, type Models } from './models';

interface Particle { spr: THREE.Sprite; vx: number; vy: number; vz: number; life: number; max: number; size: number; }

const UP = 0.9; // entity hover height
const ENEMY_FIRE = 0xff5a2a; // ALL enemy fire is hot-orange so friend/foe reads instantly
const WHITE = new THREE.Color(0xffffff);
const HURT = new THREE.Color(0xff3b5c);
const ZONECOL = new THREE.Color(); // scratch for the hero's tempo-zone tint

export class View {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  models!: Models;
  ready = false;
  private world: World;
  private bus: Bus;
  private lowfx: boolean;

  private playerMesh = new THREE.Group();
  private playerRing: THREE.Mesh;     // glowing disc under the hero — makes it unmissable
  private aimDart: THREE.Mesh;        // forward chevron showing facing/aim
  private playerLight: THREE.PointLight;
  private heroAura!: THREE.Mesh;      // soft energy shell around the hero
  private heroCore!: THREE.Mesh;      // bright energy core in the hero's chest
  private heroShards: THREE.Mesh[] = []; // orbiting energy shards (life/animation)
  private castPunch = 0;              // cast recoil/anticipation timer
  private dashT = 0;                  // dash stretch/afterimage timer
  private hurtT = 0;                  // hurt flinch timer (set on player:hurt)
  private bossMesh: THREE.Object3D | null = null;
  private bossRing: THREE.Mesh;
  private enemyMeshes = new Map<number, THREE.Group>();
  private projPool: THREE.Mesh[] = [];
  private orbPool: THREE.Object3D[] = [];
  private parts: Particle[] = [];
  private partCursor = 0;
  private portal: THREE.Mesh;
  private reticle: THREE.Mesh;
  private grid: THREE.GridHelper;
  private floorGlow: THREE.Mesh;
  private floorMat!: THREE.MeshStandardMaterial;
  private hemi: THREE.HemisphereLight;
  private walls: THREE.Mesh[] = [];
  private pillars: THREE.Mesh[] = [];
  private ringGeo = new THREE.RingGeometry(0.78, 1.05, 28);
  private teleGeo = new THREE.CircleGeometry(1, 36);
  private telePool: { mesh: THREE.Mesh; t: number; dur: number; r: number }[] = [];
  // combat-FX pools: expanding shockwave rings, melee slash arcs, death shatter shards
  private shockGeo = new THREE.RingGeometry(0.78, 1.0, 48);
  private shockPool: { mesh: THREE.Mesh; t: number; dur: number; maxR: number }[] = [];
  private slashGeo = new THREE.RingGeometry(0.55, 1.0, 24, 1, -0.7, 1.4); // crescent arc
  private slashPool: { mesh: THREE.Mesh; t: number; dur: number }[] = [];
  private shatterGeo = new THREE.TetrahedronGeometry(0.28);
  private shatterPool: { mesh: THREE.Mesh; vx: number; vy: number; vz: number; t: number; dur: number }[] = [];
  private shatterCursor = 0;

  cinematic = false; // when true, the camera is driven externally (cutscene / title orbit)
  camYaw = 0;                // orbit angle of the chase cam (player-controlled + auto-framed)
  camZoom = 1;               // mouse-wheel zoom (WoW-style): scales height + distance
  private manualT = 0;       // >0 = player is steering the camera; pauses auto-frame
  private shakeT = 0;
  private camTarget = new THREE.Vector3();
  private scratch = new THREE.Vector3();
  private charColor = NEON.amber;

  constructor(world: World, bus: Bus, lowfx: boolean) {
    this.world = world; this.bus = bus; this.lowfx = lowfx;
    this.camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 600);
    this.camera.position.set(0, 8, 14);

    // deep-space backdrop: a lit indigo gradient + starfield so the sky reads as a place, not a void
    this.scene.background = gradientTex(0x241a5c, 0x1a1244, 0x0c0726);
    this.scene.fog = new THREE.FogExp2(0x1a1448, 0.014);
    this.scene.add(starfield());

    // Lighting that REVEALS FORM without washing the wet floor: a warm directional KEY gives a
    // light→shadow gradient across curved surfaces; a cool hemisphere fills shadows without going
    // flat; ONE low magenta back-RIM separates silhouettes from the neon background. (Strong/extra
    // rims blew specular hotspots off the reflective metal floor — kept subtle on purpose.)
    this.hemi = new THREE.HemisphereLight(0xaecbff, 0x241038, 0.95);
    this.scene.add(this.hemi);
    const key = new THREE.DirectionalLight(0xffe6cf, 1.1);
    key.position.set(11, 24, 13); this.scene.add(key);
    key.castShadow = true; key.shadow.mapSize.set(1536, 1536);
    key.shadow.camera.near = 2; key.shadow.camera.far = 90;
    const SC = key.shadow.camera; SC.left = -ARENA; SC.right = ARENA; SC.top = ARENA; SC.bottom = -ARENA; SC.updateProjectionMatrix();
    key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02;
    const rim = new THREE.DirectionalLight(0xff7ccf, 0.4); // subtle magenta back-rim for silhouette separation
    rim.position.set(-7, 9, -24); this.scene.add(rim);

    // detailed paneled/circuit floor (procedural texture = albedo + glowing emissive seams),
    // so the arena reads as a built surface, not a flat plane. Seams are white in the texture
    // and tinted per-biome via the emissive colour.
    // REFLECTIVE floor (high metalness + low roughness) catches the neon IBL env -> the iconic
    // wet-arena sheen; the circuit texture is albedo + glowing emissive seams.
    const ftex = floorTex();
    this.floorMat = new THREE.MeshStandardMaterial({ map: ftex, emissiveMap: ftex, emissive: NEON.mag, emissiveIntensity: 0.55, roughness: 0.16, metalness: 0.9, envMapIntensity: 1.9 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA * 2.4, ARENA * 2.4), this.floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.02; floor.receiveShadow = true; this.scene.add(floor);

    // a cool violet floor glow (NOT the biome accent) so the floor stays indigo, not monochrome
    this.floorGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA * 2, ARENA * 2),
      new THREE.MeshBasicMaterial({ map: radialTex(0x6a4cff), transparent: true, opacity: 0.38, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.floorGlow.rotation.x = -Math.PI / 2; this.floorGlow.position.y = 0.01; this.scene.add(this.floorGlow);

    this.grid = new THREE.GridHelper(ARENA * 2, 24, 0xff6cf2, 0x3a2370);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.18; // subtle — the floor texture carries the panel detail
    this.grid.position.y = 0.02; this.scene.add(this.grid);

    // arena walls: tall textured body + a bright top rail AND a base glow band (children at
    // LOCAL y offsets) — a layered lit structure, not a flat slab.
    const wtex = wallTex();
    const WH = 7.5;
    for (let i = 0; i < 4; i++) {
      const horiz = i < 2;
      const len = ARENA * 2;
      const wx = horiz ? 0 : (i === 2 ? -ARENA : ARENA);
      const wz = horiz ? (i === 0 ? -ARENA : ARENA) : 0;
      const w = new THREE.Mesh(new THREE.BoxGeometry(horiz ? len : 0.8, WH, horiz ? 0.8 : len),
        new THREE.MeshStandardMaterial({ color: 0x120a2c, emissive: NEON.mag, emissiveIntensity: 0.55, roughness: 0.5, metalness: 0.45, map: wtex, emissiveMap: wtex }));
      w.position.set(wx, WH / 2, wz); w.castShadow = true; w.receiveShadow = true;
      const stripGeo = new THREE.BoxGeometry(horiz ? len : 0.62, 0.5, horiz ? 0.62 : len);
      const rail = new THREE.Mesh(stripGeo, neonMat(NEON.mag, 2.6).clone()); rail.position.y = WH / 2 - 0.05; rail.userData.glow = true;
      const base = new THREE.Mesh(stripGeo, neonMat(NEON.mag, 2.0).clone()); base.position.y = -WH / 2 + 0.5; base.userData.glow = true;
      w.add(rail, base);
      this.walls.push(w); this.scene.add(w);
    }
    this.scene.add(buildBackdrop()); // distant neon skyline + celestial ring

    // corner pillars + a center floor emblem — give the arena a sense of place / depth
    for (const [px, pz] of [[-ARENA, -ARENA], [ARENA, -ARENA], [-ARENA, ARENA], [ARENA, ARENA]]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.0, 12, 6),
        new THREE.MeshStandardMaterial({ color: 0x140a30, emissive: NEON.mag, emissiveIntensity: 0.9, roughness: 0.5, metalness: 0.3 }));
      p.position.set(px, 6, pz); this.pillars.push(p); this.scene.add(p);
    }
    const emblem = new THREE.Mesh(new THREE.RingGeometry(4.6, 5.3, 56),
      new THREE.MeshBasicMaterial({ color: 0x6a4cff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    emblem.rotation.x = -Math.PI / 2; emblem.position.y = 0.03; this.scene.add(emblem);

    // portal (hidden until room clear)
    this.portal = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.34, 14, 36), neonMat(NEON.green, 2.0));
    this.portal.rotation.x = Math.PI / 2; this.portal.visible = false;
    this.portal.position.set(world.portalX, 1.5, world.portalZ); this.scene.add(this.portal);

    // hero ground ring + forward aim chevron
    this.playerRing = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.5, 36),
      new THREE.MeshBasicMaterial({ color: this.charColor, transparent: true, opacity: 0.92, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.playerRing.rotation.x = -Math.PI / 2; this.scene.add(this.playerRing);
    this.aimDart = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.0, 4),
      new THREE.MeshBasicMaterial({ color: this.charColor, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(this.aimDart);
    this.playerLight = new THREE.PointLight(this.charColor, 1.0, 16, 2); this.scene.add(this.playerLight);

    // aim reticle on ground
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.78, 24), new THREE.MeshBasicMaterial({ color: NEON.cyan, transparent: true, opacity: 0.85, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.reticle.rotation.x = -Math.PI / 2; this.scene.add(this.reticle);

    // boss threat ring (shown only during the boss fight)
    this.bossRing = new THREE.Mesh(new THREE.RingGeometry(3.2, 4.4, 48),
      new THREE.MeshBasicMaterial({ color: NEON.red, transparent: true, opacity: 0.7, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.bossRing.rotation.x = -Math.PI / 2; this.bossRing.visible = false; this.scene.add(this.bossRing);

    this.scene.add(this.playerMesh);
  }

  counts(): { enemyMeshes: number; projPool: number; parts: number; activeParts: number } {
    let activeParts = 0; for (const p of this.parts) if (p.life > 0) activeParts++;
    return { enemyMeshes: this.enemyMeshes.size, projPool: this.projPool.length, parts: this.parts.length, activeParts };
  }

  async init(): Promise<void> {
    this.models = await loadModels();
    this.playerMesh.add(this.models.player);
    this.models.player.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; }); // hero casts a shadow
    // hero energy aura + orbiting shards (life / "designed character" read)
    // tight, faint energy shell — small enough that the chrome hero silhouette reads ABOVE it
    // (a big bright aura was the main cause of the "glowing blob" read).
    this.heroAura = new THREE.Mesh(new THREE.SphereGeometry(1.05, 18, 14),
      new THREE.MeshBasicMaterial({ color: this.charColor, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(this.heroAura);
    this.heroCore = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 0), neonMat(this.charColor, 3.6).clone());
    this.scene.add(this.heroCore);
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), neonMat(this.charColor, 3.0).clone());
      this.scene.add(s); this.heroShards.push(s);
    }
    const max = this.lowfx ? 80 : 240;
    for (let i = 0; i < max; i++) {
      const m = new THREE.SpriteMaterial({ map: this.models.tex.dot, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
      const s = new THREE.Sprite(m); s.visible = false; this.scene.add(s);
      this.parts.push({ spr: s, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1 });
    }
    const projGeo = new THREE.SphereGeometry(0.42, 10, 10);
    for (let i = 0; i < 150; i++) {
      const mesh = new THREE.Mesh(projGeo, neonMat(NEON.cyan, 2.2).clone());
      mesh.visible = false; this.scene.add(mesh); this.projPool.push(mesh);
    }
    // telegraph (attack-warning) ground markers pool
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(this.teleGeo, new THREE.MeshBasicMaterial({ color: ENEMY_FIRE, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.rotation.x = -Math.PI / 2; m.position.y = 0.03; m.visible = false; this.scene.add(m);
      this.telePool.push({ mesh: m, t: 0, dur: 1, r: 1 });
    }
    const fxMat = () => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 12; i++) { const m = new THREE.Mesh(this.shockGeo, fxMat()); m.rotation.x = -Math.PI / 2; m.position.y = 0.07; m.visible = false; this.scene.add(m); this.shockPool.push({ mesh: m, t: 0, dur: 1, maxR: 1 }); }
    for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(this.slashGeo, fxMat()); m.visible = false; this.scene.add(m); this.slashPool.push({ mesh: m, t: 0, dur: 1 }); }
    for (let i = 0; i < 32; i++) { const mat = neonMat(0xffffff, 2.2).clone(); mat.transparent = true; const m = new THREE.Mesh(this.shatterGeo, mat); m.visible = false; this.scene.add(m); this.shatterPool.push({ mesh: m, vx: 0, vy: 0, vz: 0, t: 0, dur: 1 }); }
    this.subscribe();
    this.ready = true;
  }

  setBiome(fog: number, accent: number): void {
    (this.scene.fog as THREE.FogExp2).color.setHex(fog);
    // lit indigo sky tinted by the biome — top must NOT be near-black or the upper frame voids out
    this.scene.background = gradientTex(lighten(fog, 0x33285a), lighten(fog, 0x140f30), fog);
    const gm = this.grid.material as THREE.Material & { color?: THREE.Color };
    if (gm.color) gm.color.setHex(accent);
    this.floorMat.emissive.setHex(accent); // tint the glowing floor seams per biome
    for (const w of this.walls) {
      (w.material as THREE.MeshStandardMaterial).emissive.setHex(accent); // dark body keeps its colour
      for (const c of w.children) {
        const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (c.userData.glow && m) { m.color.setHex(accent); m.emissive.setHex(accent); }
      }
    }
    for (const p of this.pillars) (p.material as THREE.MeshStandardMaterial).emissive.setHex(accent);
  }

  setCharColor(color: number): void {
    this.charColor = color;
    if (this.models) tintPlayer(this.models.player, color);
    (this.playerRing.material as THREE.MeshBasicMaterial).color.setHex(color);
    (this.aimDart.material as THREE.MeshBasicMaterial).color.setHex(color);
    this.playerLight.color.setHex(color);
    if (this.heroAura) (this.heroAura.material as THREE.MeshBasicMaterial).color.setHex(color);
    if (this.heroCore) { const m = this.heroCore.material as THREE.MeshStandardMaterial; m.color.setHex(color); m.emissive.setHex(color); }
    for (const s of this.heroShards) { const m = s.material as THREE.MeshStandardMaterial; m.color.setHex(color); m.emissive.setHex(color); }
  }

  private subscribe(): void {
    this.bus.on('fx:hit', (p) => {
      this.burst(p.x, p.z, p.color, 6 + (p.power > 1.5 ? 8 : 0), 6, 0.7, 0.4);
      this.burst(p.x, p.z, 0xffffff, p.power > 1.5 ? 6 : 2, 4, 0.85, 0.2); // white spark = crunchy hit
      if (p.power > 1.5) this.shakeT = Math.max(this.shakeT, 0.35);        // crit kick
    });
    this.bus.on('fx:cast', (p) => { this.burst(p.x, p.z, p.color, 10, 8, 0.9, 0.45); this.castPunch = 1; if (p.kind === 'dash') this.dashT = 1; });
    this.bus.on('fx:death', (p) => { this.burst(p.x, p.z, p.color, p.big ? 44 : 18, p.big ? 15 : 9, 1.5, 0.7); this.shatter(p.x, p.z, p.color, p.big ? 16 : 7); if (p.big) this.shakeT = Math.max(this.shakeT, 1); });
    this.bus.on('fx:crash', (p) => { const c = p.hot ? 0xff5a2a : NEON.ice; this.burst(p.x, p.z, c, 64, 19, 2.3, 0.9); this.shakeT = 1.1; });
    this.bus.on('fx:telegraph', (p) => {
      const s = this.telePool.find((q) => q.t <= 0) || this.telePool[0];
      s.t = p.dur; s.dur = p.dur; s.r = p.radius;
      (s.mesh.material as THREE.MeshBasicMaterial).color.setHex(p.color);
      s.mesh.position.set(p.x, 0.03, p.z); s.mesh.scale.setScalar(p.radius); s.mesh.visible = true;
    });
    this.bus.on('fx:shock', (p) => {
      const s = this.shockPool.find((q) => q.t <= 0) || this.shockPool[0];
      s.t = s.dur = 0.5; s.maxR = p.r;
      (s.mesh.material as THREE.MeshBasicMaterial).color.setHex(p.color);
      s.mesh.position.set(p.x, 0.07, p.z); s.mesh.scale.setScalar(0.3); s.mesh.visible = true;
    });
    this.bus.on('fx:slash', (p) => {
      const s = this.slashPool.find((q) => q.t <= 0) || this.slashPool[0];
      s.t = s.dur = 0.26;
      (s.mesh.material as THREE.MeshBasicMaterial).color.setHex(p.color);
      s.mesh.position.set(p.x, 0.7, p.z);
      s.mesh.rotation.set(-Math.PI / 2, 0, -p.angle); // lay flat, sweep toward aim
      s.mesh.scale.setScalar(p.range * 0.7); s.mesh.visible = true;
    });
    this.bus.on('fx:pickup', (p) => this.burst(p.x, p.z, p.color, 12, 6, 0.9, 0.5));
    this.bus.on('fx:shake', (p) => { this.shakeT = Math.max(this.shakeT, p.power); });
    this.bus.on('player:dead', () => { const p = this.world.player; this.burst(p.x, p.z, NEON.red, 56, 17, 1.9, 0.95); this.shakeT = 1; });
    this.bus.on('player:hurt', () => { this.hurtT = 1; this.shakeT = Math.max(this.shakeT, 0.5); });
  }

  private burst(x: number, z: number, color: number, count: number, spread: number, size: number, life: number): void {
    const n = this.lowfx ? Math.ceil(count * 0.4) : count;
    for (let i = 0; i < n; i++) {
      const pt = this.parts[this.partCursor];
      this.partCursor = (this.partCursor + 1) % this.parts.length;
      const a = Math.random() * Math.PI * 2; const sp = Math.random() * spread;
      pt.vx = Math.cos(a) * sp; pt.vz = Math.sin(a) * sp; pt.vy = Math.random() * spread * 0.5 + 1;
      pt.life = pt.max = life * (0.7 + Math.random() * 0.6); pt.size = size * (0.6 + Math.random() * 0.7);
      const m = pt.spr.material as THREE.SpriteMaterial;
      m.color.setHex(color); m.opacity = 1;
      pt.spr.position.set(x, UP + 0.3, z); pt.spr.scale.setScalar(pt.size); pt.spr.visible = true;
    }
  }

  sync(dt: number): void {
    if (!this.ready) return;
    const w = this.world; const pl = w.player;
    this.floorMat.emissiveIntensity = 0.45 + Math.sin(w.t * 1.2) * 0.16; // slow floor energy pulse

    // ---- hero: idle / walk / cast / dash / hurt animation -------------------
    this.castPunch = Math.max(0, this.castPunch - dt * 4);
    this.dashT = Math.max(0, this.dashT - dt * 3);
    this.hurtT = Math.max(0, this.hurtT - dt * 4);
    const moveLen = Math.min(1, Math.hypot(pl.mvx, pl.mvz));
    const breathe = 1 + Math.sin(w.t * 3) * 0.03;
    // step-bob while walking, gentle breathe at rest
    const py = UP + 0.04 + (moveLen > 0.05 ? Math.abs(Math.sin(w.t * 12)) * 0.16 * moveLen : Math.sin(w.t * 3) * 0.04);
    this.playerMesh.position.set(pl.x, py, pl.z);
    this.playerMesh.rotation.y = -pl.angle + Math.PI / 2;
    this.playerMesh.rotation.x = moveLen * 0.16 - this.castPunch * 0.12; // lean into movement / recoil on cast
    this.playerMesh.visible = pl.alive;
    // squash/stretch: cast pop, dash STRETCH along facing, hurt flinch
    this.playerMesh.scale.set(
      breathe * (1 - this.dashT * 0.25) * (1 - this.hurtT * 0.12),
      breathe * (1 + this.castPunch * 0.18) * (1 - this.hurtT * 0.16),
      breathe * (1 + this.dashT * 0.6) * (1 + this.castPunch * 0.12));
    if (this.models) this.models.player.visible = pl.iframe <= 0 || Math.sin(w.t * 40) > -0.3;
    // articulated hero parts: halo spin, head bob, focus-orb fires forward on cast
    const hero = this.models?.player;
    if (hero) {
      const halo = hero.getObjectByName('halo'); if (halo) halo.rotation.z += dt * 1.2;
      const head = hero.getObjectByName('head'); if (head) head.position.y = 1.62 + Math.sin(w.t * 4) * 0.06;
      const orb = hero.getObjectByName('orb'); if (orb) { orb.rotation.y += dt * 4; orb.position.set(0, 1.0 + Math.sin(w.t * 5) * 0.08, 0.72 + this.castPunch * 0.5); }
    }

    this.playerRing.visible = this.aimDart.visible = pl.alive;
    this.playerRing.position.set(pl.x, 0.04, pl.z);
    this.playerRing.scale.setScalar((1 + Math.sin(w.t * 5) * 0.06) * (1 + this.castPunch * 0.3));
    // aim chevron doubles as a muzzle — punches out + brightens on cast
    const reach = 1.7 + this.castPunch * 0.6;
    this.aimDart.position.set(pl.x + Math.cos(pl.angle) * reach, 0.3, pl.z + Math.sin(pl.angle) * reach);
    this.aimDart.rotation.set(Math.PI / 2, 0, -pl.angle - Math.PI / 2);
    (this.aimDart.material as THREE.MeshBasicMaterial).opacity = 0.7 + this.castPunch * 0.3;
    // DYNAMIC state: the hero charges with the SPELL WEAVE — it tints to the last glyph woven and
    // flares while EMPOWERED (post-Resonance/Prismatic), brightens with combo, pulses red on low HP.
    const energy = pl.empower > 0 ? 1 : pl.weave.length / 3;     // 0 → 1 as the weave fills / empowers
    ZONECOL.setHex(pl.weave.length ? GLYPHS[pl.weave[pl.weave.length - 1]].color : this.charColor);
    const lowHp = pl.hp / pl.maxHp < 0.3 ? (0.5 + Math.sin(w.t * 11) * 0.5) : 0;
    const combo = Math.min(1, pl.combo / 16);
    this.playerLight.position.set(pl.x, 3.2, pl.z);
    this.playerLight.color.setHex(this.charColor).lerp(ZONECOL, energy * 0.7);
    this.playerLight.intensity = 1.0 + energy * 0.8 + combo * 0.6 + this.castPunch * 1.6 + this.dashT;

    // energy core (chest): pulse, flare on cast, redden on hurt
    if (this.heroCore) {
      this.heroCore.visible = pl.alive;
      this.heroCore.position.set(pl.x, py + 0.9, pl.z);
      this.heroCore.rotation.y += dt * 3; this.heroCore.rotation.x += dt * 2;
      this.heroCore.scale.setScalar((0.9 + Math.sin(w.t * 7) * 0.12) * (1 + this.castPunch * 0.6 + combo * 0.25));
      const cm = this.heroCore.material as THREE.MeshStandardMaterial;
      cm.emissive.setHex(this.charColor).lerp(ZONECOL, energy * 0.8).lerp(HURT, Math.max(this.hurtT, lowHp * 0.6));
      // capped tempo-driven glow: at CRITICAL (energy~1) the old curve blew the chest core out and
      // washed the hero silhouette — keep it punchy but never let it swallow the chrome body read.
      cm.emissiveIntensity = 2.5 + energy * 1.0 + combo * 1.0 + this.castPunch * 2.4;
    }
    if (this.heroAura) {
      this.heroAura.visible = pl.alive;
      this.heroAura.position.set(pl.x, py + 0.3, pl.z);
      this.heroAura.scale.setScalar(1 + Math.sin(w.t * 4) * 0.06 + this.castPunch * 0.35 + this.dashT * 0.3 + energy * 0.15 + combo * 0.15);
      const am = this.heroAura.material as THREE.MeshBasicMaterial;
      am.color.setHex(this.charColor).lerp(ZONECOL, energy * 0.8).lerp(HURT, Math.max(this.hurtT, lowHp) * 0.8);
      am.opacity = 0.10 + this.castPunch * 0.2 + this.hurtT * 0.3 + energy * 0.1 + lowHp * 0.16 + combo * 0.06;
    }
    if (this.dashT > 0.35) this.burst(pl.x, py, this.charColor, 2, 1.2, 1.1, 0.28); // dash afterimage trail
    for (let i = 0; i < this.heroShards.length; i++) {
      const s = this.heroShards[i]; s.visible = pl.alive;
      const a = w.t * (1.6 + combo * 1.6) + i * (Math.PI * 2 / this.heroShards.length); // spin up with combo
      const rad = 1.5 + this.dashT * 0.9 + energy * 0.25;
      s.position.set(pl.x + Math.cos(a) * rad, py + 0.7 + Math.sin(w.t * 3 + i) * 0.2, pl.z + Math.sin(a) * rad);
      s.rotation.y += dt * 3; s.rotation.x += dt * 2;
      const sm = s.material as THREE.MeshStandardMaterial;
      sm.emissive.setHex(this.charColor).lerp(ZONECOL, energy * 0.85); sm.color.copy(sm.emissive);
    }

    // boss mesh — big, imposing, grounded glow
    if (w.boss && !this.bossMesh && this.models) { this.bossMesh = this.models.boss; this.bossMesh.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; }); this.scene.add(this.bossMesh); }
    if (!w.boss && this.bossMesh) { this.scene.remove(this.bossMesh); this.bossMesh = null; }
    if (w.boss && this.bossMesh) {
      this.bossMesh.position.set(w.boss.x, UP + 2.0 + Math.sin(w.t * 2) * 0.3, w.boss.z);
      this.bossMesh.rotation.y += dt * 0.5;
      const br = this.bossMesh.getObjectByName('bossRing'); if (br) br.rotation.y -= dt * 1.1; // batons counter-spin
    }
    this.bossRing.visible = !!w.boss;
    if (w.boss) { this.bossRing.position.set(w.boss.x, 0.05, w.boss.z); this.bossRing.scale.setScalar(1 + Math.sin(w.t * 3) * 0.08); }

    // enemies — each a group: spinning body + flat threat ring (reads on the floor)
    const seen = new Set<number>();
    for (const e of w.enemies) {
      if (e.dead || e.def.kind === 'boss') continue;
      seen.add(e.id);
      let g = this.enemyMeshes.get(e.id);
      if (!g) {
        g = buildEnemy(e.def.kind, e.def.color); // distinct designed creature (own materials)
        const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: ENEMY_FIRE, transparent: true, opacity: 0.95, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = -UP + 0.04; ring.name = 'ring';
        g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.name !== 'ring') m.castShadow = true; }); // enemies cast shadows (not the flat threat ring)
        g.add(ring); g.userData.born = w.t; this.scene.add(g); this.enemyMeshes.set(e.id, g);
      }
      const body = g.getObjectByName('body') as THREE.Mesh;
      const core = g.getObjectByName('core') as THREE.Mesh | null;
      const ring = g.getObjectByName('ring') as THREE.Mesh;
      const f = Math.min(1, e.hitFlash / 0.12);                  // 1 right after a hit -> 0
      const age = w.t - (g.userData.born ?? w.t);
      const spawnUp = Math.min(1, age / 0.32); const spawn = spawnUp * (2 - spawnUp); // ease-out scale-in
      const charge = e.windup > 0 ? 1 : 0;                        // brute charging a slam
      const lunge = e.lunge > 0 ? 1 : 0;
      // face the player (models point +Z) + idle sway, bob, charge-grow
      g.rotation.y = Math.atan2(pl.x - e.x, pl.z - e.z) + Math.sin(w.t * 2 + e.id) * 0.08;
      g.position.set(e.x, UP + Math.sin(w.t * 2.5 + e.id) * 0.12, e.z);
      g.scale.setScalar((e.elite ? 1.7 : 1.28) * spawn * (1 + charge * 0.14)); // bigger so the layered detail reads at chase-cam distance
      const breath = 1 + Math.sin(w.t * 2.2 + e.id) * 0.05;      // living idle: subtle breathing
      body.scale.set(1 + f * 0.3, (1 + f * 0.3) * breath, 1 + f * 0.3);
      body.rotation.z = Math.sin(w.t * 3 + e.id) * 0.07 + charge * 0.18; // idle rock + rear-back on charge (telegraph)
      const bm = body.material as THREE.MeshStandardMaterial;
      bm.emissive.setHex(e.def.color).lerp(WHITE, f + charge * 0.5); // flash white on hit / charge
      bm.emissiveIntensity = 0.7 + f * 3 + charge * 2;
      if (core) { core.rotation.y += dt * 3; core.scale.setScalar((0.9 + Math.sin(w.t * 6 + e.id) * 0.14) * (1 + f + charge * 0.6)); }
      ring.scale.setScalar(e.elite ? 1.7 : 1.2);
      // animate the distinct parts: wings flap (faster mid-lunge), runes orbit, pods pulse out
      for (const c of g.children) {
        if (c.userData.wing !== undefined) c.rotation.y = c.userData.wing * (0.5 + Math.sin(w.t * (lunge ? 34 : 14) + e.id) * 0.35);
        else if (c.userData.orbit !== undefined) { const a = w.t * 2.5 + (c.userData.orbit / 4) * Math.PI * 2; c.position.set(Math.cos(a) * 0.95, 0.1 + Math.sin(w.t * 3 + c.userData.orbit) * 0.3, Math.sin(a) * 0.95); c.rotation.x += dt * 4; }
        else if (c.userData.pod !== undefined) { const a = (c.userData.pod / 4) * Math.PI * 2; const r = 0.78 + charge * 0.5 + Math.sin(w.t * 4 + c.userData.pod) * 0.08; c.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); }
        else if (c.userData.plate !== undefined) c.rotation.z = c.userData.plate * (0.42 + charge * 0.35 + Math.sin(w.t * 2.6 + e.id) * 0.07); // shoulder plates heave (breathe + telegraph)
      }
    }
    for (const [id, g] of this.enemyMeshes) if (!seen.has(id)) {
      g.traverse((o) => { const m = (o as THREE.Mesh).material; if (m) (m as THREE.Material).dispose(); }); // free per-enemy mats
      this.scene.remove(g); this.enemyMeshes.delete(id);
    }

    // projectiles — friendly keep their card colour, ALL enemy fire is hot-orange.
    // Velocity-stretch into a TRACER (juice + reads as fast/incoming) oriented along travel.
    let pi = 0;
    for (const p of w.projectiles) {
      if (!p.active) continue;
      const m = this.projPool[pi++]; if (!m) break;
      const col = p.friendly ? p.color : ENEMY_FIRE;
      m.visible = true; m.position.set(p.x, UP, p.z);
      (m.material as THREE.MeshStandardMaterial).color.setHex(col);
      (m.material as THREE.MeshStandardMaterial).emissive.setHex(col);
      const sp = Math.hypot(p.vx, p.vz) || 1;
      m.lookAt(p.x + p.vx / sp, UP, p.z + p.vz / sp); // long axis (local Z) faces travel
      const len = p.friendly ? 3.2 : 2.2, wid = p.friendly ? 0.95 : 0.95; // beefier friendly tracers read as power
      m.scale.set(wid, wid, len);
    }
    for (; pi < this.projPool.length; pi++) this.projPool[pi].visible = false;

    // pickups (orbs)
    let oi = 0;
    for (const pk of w.pickups) {
      let o = this.orbPool[oi];
      if (!o && this.models) { o = this.models.orbProto.clone(); this.scene.add(o); this.orbPool[oi] = o; }
      oi++;
      if (o) { o.visible = true; o.position.set(pk.x, UP + 0.4 + Math.sin(w.t * 3 + pk.x) * 0.2, pk.z); o.rotation.y += dt * 2; }
    }
    for (; oi < this.orbPool.length; oi++) this.orbPool[oi].visible = false;

    // portal + reticle
    this.portal.visible = w.portalOpen;
    if (w.portalOpen) { this.portal.rotation.z += dt * 1.5; this.portal.scale.setScalar(1 + Math.sin(w.t * 4) * 0.06); }
    this.reticle.visible = pl.alive;
    this.reticle.position.set(pl.aimX, 0.05, pl.aimZ);
    this.reticle.rotation.z += dt * 2;

    this.updateParticles(dt);
    this.updateTelegraphs(dt);
    this.updateCombatFx(dt);
    if (!this.cinematic) this.updateCamera(dt);
  }

  private shatter(x: number, z: number, color: number, n: number): void {
    const cnt = this.lowfx ? Math.ceil(n * 0.5) : n;
    for (let i = 0; i < cnt; i++) {
      const f = this.shatterPool[this.shatterCursor]; this.shatterCursor = (this.shatterCursor + 1) % this.shatterPool.length;
      const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 9;
      f.vx = Math.cos(a) * sp; f.vz = Math.sin(a) * sp; f.vy = 4 + Math.random() * 7;
      f.t = f.dur = 0.7 + Math.random() * 0.4;
      f.mesh.position.set(x, UP, z); f.mesh.scale.setScalar(0.6 + Math.random() * 0.8); f.mesh.visible = true;
      const m = f.mesh.material as THREE.MeshStandardMaterial; m.color.setHex(color); m.emissive.setHex(color); m.opacity = 1;
    }
  }

  private updateCombatFx(dt: number): void {
    for (const s of this.shockPool) {
      if (s.t <= 0) continue; s.t -= dt;
      const mat = s.mesh.material as THREE.MeshBasicMaterial;
      if (s.t <= 0) { s.mesh.visible = false; mat.opacity = 0; continue; }
      const e = 1 - s.t / s.dur;
      s.mesh.scale.setScalar(0.3 + (s.maxR - 0.3) * (1 - Math.pow(1 - e, 3))); // ease-out expansion
      mat.opacity = (1 - e) * 0.9;
    }
    for (const s of this.slashPool) {
      if (s.t <= 0) continue; s.t -= dt;
      const mat = s.mesh.material as THREE.MeshBasicMaterial;
      if (s.t <= 0) { s.mesh.visible = false; mat.opacity = 0; continue; }
      s.mesh.rotation.z += dt * 3.5;            // sweep the crescent
      s.mesh.scale.multiplyScalar(1 + dt * 1.6); // slight follow-through grow
      mat.opacity = (s.t / s.dur) * 0.95;
    }
    for (const f of this.shatterPool) {
      if (f.t <= 0) continue; f.t -= dt;
      const mat = f.mesh.material as THREE.MeshStandardMaterial;
      if (f.t <= 0) { f.mesh.visible = false; continue; }
      f.vy -= dt * 15;
      f.mesh.position.x += f.vx * dt; f.mesh.position.y += f.vy * dt; f.mesh.position.z += f.vz * dt;
      if (f.mesh.position.y < 0.15) { f.mesh.position.y = 0.15; f.vy *= -0.4; f.vx *= 0.7; f.vz *= 0.7; }
      f.mesh.rotation.x += dt * 8; f.mesh.rotation.y += dt * 6;
      const k = f.t / f.dur; f.mesh.scale.setScalar(0.55 + k * 0.6); mat.opacity = Math.min(1, k * 1.5);
    }
  }

  private updateTelegraphs(dt: number): void {
    for (const s of this.telePool) {
      if (s.t <= 0) continue;
      s.t -= dt;
      const mat = s.mesh.material as THREE.MeshBasicMaterial;
      if (s.t <= 0) { s.mesh.visible = false; mat.opacity = 0; continue; }
      const f = 1 - s.t / s.dur;                          // 0 -> 1 as the attack lands
      mat.opacity = 0.16 + f * 0.5;                       // fill / brighten the danger zone
      s.mesh.scale.setScalar(s.r * (0.97 + Math.sin(f * 22) * 0.02));
    }
  }

  resyncCam(): void { const pl = this.world.player; if (pl) this.camTarget.set(pl.x, 0, pl.z); }

  private updateParticles(dt: number): void {
    for (const pt of this.parts) {
      if (pt.life <= 0) continue;
      pt.life -= dt;
      const m = pt.spr.material as THREE.SpriteMaterial;
      if (pt.life <= 0) { pt.spr.visible = false; m.opacity = 0; continue; }
      pt.vy -= dt * 6;
      pt.spr.position.x += pt.vx * dt; pt.spr.position.y += pt.vy * dt; pt.spr.position.z += pt.vz * dt;
      if (pt.spr.position.y < 0.1) { pt.spr.position.y = 0.1; pt.vy *= -0.3; }
      const f = pt.life / pt.max;
      m.opacity = f; pt.spr.scale.setScalar(pt.size * (0.4 + f * 0.8));
    }
  }

  // Player rotates the chase cam (Q/E or arrows). Marks manual control so auto-frame yields.
  rotateCam(delta: number): void { this.camYaw += delta; this.manualT = 1.4; }
  // mouse-wheel zoom (WoW-style): pull the camera in/out
  zoomBy(delta: number): void { this.camZoom = Math.max(0.65, Math.min(1.7, this.camZoom + delta)); }

  // Yaw whose forward vector points at the centroid of nearby threats (for auto-framing).
  private threatYaw(px: number, pz: number): number | null {
    let cx = 0, cz = 0, n = 0;
    for (const e of this.world.enemies) {
      if (e.dead || e.def.kind === 'boss') continue;
      if ((e.x - px) ** 2 + (e.z - pz) ** 2 > 900) continue; // within 30u
      cx += e.x; cz += e.z; n++;
    }
    if (this.world.boss) { cx += this.world.boss.x; cz += this.world.boss.z; n += 1; }
    if (!n) return null;
    const dx = cx / n - px, dz = cz / n - pz;
    if (dx * dx + dz * dz < 1) return null;
    return Math.atan2(dx, -dz); // yaw where forward (sin yaw, -cos yaw) points at the centroid
  }

  // Behind-the-shoulder low chase camera: hero large in the lower third, threats ahead.
  private updateCamera(dt: number): void {
    const pl = this.world.player;
    this.camTarget.lerp(this.scratch.set(pl.x, 0, pl.z), Math.min(1, dt * 5));
    this.manualT = Math.max(0, this.manualT - dt);
    // auto-frame: when the player isn't steering, ease the camera so nearby foes stay in view
    if (this.manualT <= 0) {
      const t = this.threatYaw(this.camTarget.x, this.camTarget.z);
      if (t !== null) this.camYaw = lerpAngle(this.camYaw, t, dt * 0.9);
    }
    let sx = 0, sy = 0, sz = 0;
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt * 2.5);
      const amp = this.shakeT * 0.6;
      sx = (Math.random() - 0.5) * amp; sy = (Math.random() - 0.5) * amp * 0.5; sz = (Math.random() - 0.5) * amp;
    }
    // WoW-style 3/4 over-the-shoulder: higher + further + ~33° down so you see the hero AND
    // the ground/foes around them. Height & distance scale with the zoom; look-ahead stays put.
    const H = 11 * this.camZoom, BACK = 11.5 * this.camZoom, AHEAD = 4.5, LOOKY = 1.3, EDGE = ARENA - 1.5;
    const fx = Math.sin(this.camYaw), fz = -Math.cos(this.camYaw); // forward (horizontal)
    // sit behind the hero along -forward; clamp inside the arena so the camera never slips
    // behind a wall (which fills the screen with a flat wall colour at the back edge).
    const cx = Math.max(-EDGE, Math.min(EDGE, this.camTarget.x - fx * BACK + sx));
    const cz = Math.max(-EDGE, Math.min(EDGE, this.camTarget.z - fz * BACK + sz));
    this.camera.position.set(cx, H + sy, cz);
    this.camera.lookAt(this.camTarget.x + fx * AHEAD, LOOKY, this.camTarget.z + fz * AHEAD);
  }
}

// shortest-path angular lerp (handles wraparound)
function lerpAngle(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

// ---- procedural backdrop helpers (no asset files) ---------------------------
function lighten(hex: number, add: number): number {
  const r = Math.min(255, ((hex >> 16) & 255) + ((add >> 16) & 255));
  const g = Math.min(255, ((hex >> 8) & 255) + ((add >> 8) & 255));
  const b = Math.min(255, (hex & 255) + (add & 255));
  return (r << 16) | (g << 8) | b;
}
function starfield(): THREE.Points {
  const n = 320; const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2; const r = 80 + Math.random() * 120;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = 18 + Math.random() * 90;       // up in the sky
    pos[i * 3 + 2] = Math.sin(a) * r;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ color: 0xbcd0ff, size: 1.1, sizeAttenuation: true, transparent: true, opacity: 0.85, fog: false });
  const p = new THREE.Points(g, m); p.name = 'stars'; return p;
}
// Neon environment (equirect) for image-based lighting: a deep gradient with a bright neon
// horizon band + colored streaks — what the reflective floor/metallic surfaces catch.
export function neonEnvTex(): THREE.CanvasTexture {
  const w = 512, h = 256, c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, '#0a0620'); grd.addColorStop(0.42, '#2e2068'); grd.addColorStop(0.52, '#9a3ad0'); grd.addColorStop(1, '#0c0726');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,108,242,0.95)'; g.fillRect(0, h * 0.5, w, 10);          // bright neon horizon band
  for (let i = 0; i < 14; i++) { g.fillStyle = i % 2 ? 'rgba(77,251,255,0.8)' : 'rgba(255,108,242,0.85)'; g.fillRect((i / 14) * w + 6, h * 0.3, 9, h * 0.34); } // vivid wall streaks
  const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// Distant world backdrop: an instanced neon SKYLINE of spires (2 draw calls) ringing the
// arena beyond the walls + a celestial ring/moon high in the sky. Gives real depth so the
// background isn't an empty gradient.
function buildBackdrop(): THREE.Group {
  const g = new THREE.Group();
  const N = 42;
  const spireMat = new THREE.MeshStandardMaterial({ color: 0x0e0826, emissive: 0x3a2a7a, emissiveIntensity: 0.6, roughness: 0.7, fog: true });
  const capMat = new THREE.MeshBasicMaterial({ color: 0x8a6cff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), spireMat, N);
  const caps = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.7, 1), capMat, N);
  const d = new THREE.Object3D();
  for (let i = 0; i < N; i++) {
    // a NEON CITY SKYLINE close behind the walls (radius 34-56) so it looms over the wall-line
    // and reads as the in-play horizon backdrop (the down-cam can't see far/tall sky structures).
    const a = (i / N) * Math.PI * 2; const r = 34 + (i % 6) * 4.5;
    const h = 12 + ((i * 53) % 24); const wdt = 3.5 + (i % 3) * 2.2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    d.position.set(x, h / 2 - 3, z); d.rotation.set(0, a + (i % 3) * 0.2, 0); d.scale.set(wdt, h, wdt); d.updateMatrix(); bodies.setMatrixAt(i, d.matrix);
    d.position.set(x, h - 3, z); d.scale.set(wdt + 0.6, 1.0, wdt + 0.6); d.updateMatrix(); caps.setMatrixAt(i, d.matrix);
  }
  g.add(bodies, caps);
  // colossal central megastructure (The Conductor's spire) — dramatic in cutscenes/wide shots
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(5, 13, 72, 6),
    new THREE.MeshStandardMaterial({ color: 0x0c0826, emissive: 0x6a3cff, emissiveIntensity: 0.55, roughness: 0.6 }));
  tower.position.set(0, 30, -98); g.add(tower);
  const crown = new THREE.Mesh(new THREE.TorusGeometry(9, 1.6, 8, 28), new THREE.MeshBasicMaterial({ color: 0x9a7cff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  crown.position.set(0, 64, -98); crown.rotation.x = Math.PI / 2; g.add(crown);
  // celestial ring/moon
  const moon = new THREE.Mesh(new THREE.SphereGeometry(18, 24, 18), new THREE.MeshBasicMaterial({ color: 0x2a2060, fog: false }));
  moon.position.set(-30, 48, -110); g.add(moon);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(27, 1.4, 10, 56), new THREE.MeshBasicMaterial({ color: 0x9a7cff, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  ring.position.copy(moon.position); ring.rotation.set(1.15, 0.4, 0); g.add(ring);
  return g;
}
// Procedural arena floor: dark indigo panels with bright (white) seams, corner ticks, the odd
// glowing panel + circuit runs. White seams so the emissiveMap tints them per biome accent.
function floorTex(): THREE.CanvasTexture {
  const s = 512, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0a0622'; g.fillRect(0, 0, s, s);
  const cells = 4, cw = s / cells;
  for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
    const px = x * cw, py = y * cw;
    g.fillStyle = (x + y) % 2 ? '#140b34' : '#0f0828'; g.fillRect(px + 3, py + 3, cw - 6, cw - 6);
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 2; g.strokeRect(px + 3, py + 3, cw - 6, cw - 6);
    g.fillStyle = 'rgba(255,255,255,0.85)'; // corner ticks
    for (const [tx, ty] of [[px + 8, py + 8], [px + cw - 26, py + 8], [px + 8, py + cw - 18], [px + cw - 26, py + cw - 18]]) {
      g.fillRect(tx, ty, 18, 3); g.fillRect(tx, ty, 3, 14);
    }
    if (Math.random() < 0.18) { g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(px + 8, py + 8, cw - 16, cw - 16); } // glow panel
    if (Math.random() < 0.5) { g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillRect(px + cw / 2 - 1, py + 10, 2, cw - 20); } // circuit run
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 4); t.anisotropy = 4;
  return t;
}
// Wall panels: dark base, vertical seams, a bright horizontal band + tech ticks. White marks
// so the emissiveMap tints them per biome accent (so walls glow with structure, not flat slabs).
function wallTex(): THREE.CanvasTexture {
  const w = 256, h = 64, c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0c0622'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 2;
  for (let x = 0; x <= w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(0, h - 8, w, 4);        // bright base band
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, 12, w, 2);         // upper accent line
  for (let x = 8; x < w; x += 32) { g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(x, 20, 6, 6); } // tech ticks
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 1);
  return t;
}
function gradientTex(top: number, mid: number, bottom: number): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d')!; const grd = g.createLinearGradient(0, 0, 0, 256);
  const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
  grd.addColorStop(0, hex(top)); grd.addColorStop(0.55, hex(mid)); grd.addColorStop(1, hex(bottom));
  g.fillStyle = grd; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function radialTex(color: number): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!; const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
  grd.addColorStop(0, hex(color)); grd.addColorStop(0.4, hex(color) + '80'); grd.addColorStop(1, '#00000000');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
