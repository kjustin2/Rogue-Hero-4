# Rogue Hero 4

An intense **neon-arcane 3D roguelike**. Twin-stick real-time combat built on Three.js,
driven by the **TEMPO** mechanic — a meter you shove HOT for damage, push COLD for defense,
and slam to 0/100 to trigger an arena-clearing crash. Clear rooms, draft relics, descend
six depths, and silence **The Conductor**.

Built entirely from **CC0 assets** — Kenney GLB models + Ogg sound effects (public domain),
retinted into an emissive neon look, with a synthesized ambient score. See
[`public/assets/CREDITS.md`](public/assets/CREDITS.md).

> The project lives in the **`rogue-hero-4/`** subfolder — run every command from there
> (`cd rogue-hero-4` first), otherwise npm can't find `package.json`.

## Play (standalone desktop app)
`npm start` builds the game and opens it in a **standalone Electron window** — a real
desktop app, no browser, no dev server:
```bash
cd rogue-hero-4  # from the repo root
npm install
npm run assets   # fetch the CC0 assets (one time)
npm start        # builds, then opens the standalone Rogue Hero 4 window
```
Electron serves `dist/` over a fixed loopback port (`127.0.0.1:8123`) so localStorage saves
stay stable across launches. (`npm run serve` still serves the web build at :8000 if you
prefer a browser.)

## Develop
Hot-reloading dev server while working on the game (from `rogue-hero-4/`):
```bash
npm run dev      # open the printed localhost URL
```
**WASD** move (camera-relative) · **Q/E** (or ←/→) rotate camera · **mouse** aim ·
**1–4** / **left-click** cast · **Space** dash. First run launches an interactive tutorial.
Three vessels (Pyre / Frost / Shadow); Frost and Shadow unlock as you play.

## Test & verify
```bash
npm run typecheck   # tsc --noEmit
npm run build       # typecheck + vite build
npm run smoke       # real-browser boot test (non-black frame, input, no errors)
npm run test:e2e    # core-loop assertions
npm run perf        # deterministic perf + leak gate vs perf-baseline.json
npm run audit       # a bot plays full runs, checking invariants + balance
npm run tour        # screenshot every scenario -> shots/
npm run doctor      # contact sheet + HEALTH report -> shots/
npm run vision      # VLM-judged visual QA: scores every screen vs docs/GAME_BIBLE.md -> shots/VISION.md
npm run flow        # layout/flow invariants: real click-through @ 5 resolutions, fails on overlapping UI
npm run motion      # MOTION/FEEL: 8-frame filmstrips + byte-diff energy, judged for juice/animation
npm run qa          # ONE gate: typecheck+flow+perf (hard) + vision+motion+doctor -> ✅ SHIPPABLE / ❌ BLOCKED
```
The **vision harness** gives the test suite *eyes* — it captures each screen at full FX and
has the authed `claude` CLI score it against the design intent in
[`docs/GAME_BIBLE.md`](docs/GAME_BIBLE.md) (readability, camera, clarity, environment,
appeal, feel). Architecture and conventions live in [`CLAUDE.md`](CLAUDE.md).
