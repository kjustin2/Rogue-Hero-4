import * as THREE from "three";
import type { World } from "../sim/world.js";
import type { Bus } from "../sim/bus.js";
import type { Enemy, EnemyKind } from "../sim/types.js";

// ---- shared assets (never disposed) -----------------------------------
const ENEMY_GEO: Record<EnemyKind, THREE.BufferGeometry> = {
  darter:   new THREE.ConeGeometry(0.55, 1.3, 5),
  brute:    new THREE.BoxGeometry(1.7, 1.9, 1.7),
  caster:   new THREE.OctahedronGeometry(0.95, 0),
  splitter: new THREE.IcosahedronGeometry(0.95, 0),
  boss:     new THREE.CylinderGeometry(2.3, 3.1, 4.8, 10),
};
const ENEMY_Y: Record<EnemyKind, number> = { darter: 0.65, brute: 0.95, caster: 0.95, splitter: 0.95, boss: 2.4 };

function softTexture(): THREE.Texture {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.4, "rgba(255,255,255,0.6)"); g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---- additive point particles -----------------------------------------
class Particles {
  pts: THREE.Points;
  private max = 420;
  private pos: Float32Array; private col: Float32Array;
  private vx: Float32Array; private vy: Float32Array; private vz: Float32Array;
  private life: Float32Array; private ttl: Float32Array;
  private n = 0;
  private _c = new THREE.Color();

  constructor(scene: THREE.Object3D) {
    this.pos = new Float32Array(this.max * 3);
    this.col = new Float32Array(this.max * 3);
    this.vx = new Float32Array(this.max); this.vy = new Float32Array(this.max); this.vz = new Float32Array(this.max);
    this.life = new Float32Array(this.max); this.ttl = new Float32Array(this.max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.42, map: softTexture(), vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    this.pts = new THREE.Points(geo, mat);
    this.pts.frustumCulled = false;
    scene.add(this.pts);
  }

  spawn(x: number, y: number, z: number, color: number, count: number, speed: number, life: number, grav = -2) {
    this._c.set(color);
    for (let i = 0; i < count && this.n < this.max; i++) {
      const k = this.n++;
      const a = Math.random() * Math.PI * 2, up = Math.random() * 1.4, s = speed * (0.4 + Math.random() * 0.8);
      this.pos[k * 3] = x; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z;
      this.vx[k] = Math.cos(a) * s; this.vy[k] = up * speed * 0.4; this.vz[k] = Math.sin(a) * s;
      this.col[k * 3] = this._c.r; this.col[k * 3 + 1] = this._c.g; this.col[k * 3 + 2] = this._c.b;
      this.ttl[k] = this.life[k] = life * (0.6 + Math.random() * 0.6);
      (this as any)._g = grav;
    }
  }

  update(dt: number) {
    let n = 0;
    const g = (this as any)._g ?? -2;
    for (let i = 0; i < this.n; i++) {
      const l = this.life[i] - dt;
      if (l <= 0) continue;
      const di = i, ti = n;
      this.vy[di] += g * dt;
      let x = this.pos[di * 3] + this.vx[di] * dt;
      let y = this.pos[di * 3 + 1] + this.vy[di] * dt;
      let z = this.pos[di * 3 + 2] + this.vz[di] * dt;
      // write survivor at slot n
      this.pos[ti * 3] = x; this.pos[ti * 3 + 1] = y; this.pos[ti * 3 + 2] = z;
      const f = l / this.ttl[di];
      this.col[ti * 3] = this.col[di * 3] * f; this.col[ti * 3 + 1] = this.col[di * 3 + 1] * f; this.col[ti * 3 + 2] = this.col[di * 3 + 2] * f;
      this.vx[ti] = this.vx[di]; this.vy[ti] = this.vy[di]; this.vz[ti] = this.vz[di];
      this.life[ti] = l; this.ttl[ti] = this.ttl[di];
      n++;
    }
    this.n = n;
    const geo = this.pts.geometry;
    (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    geo.setDrawRange(0, this.n);
  }
}

// ---- expanding shock rings --------------------------------------------
class Rings {
  private pool: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number; ttl: number; r: number }[] = [];
  private geo = new THREE.RingGeometry(0.78, 1, 40);
  constructor(private scene: THREE.Object3D) {}
  spawn(x: number, z: number, radius: number, color: number) {
    let s = this.pool.find((p) => p.life <= 0);
    if (!s) {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });
      const mesh = new THREE.Mesh(this.geo, mat); mesh.rotation.x = -Math.PI / 2; mesh.frustumCulled = false;
      this.scene.add(mesh); s = { mesh, mat, life: 0, ttl: 0, r: 1 }; this.pool.push(s);
    }
    s.mat.color.set(color); s.life = s.ttl = 0.45; s.r = radius;
    s.mesh.position.set(x, 0.12, z); s.mesh.visible = true;
  }
  update(dt: number) {
    for (const s of this.pool) {
      if (s.life <= 0) continue;
      s.life -= dt;
      const f = 1 - s.life / s.ttl;
      const sc = s.r * (0.25 + 0.75 * f);
      s.mesh.scale.set(sc, sc, sc);
      s.mat.opacity = Math.max(0, 1 - f) * 0.9;
      if (s.life <= 0) s.mesh.visible = false;
    }
  }
}

