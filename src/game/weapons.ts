/**
 * Weapons — the player's arsenal. Each weapon is mechanically DISTINCT: fast bolts,
 * a melee greatsword, explosive rockets, an instant hitscan laser, or called-down air
 * strikes. Each has a fast LIGHT attack (LMB) + strong HEAVY attack (RMB) and its own
 * light/heavy combos, whose finishers fire FORWARD (projectiles / rockets / beams /
 * strikes) — not melee-range circles. Weapons are found as pickups on the causeway.
 * Pure data — player reads timings + mode, combat reads the combo payoff.
 */

export type AttackMode = "bolt" | "rocket" | "laser" | "airstrike" | "melee";
export type AttackType = "projectile" | "melee"; // HUD/viewmodel flavor
export type Slot = "light" | "heavy";
export type ComboEffect = "barrage" | "bolts" | "slam" | "rocketvolley" | "megabeam" | "airstrike";

export interface AttackDef {
  mode: AttackMode;
  type: AttackType;
  damage: number;
  knockback: number;
  /** Self-shove on firing: + shoves the player BACKWARD (recoil / rocket-kick),
   *  - pulls them FORWARD (a melee lunge into range). 0 = planted. */
  recoil: number;
  windup: number;
  active: number;
  recovery: number;
  cooldown: number;
  // melee
  arc: number;
  range: number;
  // bolt / rocket
  speed: number;
  pellets: number;
  spread: number;
  big: boolean;
  pierce: boolean;
  /** Projectile visual: a thin crossbow dart, a heavy iron cannonball, or a runed comet. */
  shape: "dart" | "cannonball" | "comet";
  // rocket
  explodeRadius: number;
  /** >0 → a lobbed shot that arcs under gravity (mortar) instead of flying straight. */
  gravity: number;
  // laser (hitscan): beam half-width + reach
  beamWidth: number;
  beamRange: number;
  /** >0 → the heavy can be HELD: damage/recoil scale up to chargeMult over chargeMax seconds. */
  chargeMax: number;
  chargeMult: number;
  // airstrike: N strikes, each radius, fired this far ahead, after this delay
  strikeCount: number;
  strikeRadius: number;
  strikeRange: number;
  strikeDelay: number;
}

export interface WeaponComboDef {
  name: string;
  recipe: Slot[];
  tier: number;
  damageMult: number;
  effect: ComboEffect;
  radius: number;
  color: number;
}

export interface WeaponDef {
  id: string;
  name: string;
  kind: AttackType;
  color: number;
  /** Movement speed multiplier WHILE committing to an attack — the "how you move" identity.
   *  A crossbow skirmisher stays mobile (~0.85); a greatsword roots you (~0.4). */
  moveMult: number;
  light: AttackDef;
  heavy: AttackDef;
  combos: WeaponComboDef[];
}

export function attackDuration(a: AttackDef): number {
  return a.windup + a.active + a.recovery;
}

// ---- terse attack builders ----
const BASE: AttackDef = {
  mode: "bolt", type: "projectile", damage: 10, knockback: 3, recoil: 0,
  windup: 0.05, active: 0.05, recovery: 0.08, cooldown: 0.2,
  arc: 0, range: 0, speed: 38, pellets: 1, spread: 0, big: false, pierce: false, shape: "comet",
  explodeRadius: 0, gravity: 0, beamWidth: 0, beamRange: 0, chargeMax: 0, chargeMult: 1,
  strikeCount: 0, strikeRadius: 0, strikeRange: 0, strikeDelay: 0,
};
function bolt(o: Partial<AttackDef> & { damage: number; cooldown: number }): AttackDef {
  return { ...BASE, mode: "bolt", type: "projectile", shape: "dart", ...o };
}
function rocket(o: Partial<AttackDef> & { damage: number; cooldown: number }): AttackDef {
  return { ...BASE, mode: "rocket", type: "projectile", shape: "cannonball", speed: 26, explodeRadius: 3.6, knockback: 7, recoil: 6, windup: 0.1, ...o };
}
function laser(o: Partial<AttackDef> & { damage: number; cooldown: number }): AttackDef {
  return { ...BASE, mode: "laser", type: "projectile", beamWidth: 1.3, beamRange: 46, knockback: 2, ...o };
}
function airstrike(o: Partial<AttackDef> & { damage: number; cooldown: number }): AttackDef {
  return { ...BASE, mode: "airstrike", type: "projectile", strikeCount: 1, strikeRadius: 4, strikeRange: 16, strikeDelay: 0.55, knockback: 6, windup: 0.12, ...o };
}
function melee(o: Partial<AttackDef> & { damage: number; cooldown: number }): AttackDef {
  return { ...BASE, mode: "melee", type: "melee", knockback: 5, recoil: -5, active: 0.14, recovery: 0.1, arc: 2.0, range: 3.2, speed: 0, ...o };
}

