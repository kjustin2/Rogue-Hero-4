import * as THREE from 'three';
import { World } from '../sim/world';
import { Bus } from '../bus';
import { ARENA } from '../content';
import { loadModels, neonMat, tintPlayer, enemyGeo, type Models } from './models';

interface Particle { spr: THREE.Sprite; vx: number; vy: number; vz: number; life: number; max: number; size: number; }

const UP = 0.9; // entity hover height

export class View {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  models!: Models;
  ready = false;
  private world: World;
  private bus: Bus;
  private lowfx: boolean;

  private playerMesh = new THREE.Group();
  private bossMesh: THREE.Object3D | null = null;
  private enemyMeshes = new Map<number, THREE.Mesh>();
  private projPool: THREE.Mesh[] = [];
  private orbPool: THREE.Object3D[] = [];
  private parts: Particle[] = [];
  private partCursor = 0;
  private portal: THREE.Mesh;
  private reticle: THREE.Mesh;
  private grid: THREE.GridHelper;
  private hemi: THREE.HemisphereLight;
  private walls: THREE.Mesh[] = [];

  private shakeT = 0;
  private camTarget = new THREE.Vector3();

  constructor(world: World, bus: Bus, lowfx: boolean) {
    this.world = world; this.bus = bus; this.lowfx = lowfx;
    this.camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.1, 400);
    this.camera.position.set(0, 30, 22);

    this.scene.fog = new THREE.FogExp2(0x0b0420, 0.012);
    this.hemi = new THREE.HemisphereLight(0x88aaff, 0x130826, 0.7);
    this.scene.add(this.hemi);
    const key = new THREE.DirectionalLight(0xbfe6ff, 0.5);
    key.position.set(8, 24, 10); this.scene.add(key);

