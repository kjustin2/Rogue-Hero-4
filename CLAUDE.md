# Rogue Hero 4 — first-person neon combo brawler (plain Three.js)

A first-person action game: you walk down a long, wide neon **causeway**, fight rift-born
enemies at sealed **gates**, and bring down the **Rift Warden** boss at the far end. You wield a
**swappable arsenal** of weapons (most ranged, some melee), each with a fast LIGHT attack (LMB), a
strong HEAVY attack (RMB), and its own light/heavy **combos** that fire FORWARD (a barrage comet,
rocket volley, mega-beam, or air-strike cluster). Weapons are mechanically distinct — fast bolts, a
melee greatsword, explosive rockets, an instant hitscan laser, called-down air strikes. **E** swaps
weapon, **Dash** dodges. New weapons are **found on the ground** along the causeway (dramatic claim);
kills drop **rift shards** that heal.

Stack: **plain Three.js + Vite + strict TypeScript, shipped as Electron** — no game engine, no UI
framework, no test framework. It was rebuilt from the Rogue-Hero-3 action-roguelike base: the proven
infra (post stack, feel primitives, audio, Electron shell, harness) was kept; the card/tempo/relic/
roguelite gameplay was replaced with this first-person combo loop.

## Architecture (sim → render → HUD, one composition root)
- **`src/main.ts`** — the one composition root: builds the Ctx, owns the single loop (`frame(dt)` +
  `setAnimationLoop`), the state machine (`title → playing → paused → dead → victory`), the run flow
  (gate waves → boss → victory/death), and the **`window.__rh4`** test seam (`__rh4debug.scenario`,
  `frames(n,dt)`, `checkCombos`).
- **`src/game/`** — Three-free-ish sim: `ctx.ts` (type-only hub), `weapons.ts` (arsenal catalog:
  per-weapon light/heavy attack defs with distinct `mode` (bolt/rocket/laser/airstrike/melee) +
  light/heavy combos + `matchWeaponCombo`/`weaponComboSelfCheck`), `player.ts` (FP controller +
  weapon switch/light/heavy + per-mode fire + combo buffer + rift-shard counter + `unlockWeapon` +
  viewmodel), `combat.ts` (the one damage funnel: `dealDamage` / `meleeSweep` / `aoeDamage` /
  hitscan `beam` / scheduled-strike `update` / `resolveCombo` (forward finishers) / `damagePlayer`),
  `enemies.ts` (4 archetypes + wave spawner), `boss.ts`, `pickups.ts` (rift shards + ground weapon
  pickups), `level.ts` (level-as-data: causeway + bounds + gates), `projectiles.ts` (pooled comets +
  big/pierce/explode/gravity).
- **`src/render/`** — `stage.ts` (renderer + post chain), `fpsCamera.ts` (yaw/pitch mouse-look +
  trauma/kick/FOV feel, parks the stage camera at the eyes), feel primitives `particles.ts`,
  `trail.ts`, `telegraphs.ts`, `floaters.ts` (reused from RH3, untouched).
- **`src/ui/`** — `hud.ts` (crosshair, health, rift-shard counter, equipped-weapon panel + swap rack,
  per-weapon combo codex, live combo chain, boss bar, distance) and `menus.ts` (title/pause/dead/
  victory; title is deliberately title + button only — no wall of text).
- **`src/core/`**, **`src/audio/`** — `events.ts` (typed bus, rewritten EventMap), `input.ts`
  (repurposed actions + pointer-lock mouse-look), `math.ts`, `rng.ts`, `sfx.ts` (procedural),
  `music.ts` (streamed).

## Conventions
- **Camera-relative movement** via `cam.worldForward`/`worldRight` (ground-projected) — never world -Z.
- **One damage funnel** (`Combat`): all HP changes route through it. Combo bonus + AoE live in
  `resolveCombo`, not callers.
- **Typed event bus** (`core/events.ts`): emit-only from sim; sfx/HUD subscribe. A typo'd event is a
  compile error.
- **Emissive = light**: pair emissive materials with co-located PointLights (pillars, gates, boss).
- The weapon viewmodel is parented to `stage.camera`, so `main` adds the camera to the scene.
- Avoid per-frame allocation in update loops (reuse scratch vectors).

## Harness (real renderer, never a mock)
- `npm run typecheck` — `tsc --noEmit`; the static gate.
- `npm run build` — typecheck + `vite build`.
- `npm run smoke` — builds, boots the BUILT game in a (showInactive) Electron/Chromium window, drives
  title → path → combat → **STARFALL barrage combo** → weapon-swap showcase → boss → victory → death,
  asserts non-black frames + zero console errors + `checkCombos()` clean + draw calls > 0, writes
  `shots/electron-*.png`. **Read the screenshots** — a clean console over a black canvas is still a failure.
- `npm start` — standalone Electron window (serves `dist/` over fixed loopback port 41730 so
  origin-keyed localStorage survives).
- A never-shown Electron window suspends rAF and won't recomposite the DOM overlay — the smoke drives
  the sim via `__rh4debug.frames(n,dt)` and uses `showInactive()` for accurate captures.

## Gotchas confirmed here
- `requestPointerLock()` returns a promise that rejects without a user gesture / in a hidden window —
  `Input.lockPointer` swallows it (else it spams console errors and fails the smoke).
- `tsc` flags unused **private** class methods (TS6133), not just locals — delete dead ones.
