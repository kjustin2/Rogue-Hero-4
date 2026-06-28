# Rogue Hero 4 — Living Design Doc

> Short by design. The *visual* bible is `GAME_BIBLE.md`; the *design knowledge + rubric* is the
> global `/game-design` skill. This doc is the current **direction** — update it as it evolves.

## Core idea (one breath)
A fast neon-arcane **roguelite** whose one big idea is the **TEMPO meter**: every ability shoves
a 0–100 dial that changes what your attacks do (HOT = more damage, COLD = tougher, 0/100 = a
room-clearing crash). The whole game is the *interesting decision* of riding and baiting that dial
while you descend six depths and silence The Conductor.

## Design pillars (what every change must serve)
1. **Game feel first** (Swink): dash/attack/cancel must read instant (<~100 ms) and snappy before
   any spectacle. Polish is feedback, not decoration.
2. **Interesting decisions** (Meier): TEMPO management + the relic draft are real, informed,
   non-dominated choices. No always-best card/relic; legible randomness.
3. **Readability wins ties**: hero vs enemy vs projectile vs hazard instantly distinct; juice
   never buries the read.
4. **Flow**: difficulty ramps with depth/skill; never all-options-disabled, never a steamroll.
5. **Meta = variety, not power** (roguelite craft): unlocks open options; an escalating knob keeps
   veterans honest. Every death advances + poses a new question ("one more run").

## How we judge it (no vibes, no "done" from code)
Every cycle, dual-gate against the **`/game-design` rubric** (10 lines):
- **Look/feel/flow** → `/vision-loop` (`npm run vision` + `npm run motion`) judges screenshots/
  filmstrips vs `GAME_BIBLE.md` + the rubric.
- **Logic/balance/perf** → `npm run audit` (a bot plays runs, checks invariants + the deaths/
  depth/win balance signal), `npm run perf`, `npm run flow`, `npm run e2e`.
- **One gate**: `npm run qa` → ✅ SHIPPABLE / ❌ BLOCKED.

## Current direction / open design problems (living — keep honest)
- Presentation is strong (distinct enemies, dynamic hero, SC2 menus, combat spectacle).
- **Next design work (rubric-driven):** verify *interesting decisions* — are all 4 cards worth
  casting and is the relic draft non-dominated (logic via audit)? Tune the difficulty *ramp*
  (deaths/depth curve) toward the flow channel. Confirm dash/attack input *feel* (latency) and
  the "one more run" loop (meta opens variety, not raw power).
