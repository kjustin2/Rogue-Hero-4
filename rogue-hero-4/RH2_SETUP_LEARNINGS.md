# Rogue Hero 2 Setup Learnings

## Architecture Worth Carrying Forward

- The game loop is cleanly separated from most gameplay systems. `Engine` owns timing, hit stop, slow motion, frame throttling, and render/update profiling.
- Combat, cards, relics, tempo, rooms, projectiles, particles, audio, meta progression, and networking are plain JavaScript systems. That makes PixiJS practical because rendering can be replaced without rewriting the simulation.
- Multiplayer is already treated as a simulation concern, not a renderer concern. WebRTC snapshots, host/client routing, deterministic RNG, peer recovery, and debug tooling can stay stable while visuals change.
- The debug surface is a major asset. `_dev` helpers allow fast smoke testing of bosses, cards, relics, map states, multiplayer states, RNG traces, and desync diagnosis.
- The existing automated tests cover the parts most likely to break during a renderer migration: networking, snapshots, room transitions, cards, bosses, co-op, and deterministic state.

## Rendering Lessons

- `Renderer.js` is useful but not the whole render boundary. Many modules still draw directly to a Canvas 2D context, so a PixiJS migration has to be staged.
- The highest-value first targets are particles, projectiles, enemy/player bodies, telegraphs, room backgrounds, and post-processing overlays because they render frequently during combat.
- UI should move later. It has lots of Canvas text/layout code and lower frame-pressure than combat effects.
- Canvas fallbacks are useful during migration. A Pixi overlay can add new polish immediately while subsystems are converted one at a time.
- Biome data already contains palette, ambience, and post-FX intent. Rogue Hero 4 should expand those fields into real Pixi filters, tinting, blend modes, displacement maps, and animated screen-space effects.

## Gameplay Lessons

- Tempo is the identity of the game. New attacks, enemy patterns, animations, and visual effects should make tempo states easier to read and more exciting, not bury them.
- Co-op readability matters. Player halos, downed/revive indicators, shared tempo resonance, and multiplayer waiting badges need stronger visual hierarchy as effects get denser.
- Enemy silhouette language is valuable. Rogue Hero 4 should push this further with stronger shapes, windups, color-coded intents, and animated tells.
- The card system can support flashier attacks without changing core rules: new VFX can be attached to existing card execution events before adding new mechanics.

## Rogue Hero 4 Direction

- Preserve the current feel: tempo-driven movement, dodge timing, deck-based attacks, roguelike rooms, boss fights, and 1-4 player co-op.
- Make the sequel visually distinct: neon arcane overlays, GPU glow, richer biome color grading, animated ambient layers, punchier hit flashes, clearer attack silhouettes, and denser particles.
- Use PixiJS for the spectacle layer first, then migrate core draw calls as isolated slices.
