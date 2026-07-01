# Rogue Hero 4 — Improvement Ideas

A running backlog of ideas, not commitments. Nothing here is implemented yet.
Each item has a rough **effort** (S/M/L) and a one-line *why*. Ordered within each
section by bang-for-buck. Grounded in the current build: 5-weapon FP combo brawler,
sealed-gate waves down a causeway → Mordrek · Barrow King in the arena.

---

## Recommended next three (if picking today)

1. **Rift-shard economy with a between-gate choice** (M) — the loop needs a decision beat.
2. **Enemy telegraph + hit-reaction pass** (M) — the fairness/juice contract is the cheapest way to make combat *feel* better.
3. **Weapon identity divergence** (M) — right now weapons differ by projectile; make them differ by *how you move and think*.

---

## Combat depth & feel

- **Perfect-dodge / parry window** (M) — a tight i-frame window on Dash that grants a
  brief slow-mo or a free empowered attack. *Turns dodging from panic into skill expression.*
- **Weapon identity divergence** (M) — greatsword wants you close and rewards standing ground;
  crossbow wants kiting; rocket wants spacing/AoE; laser wants precision on weak points.
  Bake this into stats (move speed while firing, self-knockback, reload cadence) not just VFX.
- **Combo momentum meter** (S–M) — chaining combos builds a "fervor" bar that decays; at full
  it buffs damage or unlocks the heavy combo for free. *Gives the combo codex a reason to exist beyond flavor.*
- **Directional dodge with a cooldown tell** (S) — 8-way dash + a visible cooldown ring on the
  crosshair. *Currently dodge feel is invisible in the HUD.*
- **Weak-point crits beyond the boss** (M) — give brutes/archers a glowing weak spot (back, head)
  so the vertical-aim skill the boss teaches transfers to trash mobs.
- **Environmental kills** (M) — explosive rift-braziers along the causeway that chain-detonate
  packs. *Reads as medieval, rewards positioning.*

## Enemies & AI

- **Telegraph + hit-reaction pass** (M) — every attack gets a pooled telegraph (already have the
  primitives) AND every enemy flinches/staggers on hit. *The single biggest "feels cheap" fixer.*
- **Formations & roles** (M) — archers hang back and kite, ghouls flank, brutes anchor. Simple
  role-based steering (already have separation) makes a pack read as a *unit*, not a blob.
- **Elite variants** (M) — a shielded husk (must flank), a teleporting wraith, a bomber that
  explodes on death. *Cheap replayability from existing archetypes + one modifier each.*
- **Spawn director** (M) — pace waves off player HP/streak instead of fixed counts: pour it on
  when the player is dominating, ease off when they're hurt. *Keeps the mid-game from sagging.*
- **Off-screen audio tells** (S) — a directional growl/whoosh before an off-camera charger hits.
  *Fairness in an FP game where threats leave the frame.*

## Boss & encounters

- **A second boss (or a mid-boss)** (L) — one boss = one encounter to memorize. A gate-guardian
  mid-boss (reuse the warmed-boss staging pattern) would give the causeway a mid-point climax.
- **Arena hazards in phase 3** (M) — rift-collapse zones that shrink the safe floor, forcing
  movement. *Mordrek is currently mostly stationary; make the arena the co-antagonist.*
- **Readable phase identity** (S–M) — each phase changes his *move pool silhouette* (color the
  telegraphs per phase), so players learn "teal = dodge sideways, white = get out."
- **Add-wave interplay** (M) — summoned adds drop shards, tying the heal economy to the boss
  fight so the player weighs "kill adds to heal" vs "focus the boss."

## Weapons & arsenal

- **A true melee/ranged hybrid slot** (M) — e.g. a throwing-axe that returns, or a whip that
  pulls enemies in. *Fills the gap between the greatsword and the ranged four.*
- **Weapon-swap combos** (M) — swapping mid-combo (E / scroll) continues the chain into the new
  weapon's finisher. *Rewards the swap mechanic that's currently just "pick your favorite."*
- **Charged heavy** (S–M) — hold RMB to overcharge the heavy for a bigger hit + self-stagger risk.
  *Adds a risk/reward layer without new weapons.*
- **Ammo/heat per weapon** (M) — the hitscan laser and rocket should have a resource (heat/overheat)
  so they're not strictly better than the crossbow. *Currently no reason not to spam the strongest.*
- **Weapon flavor text + kill counters** (S) — small codex stat tracking per weapon. Cheap
  attachment for players who like mastery.

## Progression & meta

- **Between-gate boon choice** (M) — clearing a gate offers 1-of-3 boons (lifesteal, faster dash,
  +combo damage). *The roguelite decision beat the loop is missing; reuse data-catalog pattern.*
