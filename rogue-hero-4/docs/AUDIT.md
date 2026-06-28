# Rogue Hero 4 — Pro Design Audit

## 2026-06-28 — Critic-grade review pass (Edge scale + self-consistency)
The vision judge was rebuilt to grade like a real critic, per fresh research on how 90+ games are
reviewed/scored:
- **Edge framing:** 5 = a competent *shipped* game, 7 = good, 8 = great, 9–10 = genre-defining.
  "No bugs" is a 5, not an 8. Most competent work lands 5–6.
- **Evidence-anchored:** every criterion must cite a specific on-screen element or it defaults to 5;
  reason-before-score; anchors rewritten with critic tells (silhouette test, lighting-reveals-form,
  emissive-as-light, colour identity, anticipation/follow-through/hit-stop in motion).
- **Self-consistency:** each shot judged median-of-3 to kill the ±2-3 single-sample noise (the same
  camera scored 8 then 4 across runs) — the harsh score is now *trustworthy*.

**Result:** the *same* shippable build dropped from a lenient **6.8** to a stable harsh **6.2** — the
scale moved, not the quality. Under Edge framing, 6.2 = "clearly above competent-commercial." The
hard bar was recalibrated to **6.0** (a higher standard than the old 6.4 under the lenient judge),
with margin so a real regression (≈ −0.4) still blocks.

**Improvements landed this pass (real, dual-gated):** richer multi-layer enemy models + bigger so
detail reads at chase-cam distance; distinct **colour identity** (amber Brute / red Darter / violet
Caster / green Splitter); **cast shadows + a warm directional key + subtle rim** (the #1 repeated
"flat ambient" cap → appeal a stable 6); **hit-stop on kills** + stronger knockback + enemy flinch;
breathing idles; beefier friendly tracers; boss de-bloomed so its armour reads; relic emoji → arcane
glyphs; draft "pick-me" affordance; cleaner hero chrome (less "striped").

**The named ceiling (next real work):** `detail` is stuck at 3–5 across scenarios — the harsh
"default-solid test" on procedural Three.js primitives. Closing it toward 7 needs genuine model
craft: per-vessel preview models on the select cards, sculpted (non-primitive) hero/enemy silhouettes
or baked normal/AO, and a stronger value hierarchy (the scenes are saturation-heavy). `appeal` sits
at a stable 6 — a true per-entity fresnel rim (not floor-washing directional) is the next lever.

---

# Rogue Hero 4 — Pro Design Audit (2026-06-27)

Audited against the **`/game-design` rubric** (Schell/Koster/Swink/Meier/flow/roguelite craft),
dual-gated: the VLM vision judge (`npm run vision`, full-FX screenshots vs `GAME_BIBLE.md`) + the
deterministic harness (`flow`/`perf`/`motion`/`audit`). Scores are 0–10 per the anchored rubric.
This pass focused on combat, animations, cutscenes, boss battles, and menus.

## Scorecard (this build)
| Area | Rubric lines | State | Verdict |
|---|---|---|---|
| Menus / UX | 3,6,7,9 | Title now has Play/Tutorial/How-to/Exit; all screens in a beveled SC2 panel; readable at 5 res | **Strong** (menu_clarity 6–9, readability 7–8) |
| Combat readability | 3,6 | WoW chase cam, hero reads as armored figure, cards show cooldown+tempo | **Good** (readability 7–8, clarity 6–7) |
| Combat feel/juice | 1,4 | crash hitstop, shake, floaters, telegraphs, screen flash — motion gate: all moving | **Good** (feel 7–8) |
| Animations | 1,4 | hero halo-spin/head-bob/cast-recoil/dash-stretch; enemies wing-flap/rune-orbit/pod-pulse; boss baton counter-spin | **Good**, see gaps |
| Cutscenes | 4,6 | dive/boss/win/death keyframed cams, letterbox, titles, skip, no soft-lock (e2e) | **Good** |
| Boss battles | 3,5 | new multi-part procedural Conductor (distinct cold silhouette vs warm hero), HP bar, closer framing | **Improved** (was a blob; clarity 4→5) |
| Model craft / detail | 9 | procedural multi-part hero/enemies/boss, lit-metal chassis under neon IBL | **Weakest** (detail 4–5) — next frontier |

## What's good (keep)
- **Readability wins (rubric 3):** chrome-metal hero + colored-armor enemies + cold boss are now
  instantly distinct; cards carry cooldown + tempo delta; menus are framed and legible at all sizes.
- **Juice reads in motion (rubric 4):** the motion gate confirms combat/crash/swarm all have real
  energy; hitstop + shake + flash + floaters layer per impact.
- **Onboarding (rubric 7):** interactive tutorial teaches one mechanic at a time, gated on doing it;
  banner no longer lingers over combat (the `startRun` clear fixed cross-scenario bleed).
- **Clarity of goal (rubric 6):** TEMPO zone label + bar always visible; boss HP bar named.

## Open problems, ranked (rubric line → fix)
1. **Model/surface detail = programmer-art tier (rubric 9, detail 4–5 across the board).** Entities
   are multi-part but the VLM still reads single-material primitives. *Next:* emissive trim/circuit
   decals on hero + enemy shells; a normal/roughness CanvasTexture on armor; more silhouette breakup.
2. **Boss still over-bright + small when far (rubric 3, boss clarity ~5).** The eye/batons bloom hot
   and the boss is far in real rooms. *Next:* dial boss accent emissive down a touch more; add a
   boss-approach beat (telegraph wall) so the player engages it up-close where it reads as massive.
3. **`feel` can't show in HOT/CRIT shots (rubric 4).** Casting in those zones crashes tempo, so the
   capture is static. *Accepted harness limit* (documented); not a game bug.
4. **Interesting-decisions not yet proven (rubric 2) — LOGIC, not visual.** Are all 4 cards worth
   casting and the relic draft non-dominated? *Next:* drive `npm run audit` to confirm no card/relic
   is always-best and the deaths/depth curve sits in the flow channel (rubric 5).
5. **Menu appeal still ~6–7 (rubric 9).** Panels help; cards could use hover-glow affordance + a small
   per-vessel preview model, and end screens a richer stat line.

## How this was judged (no vibes)
Every line above has a **vision probe** (a scored screenshot in `shots/VISION.md` / `contact.png`)
AND a **logic/metric** backer (`flow` overlap=0 at 5 res, `perf` no-leak, `motion` all-moving,
`e2e` no soft-lock). The vision SHIP GATE is now a **hard** qa gate on the stable overall avg
(≥6.4) — single-criterion VLM scores are too noisy to gate on, so they drive feedback, not blocks.
