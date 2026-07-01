# Rogue Hero 4 — Rift Causeway

A first-person **dark-fantasy combo brawler**. Descend a torch-lit gothic causeway, break the
undead waves at three sealed gates, claim a boon after each, and bring down **Mordrek, the
Barrow King** in the arena at the far end. A swappable arsenal of five weapons — crossbow,
greatsword, hand bombard, prism rod, storm caller — each with light/heavy attacks, chargeable
heavies, and its own combo strings whose finishers fire forward.

Built on **plain Three.js + Vite + strict TypeScript**, shipped as an Electron desktop app.
No game engine, no UI framework, no test framework — the truth is screenshots + state asserts.
All content is procedural: primitive-built meshes, canvas-painted textures, synthesized SFX
(music is the one streamed exception).

## Play
| Input | Action |
|-------|--------|
| **WASD** | Move (camera-relative) |
| **Mouse** | Look |
| **LMB / J** | Light attack — fast |
| **RMB / K** | Heavy attack — strong; **hold to charge** (greatsword/bombard/rod) |
| **E / wheel** | Swap weapon (the combo chain survives the swap — SWAP FINISH pays 1.25×) |
| **Shift / Space** | Dash — i-frames; dodging *through* a hit is a PERFECT (slow-mo + refunds) |
| **Esc** | Pause |

Chain light/heavy per the codex (top right) to fire named combo finishers. Finishers build
**FERVOR** — at full, the next heavy is free and empowered. Kills drop gold **rift shards**
that heal. New weapons wait on the ground past each gate; clearing a gate offers **one of
three boons**. Elites (gate 2+) are crowned: shielded (flank them), frenzied, or bursting
(dodge the death blast). The Barrow King roams, reaps, and — in his final phase — burns the
floor; dash *through* his gravewave ring.

**DAILY RITE** on the title runs today's seed for score (kills×10 + shards×5 − seconds).
Clearing the causeway unlocks starting with any weapon you held.

## Develop
```
npm install
npm run dev        # vite dev server
npm run typecheck  # tsc --noEmit (static gate)
npm run build      # typecheck + vite build
npm run smoke      # build + Electron playthrough → shots/electron-*.png (READ them)
npx electron scripts/soak-electron.cjs   # real-GPU boss-fight perf soak (after a build)
npm start          # standalone Electron window (fixed port 41730 — saves survive)
npm run package    # electron-builder portable .exe
```

The smoke boots the built game in real Chromium and drives title → path → wave → boon →
arsenal showcase → charged heavy / fervor / swap-combo / elite asserts → boss (phases,
gravewave, killcam) → victory (meta save written) → death. It fails on a black frame, a
console error, a broken combo, or > 700 draw calls.
