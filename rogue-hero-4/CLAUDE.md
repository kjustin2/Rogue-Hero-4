# Rogue Hero 4 — neon-arcane 3D roguelike

Twin-stick real-time roguelike. Vite + TypeScript + Three.js. Art = a few **CC0**
Kenney GLB models retinted into emissive neon + procedural polyhedra; audio = **CC0**
Kenney Ogg SFX + a synthesized music bed. All assets are CC0 (see
`public/assets/CREDITS.md`); re-fetch with `npm run assets`.

## The signature mechanic — TEMPO
A 0–100 meter, neutral 50, always decaying toward 50. Cards shove it. Zones change your
attacks: **HOT** (≥70) ramps damage to ×1.5; **CRITICAL** (≥90) makes attacks pierce;
**COLD** (≤30) is defensive (−25% incoming). Hit **0 or 100** → a **crash**: an AoE burst
(hot = fire nova, cold = freeze) that resets tempo to 50. Riding the swing and baiting the
crash is the skill. (`src/sim/tempo.ts`)

## Architecture (match it)
- **`src/main.ts`** — the ONLY state machine (`title → select → playing → draft →
  gameover/win`), the dt-capped loop, input, and the `window.__game` hook. Render reads,
  never mutates.
- **`src/sim/`** — pure, Three.js-free, headless-testable.
  - `world.ts` — entities, the **one damage funnel** (`hitEnemy` / `damagePlayer` — never
    poke HP elsewhere), card casting, enemy AI, run/room flow, tempo crashes.
  - `tempo.ts` — zone math. `rng.ts` — seeded mulberry32.
- **`src/render/`** — `stage.ts` (renderer + bloom post; `?lowfx`/`?nofx` drop to a plain
  blit), `view.ts` (sim→scene sync, particle pool, camera follow; yields the camera when
  `view.cinematic`), `models.ts` (CC0 GLB load + neon material/geometry helpers, all
  **shared** per colour/kind — no per-entity material churn), `cinematic.ts` (cutscene
  timeline: keyframed camera shots around a captured focus, with skip).
- **`src/audio.ts`** — Web Audio; loads CC0 Ogg, synth music bed. Degrades to silence.
- **`src/hud.ts`** — DOM HUD + overlay screens + damage floaters.
- **`src/content.ts` / `types.ts`** — all data tables (cards, characters, enemies, relics,
  biomes) + the typed `Bus` event map in `bus.ts`. The sim only **emits**; render/audio/HUD
  subscribe.

## The test seam — `window.__game`
Drives every headless test. Key bits: `world`, `mode`, `start(charId)`, `cast(i)`,
`setMove(x,z)`, `aimAt(x,z)`, `frameStats()`, and **`scenario(spec)` / `scenarios()`** —
cut straight to any state: `combat swarm boss crit cold hot draft gameover win title
select`, plus cutscene jumps `cutdive cutboss cutwin cutdeath`. Keep it in sync with
public fields when you add systems.

## Cutscenes
Cinematic cutscenes (descent / boss reveal / victory / death) play on real flow
transitions and freeze the sim (`mode='cutscene'`); they're skippable (click/key) and
never soft-lock (an e2e probe guards that). Triggered only from real entry points
(`beginRun`, `chooseRelic` at boss depth, win/death in the loop) — **not** from
`scenario()` jumps. **`?nocut`** disables them for fast, deterministic tests; the
logic/perf harness passes it, while `tour`/`doctor` leave them on to screenshot the
`cut*` scenarios. Toggle at runtime via `__game.setCutscenes(bool)`.

## Harness (real browser, never a mock canvas)
- `npm run typecheck` — static gate, after any TS change.
- `npm run build` — typecheck + vite build.
- `npm run smoke` — Edge via puppeteer-core, `?lowfx`: asserts a **non-black** frame,
  player moves, a cast shifts tempo, zero console errors.
