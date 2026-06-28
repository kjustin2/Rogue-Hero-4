import {
  onStart, onUpdate, onBeforeRender, onAfterRender, addComponent, setAutoFitEnabled, loadPMREM,
  PostProcessingManager, BloomEffect, ToneMappingEffect, Antialiasing,
  ScreenSpaceAmbientOcclusionN8, Vignette, ChromaticAberration,
} from "@needle-tools/engine";
import * as THREE from "three";
import { Bus } from "./sim/bus.js";
import { World } from "./sim/world.js";
import { Hud } from "./render/hud.js";
import { View } from "./render/view.js";
import { Audio } from "./audio.js";
import { ROAD_HALF, ROAD_LEN, BOSS_AT, BIOMES, NEON } from "./sim/content.js";

const PARAMS = new URLSearchParams(location.search);
const LOWFX = PARAMS.has("lowfx");
const NOSKY = LOWFX || PARAMS.has("nosky");
const NOENV = LOWFX || PARAMS.has("noenv");
const META_KEY = "rh4.meta";
const EYE_Y = 1.7;
const SENS = 0.0022;

type Mode = "title" | "playing" | "draft" | "gameover" | "win";

onStart((context) => {
  const scene = context.scene;
  const cam = context.mainCamera as THREE.PerspectiveCamera | undefined;
  if (cam) { cam.fov = 80; cam.near = 0.1; cam.far = 420; cam.updateProjectionMatrix(); }

  // perf counters (capture right after the draw; Needle resets info per frame)
  let lastCalls = 0, lastTris = 0;
  context.renderer.info.autoReset = false;
  onBeforeRender(() => context.renderer.info.reset());
  onAfterRender(() => { lastCalls = context.renderer.info.render.calls; lastTris = context.renderer.info.render.triangles; });

  scene.fog = new THREE.Fog(0x06060c, 28, 240);

  // gradient sky for atmosphere (dark crown → faintly lit violet horizon)
  if (!NOSKY) {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(420, 24, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x04060f) }, bot: { value: new THREE.Color(0x190d2c) } },
      vertexShader: "varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader: "varying vec3 vP; uniform vec3 top; uniform vec3 bot; void main(){ float h=normalize(vP).y*0.5+0.5; gl_FragColor=vec4(mix(bot,top,smoothstep(0.0,0.62,h)),1.0); }",
    }));
    sky.frustumCulled = false; setAutoFitEnabled(sky, false); scene.add(sky);
  }

  // image-based lighting → PBR reflections (subtle, so the neon stays the star)
  if (!NOENV) {
    loadPMREM("https://cdn.needle.tools/static/hdris/photo_studio_01_4k.pmrem.ktx2", context.renderer)
      .then((t) => { if (t) { scene.environment = t; scene.environmentIntensity = 0.72; } });
  }

  // --- lights
  scene.add(new THREE.HemisphereLight(0x3a4e7a, 0x0c0c18, 0.95));
  const key = new THREE.DirectionalLight(0xfff0e0, 2.5);
  key.position.set(12, 28, -8); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera; sc.left = -ROAD_HALF * 2; sc.right = ROAD_HALF * 2; sc.top = 50; sc.bottom = -50; sc.near = 1; sc.far = 130;
  key.shadow.bias = -0.0004; scene.add(key);

  // --- the road
  const mid = ROAD_LEN / 2;
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(ROAD_HALF * 2 + 2, 1, ROAD_LEN + 70),
    new THREE.MeshStandardMaterial({ color: 0x12131f, metalness: 0.8, roughness: 0.34, envMapIntensity: 0.95 }),
  );
  floor.position.set(0, -0.5, mid); floor.receiveShadow = true; setAutoFitEnabled(floor, false); scene.add(floor);

  for (const sgn of [-1, 1]) { // emissive edge rails define the road + give parallax
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.5, ROAD_LEN + 70),
      new THREE.MeshStandardMaterial({ color: 0x05050a, emissive: new THREE.Color(NEON.cyan), emissiveIntensity: 1.8 }),
    );
    rail.position.set(sgn * ROAD_HALF, 0.2, mid); setAutoFitEnabled(rail, false); scene.add(rail);
  }

  const pcols = [NEON.cyan, NEON.mag, NEON.violet, NEON.amber];
  for (let z = 8, i = 0; z < ROAD_LEN; z += 11, i++) { // pillars receding toward the boss
    for (const sgn of [-1, 1]) {
      const p = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 4.6, 0.6),
        new THREE.MeshStandardMaterial({ color: 0x04040a, emissive: new THREE.Color(pcols[i % pcols.length]), emissiveIntensity: 2.2, roughness: 0.4 }),
      );
      p.position.set(sgn * (ROAD_HALF + 1.4), 2.3, z); p.castShadow = true; setAutoFitEnabled(p, false); scene.add(p);
    }
  }

  // end gate + light beam = the boss landmark, visible from the start (also the menu backdrop)
  const gate = new THREE.Mesh(
    new THREE.TorusGeometry(7, 0.6, 12, 48),
    new THREE.MeshStandardMaterial({ color: 0x100406, emissive: new THREE.Color(NEON.red), emissiveIntensity: 2.6 }),
  );
  gate.position.set(0, 6.5, ROAD_LEN); setAutoFitEnabled(gate, false); scene.add(gate);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 0.7, 34, 8),
    new THREE.MeshBasicMaterial({ color: NEON.red, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  beam.position.set(0, 16, BOSS_AT); setAutoFitEnabled(beam, false); scene.add(beam);

  // --- look post
  if (!LOWFX) {
    const post = addComponent(scene, PostProcessingManager);
    const ssao = post.addEffect(new ScreenSpaceAmbientOcclusionN8());
    ssao.aoRadius.value = 0.9; ssao.intensity.value = 2.4; ssao.falloff.value = 1;
    const bloom = post.addEffect(new BloomEffect());
    bloom.threshold.value = 1.0; bloom.intensity.value = 0.85; bloom.scatter.value = 0.72;
    post.addEffect(new ToneMappingEffect()).setMode("Neutral");
    post.addEffect(new Antialiasing());
    post.addEffect(new Vignette()).intensity.value = 0.3;
    post.addEffect(new ChromaticAberration()).intensity.value = 0.0016;
  }

  // --- game objects
  const bus = new Bus(); new Audio(bus);
  const world = new World(bus);
  const view = new View(scene, bus);
  view.player.visible = false; // first-person: no external avatar
  const hud = new Hud(bus);
  const state = { mode: "title" as Mode };
  let curChar = "pyre";

  // a caster glow that follows the player so the road lights up around you
  const camLight = new THREE.PointLight(0x9fdcff, 2.8, 32, 1.4); scene.add(camLight);

  // --- first-person look + input
  let yaw = 0, pitch = 0, paused = false, wasLocked = false;
  const settings = { sens: 1, invertY: false };
  try { Object.assign(settings, JSON.parse(localStorage.getItem("rh4.settings") || "{}")); } catch { /* ignore */ }
  const saveSettings = () => { try { localStorage.setItem("rh4.settings", JSON.stringify(settings)); } catch { /* ignore */ } };
  const canvas = context.renderer.domElement as HTMLCanvasElement;
  const locked = () => document.pointerLockElement === canvas;
  const lock = () => { try { const r = canvas.requestPointerLock() as unknown as Promise<void> | undefined; if (r && typeof (r as any).catch === "function") (r as Promise<void>).catch(() => { }); } catch { /* ignore */ } };
  addEventListener("mousemove", (e) => { if (locked()) { yaw -= e.movementX * SENS * settings.sens; pitch = Math.max(-1.3, Math.min(1.3, pitch + (settings.invertY ? 1 : -1) * e.movementY * SENS * settings.sens)); } });
  document.addEventListener("pointerlockchange", () => {
    const now = locked();
    // only pause if lock was actually HELD then lost (Esc) — not when it simply failed to engage
    if (state.mode === "playing" && wasLocked && !now && !paused) {
      paused = true; hud.showPause(settings, saveSettings, () => { paused = false; hud.clearOverlay(); lock(); });
    }
    wasLocked = now;
  });
  addEventListener("pointerdown", (e) => {
    if (state.mode !== "playing" || paused) return;
    if (!locked()) { lock(); return; }   // click the game to capture the mouse for look (standard FPS)
    if (e.button === 0) world.cast(0); else if (e.button === 2) world.cast(1);
  });
  addEventListener("contextmenu", (e) => e.preventDefault());
  addEventListener("keydown", (e) => {
    if (state.mode !== "playing" || e.repeat) return;
    if (e.code === "Digit1") world.cast(0);
    else if (e.code === "Digit2") world.cast(1);
    else if (e.code === "Digit3") world.cast(2);
    else if (e.code === "Digit4") world.cast(3);
    else if (e.code === "Space") castDash();
  });
  const castDash = () => { const i = world.player?.cards.findIndex((c) => c.def.kind === "dash") ?? -1; if (i >= 0) world.cast(i); };

  const v = new THREE.Vector3(), look = new THREE.Vector3();
  const project = (x: number, y: number, z: number) => {
    v.set(x, y, z).project(cam!);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, vis: v.z < 1 };
  };

  const setBiome = () => { const b = BIOMES[Math.min(world.depth - 1, BIOMES.length - 1)]; (scene.fog as THREE.Fog).color.setHex(b.fog); };
  const saveMeta = (win: boolean) => {
    try {
      const m = { runs: 0, bestDepth: 0, kills: 0, unlocked: [] as string[], seenTutorial: false, ...JSON.parse(localStorage.getItem(META_KEY) || "{}") };
      m.runs++; m.kills += world.kills; m.bestDepth = Math.max(m.bestDepth, world.depth);
      if (win && !m.unlocked.includes("frost")) m.unlocked.push("frost");
      if (m.bestDepth >= 2 && !m.unlocked.includes("shadow")) m.unlocked.push("shadow");
      localStorage.setItem(META_KEY, JSON.stringify(m));
    } catch { /* private mode */ }
  };
  const loadUnlocked = (): Set<string> => {
    try { const m = JSON.parse(localStorage.getItem(META_KEY) || "{}"); return new Set(["pyre", ...(m.unlocked || [])]); }
    catch { return new Set(["pyre"]); }
  };
  const startRun = (charId: string) => {
    curChar = charId; world.start(charId, (Math.random() * 1e9) >>> 0);
    yaw = 0; pitch = 0; paused = false; state.mode = "playing"; hud.clearOverlay(); setBiome();
    // do NOT auto-request pointer lock here (fragile after a DOM-overlay click) — the player
    // clicks the game to lock; a prominent prompt tells them so.
  };
  const toSelect = () => { state.mode = "title"; document.exitPointerLock?.(); hud.showSelect(loadUnlocked(), (id) => startRun(id)); };

  bus.on("draft:open", ({ choices }) => {
    state.mode = "draft"; document.exitPointerLock?.();
    hud.showDraft(choices, (id) => { world.chooseRelic(id); world.nextAct(); setBiome(); state.mode = "playing"; });
  });
  bus.on("run:win", () => { state.mode = "win"; document.exitPointerLock?.(); saveMeta(true); hud.showEnd(true, world.depth, world.kills, () => startRun(curChar)); });
  bus.on("run:lose", () => { state.mode = "gameover"; document.exitPointerLock?.(); saveMeta(false); hud.showEnd(false, world.depth, world.kills, () => startRun(curChar)); });

  // --- frame loop
  onUpdate((ctx) => {
    const dt = ctx.time.deltaTime;
    const fp = state.mode === "playing" && !!cam && !!world.player;
    if (fp && !paused) {
      const input = ctx.input;
      const sy = Math.sin(yaw), cy = Math.cos(yaw);
      let mx = 0, mz = 0;
      if (input.getKeyPressed("KeyW")) { mx += sy; mz += cy; }
      if (input.getKeyPressed("KeyS")) { mx -= sy; mz -= cy; }
      if (input.getKeyPressed("KeyD")) { mx -= cy; mz += sy; } // screen-right
      if (input.getKeyPressed("KeyA")) { mx += cy; mz -= sy; }
      world.input.mx = mx; world.input.mz = mz;
      world.input.ax = world.player!.x + sy * 12; world.input.az = world.player!.z + cy * 12; // aim where you look
      world.update(dt);
      view.sync(world, dt);
      hud.update(world, project, dt);
      camLight.position.set(world.player!.x, 2.4, world.player!.z);
    }
    if (fp && cam) {
      const amp = view.renderShake * 0.5, cp = Math.cos(pitch), sy = Math.sin(yaw), cy = Math.cos(yaw);
      cam.position.set(
        world.player!.x + (Math.random() * 2 - 1) * amp, EYE_Y + (Math.random() * 2 - 1) * amp, world.player!.z + (Math.random() * 2 - 1) * amp,
      );
      look.set(cam.position.x + sy * cp, cam.position.y + Math.sin(pitch), cam.position.z + cy * cp);
      cam.lookAt(look);
      hud.lookHint(!locked() && !paused);
    } else if (cam) {
      cam.position.set(0, 5, 2); cam.lookAt(0, 4.5, 80); // scenic menu cam down the road
      camLight.position.set(0, 8, 24); hud.lookHint(false); // light the near road behind the menu
    }
    hud.root.style.display = state.mode === "playing" ? "" : "none";
  });

  // --- test seam
  (window as any).__rh4 = {
    ctx: context, world, bus, view,
    get mode() { return state.mode; },
    start: (c = "pyre") => startRun(c),
    cast: (i: number) => world.cast(i),
    setMove: (x: number, z: number) => { world.input.mx = x; world.input.mz = z; },
    aimAt: (x: number, z: number) => { world.input.ax = x; world.input.az = z; },
    look: (dx: number, dy: number) => { yaw -= dx * SENS; pitch = Math.max(-1.3, Math.min(1.3, pitch - dy * SENS)); },
    getYaw: () => yaw,
    getPos: () => world.player ? { x: world.player.x, y: 0, z: world.player.z } : { x: 0, y: 0, z: 0 },
    frameStats: () => ({ drawCalls: lastCalls, triangles: lastTris, enemies: world.alive }),
    scenario: (spec = "combat") => {
      const s = spec.toLowerCase();
      if (s.includes("title")) { state.mode = "title"; hud.showStart(toSelect); return; }
      if (s.includes("select")) { toSelect(); return; }
      startRun(s.includes("frost") ? "frost" : s.includes("shadow") ? "shadow" : "pyre");
      const w = world, p = w.player;
      if (s.includes("boss")) { p.z = BOSS_AT - 18; w.bossActive = true; if (w.bossEnt) w.bossEnt.dormant = false; }
      else { const n = s.includes("swarm") ? 12 : 5; for (let i = 0; i < n; i++) w.spawnEnemy(i % 3 === 0 && s.includes("swarm") ? "darter" : "darter", p.x + (Math.random() * 2 - 1) * ROAD_HALF * 0.8, p.z + 10 + Math.random() * 22, false); }
    },
    scenarios: () => ["title", "select", "combat", "swarm", "boss", "frost", "shadow"],
    ready: true,
  };

  hud.showStart(toSelect);
  console.log("[rh4] booted (first-person road)");
});
