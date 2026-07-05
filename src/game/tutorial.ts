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
  "Aim with the mouse — LEFT-CLICK to strike the husk",
  "Press  SPACE  to DASH — roll through a blow for a PERFECT DODGE",
  "Hold  RIGHT-CLICK  for a heavy strike",
  "String hits together into a COMBO FINISHER",
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
  private flags = { hit: false, dodged: false, heavy: false, combo: false, swapped: false };

  constructor(private ctx: Ctx, private hud: Hud) {
    ctx.events.on("ENEMY_HIT", (e) => { if (this.active) { this.flags.hit = true; if (e.heavy) this.flags.heavy = true; } });
    ctx.events.on("DODGE", () => { if (this.active) this.flags.dodged = true; });
    ctx.events.on("COMBO_RESOLVE", () => { if (this.active) this.flags.combo = true; });
    ctx.events.on("WEAPON_SWITCH", () => { if (this.active) this.flags.swapped = true; });
  }

  start(): void {
    this.active = true;
    this.step = 0;
    this.moved = 0;
    this.doneTimer = -1;
    this.flags = { hit: false, dodged: false, heavy: false, combo: false, swapped: false };
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
      case 1: advance = this.flags.hit; break;
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
    this.hud.setTutorial(`TRAINING  ·  ${STEPS[this.step]}`);
  }
}
