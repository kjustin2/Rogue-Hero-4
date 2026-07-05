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
  victory/death incl. killcam slow-mo), the **boss walk-up cutscene** (a scripted camera DOLLY —
  `fpsCamera.setCinePose` sweeps a vantage while `updateBossCutscene` scripts the path — + a MORDREK
  title card), the **first-run tutorial** (auto-launches on the first DESCEND if `!save.tutorialDone`;
  `inTutorial` = a forgiving training slice reusing the `playing` state — PLAYER_DIED revives, run not
  recorded), run stats, meta-save writes, and the **`window.__rh4`**
  seam (`__rh4debug.scenario/frames/checkCombos/drainWave/tutorial/tutorialActive`, `__rh4perf`).
- **`src/game/tutorial.ts`** — verb-gated first-run training (move→light→dodge→heavy→combo→swap),
  flags latched off the event bus, reuses `hud.setTutorial()`; replayable from the title's TUTORIAL button.
- **`src/game/`** — sim: `ctx.ts` (type-only hub), `weapons.ts` (arsenal catalog + chargeable
  heavies + `matchWeaponCombo`/self-check), `player.ts` (FP controller, charge/fervor/swap-combo
  buffer, PlayerMods read sites, per-weapon procedural viewmodels), `combat.ts` (the one damage funnel; `modifyIncoming` hook for shielded elites;
  lifesteal/dmg-taken mods; `resolveCombo` forward finishers (fire the WEAPON's own projectile
  shape, not a hardcoded dart); **long-range falloff** — full damage ≤18u, tapering to 45% by
  ~50u; **hit-stop is DEFENSE-ONLY** — landing hits on enemies never dilates the frame (that read
  as the game slowing down when you attack); `ctx.hitstop` fires only on player wounds /
  perfect-dodge / weapon-pickup, main runs the frame at dt×0.08 while it drains; **`hitPart`** — the
  shootable-parts funnel: call sites (projectiles/beam/melee) resolve the impact point and chip
  breakable armor/limbs), `enemies.ts` (6 archetypes,
  **pooled** per kind, roles/flanking, **ELITES** catalog, **spawn director** — per-gate
  {budget,cap,pack,eliteChance}, trickle + hp-reading pacing, `waveDone()`; **breakable parts** from
  `breakables.ts` — shoot off the weapon (disarm), knight shield (noblock), brute pauldron (expose),
  gargoyle wing (dewing); part HP is a SEPARATE pool from body HP), `boss.ts` (**roams** the arena —
  idle tangential drift + frequent wider anchor shifts, no player pursuit; anchors + shift glide,
  slam/volley/beam/sweep/collapse/**RIFT FISSURE** (a line of eruptions marches down the telegraphed
  lane — sidestep OFF it; replaced the old dash-through gravewave ring)/**harvest**, phase-3 soulfire pools + recurring adds
  with guaranteed shards, per-phase telegraph colors; **breakable pauldrons→`armorMult` / blade→drops
  sweep+harvest**), `boons.ts` (12 data boons →
  flat `PlayerMods`), `breakables.ts` (per-kind breakable-part catalog), `pickups.ts` (gold economy), `level.ts` (level-as-data causeway with segment
  identity: Outer Ward → Grave Ward → Reliquary Approach; `gutterAt(z)` torch fade;
  **atmosphere layer** — drifting cool ground mist + fine airborne dust + a cold violet aurora
  curtain + warm brazier glow-halos, all pooled `THREE.Points` animated in `update`),
  `projectiles.ts` (pooled).
- **`src/render/`** — `stage.ts` (post chain: bloom(0.92/thr 0.45)/SSAO(high)/CA/grade/SMAA,
  quality tiers, dual-composer warm-up, warm key + **cool rim/back light** for silhouette
  separation), `enemyMeshes.ts`/`bossMesh.ts` (procedural body
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
  asserts → boss phases/RIFT FISSURE/killcam → victory **meta-save assert** → death; **regression beats**:
  rat-lands-a-hit, stuck-gargoyle-force-descends, boss-arena-lock, stormcaller-aim-down-lands-closer,
  first-run-tutorial-runs-to-completion), asserts
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
  parts — it normalizes via `toNonIndexed()` first; keep that invariant. The rat's 4 legs + the
  ghoul's 2 shins are kept OUT of the merge (in the keep-list + excluded from `statics`) so they
  stay live for the footfall stride in `Enemy.sync` — don't re-merge them.
- **Breakable parts** (shootable armor/limbs): promoting a part is NOT just a keep-list entry —
  `buildEnemyMesh` only re-instances core/weapon/wings/legs, so a promoted armor part must be
  captured in `buildBody`, returned via `EnemyMeshParts.parts`, added to the keep-list, AND
  `clone(true)`-per-instance (else all pooled instances share one Object3D). NEVER mutate a part's
  material to flash/fade (shared across instances + the merged body) — break visuals are hide +
  `fx.burst` + `fx.chunk`. Part state (broken/hp + effect flags) MUST reset in `Enemy.reset` /
  `Boss.reset` and scale in `makeElite` (pooled bodies). Part HP is a SEPARATE pool from body HP
  (a hit chips the part AND deals full body damage) so enemies never become damage-sponges.
- The debris **chunk pool** (particles.ts) uses **MeshBasic**, not MeshStandard: a transparent +
  lit material's first VISIBLE draw mid-fight is a ~100-370ms pipeline stall (misreads as gc/stall
  in the soak classifier). All FX pools stay unlit MeshBasic for this reason.
- The key light's shadow ortho box only covers ~60u, so `main.ts`'s frame loop slides the key
  light + its target to follow the player each frame (texel-snapped so shadows don't swim) — do
  NOT pin them at the origin again (that left the whole causeway + arena shadowless = floating
  characters). It only MOVES existing lights (no relink).
- Viewmodel swing timing: `player.ts animate()` time-warps the pose sample so the pose's IMPACT
  keyframe coincides with the mechanical hit (`moveT >= windup`); `samplePose` writes a module
  scratch (no per-frame alloc). Don't restore the linear `moveT/attackDuration` sample — the
  visible swing would connect ~0.1s after damage fires again.
- InstancedMesh frustum-culls off its base-geometry bounds at the origin → set
  `frustumCulled = false` for spread instances (see level.ts). Changing the scene's point-light
  count mid-combat forces a synchronous relink of every MeshStandardMaterial — the boss light is
  pre-added and scene-owned (boss.ts / bossMesh.ts), as are the key + cool rim light (stage.ts,
  added at boot); never spawn/remove lights live.
- Boss weak-point coupling: `CORE_Y` (boss.ts) assumes the boss group's scale — don't rescale the
  boss group.
- **Melee enemy reach**: any melee kind's `attackRange` MUST exceed the separation floor
  (`radius + playerRadius(0.5) + 0.6`) or `separate()` shoves it just outside strike range every
  frame and it can NEVER wind up (this was the "rat can't hurt me" bug — rat attackRange 1.3 < floor 1.42).
- **Flyer reachability**: a cruising gargoyle (`alt≈4.5`, `hitBottom>2.2`) is unreachable to grounded
  melee/AoE; `tickFly`'s low-pass failsafe force-descends it to a killable altitude after ~3.5s out of
  dive range — without it a melee loadout could leave it alive forever and the gate never opens.
- **Arena lock**: `level.lockArena` (set true when the boss activates in main; cleared in `Level.reset`)
  makes `clampPosition(pos, radius, keepInArena=true)` pin the player inside the arena bowl — no
  retreating down the corridor once the boss fight starts. The player passes `keepInArena=true`.
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
