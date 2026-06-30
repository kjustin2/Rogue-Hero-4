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
  // rocket
  explodeRadius: number;
  // laser (hitscan): beam half-width + reach
  beamWidth: number;
  beamRange: number;
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
  light: AttackDef;
  heavy: AttackDef;
  combos: WeaponComboDef[];
}

export function attackDuration(a: AttackDef): number {
  return a.windup + a.active + a.recovery;
}

// ---- terse attack builders ----
const BASE: AttackDef = {
  mode: "bolt", type: "projectile", damage: 10, knockback: 3,
  windup: 0.05, active: 0.05, recovery: 0.08, cooldown: 0.2,
  arc: 0, range: 0, speed: 38, pellets: 1, spread: 0, big: false, pierce: false,
  explodeRadius: 0, beamWidth: 0, beamRange: 0,
  strikeCount: 0, strikeRadius: 0, strikeRange: 0, strikeDelay: 0,
};
function bolt(o: Partial<AttackDef> & { damage: number; cooldown: number }): AttackDef {
  return { ...BASE, mode: "bolt", type: "projectile", ...o };
}
function rocket(o: Partial<AttackDef> & { damage: number; cooldown: number }): AttackDef {
  return { ...BASE, mode: "rocket", type: "projectile", speed: 26, explodeRadius: 3.6, knockback: 7, windup: 0.1, ...o };
}
function laser(o: Partial<AttackDef> & { damage: number; cooldown: number }): AttackDef {
  return { ...BASE, mode: "laser", type: "projectile", beamWidth: 1.3, beamRange: 46, knockback: 2, ...o };
}
function airstrike(o: Partial<AttackDef> & { damage: number; cooldown: number }): AttackDef {
  return { ...BASE, mode: "airstrike", type: "projectile", strikeCount: 1, strikeRadius: 4, strikeRange: 16, strikeDelay: 0.55, knockback: 6, windup: 0.12, ...o };
}
function melee(o: Partial<AttackDef> & { damage: number; cooldown: number }): AttackDef {
  return { ...BASE, mode: "melee", type: "melee", knockback: 5, active: 0.14, recovery: 0.1, arc: 2.0, range: 3.2, speed: 0, ...o };
}

const GOLD = 0xffc24a, EMBER = 0xff7a3c, RED = 0xff5530, CYAN = 0x49f0ff, VIOLET = 0xb46cff;

export const WEAPONS: WeaponDef[] = [
  {
    // fast, precise single-target plinking — the all-rounder
    id: "boltcaster", name: "BOLT CASTER", kind: "projectile", color: GOLD,
    light: bolt({ damage: 11, cooldown: 0.18, speed: 44, knockback: 2 }),
    heavy: bolt({ damage: 13, cooldown: 0.5, speed: 36, pellets: 3, spread: 0.13, windup: 0.09, knockback: 3 }),
    combos: [
      { name: "STARFALL", recipe: ["light", "light", "light"], tier: 2, damageMult: 2.2, effect: "barrage", radius: 4.5, color: GOLD },
      { name: "ARCSHOT", recipe: ["light", "light", "heavy"], tier: 2, damageMult: 1.7, effect: "bolts", radius: 0, color: GOLD },
      { name: "SCATTERSHOT", recipe: ["heavy", "heavy"], tier: 2, damageMult: 1.6, effect: "bolts", radius: 0, color: GOLD },
    ],
  },
  {
    // the one melee — short reach, heavy hits, forward ground shockwaves
    id: "greatsword", name: "EMBER GREATSWORD", kind: "melee", color: EMBER,
    light: melee({ damage: 13, cooldown: 0.22, arc: 1.9, range: 3.3, active: 0.12, recovery: 0.07, knockback: 4 }),
    heavy: melee({ damage: 28, cooldown: 0.55, arc: 2.8, range: 3.9, windup: 0.1, active: 0.18, recovery: 0.15, knockback: 12 }),
    combos: [
      { name: "CRESCENDO", recipe: ["light", "light", "heavy"], tier: 2, damageMult: 2.6, effect: "slam", radius: 5.0, color: EMBER },
      { name: "QUAKE", recipe: ["heavy", "heavy"], tier: 2, damageMult: 2.2, effect: "slam", radius: 6.5, color: 0xffd24a },
      { name: "ONSLAUGHT", recipe: ["light", "light", "light"], tier: 1, damageMult: 1.8, effect: "slam", radius: 4.5, color: EMBER },
    ],
  },
  {
    // explosive rockets — AoE booms, splash, slower travel
    id: "rocketlance", name: "ROCKET LANCE", kind: "projectile", color: RED,
    light: rocket({ damage: 16, cooldown: 0.5, explodeRadius: 3.4, speed: 28 }),
    heavy: rocket({ damage: 34, cooldown: 1.0, explodeRadius: 5.2, speed: 22, windup: 0.14, knockback: 11 }),
    combos: [
      { name: "SALVO", recipe: ["light", "light", "heavy"], tier: 2, damageMult: 1.8, effect: "rocketvolley", radius: 3.6, color: RED },
      { name: "DEMOLITION", recipe: ["heavy", "heavy"], tier: 3, damageMult: 2.2, effect: "rocketvolley", radius: 4.6, color: RED },
    ],
  },
  {
    // instant hitscan laser — no travel time, pierces a thin corridor
    id: "arclaser", name: "ARC LASER", kind: "projectile", color: CYAN,
    light: laser({ damage: 14, cooldown: 0.3, beamWidth: 1.1, beamRange: 46 }),
    heavy: laser({ damage: 30, cooldown: 0.85, beamWidth: 2.4, beamRange: 52, windup: 0.12, knockback: 5 }),
    combos: [
      { name: "OVERLOAD", recipe: ["light", "light", "light"], tier: 2, damageMult: 2.0, effect: "megabeam", radius: 3.2, color: CYAN },
      { name: "PRISM", recipe: ["heavy", "heavy"], tier: 3, damageMult: 2.4, effect: "megabeam", radius: 4.2, color: CYAN },
    ],
  },
  {
    // called-down air strikes — delayed AoE pillars rain on a zone ahead
    id: "stormcaller", name: "STORM CALLER", kind: "projectile", color: VIOLET,
    light: airstrike({ damage: 22, cooldown: 0.6, strikeCount: 1, strikeRadius: 4.0, strikeRange: 15 }),
    heavy: airstrike({ damage: 30, cooldown: 1.1, strikeCount: 3, strikeRadius: 4.2, strikeRange: 17, windup: 0.16, knockback: 8 }),
    combos: [
      { name: "TEMPEST", recipe: ["light", "light", "heavy"], tier: 2, damageMult: 1.8, effect: "airstrike", radius: 4.4, color: VIOLET },
      { name: "CATACLYSM", recipe: ["heavy", "heavy"], tier: 3, damageMult: 2.2, effect: "airstrike", radius: 4.8, color: 0xffe6b0 },
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
  if (matchWeaponCombo(["light", "light", "light"], bolt)?.name !== "STARFALL") {
    fail.push("starter STARFALL should resolve for light,light,light");
  }
  return fail;
}
