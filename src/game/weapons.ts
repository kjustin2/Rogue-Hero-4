/**
 * Weapons — the player's arsenal. Each weapon has a fast LIGHT attack (LMB) and a
 * strong HEAVY attack (RMB); most are projectile weapons, some are melee. Chaining
 * light/heavy within a window resolves per-weapon combos (e.g. firing light three
 * times → a barrage big-shot). Weapons unlock with rift shards collected from kills,
 * and E cycles the unlocked set. Pure data — player reads timings, combat reads the
 * combo payoff. No engine deps, so the combo matcher is unit-checkable.
 */

export type AttackType = "projectile" | "melee";
export type Slot = "light" | "heavy";
export type ComboEffect = "slam" | "lance" | "quake" | "nova" | "barrage";

export interface AttackDef {
  type: AttackType;
  damage: number;
  knockback: number;
  /** Timing (seconds). The hit/cast lands at `windup`. */
  windup: number;
  active: number;
  recovery: number;
  cooldown: number;
  // melee only
  arc: number;
  range: number;
  // projectile only
  speed: number;
  /** Shots per cast (spread fan). */
  pellets: number;
  /** Half-spread of the fan (radians). */
  spread: number;
  /** A fat, slow, piercing shot. */
  big: boolean;
  pierce: boolean;
}

export interface WeaponComboDef {
  name: string;
  /** light/heavy sequence, matched as a suffix of the recent attack buffer. */
  recipe: Slot[];
  /** 1..3 — scales the on-resolve fanfare. */
  tier: number;
  damageMult: number;
  effect: ComboEffect;
  radius: number;
  color: number;
}

export interface WeaponDef {
  id: string;
  name: string;
  /** Dominant flavor (HUD label + viewmodel cast-orb on projectile weapons). */
  kind: AttackType;
  color: number;
  /** Rift shards required to unlock (0 = starter). */
  unlockAt: number;
  light: AttackDef;
  heavy: AttackDef;
  combos: WeaponComboDef[];
}

export function attackDuration(a: AttackDef): number {
  return a.windup + a.active + a.recovery;
}

// ---- terse attack builders (defaults keep the literals readable) ----
function proj(o: Partial<AttackDef> & { damage: number; cooldown: number }): AttackDef {
  return {
    type: "projectile", knockback: 3, windup: 0.05, active: 0.05, recovery: 0.08,
    arc: 0, range: 0, speed: 38, pellets: 1, spread: 0, big: false, pierce: false, ...o,
  };
}
function melee(o: Partial<AttackDef> & { damage: number; cooldown: number }): AttackDef {
  return {
    type: "melee", knockback: 5, windup: 0.05, active: 0.14, recovery: 0.1,
    arc: 2.0, range: 3.2, speed: 0, pellets: 0, spread: 0, big: false, pierce: false, ...o,
  };
}

const GOLD = 0xffc24a, EMBER = 0xff7a3c, CYAN = 0x6ad0ff, VIOLET = 0xb46cff, ICE = 0x9fe0ff;

