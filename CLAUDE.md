# Rogue Hero 4 — first-person neon combo brawler (plain Three.js)

A first-person action game: you walk down a long, wide neon **causeway**, fight rift-born
enemies at sealed **gates**, and bring down the **Rift Warden** boss at the far end. You have a
**limited moveset** of three glyphs (Strike / Cleave / Bolt) plus a Dash; chaining glyphs within
a time window resolves named **combos** (CRESCENDO, ARC LANCE, QUAKE, VOID NOVA) with big AoE
payoffs and signature VFX.

Stack: **plain Three.js + Vite + strict TypeScript, shipped as Electron** — no game engine, no UI
framework, no test framework. It was rebuilt from the Rogue-Hero-3 action-roguelike base: the proven
infra (post stack, feel primitives, audio, Electron shell, harness) was kept; the card/tempo/relic/
roguelite gameplay was replaced with this first-person combo loop.

## Architecture (sim → render → HUD, one composition root)
- **`src/main.ts`** — the one composition root: builds the Ctx, owns the single loop (`frame(dt)` +
  `setAnimationLoop`), the state machine (`title → playing → paused → dead → victory`), the run flow
  (gate waves → boss → victory/death), and the **`window.__rh4`** test seam (`__rh4debug.scenario`,
  `frames(n,dt)`, `checkCombos`).
- **`src/game/`** — Three-free-ish sim: `ctx.ts` (type-only hub), `moves.ts` (glyph catalog, data),
  `combos.ts` (pure suffix matcher + `comboSelfCheck`), `player.ts` (FP controller + moveset +
  combo buffer + weapon viewmodel), `combat.ts` (the one damage funnel: `dealDamage` / `meleeSweep`
  / `resolveCombo` / `damagePlayer`), `enemies.ts` (3 archetypes + wave spawner), `boss.ts`,
  `level.ts` (level-as-data: causeway geometry + bounds clamp + gate barriers), `projectiles.ts`.
- **`src/render/`** — `stage.ts` (renderer + post chain), `fpsCamera.ts` (yaw/pitch mouse-look +
  trauma/kick/FOV feel, parks the stage camera at the eyes), feel primitives `particles.ts`,
  `trail.ts`, `telegraphs.ts`, `floaters.ts` (reused from RH3, untouched).
- **`src/ui/`** — `hud.ts` (crosshair, health, glyph cooldowns, live combo chain, combo codex, boss
  bar, distance) and `menus.ts` (title/pause/dead/victory).
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
  title → path → combat → **CRESCENDO combo** → boss → victory → death, asserts non-black frames +
  zero console errors + `checkCombos()` clean + draw calls > 0, writes `shots/electron-*.png`. **Read
  the screenshots** — a clean console over a black canvas is still a failure.
- `npm start` — standalone Electron window (serves `dist/` over fixed loopback port 41730 so
  origin-keyed localStorage survives).
- A never-shown Electron window suspends rAF and won't recomposite the DOM overlay — the smoke drives
  the sim via `__rh4debug.frames(n,dt)` and uses `showInactive()` for accurate captures.

## Gotchas confirmed here
- `requestPointerLock()` returns a promise that rejects without a user gesture / in a hidden window —
  `Input.lockPointer` swallows it (else it spams console errors and fails the smoke).
- `tsc` flags unused **private** class methods (TS6133), not just locals — delete dead ones.
