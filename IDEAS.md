# Rogue Hero 4 — further-improvement ideas

A backlog for after the current build. Ordered roughly by feel-per-effort. Nothing here is
started; each idea names the seam it would plug into so it stays cheap to pick up.

## Combat feel (highest return)

- **Executions.** When a melee kill lands under 30% HP, a 0.3s canned kill-flourish (bigger slash
  arc, ash burst, unique sfx) with a guaranteed shard. Seam: `Combat.dealDamage` already knows
  `killed` + `heavy`; gate on weapon `kind === "melee"`.
- **Directional flinches.** Enemies currently lean back on any hit; feed `fromX/fromZ` into the
  flinch so they jerk *away from the shot*, and stagger sideways on grazes. Seam: `Enemy.flinch`
  already decays — make it a small vector instead of a scalar.
- **Weapon-specific hit sfx.** One shared `enemyHit` today; give the maul a bone-pulverize layer,
  the axes a wet chop, the laser a sizzle. Seam: `ENEMY_HIT` event already carries `heavy`; add
  the weapon id.
- **Last-enemy kill-cam micro.** The final kill of a wave gets 0.2s slowmo + a longer trauma tail
  so wave-clears feel like a beat, not a fade. Seam: `waveDone()` transition in main.
- **Low-HP state.** Under 25%: desaturated edges, heartbeat layer, slightly boosted shard magnet.
  Seam: HUD `danger` div exists; sfx has an ambient bus.

## Enemies & AI

- **A miniboss per gate.** One named elite (fixed loadout, small health bar) leading each wave —
  waves gain a face. Seam: elites + boss-bar HUD both exist; spawn from the director's pack table.
- **Rat swarm behavior.** Rats currently path individually; give packmates a shared jitter orbit
  so they *boil* around the player instead of queueing. Seam: `separate()` already runs; add a
  per-rat orbital bias.
- **Knight shield-break.** Heavy hits deplete a small shield pool; at zero the kite shield visibly
  shatters and he takes full frontal damage. Rewards commitment over flanking. Seam:
  `modifyIncoming` + a detachable shield mesh in the template.
- **Archer volleys.** Archers on the same gate synchronize a telegraphed arrow rain (uses the
  existing strike-arc telegraphs) instead of independent potshots.
- **Necromancer caster.** Channels a raise — brings back one corpse as a half-HP husk unless
  interrupted. Creates a priority target. Seam: keel-over deaths already leave a body pose.

## Weapons & builds

- **Weapon mastery.** Kills-per-weapon (already in save stats) unlock a third combo per weapon at
  25 kills. Long-term pull with zero new systems.
- **Charge on more heavies.** Only 3 weapons charge today; francisca charged-heavy = all five axes
  in one horizontal fan, maul charged-heavy = a forward shockwave line.
- **Cursed weapons.** Rare drops with a boon + a bane ("+40% damage, dashes cost 20% more"). Uses
  the existing PlayerMods surface; the swap screen becomes a real dilemma.
- **Throw-the-melee.** Heavy-while-sprinting with greatsword/maul hurls it (big single hit), then
  you fight bare-fisted until you walk over it. High skill ceiling, one projectile + one pickup.

## Run structure

- **Side crypts.** One optional door per causeway segment: a harder mini-arena for a guaranteed
  weapon/boon. Risk/reward without new level tech (reuse gate-wave director in a small room).
- **Boss modifiers on repeat clears.** After first victory, DESCEND offers "Barrow King +1" —
  faster tells, extra gravewave ring — with a score multiplier. Uses save `clears`.
- **Daily rite, reconsidered.** Was removed as clutter, but with seeds + score already in place, a
  single title-line "TODAY'S RITE: seed 20260703 — best 4:12" is one button and real replay pull.
- **Pacifist lane.** Track "gates cleared untouched" in run stats; flawless gate = bonus boon
  choice. Rewards mastery through systems that already exist.

## Presentation

- **Intro crawl.** 10s rail-camera flyover of the causeway (Director-style, as in DEAD AIR) before
  pointer lock, establishing gates → boss silhouette at the far end. All pieces exist (rail cam in
  boss cutscene).
- **Gate-open spectacle.** Gates currently just unseal; add portcullis grind (chain sfx), dust
  curtain, and a slow light-bleed from the next segment.
- **Weather beats per segment.** S1 ember drift → S2 ash fall → S3 soulfire motes rising. The
  ambient emitter already exists; parameterize by z.
- **Corpse persistence budget.** Keep the last ~20 keel-over corpses instead of fading all — the
  causeway should look *fought through* by the boss door.
- **Boss arena walls.** The arena reads as open night; ring it with ruined chapel arches +
  chandeliers (instanced, one draw call) so the final fight has a room.

## Tech / harness

- **Replay capture.** Record input + seed per run (few KB), `__rh4debug.replay(blob)` re-simulates
  it. Turns any bug report into a deterministic repro; the sim is already seeded.
- **Perf HUD toggle.** F3 overlay: draw calls, tris, hitstop, entity counts — reads the counters
  the smoke already gates on.
- **Vision-judged contact sheet.** Feed `shots/electron-*.png` through the visual-qa agent with a
  game-bible rubric on every smoke, not just on demand.
- **Balance telemetry.** Log damage-dealt-per-weapon + damage-taken-per-enemy-kind per run into
  the save; after a few runs the tuning targets pick themselves.