const GOLD = 0xffc24a, EMBER = 0xff7a3c, RED = 0xff5530, CYAN = 0x49f0ff, VIOLET = 0xb46cff;

export const WEAPONS: WeaponDef[] = [
  {
    // fast, precise single-target plinking — the mobile all-rounder (kite & plink)
    id: "boltcaster", name: "HEAVY CROSSBOW", kind: "projectile", color: GOLD, moveMult: 0.85,
    // light: rapid single darts. heavy: a slow charged POWER BOLT that pierces the whole lane.
    light: bolt({ damage: 11, cooldown: 0.17, speed: 50, knockback: 2 }),
    heavy: bolt({ damage: 30, cooldown: 0.7, speed: 38, big: true, pierce: true, windup: 0.18, recovery: 0.14, knockback: 6 }),
    combos: [
      { name: "ARROWSTORM", recipe: ["light", "light", "light"], tier: 2, damageMult: 2.2, effect: "barrage", radius: 4.5, color: GOLD },
      { name: "SPLIT VOLLEY", recipe: ["light", "light", "heavy"], tier: 2, damageMult: 1.7, effect: "bolts", radius: 0, color: GOLD },
      { name: "THORNBURST", recipe: ["heavy", "heavy"], tier: 2, damageMult: 1.6, effect: "bolts", radius: 0, color: GOLD },
    ],
  },
  {
    // the one melee — roots you mid-swing but LUNGES you into range; heavy hits, shockwaves
    id: "greatsword", name: "EMBER GREATSWORD", kind: "melee", color: EMBER, moveMult: 0.4,
    light: melee({ damage: 13, cooldown: 0.22, arc: 1.9, range: 3.3, active: 0.12, recovery: 0.07, knockback: 4, recoil: -5 }),
    heavy: melee({ damage: 28, cooldown: 0.55, arc: 2.8, range: 3.9, windup: 0.1, active: 0.18, recovery: 0.15, knockback: 12, recoil: -9, chargeMax: 0.9, chargeMult: 2.0 }),
    combos: [
      { name: "SUNDERSTRIKE", recipe: ["light", "light", "heavy"], tier: 2, damageMult: 2.6, effect: "slam", radius: 5.0, color: EMBER },
      { name: "EARTHSHAKER", recipe: ["heavy", "heavy"], tier: 2, damageMult: 2.2, effect: "slam", radius: 6.5, color: 0xffd24a },
      { name: "BLADE FLURRY", recipe: ["light", "light", "light"], tier: 1, damageMult: 1.8, effect: "slam", radius: 4.5, color: EMBER },
    ],
  },
  {
    // explosive rockets — AoE booms + heavy SELF-RECOIL that shoves you back (spacing/peek tool)
    id: "rocketlance", name: "HAND BOMBARD", kind: "projectile", color: RED, moveMult: 0.6,
    // light: a flat-fired iron shell, small blast. heavy: a lobbed MORTAR that arcs + big blast.
    light: rocket({ damage: 16, cooldown: 0.5, explodeRadius: 3.4, speed: 30 }),
    heavy: rocket({ damage: 36, cooldown: 1.05, explodeRadius: 6.0, speed: 22, gravity: 26, windup: 0.2, recovery: 0.18, knockback: 12, recoil: 16, chargeMax: 0.9, chargeMult: 1.8 }),
    combos: [
      { name: "CANNONADE", recipe: ["light", "light", "heavy"], tier: 2, damageMult: 1.8, effect: "rocketvolley", radius: 3.6, color: RED },
      { name: "SIEGEBREAKER", recipe: ["heavy", "heavy"], tier: 3, damageMult: 2.2, effect: "rocketvolley", radius: 4.6, color: RED },
    ],
  },
  {
    // instant hitscan laser — precision weapon; the heavy charge nearly ROOTS you to aim
    id: "arclaser", name: "PRISM ROD", kind: "projectile", color: CYAN, moveMult: 0.5,
    // light: a quick thin zap. heavy: a slow-charged WIDE lance-beam you can feel wind up.
    light: laser({ damage: 13, cooldown: 0.26, beamWidth: 0.8, beamRange: 46, windup: 0.04 }),
    heavy: laser({ damage: 34, cooldown: 1.0, beamWidth: 3.0, beamRange: 56, windup: 0.32, recovery: 0.2, knockback: 6, recoil: 8, chargeMax: 0.9, chargeMult: 2.0 }),
    combos: [
      { name: "RADIANT LANCE", recipe: ["light", "light", "light"], tier: 2, damageMult: 2.0, effect: "megabeam", radius: 3.2, color: CYAN },
      { name: "PRISM WRATH", recipe: ["heavy", "heavy"], tier: 3, damageMult: 2.4, effect: "megabeam", radius: 4.2, color: CYAN },
    ],
  },
  {
    // called-down air strikes — artillery; call a zone ahead, then reposition off it
    id: "stormcaller", name: "STORM CALLER", kind: "projectile", color: VIOLET, moveMult: 0.7,
    light: airstrike({ damage: 22, cooldown: 0.6, strikeCount: 1, strikeRadius: 4.0, strikeRange: 15 }),
    heavy: airstrike({ damage: 30, cooldown: 1.1, strikeCount: 3, strikeRadius: 4.2, strikeRange: 17, windup: 0.16, knockback: 8, recoil: 4 }),
    combos: [
      { name: "STORMFALL", recipe: ["light", "light", "heavy"], tier: 2, damageMult: 1.8, effect: "airstrike", radius: 4.4, color: VIOLET },
      { name: "HEAVEN'S WRATH", recipe: ["heavy", "heavy"], tier: 3, damageMult: 2.2, effect: "airstrike", radius: 4.8, color: 0xffe6b0 },
    ],
  },
];

