import type { EnemyKind } from "./enemies";

/**
 * Shootable/breakable signature parts. You AIM at a part (armor plate, weapon-arm, wing) and enough
 * hits chip its own HP pool until it breaks off — with a gameplay effect. Part HP is SEPARATE from
 * body HP (a hit that lands on a part chips the part AND deals normal body damage), so this never
 * turns enemies into damage-sponges. Bodies are perf-merged, so only a bounded set is breakable:
 * weapons/wings are already live handles (free); the knight shield + brute pauldron are promoted out
 * of the merge (enemyMeshes keep-list). Bosses carry their own list inline in boss.ts.
 */

/** What breaking a part does to the fight. */
export type BreakEffect = "disarm" | "noblock" | "expose" | "dewing";

/** Key that resolves to a live per-instance mesh handle on the Enemy. */
export type PartKey = "weapon" | "wingL" | "wingR" | "shield" | "pauldron";

export interface BreakableDef {
  part: PartKey;
  /** World hit radius — generous, since the projectile's impact point sits on the body cylinder, not the part. */
  radius: number;
  /** Part HP as a fraction of the enemy's base cfg.hp (its own pool; the body still takes full damage). */
  hpFrac: number;
  effect: BreakEffect;
  /** Debris / chunk color (the part's material tone). */
  debris: number;
}

export const BREAKABLES: Partial<Record<EnemyKind, BreakableDef[]>> = {
  // weapon-disarm: the weapon is already a live handle, so this is nearly free. Break it → the enemy
  // still telegraphs its swing/cast but connects with nothing (you shot the weapon out of its grip).
  husk: [{ part: "weapon", radius: 0.8, hpFrac: 0.6, effect: "disarm", debris: 0x9aa2ac }],
  spitter: [{ part: "weapon", radius: 0.8, hpFrac: 0.7, effect: "disarm", debris: 0xbfb49c }],
  archer: [{ part: "weapon", radius: 0.8, hpFrac: 0.7, effect: "disarm", debris: 0x8d8270 }],
  bomber: [{ part: "weapon", radius: 0.9, hpFrac: 0.6, effect: "disarm", debris: 0xbfb49c }],
  wraith: [{ part: "weapon", radius: 0.9, hpFrac: 0.7, effect: "disarm", debris: 0x9aa2ac }],
  ghoul: [{ part: "weapon", radius: 0.8, hpFrac: 0.7, effect: "disarm", debris: 0xbfb49c }],
  // knight: break the kite SHIELD → its frontal block is gone (no more flanking required); break the sword → disarmed.
  knight: [
    { part: "shield", radius: 1.0, hpFrac: 0.9, effect: "noblock", debris: 0x35322e },
    { part: "weapon", radius: 0.8, hpFrac: 0.7, effect: "disarm", debris: 0x9aa2ac },
  ],
  // brute: break a PAULDRON → exposed, takes more damage everywhere; break the cleaver → its slam is gone.
  brute: [
    { part: "pauldron", radius: 0.9, hpFrac: 0.7, effect: "expose", debris: 0x35322e },
    { part: "weapon", radius: 1.1, hpFrac: 0.8, effect: "disarm", debris: 0x9aa2ac },
  ],
  // gargoyle: break a WING → it's grounded, can't dive any more.
  gargoyle: [
    { part: "wingL", radius: 1.0, hpFrac: 0.5, effect: "dewing", debris: 0x4c463e },
    { part: "wingR", radius: 1.0, hpFrac: 0.5, effect: "dewing", debris: 0x4c463e },
  ],
  // rat omitted (8 hp — dies before a part matters).
};
