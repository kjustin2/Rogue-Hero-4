# Rogue Hero 4 — first-person dark-fantasy combo brawler (plain Three.js)

A first-person action game: you descend a torch-lit gothic **causeway**, break undead waves at
three sealed **gates** (claiming a **boon** after each), and fell **Mordrek the Barrow King** in
the arena at the end. A **swappable arsenal** of seven weapons (crossbow / greatsword / hand
bombard / prism rod / storm caller / GRAVE MAUL / FRANCISCA AXES), each with a fast LIGHT (LMB), a
strong HEAVY (RMB, **hold to charge** on four: greatsword/bombard/prism rod/maul — `chargeMax`/
`chargeMult` in weapons.ts), and its own combos whose finishers fire FORWARD. You **carry at most
5** (`Player.MAX_WEAPONS`); grabbing a pickup while full emits `WEAPON_OFFER` → the forced **swap
screen** (trade an owned weapon or decline). Combo finishers build
**fervor** (full = next heavy free + empowered); the chain **survives weapon swaps** (SWAP FINISH
1.25×). **Dash** i-frames; dodging through a hit is a PERFECT (slow-mo + cooldown refund). Kills
drop gold **rift shards** that heal; elites (crowned: shielded/frenzied/bursting) always drop one.
Meta saves (localStorage `rh4-save`): clears, best time, starting-weapon unlocks.

Stack: **plain Three.js + Vite + strict TypeScript, shipped as Electron** — no game engine, no UI
framework, no test framework. Rebuilt from the Rogue-Hero-3 base, then remade (2026-07):
palette/color-hierarchy overhaul, spawn director + elites, boss overhaul, boons/meta.
**All art is procedural** (primitives + canvas textures) — Meshy GLB assets were tried and
REMOVED by user decision (they read worse than the stylized primitives); do not reintroduce.

## Architecture (sim → render → HUD, one composition root)
- **`src/main.ts`** — the one composition root: builds the Ctx, owns the single loop (`frame(dt)`), the state machine
  (`title → playing → paused → boon → swap → dead → victory`), run flow (gate waves → boon → boss →
  victory/death incl. killcam slow-mo), run stats, meta-save writes, and the **`window.__rh4`**
  seam (`__rh4debug.scenario/frames/checkCombos/drainWave`, `__rh4perf`).
- **`src/game/`** — sim: `ctx.ts` (type-only hub), `weapons.ts` (arsenal catalog + chargeable
  heavies + `matchWeaponCombo`/self-check), `player.ts` (FP controller, charge/fervor/swap-combo
  buffer, PlayerMods read sites, per-weapon procedural viewmodels), `combat.ts` (the one damage funnel; `modifyIncoming` hook for shielded elites;
  lifesteal/dmg-taken mods; `resolveCombo` forward finishers; **long-range falloff** — full damage
  ≤18u, tapering to 45% by ~50u; **micro-hitstop** per hit — `ctx.hitstop` 0.02–0.12s scaled by
  crit/kill/heavy, main runs the frame at dt×0.08 while it drains), `enemies.ts` (6 archetypes,
  **pooled** per kind, roles/flanking, **ELITES** catalog, **spawn director** — per-gate
  {budget,cap,pack,eliteChance}, trickle + hp-reading pacing, `waveDone()`), `boss.ts` (anchors +
  shift glide, slam/volley/beam/sweep/collapse/**gravewave**/**harvest**, phase-3 soulfire pools +
  recurring adds with guaranteed shards, per-phase telegraph colors), `boons.ts` (12 data boons →
  flat `PlayerMods`), `pickups.ts` (gold economy), `level.ts` (level-as-data causeway with segment
  identity: Outer Ward → Grave Ward → Reliquary Approach; `gutterAt(z)` torch fade),
  `projectiles.ts` (pooled).