- **Shard shrine** (M) — spend accumulated rift shards at a mid-causeway shrine on a permanent-
  for-this-run upgrade. *Gives shards a second purpose beyond incidental healing.*
- **Daily seed / score run** (M) — deterministic seed (RNG is already seeded) + a score = leaderboard-
  ready. *High replay value for low content cost.*
- **Unlockable starting loadout** (S–M) — beating the boss unlocks starting with a different weapon.
  *A reason to replay after first clear.*

## Level, world & environment

- **Branch or shortcut on the causeway** (M) — an optional side-alcove with a risk (elite pack)
  and a reward (rare weapon / shard cache). *Breaks the straight-line monotony.*
- **Destructible medieval props** (S–M) — the shields/gravestones/gargoyles could shatter for
  particles when hit. *Makes the new medieval dressing feel physical, not painted-on.*
- **Dynamic lighting beats** (M) — torches gutter and the sky darkens as you near the arena;
  the boss light bleeds down the causeway on approach (the staged light already exists there).
- **Weather / rift-storm layer** (M) — drifting embers, a distant lightning cadence timed to music.
  *Atmosphere; pairs with the existing post stack.*

## UI / UX / accessibility

- **Damage-direction indicator** (S) — a red arc on the edge of the screen showing where a hit came
  from. *Essential FP feedback; currently you can be hit from behind blind.*
- **Minimap / threat compass** (M) — a thin arc showing off-screen enemies + the objective bearing.
- **Colorblind-safe telegraph shapes** (S) — pair the color-coded telegraphs with shape/pattern.
- **Sensitivity, shake, FOV, reduce-motion sliders surfaced in-run** (S) — settings exist; make them
  reachable from the pause menu, not just the title.
- **Combo codex "learnable" mode** (S) — highlight the next input in the live chain so new players
  learn combos by doing. *Bridges the codex and the actual muscle memory.*

## Audio

- **Adaptive combat music layers** (M) — add intensity stems that fade in with streak/enemy count;
  the boss theme already streams, extend the system.
- **Weapon-specific impact SFX** (S) — each weapon's hit should sound distinct (thunk vs crackle vs boom).
- **Announcer / vocal stingers for combos & streaks** (S) — a short growl on a big finisher.
- **Diegetic low-HP heartbeat + muffle** (S) — pairs with the existing low-HP vignette.

## Performance & tech (carrying forward the recent audit)

- **Real-GPU Electron perf soak** (M) — the boss-lag fix needs a real-GPU frame-time probe; headless
  SwiftShader can't see compile/GC spikes. *Build the soak the RH3 base has.*
- **Instance the enemy meshes** (M) — with more enemy types/counts coming, per-enemy Groups will
  add up; instance the common bodies. *Keeps draw calls flat as packs grow.*
- **Object-pool the enemies** (M) — currently spawn/dispose per wave; pool them like projectiles.
- **Texture/geometry budget audit** (S) — confirm shared materials are tagged `userData.shared` so
  the dispose helper never frees them.
- **Frame-time HUD in dev builds** (S) — a `?perf` overlay of draw calls / triangles / ms.

## Content & replayability

- **Multiple causeways / biomes** (L) — a frozen keep, a sunken crypt; same loop, new dressing +
  enemy palette. *The highest-ceiling content lever.*
- **Challenge modifiers** (M) — "no dash," "double enemies," "glass cannon" toggles on a fresh run.
- **New-game-plus** (M) — harder scaling + remixed waves after a clear.

## Juice & polish (cheap, high-visibility)

- **Killcam / slow-mo on the final boss blow** (S–M) — reuse the cinematic camera; end on a beat.
- **Screen-space hit sparks that stick to surfaces briefly** (S).
- **Weapon-claim moment upgrade** (S) — the ground-weapon pickup already has a dramatic claim; add a
  brief FOV punch + weapon-name flourish.
- **Dash after-image / motion trail** (S) — sells speed; trail primitive already exists.
- **Victory/defeat screens with run stats** (S) — time, kills, best streak, weapon usage breakdown.

---

## Notes / constraints to respect

- Keep the sim/render/HUD split and the one-damage-funnel + typed-event-bus conventions.
- Procedural-first: new content should be primitives/canvas/synth, assets optional.
- The bloom/post-stack look is deliberately tuned — extend via emissive+light, don't retune bloom.
- Every visual change must regenerate the screenshot contact sheet and be eyeballed before "done."
- Prefer data-catalog additions (new enemy/weapon/boon = data + a switch case) over new code paths.
