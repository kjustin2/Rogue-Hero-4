# Rogue Hero 4 — Rift Causeway

A first-person neon combo brawler. Walk down a long, wide arcane causeway, fight rift-born
enemies at sealed gates, and bring down the **Rift Warden** at the far end. You wield a
limited moveset of three glyphs and chain them into devastating combos.

Built on **plain Three.js + Vite + strict TypeScript**, shipped as an Electron desktop app.
No game engine, no UI framework, no test framework — the truth is screenshots + state asserts.

## Play
| Input | Action |
|-------|--------|
| **WASD** | Move (camera-relative) |
| **Mouse** | Look |
| **LMB / J** | Strike — fast light slash |
| **RMB / K** | Cleave — heavy arc, knockback |
| **E** | Bolt — ranged arcane shot |
| **Shift / Space** | Dash — quick lunge with i-frames |
| **Esc** | Pause |

Click to lock the mouse. Clear each gate's wave to open the way forward.

## Combos
Chain glyphs within ~1.4s to resolve a named combo (a big AoE payoff with its own VFX):

| Combo | Recipe | Effect |
|-------|--------|--------|
| **CRESCENDO** | Strike · Strike · Cleave | overhead slam, AoE |
| **ARC LANCE** | Bolt · Bolt · Strike | piercing forward lance |
| **QUAKE** | Cleave · Cleave | shockwave + stun |
| **VOID NOVA** | Strike · Cleave · Bolt | radial nova (highest tier) |

## Develop
```
npm install
npm run dev        # vite dev server
npm run typecheck  # tsc --noEmit (static gate)
npm run build      # typecheck + vite build
npm run smoke      # build + Electron playthrough → shots/electron-*.png (READ them)
npm start          # standalone Electron window
npm run package    # electron-builder portable .exe
```

The smoke boots the built game in real Chromium, drives title → path → combat → combo → boss →
victory → death, and fails on a black frame, a console error, a broken combo, or a missing boss.