// ---- the view: sim state -> Three scene -------------------------------
export class View {
  player: THREE.Group;
  private body: THREE.Mesh; private bodyMat: THREE.MeshStandardMaterial;
  private core!: THREE.Mesh; private coreMat!: THREE.MeshBasicMaterial; private halo!: THREE.Mesh;
  private enemyPools = new Map<EnemyKind, { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; baseEmi: number }[]>();
  private projPool: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }[] = [];
  private projGeo = new THREE.BoxGeometry(0.26, 0.26, 1.5);
  private bossObj?: THREE.Group; private bossBody!: THREE.Mesh; private bossCore!: THREE.Mesh; private bossCrown!: THREE.Mesh; private bossShards: THREE.Mesh[] = [];
  private pickupPool: THREE.Mesh[] = [];
  private pickupGeo = new THREE.IcosahedronGeometry(0.45, 0);
  private particles: Particles;
  private rings: Rings;
  renderShake = 0;
  private t = 0;

  constructor(private scene: THREE.Object3D, bus: Bus) {
    this.particles = new Particles(scene);
    this.rings = new Rings(scene);

    // player model: neon capsule + facing nose + glow
    this.player = new THREE.Group(); this.player.name = "Player";
    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0x0a0a14, emissive: new THREE.Color(0x18e0ff), emissiveIntensity: 1.8, metalness: 0.3, roughness: 0.35 });
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.9, 6, 16), this.bodyMat);
    this.body.position.y = 0.9; this.body.castShadow = true; this.player.add(this.body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.42, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(0xffffff), emissiveIntensity: 2.2 }));
    nose.rotation.x = Math.PI / 2; nose.position.set(0, 0.9, 0.55); this.player.add(nose);
    // chest core + spinning base halo → a richer, more "hero" silhouette
    this.coreMat = new THREE.MeshBasicMaterial({ color: 0xbff6ff });
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), this.coreMat);
    this.core.position.y = 1.05; this.player.add(this.core);
    this.halo = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.05, 8, 36), new THREE.MeshBasicMaterial({ color: 0x18e0ff, transparent: true, opacity: 0.85 }));
    this.halo.rotation.x = -Math.PI / 2; this.halo.position.y = 0.07; this.player.add(this.halo);
    scene.add(this.player);

    // FX subscriptions
    bus.on("fx:hit", (e) => this.particles.spawn(e.x, 0.9, e.z, e.crit ? 0xffe08a : e.color, e.crit ? 14 : 6, 6, 0.4));
    bus.on("fx:death", (e) => this.particles.spawn(e.x, 0.9, e.z, e.color, e.big ? 44 : 18, e.big ? 9 : 6, 0.7));
    bus.on("fx:cast", (e) => this.particles.spawn(e.x, 1.2, e.z, e.color, 6, 4, 0.3));
    bus.on("fx:shock", (e) => this.rings.spawn(e.x, e.z, e.radius, e.color));
    bus.on("fx:crash", (e) => { this.particles.spawn(e.x, 1.2, e.z, e.color, 34, 12, 0.8); this.rings.spawn(e.x, e.z, 9, e.color); });
    bus.on("fx:dash", (e) => this.particles.spawn(e.tx, 0.9, e.tz, e.color, 16, 7, 0.45));
    bus.on("fx:shake", (e) => { this.renderShake = Math.min(2, this.renderShake + e.power); });
  }

  private enemyMeshFor(kind: EnemyKind, idx: number) {
    let pool = this.enemyPools.get(kind);
    if (!pool) { pool = []; this.enemyPools.set(kind, pool); }
    while (pool.length <= idx) {
      const baseEmi = kind === "boss" ? 1.4 : 1.9;
      const mat = new THREE.MeshStandardMaterial({ color: 0x05050c, emissive: new THREE.Color(0x888888), emissiveIntensity: baseEmi, metalness: 0.45, roughness: 0.35, envMapIntensity: 0.6 });
      const mesh = new THREE.Mesh(ENEMY_GEO[kind], mat); mesh.castShadow = true; mesh.visible = false;
      this.scene.add(mesh); pool.push({ mesh, mat, baseEmi });
    }
    return pool[idx];
  }

  private buildBoss() {
    const g = new THREE.Group(); g.visible = false;
    this.bossBody = new THREE.Mesh(new THREE.ConeGeometry(2.4, 6.2, 6),
      new THREE.MeshStandardMaterial({ color: 0x05060c, emissive: new THREE.Color(0x36f9ff), emissiveIntensity: 1.2, metalness: 0.5, roughness: 0.3, envMapIntensity: 0.7 }));
    this.bossBody.position.y = 3.1; this.bossBody.castShadow = true; g.add(this.bossBody);
    this.bossCore = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 0), new THREE.MeshBasicMaterial({ color: 0xddffff }));
    this.bossCore.position.y = 3.3; g.add(this.bossCore);
    this.bossCrown = new THREE.Mesh(new THREE.TorusGeometry(2.7, 0.22, 10, 36),
      new THREE.MeshStandardMaterial({ color: 0x100406, emissive: new THREE.Color(0xff3b5c), emissiveIntensity: 2.6 }));
    this.bossCrown.rotation.x = Math.PI / 2; this.bossCrown.position.y = 6.4; g.add(this.bossCrown);
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(new THREE.TetrahedronGeometry(0.72), new THREE.MeshStandardMaterial({ color: 0x05060c, emissive: new THREE.Color(0x36f9ff), emissiveIntensity: 2 }));
      g.add(s); this.bossShards.push(s);
    }
    this.scene.add(g); this.bossObj = g;
  }

  private syncBoss(e: Enemy) {
    if (!this.bossObj) this.buildBoss();
    const g = this.bossObj!, t = this.t;
    g.visible = true; g.position.set(e.x, 0, e.z); g.rotation.y = -e.angle + Math.PI / 2;
    this.bossCrown.rotation.z = t * 0.8;
    const flash = e.hitFlash > 0 ? e.hitFlash / 0.12 : 0;
    this.bossCore.scale.setScalar(1 + Math.sin(t * 4) * 0.15 + flash * 0.6);
    (this.bossCore.material as THREE.MeshBasicMaterial).color.setHex(flash > 0 ? 0xffffff : e.phase ? 0xffd0ea : 0xddffff);
    const bm = this.bossBody.material as THREE.MeshStandardMaterial;
    bm.emissive.set(e.phase ? 0xff3df0 : 0x36f9ff).lerp(new THREE.Color(0xffffff), flash * 0.7);
    bm.emissiveIntensity = 1.2 + flash * 2;
    for (let i = 0; i < this.bossShards.length; i++) {
      const s = this.bossShards[i], a = t * 1.2 + i * Math.PI / 2;
      s.position.set(Math.cos(a) * 3.6, 4 + Math.sin(t * 2 + i) * 0.6, Math.sin(a) * 3.6);
      s.rotation.set(t, t * 1.3, 0);
    }
  }

  sync(world: World, dt: number) {
    this.t += dt;
    const p = world.player;

    // player
    this.player.position.set(p.x, 0, p.z);
    this.player.rotation.y = Math.atan2(Math.cos(p.angle), Math.sin(p.angle));
    const hurt = p.iframe > 0 ? (Math.sin(this.t * 40) * 0.5 + 0.5) : 1;
    const empowered = p.empower > 0 ? 1.6 : 1;
    this.bodyMat.emissiveIntensity = 1.8 * empowered * (0.5 + 0.5 * hurt);
    this.body.scale.setScalar(p.hp / p.maxHp < 0.3 ? 0.95 + Math.sin(this.t * 8) * 0.04 : 1);
    this.halo.rotation.z = this.t * 1.2;
    this.coreMat.color.setHex(p.empower > 0 ? 0xffe08a : p.hp / p.maxHp < 0.3 ? 0xff6b8a : 0xbff6ff);
    this.core.scale.setScalar(1 + Math.sin(this.t * 6) * 0.18 + (p.empower > 0 ? 0.35 : 0));

    // enemies (per-kind index pools)
    const counts = new Map<EnemyKind, number>();
    for (const e of world.enemies) {
      if (!e.alive || e.kind === "boss") continue;
      const idx = counts.get(e.kind) ?? 0; counts.set(e.kind, idx + 1);
      const slot = this.enemyMeshFor(e.kind, idx);
      slot.mesh.visible = true;
      const bob = Math.sin(this.t * 3 + idx * 1.7) * 0.12;
      slot.mesh.position.set(e.x, ENEMY_Y[e.kind] + bob, e.z);
      if (e.kind === "caster" || e.kind === "splitter") slot.mesh.rotation.set(this.t * 0.8, this.t * 1.6, 0); // float + spin
      else slot.mesh.rotation.set(0, -e.angle + Math.PI / 2, 0); // face heading
      const flash = e.hitFlash > 0 ? e.hitFlash / 0.12 : 0;
      slot.mat.emissive.set(e.def.color).lerp(new THREE.Color(0xffffff), flash * 0.8);
      slot.mat.emissiveIntensity = slot.baseEmi + flash * 2.5 + (e.windup > 0 ? Math.sin(this.t * 30) * 1.5 + 1.5 : 0);
    }
    // hide unused slots
    for (const [kind, pool] of this.enemyPools) {
      const used = counts.get(kind) ?? 0;
      for (let i = used; i < pool.length; i++) pool[i].mesh.visible = false;
    }
    // boss is a dedicated multi-part model
    const bossE = world.enemies.find((e) => e.kind === "boss" && e.alive);
    if (bossE) this.syncBoss(bossE); else if (this.bossObj) this.bossObj.visible = false;

    // projectiles
    for (let i = 0; i < world.projectiles.length; i++) {
      const pr = world.projectiles[i];
      if (this.projPool.length <= i) {
        const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const mesh = new THREE.Mesh(this.projGeo, mat); mesh.frustumCulled = false; this.scene.add(mesh); this.projPool.push({ mesh, mat });
      }
      const s = this.projPool[i];
      s.mesh.visible = true; s.mesh.position.set(pr.x, 1.0, pr.z);
      s.mesh.rotation.y = Math.atan2(pr.vx, pr.vz); // tracer aligned to travel
      const k = pr.friendly ? 1.2 : 0.9;
      s.mesh.scale.set(k, k, pr.friendly ? 2.6 : 1.8);
      s.mat.color.set(pr.color);
    }
    for (let i = world.projectiles.length; i < this.projPool.length; i++) this.projPool[i].mesh.visible = false;

    // pickups
    for (let i = 0; i < world.pickups.length; i++) {
      const pk = world.pickups[i];
      if (this.pickupPool.length <= i) {
        const mesh = new THREE.Mesh(this.pickupGeo, new THREE.MeshStandardMaterial({ color: 0x0a0a14, emissive: new THREE.Color(0x53ff8a), emissiveIntensity: 2 }));
        mesh.frustumCulled = false; this.scene.add(mesh); this.pickupPool.push(mesh);
      }
      const m = this.pickupPool[i]; m.visible = true;
      m.position.set(pk.x, 0.7 + Math.sin(this.t * 3 + i) * 0.15, pk.z); m.rotation.y = this.t * 2;
    }
    for (let i = world.pickups.length; i < this.pickupPool.length; i++) this.pickupPool[i].visible = false;

    this.particles.update(dt);
    this.rings.update(dt);
    this.renderShake = Math.max(0, this.renderShake - 2.5 * dt);
  }

  applyShake(cam: THREE.Object3D, base: THREE.Vector3) {
    const amp = this.renderShake * 0.6;
    cam.position.set(
      base.x + (Math.random() * 2 - 1) * amp,
      base.y + (Math.random() * 2 - 1) * amp * 0.5,
      base.z + (Math.random() * 2 - 1) * amp,
    );
  }
}
