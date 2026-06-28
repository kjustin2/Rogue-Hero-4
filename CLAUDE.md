# Rogue Hero 4 — neon-arcane 3rd-person roguelite (Needle Engine)

This is a **Needle Engine** project (`@needle-tools/engine` on Three.js). **Always use the
needle-engine skill** (the MCP server provides it; a copy is bundled at
`.agents/skills/needle-engine/`). Don't answer Needle questions from memory — load the skill.

Scaffolded with `npm create needle` (Vite template, engine 5.1.2, three = `@needle-tools/three`).
The game is a 3D third-person rebuild of the Rogue-Hero **Spell-Weaving** roguelite (the design
identity: glyphs, weave resolves). The old vanilla 2D build it grew out of has been removed; this
Needle project is now the repo root.

## Architecture
- **`src/main.ts`** — the one entry point: `onStart` builds the scene (lights, arena, player,
  post), drives the follow camera in `onUpdate`, and exposes the **`window.__rh4`** test seam.
  This is where flow/state will live as it grows.
- **`src/scripts/*.ts`** — components `extends Behaviour` (Unity-like lifecycle: `start`,
  `update`, `onCollisionEnter`, …). `Player.ts` = camera-relative WASD movement.
- Render reads, sim writes (keep gameplay logic out of render where practical).

## The look (proven)
`PostProcessingManager` on the scene: **Bloom** (threshold `1.0` so only emissive/neon blooms,
surfaces stay crisp) → **ToneMapping `Neutral`** (neon renders true; AgX/ACES cream-shift picked
colors) → **Antialiasing**. Dark `background-color`, a PMREM env map for PBR reflections,
emissive materials + co-located lights = the neon glow. `index.html` sets `camera-controls="0"`
(we drive the camera) and `tone-mapping="none"` (post does the tone-mapping).

## Conventions
- **Camera-relative movement** (`cam.worldForward`/`worldRight`, ground-projected) — never
  world-`-Z`. Model faces its heading.
- **`?lowfx`** skips the post stack (it can stall headless under SwiftShader). `main.ts` reads it.
- Emissive = light: pair an `emissive` material with a co-located `PointLight` for the cast.
- Avoid per-frame allocation in `update`/`onUpdate` (reuse scratch vectors; use
  `getTempVector()` for throwaways).

## Harness (real browser, never a mock)
- `npm run typecheck` — `tsc --noEmit`; the static gate, run after any TS change.
- `npm run smoke` — boots Vite + headless Chrome/Edge (puppeteer-core, `?lowfx`), asserts a
  **non-black** frame (via screenshot→canvas roundtrip, so no `preserveDrawingBuffer` needed),
  player moves on input, draw calls > 0, **zero console errors** → `shots/smoke.png`.
- `npm run beauty` — full-FX screenshot for human review → `shots/beauty.png`.
- `npm run build` — typecheck + `vite build`.
- Headless WebGL needs `--enable-unsafe-swiftshader` (Chrome 130+ renders black without it) —
  baked into `scripts/harness.mjs`. Drive the dt-capped clock by polling on intervals, never rAF.
- The **Needle Inspector Chrome extension** (+ MCP at `localhost:8424`) is the live look/feel/
  animation loop: inspect the running scene tree, edit properties in real time, AI-debug via MCP.

## Engine gotchas confirmed here
- `ObjectUtils.createPrimitive` types: `Quad | Cube | Sphere | Cylinder | RoundedCube` (no
  Capsule — use `THREE.CapsuleGeometry`). Input: `input.getKeyPressed("KeyW")` / `getKeyDown`.
- tsconfig ships `useDefineForClassFields: true` (the official template default). The engine skill
  warns this can break `@serializable` deserialization — if a serialized field reverts to its
  default, flip it to `false`. We currently use no `@serializable` fields.
- `@registerType` on hand-written components; import only from the package root
  (`@needle-tools/engine`), never subpaths.