- `npm run test:e2e` — drives `__game` through the core loop with `check()` assertions.
- `npm run perf` — deterministic perf gate: peak draw calls/triangles, GPU resource
  stability (geometries must not climb = no leak), pool bounds, vs `perf-baseline.json`
  (`npm run perf -- --update` rewrites it). Headless fps is software-bound; gate on these.
- `npm run audit` — a bot actually PLAYS runs (kite/aim/cast/dodge/draft/retry) for a
  wall-time budget (`AUDIT_MS`), asserting invariants every frame (NaN, tempo OOB, arena
  escape, soft-locked rooms, leaks) and reporting a balance signal (depth/deaths/wins/HP
  floor). The fastest way to catch a soft-lock or a "can't-win" regression.
- `npm run tour` — full-FX screenshot of every scenario → `shots/tour-*.png`.
- `npm run doctor` — shoot every scenario into ONE captioned `shots/contact.png` +
  `shots/HEALTH.md` (luma / draw calls / black-frame + error flags). Read the sheet.
- `npm run vision` — **the harness with EYES**: captures every scenario at full FX and has
  the authed `claude` CLI score each screenshot against `docs/GAME_BIBLE.md` (anchored
  rubric: readability/camera/clarity/environment/appeal/feel) → `shots/VISION.md`. Luma/error
  checks can't tell "unreadable top-down void" from "good" — this can. See the `/vision-loop`
  skill for the capture→judge→fix loop. (Prompt goes via stdin, not argv; criteria are
  anchored to cut judge noise; combat shots fire a mid-action burst so "feel" reads.)
- `npm run flow` — **layout/flow invariants** (HARD GATE): drives the REAL UI via clicks
  through the whole flow at **5 resolutions** and asserts via `getBoundingClientRect()` that
  **no two interactive/text elements overlap** and nothing is offscreen → `shots/FLOW.md`,
  `flow-*.png`. This is what catches "overlapping menus" the VLM judge misses (it only sees
  single static states at one size). Exits non-zero on any overlap so it can never ship.
- `npm run motion` — **the harness that judges MOTION/FEEL**: captures an 8-frame burst of
  combat/crash/swarm into filmstrips (`shots/motion-*.png`) and scores feel / readability-in-
  motion / juice / animation, backed by deterministic byte-diff "motion energy" + peak
  particles/shake (a near-zero energy burst = frozen/no-juice). A still can't see juice; this can.
- `npm run qa` — **ONE confident gate**: typecheck + flow + perf (hard) then vision + motion +
  doctor (advisory) → `shots/QA.md` with a single **✅ SHIPPABLE / ❌ BLOCKED** verdict.
  `--fast` skips the VLM steps. The vision/motion judges are intentionally HARSH on `detail`
  + `animation` (primitive shapes / flat surfaces / no animation score low). Surface
  `shots/contact.png` (look) + `shots/motion-*.png` (feel) + `QA.md` to the user via SendUserFile.
- `npm start` opens the game in a **standalone Electron window** (`electron/main.cjs` serves
  `dist/` on fixed loopback `127.0.0.1:8123` so localStorage saves persist). `npm run serve`
  = the web build at :8000.
- Headless quirks: `?lowfx` skips the bloom composer (it stalls under SwiftShader; that run
  also flips on `preserveDrawingBuffer` so the canvas can be sampled). The dt-capped clock
  runs slow headless — poll on intervals with generous real-time waits, never on rAF.

## Conventions
- **No new asset files beyond CC0** in `public/assets/` (add to `scripts/assets.mjs`).
- One damage funnel · typed event bus · all transitions in `main.ts` · shared geo/materials
  (dispose anything you create per-frame) · run-state in `world.run`, META unlocks in
  `localStorage['rh4.meta']` (wrapped in try/catch).

## Where to add content
Cards/characters/enemies/relics/biomes are all data in `src/content.ts`. A new card needs a
`CardDef` + a `case` in `World.execCard`; a new enemy needs an `EnemyDef`, a mesh in
`models.enemyGeo` (or a model), and AI in `World.updateEnemies`. Add a `scenario()` for
anything you want to screenshot.
