# Rogue Hero 4 PixiJS Migration Plan

## Summary

Rogue Hero 4 starts from the current Rogue Hero 4 gameplay, multiplayer, combat, deck, progression, and debug systems. PixiJS is introduced as the rendering layer so the sequel can keep the existing JavaScript game loop while gaining WebGL headroom for 4-player combat, denser particles, animated sprites, and GPU post effects.

The migration is staged because the current architecture has a `Renderer.js` wrapper, but many modules still draw directly to a Canvas 2D context. The first implemented slice keeps the Canvas game playable and adds a Pixi overlay renderer for screen-space effects. Later slices convert high-frequency world rendering to Pixi layer by layer.

## Current Implementation Slice

- `rogue-hero-4` is now a self-contained Rogue Hero 4 scaffold copied from the RH4 base.
- The app title, manifest, Electron title, package metadata, and package build identity now use Rogue Hero 4 naming.
- PixiJS is loaded before the game module and listed as a dependency for future local/vendor bundling.
- `src/PixiOverlay.js` creates a transparent Pixi application layered above the existing game canvas.
- `src/Renderer.js` now owns a Pixi overlay and routes scanlines, vignette, and chromatic-aberration edge flash through Pixi when available, falling back to Canvas 2D if Pixi fails to load.
- The existing game loop, logic, input, combat, deck systems, room generation, audio, WebRTC networking, debug console, and tests remain intact.

## Next Migration Steps

1. Convert particles and projectiles to Pixi display-object pools.
   - Use `ParticleContainer` or pooled `Sprite`/`Graphics` objects.
   - Keep particle simulation in `Particles.js`; only move drawing to Pixi.
   - Preserve current caps and debug counters until performance tests prove higher caps are safe.

2. Convert combat actors and world geometry.
   - Move player bodies, enemy bodies, health bars, telegraphs, range rings, room backgrounds, pillars, and projectiles into explicit Pixi layers.
   - Keep entity state as plain JS objects and mirror it into Pixi objects during render.
   - Avoid importing Pixi into combat or networking modules.

3. Add GPU polish effects.
   - Add bloom/glow for tempo, attacks, projectiles, and pickups.
   - Use additive blend modes for fire/lightning/tempo particles.
   - Add biome color grading from existing `Biomes.postFx`.
   - Add Tide Halls displacement/ripple and Voidline chromatic aberration/distortion.

4. Migrate UI after world rendering is stable.
   - Start with the high-use combat HUD: HP, AP, tempo, cards, boss bars, revive indicators, and multiplayer badges.
   - Move modal screens later: character select, map, draft, shop, inventory, cosmetics, stats, and victory.
   - Keep the DOM cursor until Pixi cursor rendering matches browser and Electron behavior.

## Public Interfaces

- Game logic should talk to renderer-facing methods, not raw Pixi objects.
- `Renderer.ctx` is supported only as a migration bridge and should be treated as deprecated.
- Pixi-specific implementation details should stay inside renderer/visual modules.
- Biome definitions may gain Pixi-friendly filter, blend, displacement, and color-grading values.

## Test Plan

- Run `npm run syntax` after every rendering slice.
- Run `npm test` to confirm networking, snapshots, and deterministic logic are unchanged.
- Run `npm run test:smoke` for browser integration coverage.
- Add a Pixi boot smoke test that confirms the Pixi overlay exists when Pixi loads and that the game still exposes `window._dev`.
- Add a performance scenario for 4 players, 30 enemies, heavy particles, projectiles, and biome filters.

## Assumptions

- PixiJS is a renderer replacement, not a replacement game framework.
- Rogue Hero 4 keeps Rogue Hero 4 gameplay behavior until a separate design pass changes it.
- The migration prioritizes combat rendering performance before UI rewrites.
- The current CDN load is a practical first slice; before offline distribution, Pixi should be bundled or vendored into the Electron/web package.