export function weaponById(id: string): WeaponDef {
  return WEAPONS.find((w) => w.id === id) ?? WEAPONS[0];
}

/** The longest combo of `w` whose recipe is a suffix of `recent`, or null. */
export function matchWeaponCombo(recent: readonly Slot[], w: WeaponDef): WeaponComboDef | null {
  const byLen = [...w.combos].sort((a, b) => b.recipe.length - a.recipe.length);
  for (const c of byLen) {
    const r = c.recipe;
    if (recent.length < r.length) continue;
    let ok = true;
    for (let i = 0; i < r.length; i++) {
      if (recent[recent.length - r.length + i] !== r[i]) { ok = false; break; }
    }
    if (ok) return c;
  }
  return null;
}

/** Runnable self-check (ponytail: the one check the weapon-combo logic leaves behind). */
export function weaponComboSelfCheck(): string[] {
  const fail: string[] = [];
  for (const w of WEAPONS) {
    for (const c of w.combos) {
      const m = matchWeaponCombo(c.recipe, w);
      if (m?.name !== c.name) fail.push(`${w.id}: recipe ${c.name} did not self-match (got ${m?.name ?? "null"})`);
    }
    const first = w.combos[0];
    if (first && matchWeaponCombo(["heavy", ...first.recipe], w)?.name !== first.name) {
      fail.push(`${w.id}: suffix match failed for ${first.name}`);
    }
  }
  const bolt = WEAPONS[0];
  if (matchWeaponCombo(["light", "light", "light"], bolt)?.name !== "ARROWSTORM") {
    fail.push("starter ARROWSTORM should resolve for light,light,light");
  }
  // handling-stat sanity (weapon identity): mobility must stay in (0,1]
  for (const w of WEAPONS) {
    if (!(w.moveMult > 0 && w.moveMult <= 1)) fail.push(`${w.id}: moveMult ${w.moveMult} out of (0,1]`);
  }
  return fail;
}
