# Rogue Hero 4 — Game Bible (the AI's eyes)

This document is the **single source of visual + experiential truth**. The build targets it;
the **vision harness** (`scripts/vision.mjs`) feeds it to a vision model as the rubric so the
AI judges screenshots against *intent*, not just "is it black." If a screenshot disagrees
with this doc, the screenshot is the bug.

> Core lesson that created this file: the old harness reported "✓ healthy / no black frames /
> no console errors" on a game that was an unreadable, top-down, 90%-black void. **A harness
> with no eyes is worse than no harness** — it certifies garbage. Every claim of "looks good"
> must be backed by a vision-judged screenshot.

---

## 1. The fantasy (feel in one paragraph)
You are a lone vessel dropped into a neon arcane arena. You **dance on the TEMPO meter** —
shove it HOT to hit like a truck, ride it COLD to tank, and slam 0/100 to detonate the room.
It should feel **fast, punchy, legible, and a little overwhelming in a good way**: bright tracer
fire, chunky hits, screen kick on a crash, enemies that read instantly as threats. Think
*Hades meets a synthwave bullet-arena*, viewed from just **over the hero's shoulder**.

## 2. Camera — NON-NEGOTIABLE
- **Behind-the-shoulder third person.** The hero sits in the **lower third** of the frame,
  large and clearly the protagonist. Camera is **low and close** (height ≈ 6–9 units, ≈ 11–14
  units behind), pitched down only ~25–35°, looking slightly *ahead* of the hero so you see
  the threats you're walking into.
- Smooth follow: fast-in / slow-out damping. Light shake on hits/crashes — never nausea.
- **Player-controllable + auto-framing.** The player can rotate the camera (Q/E or ←/→) and
  movement is camera-relative; when they aren't steering, it gently auto-frames toward nearby
  threats so enemies stay in view. "I can't keep the enemies on screen" is a failure.
- **Forbidden:** the old steep top-down (height 30, 22 back). If the hero looks like a tiny
  speck in a void, the camera is wrong.

## 3. Readability — the bar
- **You can tell the protagonist from enemies from projectiles at a glance.** Hero = one bold
  silhouette + signature colour. Enemies = distinct hostile shapes, clearly *not* the hero.
  Friendly fire = one colour, enemy fire = a clearly different colour.
- **All on-screen text is readable** at 1280×720: HUD labels, the 4 ability cards (name +
  hotkey), depth/score, menu buttons, card descriptions. No clipping, no text hidden behind
  bands, nothing smaller than ~13px effective.
- The frame is **not** mostly black. There is a real, lit environment (floor, walls, depth
  cues, ground glow) — the arena reads as a *place*, not a void with a thin grid.
- **No overlapping or clipped UI — at ANY window size or aspect.** Menus and HUD must lay out
  responsively (flex/`clamp`, not fixed pixels) so nothing ever collides or runs offscreen at
  720p / 1080p / the desktop window / a laptop / 4:3. This is enforced as a hard invariant by
  `npm run flow` (a vibe-judge alone will miss it).

## 4. The flow (every state must be self-explanatory)
1. **Title** — game name big, one obvious primary button ("Play"), one line of what this is.
2. **Character select** — 2–3 vessels as clear cards: name, role, the 4 abilities, HP. Locked
   ones say how to unlock. One is obviously selectable/default. A **Back** that works.
3. **Tutorial** — the first run is an **interactive** tutorial: teach ONE mechanic at a time,
   gated on the player actually doing it (move → rotate camera → attack → dash → clear the
   room), with snappy prompts. A reference How-to-Play screen is also on the title. A new
   player must never think "I don't know how to play."
4. **Playing** — HUD always shows: vitality, the TEMPO meter with its current ZONE named,
   the 4 ability cards with hotkeys + cooldowns, depth + kills. Boss room adds a boss bar.
5. **Room clear → Draft** — pick 1 of 3 relics, each with a readable name + effect.
6. **Boss** — telegraphed, readable bullet patterns.
7. **Win / Lose** — clear outcome, stats, "Run again" + "Menu".

## 5. The look (palette + post)
- Neon-arcane: deep indigo/violet space, cyan/magenta/amber/green accents. Emissive = light
  (glowing things also cast light). Graded post: bloom on true glows, ACES tone map, vignette,
  subtle grain. Bloom threshold high enough that **panels/text stay crisp** (the VLM, like a
  human, fails on washed/blurred UI).
- Juice: hit flashes, particle bursts on kills, a fat screen-shake + flash on a TEMPO crash,
  damage floaters. Juice must **never** wreck readability (rule 3 wins ties).
- **Crafted detail, not programmer art.** Surfaces have texture/material (a paneled/circuit
  floor, not a flat plane); entities are **multi-part designed models** (a faceted shell + a
  glowing inner core + accent shards/eye), not single primitives (cones/dice/spheres/blobs).
  The floor reads as a built arena; the hero and enemies read as *designed*, distinct creatures.
- **Everything animates.** Idle motion (breathing/bob), attack anticipation + recoil on cast,
  hit reactions (squash/flinch), spawn (scale-in) and death (scale-out/shatter). Nothing should
  just rigidly translate or spin like a static prop.

## 6. The signature mechanic — TEMPO (keep this; it's the good idea)
0–100 meter, neutral 50, decays toward 50. Cards shove it. **HOT** (≥70) = ×1.5 damage;
**CRITICAL** (≥90) = pierce; **COLD** (≤30) = −25% incoming. Hit **0 or 100** → a **crash**
(AoE nova, resets to 50). The meter's zone must be **named on screen at all times** so the
player understands why their damage/defense changed.

---

## 7. Vision rubric (what the judge scores per screenshot, 0–10 each)
The harness asks the model for JSON `{reasoning, scores:{...}, top_issues:[...], verdict}` where
scores covers, **per the relevant scenario**:

- **camera** — behind-the-shoulder third person, hero large in lower third (NOT top-down void).
- **readability** — all visible text is legible; nothing clipped/blurred/hidden.
- **clarity** — can you instantly tell hero vs enemy vs projectile, and what's happening.
- **menu_clarity** — (menus only) obvious what to do next, primary action stands out.
- **environment** — a lit, real-feeling place; not a mostly-black void.
- **appeal** — does it look intentional and cool (neon-arcane), not broken/programmer-art.
- **feel** — (combat only) does the moment look dynamic/punchy (fire, hits, juice).

**Pass bar for the rebuild:** every scenario ≥ 7 on every applicable criterion, and **no**
single criterion < 6 anywhere. A scenario below bar names the specific fix in `top_issues`.

## 8. Design rubric (judge against real design knowledge, not vibes)
Grounded in Schell (lenses), Koster (fun=learning), Swink (game feel), Meier (interesting
decisions), flow theory, and roguelite craft — full reference in the `/game-design` skill. When
judging a screenshot/filmstrip, weigh the visual lines of this rubric:
- **Game feel** (Swink): does the moment look responsive/snappy with layered feedback (ADSR
  attack on hits)? Floaty/laggy/flat = low.
- **Interesting decisions** (Meier): on menus/draft, are the choices clear, distinct, and
  non-dominated (impactful + informed)? Obvious/blind/samey choices = low.
- **Readability wins ties**: hero vs enemy vs projectile vs hazard instantly distinct; juice
  never buries the read.
- **Flow**: combat reads as engaging — not empty (boring) and not unreadable chaos (anxiety).
- **Clarity of goal + feedback**: the player can always tell the goal and see the result.
- **Look/cohesion**: reads as a shipped pro game (art direction + crafted detail), not programmer art.