export const WEAPONS: WeaponDef[] = [
  {
    id: "boltcaster", name: "BOLT CASTER", kind: "projectile", color: GOLD, unlockAt: 0,
    light: proj({ damage: 11, cooldown: 0.20, speed: 42, knockback: 2 }),
    heavy: proj({ damage: 13, cooldown: 0.55, speed: 34, pellets: 3, spread: 0.13, windup: 0.1, knockback: 3 }),
    combos: [
      { name: "STARFALL", recipe: ["light", "light", "light"], tier: 2, damageMult: 2.2, effect: "barrage", radius: 4.5, color: GOLD },
      { name: "ARC LANCE", recipe: ["light", "light", "heavy"], tier: 2, damageMult: 2.0, effect: "lance", radius: 2.4, color: GOLD },
      { name: "SCATTERSTORM", recipe: ["heavy", "heavy"], tier: 2, damageMult: 2.0, effect: "nova", radius: 6.0, color: GOLD },
    ],
  },
  {
    id: "greatsword", name: "EMBER GREATSWORD", kind: "melee", color: EMBER, unlockAt: 4,
    light: melee({ damage: 12, cooldown: 0.24, arc: 1.9, range: 3.3, active: 0.12, recovery: 0.08, knockback: 4 }),
    heavy: melee({ damage: 26, cooldown: 0.6, arc: 2.8, range: 3.9, windup: 0.12, active: 0.18, recovery: 0.16, knockback: 11 }),
    combos: [
      { name: "CRESCENDO", recipe: ["light", "light", "heavy"], tier: 2, damageMult: 2.6, effect: "slam", radius: 4.5, color: EMBER },
      { name: "QUAKE", recipe: ["heavy", "heavy"], tier: 2, damageMult: 2.2, effect: "quake", radius: 6.5, color: 0xffd24a },
      { name: "ONSLAUGHT", recipe: ["light", "light", "light"], tier: 1, damageMult: 1.8, effect: "slam", radius: 4.0, color: EMBER },
    ],
  },
  {
    id: "stormbow", name: "STORM BOW", kind: "projectile", color: CYAN, unlockAt: 9,
    light: proj({ damage: 9, cooldown: 0.15, speed: 50, knockback: 1 }),
    heavy: proj({ damage: 22, cooldown: 0.7, speed: 42, big: true, pierce: true, windup: 0.12, knockback: 5 }),
    combos: [
      { name: "TEMPEST", recipe: ["light", "light", "light"], tier: 2, damageMult: 2.0, effect: "nova", radius: 6.5, color: CYAN },
      { name: "THUNDERCLAP", recipe: ["heavy", "heavy"], tier: 3, damageMult: 2.6, effect: "barrage", radius: 5.0, color: CYAN },
    ],
  },
  {
    id: "voidcannon", name: "VOID CANNON", kind: "projectile", color: VIOLET, unlockAt: 15,
    light: proj({ damage: 15, cooldown: 0.38, speed: 30, knockback: 4 }),
    heavy: proj({ damage: 34, cooldown: 1.0, speed: 18, big: true, pierce: true, windup: 0.14, knockback: 9 }),
    combos: [
      { name: "VOID NOVA", recipe: ["heavy", "heavy"], tier: 3, damageMult: 3.2, effect: "nova", radius: 7.5, color: 0xffe6b0 },
      { name: "STARFALL", recipe: ["light", "light", "light"], tier: 2, damageMult: 2.2, effect: "barrage", radius: 4.5, color: VIOLET },
    ],
  },
  {
    id: "maul", name: "GLACIER MAUL", kind: "melee", color: ICE, unlockAt: 22,
    light: melee({ damage: 14, cooldown: 0.3, arc: 1.7, range: 3.0, active: 0.13, knockback: 6 }),
    heavy: melee({ damage: 32, cooldown: 0.85, arc: 3.0, range: 4.1, windup: 0.14, active: 0.2, recovery: 0.18, knockback: 14 }),
    combos: [
      { name: "AVALANCHE", recipe: ["light", "light", "heavy"], tier: 2, damageMult: 2.6, effect: "slam", radius: 5.0, color: ICE },
      { name: "GLACIAL QUAKE", recipe: ["heavy", "heavy"], tier: 2, damageMult: 2.2, effect: "quake", radius: 7.0, color: ICE },
    ],
  },
];

export function weaponById(id: string): WeaponDef {
  return WEAPONS.find((w) => w.id === id) ?? WEAPONS[0];
}

/** The longest combo of `w` whose recipe is a suffix of `recent`, or null. */
export function matchWeaponCombo(recent: readonly Slot[], w: WeaponDef): WeaponComboDef | null {
  // longest recipe first so a 3-chain wins over a contained 2-chain
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

/**
 * Runnable self-check (ponytail: the one check the weapon-combo logic leaves behind).
 * Returns failures — empty means healthy. Wired into the smoke via __rh4debug.checkCombos.
 */
export function weaponComboSelfCheck(): string[] {
  const fail: string[] = [];
  for (const w of WEAPONS) {
    for (const c of w.combos) {
      const m = matchWeaponCombo(c.recipe, w);
      if (m?.name !== c.name) fail.push(`${w.id}: recipe ${c.name} did not self-match (got ${m?.name ?? "null"})`);
    }
    // a longer buffer ending in a recipe still resolves (suffix match)
    const first = w.combos[0];
    if (first && matchWeaponCombo(["heavy", ...first.recipe], w)?.name !== first.name) {
      fail.push(`${w.id}: suffix match failed for ${first.name}`);
    }
  }
  // starter STARFALL (light x3) beats a contained shorter combo
  const bolt = WEAPONS[0];
  if (matchWeaponCombo(["light", "light", "light"], bolt)?.name !== "STARFALL") {
    fail.push("starter STARFALL should resolve for light,light,light");
  }
  return fail;
}
