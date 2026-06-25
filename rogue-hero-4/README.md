# Rogue Hero 4

An intense **neon-arcane 3D roguelike**. Twin-stick real-time combat built on Three.js,
driven by the **TEMPO** mechanic — a meter you shove HOT for damage, push COLD for defense,
and slam to 0/100 to trigger an arena-clearing crash. Clear rooms, draft relics, descend
six depths, and silence **The Conductor**.

Built entirely from **CC0 assets** — Kenney GLB models + Ogg sound effects (public domain),
retinted into an emissive neon look, with a synthesized ambient score. See
[`public/assets/CREDITS.md`](public/assets/CREDITS.md).

## Play
```bash
npm install
npm run assets   # fetch the CC0 assets (one time)
npm run dev      # open the printed localhost URL
```
**WASD** move · **mouse** aim · **1–4** / **left-click** cast · **Space** dash.
Three vessels (Pyre / Frost / Shadow); Frost and Shadow unlock as you play.

## Develop
```bash
npm run typecheck   # tsc --noEmit
npm run build       # typecheck + vite build
npm run smoke       # real-browser boot test (non-black frame, input, no errors)
npm run test:e2e    # core-loop assertions
npm run tour        # screenshot every scenario -> shots/
npm run doctor      # contact sheet + HEALTH report -> shots/
```
Architecture and conventions live in [`CLAUDE.md`](CLAUDE.md).