- **`src/render/`** — `stage.ts` (post chain: bloom(0.92/thr 0.45)/SSAO(high)/CA/grade/SMAA,
  quality tiers, dual-composer warm-up), `enemyMeshes.ts`/`bossMesh.ts` (procedural body
  factories, kept separate from the sim logic), `fpsCamera.ts`,
  `particles/trail/telegraphs/floaters`.
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
- New materials must be in-scene before `stage.warmUp()` or their first use stalls a frame.

## Harness (real renderer, never a mock)
- `npm run typecheck` / `npm run build` — static gates.
- `npm run smoke` — builds, boots the BUILT game hidden in Electron, drives the full slice
  (title → wave → **boon pick** → arsenal showcase → **charged-heavy/fervor/swap-combo/elite**
  asserts → boss phases/gravewave/killcam → victory **meta-save assert** → death), asserts
  non-black frames, zero console errors, draw calls < 700. **Read the screenshots**
  (`shots/electron-*.png`).
- `npx electron scripts/soak-electron.cjs` — real-GPU boss-fight soak: p95 ≤ 20ms budget,
  freeze-class frames = 0, classified spikes (compile vs gc).
- `npm start` — standalone window (fixed port 41730 keeps origin-keyed saves alive).
- `npm run package` — electron-builder portable exe.

## Hard-won constraints (do not re-derive)
- `stage.ts` look/bloom config (intensity 0.92 / threshold 0.45, per-tier chains) is deliberately
  tuned — do NOT change it; tune the individual FX instead.
- `bright=X%` in smoke output is the non-black pixel fraction (black-screen guard), NOT a washout
  meter — judge washout only by viewing the PNGs.
- Blinding-FX rule: no attack/combo/projectile FX may fill a large fraction of the screen or stack
  additive white; always pass particle `size` explicitly; audit overlapping emissive instances.
- Aim fidelity: every projectile/beam/hitscan inherits full 3D camera aim (pitch included) —
  `Combat.beam()` takes the aim Vector3; every enemy/boss attack aims at the player's ACTUAL
  position. One aim bug found = audit all fire paths.
- `tele.line()` angle convention: the strip runs along (sin a, cos a) — compute the angle as
  `atan2(xComponent, zComponent)` (see boss.ts aim code).
- `mergeStatic()` (enemyMeshes.ts): merging mixed indexed/non-indexed geometry silently drops
  parts — it normalizes via `toNonIndexed()` first; keep that invariant.
- InstancedMesh frustum-culls off its base-geometry bounds at the origin → set
  `frustumCulled = false` for spread instances (see level.ts). Changing the scene's point-light
  count mid-combat forces a synchronous relink of every MeshStandardMaterial — the boss light is
  pre-added and scene-owned (boss.ts / bossMesh.ts); never spawn/remove lights live.
- Boss weak-point coupling: `CORE_Y` (boss.ts) assumes the boss group's scale — don't rescale the
  boss group.
- `shots/` is gitignored and accumulates stale files — wipe or mtime-filter before judging
  screenshots.
- Windows/Git Bash: large heredocs fail — write a script file to the scratchpad and run it.
- Transient UI (combo splash, banner, boss bar) must stay mutually exclusive — never duplicated,
  never occluding each other (`showBanner` already suppresses the combo splash; keep that rule).

## Gotchas confirmed here
- `requestPointerLock()` rejects without a gesture/hidden window — `Input.lockPointer` swallows
  it. Chromium fires `pointerlockchange` for `exitPointerLock()` even when nothing was locked,
  and menu-requested unlocks can land a state later — pause only on genuine lock loss.
- A never-shown Electron window suspends rAF — the smoke drives `__rh4debug.frames(n,dt)` and
  uses `showInactive()`; real-time waits (screenshots) DO advance the game (window paints).
- `tsc` flags unused private class methods (TS6133) — delete dead ones.
- The wave director keeps trickling by design — tests fast-forwarding a gate must
  `__rh4debug.drainWave()` before mass-killing.
