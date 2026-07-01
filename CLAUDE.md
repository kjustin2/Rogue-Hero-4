# Rogue Hero 4 — first-person dark-fantasy combo brawler (plain Three.js)

A first-person action game: you descend a torch-lit gothic **causeway**, break undead waves at
three sealed **gates** (claiming a **boon** after each), and fell **Mordrek the Barrow King** in
the arena at the end. A **swappable arsenal** of five weapons (crossbow / greatsword / hand
bombard / prism rod / storm caller), each with a fast LIGHT (LMB), a strong HEAVY (RMB, **hold to
charge** on three of them), and its own combos whose finishers fire FORWARD. Combo finishers build
**fervor** (full = next heavy free + empowered); the chain **survives weapon swaps** (SWAP FINISH
1.25×). **Dash** i-frames; dodging through a hit is a PERFECT (slow-mo + cooldown refund). Kills
drop gold **rift shards** that heal; elites (crowned: shielded/frenzied/bursting) always drop one.
Meta saves (localStorage `rh4-save`): clears, best time, starting-weapon unlocks, **DAILY RITE**
seed + score.

Stack: **plain Three.js + Vite + strict TypeScript, shipped as Electron** — no game engine, no UI
framework, no test framework. Rebuilt from the Rogue-Hero-3 base, then remade (2026-07): Meshy GLB
art, palette/color-hierarchy overhaul, spawn director + elites, boss overhaul, boons/meta/daily.

## Architecture (sim → render → HUD, one composition root)
- **`src/main.ts`** — the one composition root: builds the Ctx (top-level awaits
  `models.preload()` FIRST, then systems, then adds the hidden GLB **warm rack** before
  `stage.warmUp()`), owns the single loop (`frame(dt)`), the state machine
  (`title → playing → paused → boon → dead → victory`), run flow (gate waves → boon → boss →
  victory/death incl. killcam slow-mo), run stats, meta-save writes, and the **`window.__rh4`**
  seam (`__rh4debug.scenario/frames/checkCombos/models/drainWave`, `__rh4perf`).
- **`src/game/`** — sim: `ctx.ts` (type-only hub), `weapons.ts` (arsenal catalog + chargeable
  heavies + `matchWeaponCombo`/self-check), `player.ts` (FP controller, charge/fervor/swap-combo
  buffer, PlayerMods read sites, viewmodels = Meshy GLBs via `glbWeapon` with procedural
  fallbacks), `combat.ts` (the one damage funnel; `modifyIncoming` hook for shielded elites;
  lifesteal/dmg-taken mods; `resolveCombo` forward finishers), `enemies.ts` (6 archetypes,
  **pooled** per kind, roles/flanking, **ELITES** catalog, **spawn director** — per-gate
  {budget,cap,pack,eliteChance}, trickle + hp-reading pacing, `waveDone()`), `boss.ts` (anchors +
  shift glide, slam/volley/beam/sweep/collapse/**gravewave**/**harvest**, phase-3 soulfire pools +
  recurring adds with guaranteed shards, per-phase telegraph colors), `boons.ts` (12 data boons →
  flat `PlayerMods`), `pickups.ts` (gold economy), `level.ts` (level-as-data causeway with segment
  identity: Outer Ward → Grave Ward → Reliquary Approach; `gutterAt(z)` torch fade; GLB props),
  `projectiles.ts` (pooled).
- **`src/render/`** — `stage.ts` (post chain: bloom(0.92/thr 0.45)/SSAO(high)/CA/grade/SMAA,
  quality tiers, dual-composer warm-up), **`models.ts`** (Meshy GLB loader: preload-at-boot,
  Box3-normalize, FrontSide fix, static clone / SkeletonUtils+AnimationMixer rigged instancing,
  `?noglb` kill-switch, warm rack), `enemyMeshes.ts`/`bossMesh.ts` (procedural fallbacks + GLB
  visual builders with core-glow overlays), `fpsCamera.ts`, `particles/trail/telegraphs/floaters`.
- **`src/core/`** — `events.ts` (typed bus incl. FERVOR), `input.ts` (rebindable; pointer-lock
  pause fires only on GENUINE lock loss — `realLocked` vs harness-faked `pointerLocked`),
  `palette.ts` (**the color authority**), `save.ts` (versioned meta), `math.ts`, `rng.ts`,
  `settings.ts`. **`src/audio/`** — procedural `sfx.ts`, streamed `music.ts` (combat bed advances
  per gate; boss phase 3 = finale lament). **`src/debug/perfMonitor.ts`** wired in main (F8 HUD,
  spike classifier).

## Conventions
- **Color hierarchy (core/palette.ts)**: world = warm dark stone; **threat red** = every hostile
  telegraph/projectile/strike arc; **gold** = player economy (shards, beacons, PERFECT, fervor);
  **soulfire teal** = undead cores, hit identity, boss, rift maw. Never cross these.
- **One damage funnel** (`Combat`): all HP changes route through it (boon mods read there too).
- **Typed event bus**; camera-relative movement; avoid per-frame allocation (scratch vectors,
  `living()` returns a reusable scratch — consume immediately).
- **GLB assets are optional**: every model has a procedural fallback; `?noglb` must stay green.
  New GLB materials must be in-scene before `stage.warmUp()` (the warm rack) or first use stalls.
- Meshy regeneration is non-deterministic and costs credits — committed GLBs are permanent
  artifacts; iterate with `scripts/probe-viewmodel.cjs` screenshots, never by regenerating.

## Harness (real renderer, never a mock)
- `npm run typecheck` / `npm run build` — static gates.
- `npm run smoke` — builds, boots the BUILT game hidden in Electron, drives the full slice
  (title → wave → **boon pick** → arsenal showcase → **charged-heavy/fervor/swap-combo/elite**
  asserts → boss phases/gravewave/killcam → victory **meta-save assert** → death → **?noglb
  fallback pass**), asserts non-black frames, zero console errors, all 14 GLBs loaded,
  draw calls < 700. **Read the screenshots** (`shots/electron-*.png`).
- `npx electron scripts/soak-electron.cjs` — real-GPU boss-fight soak: p95 ≤ 20ms budget,
  freeze-class frames = 0, classified spikes (compile vs gc).
- `npm start` — standalone window (fixed port 41730 keeps origin-keyed saves alive).
- `npm run package` — electron-builder portable exe.

## Gotchas confirmed here
- `requestPointerLock()` rejects without a gesture/hidden window — `Input.lockPointer` swallows
  it. Chromium fires `pointerlockchange` for `exitPointerLock()` even when nothing was locked,
  and menu-requested unlocks can land a state later — pause only on genuine lock loss.
- A never-shown Electron window suspends rAF — the smoke drives `__rh4debug.frames(n,dt)` and
  uses `showInactive()`; real-time waits (screenshots) DO advance the game (window paints).
- Meshy rigging/animation GLB urls live at `task.result.rigged_character_glb_url` /
  `animation_glb_url` (not `model_urls.glb`); clip carrier GLBs are optimized with 16px textures
  (only their `animations[0]` is used).
- `tsc` flags unused private class methods (TS6133) — delete dead ones.
- The wave director keeps trickling by design — tests fast-forwarding a gate must
  `__rh4debug.drainWave()` before mass-killing.