    // dark floor + neon grid
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA * 2, ARENA * 2),
      new THREE.MeshStandardMaterial({ color: 0x080313, roughness: 1, metalness: 0 }),
    );
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.01; this.scene.add(floor);
    this.grid = new THREE.GridHelper(ARENA * 2, 30, 0xff3df0, 0x2a1860);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.5;
    this.scene.add(this.grid);

    // arena walls (4 emissive strips)
    const wallMat = neonMat(0xff3df0, 1.0);
    for (let i = 0; i < 4; i++) {
      const horiz = i < 2;
      const w = new THREE.Mesh(new THREE.BoxGeometry(horiz ? ARENA * 2 : 0.4, 1.4, horiz ? 0.4 : ARENA * 2), wallMat);
      w.position.set(horiz ? 0 : (i === 2 ? -ARENA : ARENA), 0.7, horiz ? (i === 0 ? -ARENA : ARENA) : 0);
      this.walls.push(w); this.scene.add(w);
    }

    // portal (hidden until room clear)
    this.portal = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.32, 12, 32), neonMat(0x53ff8a, 1.6));
    this.portal.rotation.x = Math.PI / 2; this.portal.visible = false;
    this.portal.position.set(world.portalX, 1.4, world.portalZ); this.scene.add(this.portal);

    // aim reticle on ground
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.75, 24), new THREE.MeshBasicMaterial({ color: 0x36f9ff, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    this.reticle.rotation.x = -Math.PI / 2; this.scene.add(this.reticle);

    this.scene.add(this.playerMesh);
  }

  async init(): Promise<void> {
    this.models = await loadModels();
    this.playerMesh.add(this.models.player);
    const max = this.lowfx ? 70 : 220;
    for (let i = 0; i < max; i++) {
      const m = new THREE.SpriteMaterial({ map: this.models.tex.dot, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
      const s = new THREE.Sprite(m); s.visible = false; this.scene.add(s);
      this.parts.push({ spr: s, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1 });
    }
    for (let i = 0; i < 150; i++) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), neonMat(0x36f9ff, 1.6).clone());
      mesh.visible = false; this.scene.add(mesh); this.projPool.push(mesh);
    }
    this.subscribe();
    this.ready = true;
  }

  setBiome(fog: number, accent: number): void {
    (this.scene.fog as THREE.FogExp2).color.setHex(fog);
    const gm = this.grid.material as THREE.Material & { color?: THREE.Color };
    if (gm.color) gm.color.setHex(accent);
    for (const w of this.walls) (w.material as THREE.MeshStandardMaterial).color.setHex(accent);
    (this.walls[0].material as THREE.MeshStandardMaterial).emissive.setHex(accent);
  }

  setCharColor(color: number): void {
    if (this.models) tintPlayer(this.models.player, color);
    (this.reticle.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  private subscribe(): void {
    this.bus.on('fx:hit', (p) => this.burst(p.x, p.z, p.color, 6 + (p.power > 1.5 ? 8 : 0), 6, 0.7, 0.4));
    this.bus.on('fx:cast', (p) => this.burst(p.x, p.z, p.color, 10, 8, 0.9, 0.45));
    this.bus.on('fx:death', (p) => { this.burst(p.x, p.z, p.color, p.big ? 40 : 16, p.big ? 14 : 9, 1.4, 0.7); if (p.big) this.shakeT = Math.max(this.shakeT, 1); });
    this.bus.on('fx:crash', (p) => { const c = p.hot ? 0xff5a2a : 0xbfeaff; this.burst(p.x, p.z, c, 60, 18, 2.2, 0.9); this.shakeT = 1; });
    this.bus.on('fx:pickup', (p) => this.burst(p.x, p.z, p.color, 12, 6, 0.9, 0.5));
    this.bus.on('fx:shake', (p) => { this.shakeT = Math.max(this.shakeT, p.power); });
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

    // player
    this.playerMesh.position.set(pl.x, UP + Math.sin(w.t * 4) * 0.08, pl.z);
    this.playerMesh.rotation.y = -pl.angle + Math.PI / 2;
    this.playerMesh.visible = pl.alive;
    const pm = this.models?.player;
    if (pm) { const flash = pl.iframe > 0 ? 0.5 + Math.sin(w.t * 40) * 0.4 : 1; this.playerMesh.scale.setScalar(flash > 0 ? 1 : 1); pm.visible = pl.iframe <= 0 || Math.sin(w.t * 40) > -0.3; }

    // boss mesh
    if (w.boss && !this.bossMesh && this.models) { this.bossMesh = this.models.boss; this.scene.add(this.bossMesh); }
    if (!w.boss && this.bossMesh) { this.scene.remove(this.bossMesh); this.bossMesh = null; }
    if (w.boss && this.bossMesh) {
      this.bossMesh.position.set(w.boss.x, UP + 1.6 + Math.sin(w.t * 2) * 0.3, w.boss.z);
      this.bossMesh.rotation.y += dt * 0.6;
    }

    // enemies
    const seen = new Set<number>();
    for (const e of w.enemies) {
      if (e.dead || e.def.kind === 'boss') continue;
      seen.add(e.id);
      let m = this.enemyMeshes.get(e.id);
      if (!m) { m = new THREE.Mesh(enemyGeo(e.def.kind), neonMat(e.def.color, 0.8)); this.scene.add(m); this.enemyMeshes.set(e.id, m); }
      const pop = e.hitFlash > 0 ? 1.25 : 1;
      const s = (e.elite ? 1.5 : 1) * pop;
      m.position.set(e.x, UP, e.z); m.scale.setScalar(s);
      m.rotation.y += dt * (e.def.kind === 'darter' ? 6 : 1.5); m.rotation.x += dt * 0.8;
    }
    for (const [id, m] of this.enemyMeshes) if (!seen.has(id)) { this.scene.remove(m); this.enemyMeshes.delete(id); }

    // projectiles
    let pi = 0;
    for (const p of w.projectiles) {
      if (!p.active) continue;
      const m = this.projPool[pi++]; if (!m) break;
      m.visible = true; m.position.set(p.x, UP, p.z);
      (m.material as THREE.MeshStandardMaterial).color.setHex(p.color);
      (m.material as THREE.MeshStandardMaterial).emissive.setHex(p.color);
      m.scale.setScalar(p.friendly ? 1 : 1.2);
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
    this.reticle.position.set(pl.aimX, 0.05, pl.aimZ);
    this.reticle.rotation.z += dt * 2;

    this.updateParticles(dt);
    this.updateCamera(dt);
  }

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

  private updateCamera(dt: number): void {
    const pl = this.world.player;
    this.camTarget.lerp(new THREE.Vector3(pl.x, 0, pl.z), Math.min(1, dt * 4));
    let sx = 0, sz = 0;
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt * 2.5);
      const amp = this.shakeT * 0.8;
      sx = (Math.random() - 0.5) * amp; sz = (Math.random() - 0.5) * amp;
    }
    this.camera.position.set(this.camTarget.x + sx, 30, this.camTarget.z + 22 + sz);
    this.camera.lookAt(this.camTarget.x, 1.5, this.camTarget.z - 2);
  }
}
