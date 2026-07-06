import type { Ctx } from "./ctx";
import type { Hud } from "../ui/hud";

/**
 * Verb-gated first-run training. Each step names one mechanic and advances the moment the
 * player performs it (flags latched off the typed event bus). Runs inside the normal
 * "playing" state with an `inTutorial` forgiveness flag in main (non-lethal, not recorded).
 * Mirrors the Rogue-Hero-3 tutorial shape.
 */
const STEPS: string[] = [
  "Move with  W A S D   ·   (or the left stick)",
  "Aim with the mouse — LEFT-CLICK for a light strike",
  "Press  SPACE  to DASH — its i-frames roll you through danger",
  "RIGHT-CLICK for a HEAVY strike  ·  (hold to charge some weapons)",
  "Chain  LEFT, LEFT, RIGHT-CLICK  into a COMBO FINISHER",
  "Press  E  to SWAP your weapon",
  "TRAINING COMPLETE  ·  The Rift awaits.",
];

export class Tutorial {
  active = false;
  onComplete: () => void = () => {};
  private step = -1;
  private moved = 0;
  private doneTimer = -1;
  private lastX = 0;
  private lastZ = 0;
  // verbs latch on the ACTION performed (ATTACK/DODGE/COMBO_RESOLVE/WEAPON_SWITCH) — never on
  // landing a hit, so a missed shot or an absent target can't soft-lock a step.
  private flags = { light: false, dodged: false, heavy: false, combo: false, swapped: false };

  constructor(private ctx: Ctx, private hud: Hud) {
    // latch ONLY the current step's verb — else experimenting early (a stray RMB during the light
    // lesson, an E while a 2nd weapon is already granted) pre-completes a later step and skips it.
    ctx.events.on("ATTACK", (e) => { if (!this.active) return; if (this.step === 1 && e.slot === "light") this.flags.light = true; else if (this.step === 3 && e.slot === "heavy") this.flags.heavy = true; });
    ctx.events.on("DODGE", () => { if (this.active && this.step === 2) this.flags.dodged = true; });
    ctx.events.on("COMBO_RESOLVE", () => { if (this.active && this.step === 4) this.flags.combo = true; });
    ctx.events.on("WEAPON_SWITCH", () => { if (this.active && this.step === 5) this.flags.swapped = true; });
  }

  start(): void {
    this.active = true;
    this.step = 0;
    this.moved = 0;
    this.doneTimer = -1;
    this.flags = { light: false, dodged: false, heavy: false, combo: false, swapped: false };
    this.lastX = this.ctx.player.pos.x;
    this.lastZ = this.ctx.player.pos.z;
    this.hud.setTutorial(`TRAINING  ·  ${STEPS[0]}`);
  }

  stop(): void {
    this.active = false;
    this.hud.setTutorial(null);
  }

  /** Keep a lone husk on the field during the combat lessons so there's always a target. */
  private ensureTarget(): void {
    if (this.ctx.enemies.aliveCount() > 0) return;
    const p = this.ctx.player.pos;
    this.ctx.enemies.spawn("husk", p.x + 2.5, p.z + 8);
    this.ctx.enemies.spawn("husk", p.x - 2.5, p.z + 8);
  }

  update(dt: number): void {
    if (!this.active) return;
    if (this.doneTimer >= 0) {
      this.doneTimer -= dt;
      if (this.doneTimer <= 0) { this.stop(); this.onComplete(); }
      return;
    }

    const p = this.ctx.player.pos;
    this.moved += Math.hypot(p.x - this.lastX, p.z - this.lastZ);
    this.lastX = p.x;
    this.lastZ = p.z;

    // steps 1..4 are combat lessons — always keep a husk alive to hit
    if (this.step >= 1 && this.step <= 4) this.ensureTarget();

    let advance = false;
    switch (this.step) {
      case 0: advance = this.moved > 3; break;
      case 1: advance = this.flags.light; break;
      case 2: advance = this.flags.dodged; break;
      case 3: advance = this.flags.heavy; break;
      case 4: advance = this.flags.combo; break;
      case 5: advance = this.flags.swapped; break;
    }
    if (!advance) return;

    this.step++;
    if (this.step >= STEPS.length - 1) {
      this.ctx.enemies.clear();
      this.hud.setTutorial(STEPS[STEPS.length - 1]);
      this.doneTimer = 2.8;
      return;
    }
    // entering the SWAP lesson: grant a 2nd weapon now so E can cycle (kept single-weapon until here)
    if (this.step === 5 && !this.ctx.player.weapons.includes("greatsword")) this.ctx.player.weapons.push("greatsword");
    this.hud.setTutorial(`TRAINING  ·  ${STEPS[this.step]}`);
  }
}
