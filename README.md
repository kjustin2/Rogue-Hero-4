# Rogue Hero 4

Neon-arcane 3rd-person roguelite built on [Needle Engine](https://needle.tools)
(`@needle-tools/engine` on Three.js), written code-only in TypeScript.

## Quickstart

```bash
npm install
npm run dev        # Vite dev server (http://127.0.0.1:3000)
```

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload |
| `npm run typecheck` | `tsc --noEmit` — the static gate |
| `npm run build` | Typecheck + `vite build` → `dist/` |
| `npm run app` | Build, then launch the standalone Electron desktop window |
| `npm run serve` | Preview a production build on `127.0.0.1:8000` |

## Test harness

A real-browser (puppeteer-core, headless Chrome/Edge) gate — never a mock.
Output lands in `shots/` (gitignored).

| Command | Gate |
|---|---|
| `npm run smoke` | Boots the game, asserts a non-black frame, player moves, draw calls > 0, zero console errors |
| `npm run e2e` | Drives the sim via `window.__rh4` and asserts the core loop (run starts, waves spawn, casting, aim/look) |
| `npm run doctor` | Per-scenario luma / draw-call / triangle / enemy report |
| `npm run beauty` | Full-FX screenshot for human review |
| `npm run flow` | Title → select → play → look/cast walkthrough capture |

## Structure

```
src/
  main.ts        entry point: scene build, follow camera, the window.__rh4 test seam
  sim/           pure game logic (world, weave, content, rng, bus, types) — Three.js-free
  render/        read-only renderer + HUD (view.ts, hud.ts)
  scripts/       Needle Behaviour components (Player movement, etc.)
  styles/        style.css
electron/        standalone desktop shell (main.cjs)
scripts/         the puppeteer test harness
assets/          glb / textures
```

Render reads, sim writes. See `CLAUDE.md` for the architecture and engine
conventions in detail.

## Stack

Needle Engine 5.1.x · Three.js (`@needle-tools/three`) · Vite · TypeScript · Electron (desktop)
