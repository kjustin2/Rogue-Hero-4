import type { Rng } from "../core/rng";

/**
 * Between-gate boons — the run's decision beat. Each boon writes a flat multiplier
 * into PlayerMods; the existing systems read the mods at their one funnel point each
 * (dealDamage, damagePlayer, startDash, move, addShard, fervor gain, charge draw).
 * Pure data: a new boon = one entry + (at most) one read site.
 */
export interface PlayerMods {
  lifesteal: number;       // fraction of dealt damage returned as healing
  dashCdMult: number;
  comboDmgMult: number;
  moveSpeedMult: number;
  magnetMult: number;      // shard magnet radius
  fervorGainMult: number;
  chargeRateMult: number;
  dmgTakenMult: number;
  shardHealBonus: number;
  heavyDmgMult: number;
  comboWindowBonus: number; // extra seconds before the chain drops
  strikeDmgMult: number;    // MORTAL EDGE — all outgoing damage
  executeBelow: number;     // EXECUTIONER — a hit that leaves an enemy under this HP fraction finishes it
}

export function defaultMods(): PlayerMods {
  return {
    lifesteal: 0, dashCdMult: 1, comboDmgMult: 1, moveSpeedMult: 1, magnetMult: 1,
    fervorGainMult: 1, chargeRateMult: 1, dmgTakenMult: 1, shardHealBonus: 0,
    heavyDmgMult: 1, comboWindowBonus: 0, strikeDmgMult: 1, executeBelow: 0,
  };
}

export type BoonTier = "common" | "rare" | "epic";

export interface BoonDef {
  id: string;
  name: string;
  desc: string;
  icon: string;    // glyph on the card
  accent: number;  // card accent/glow hue (menu overlay — outside the in-world palette)
  tier: BoonTier;
  apply(m: PlayerMods): void;
}

// accent families: offense = ember/red, guard = teal, tempo = gold/violet
const OFF = 0xff7a3c, RED = 0xff5530, GUARD = 0x49f0c0, GOLD = 0xffc24a, VIOLET = 0xb46cff;

export const BOONS: BoonDef[] = [
  { id: "leech", name: "SOUL LEECH", desc: "Heal for 6% of all damage you deal", icon: "🩸", accent: GUARD, tier: "rare", apply: (m) => { m.lifesteal += 0.06; } },
  { id: "wind", name: "GRAVE WIND", desc: "Dash returns 25% faster", icon: "💨", accent: GOLD, tier: "common", apply: (m) => { m.dashCdMult *= 0.75; } },
  { id: "wrath", name: "RITE OF WRATH", desc: "Combo finishers deal +30% damage", icon: "⚔️", accent: OFF, tier: "rare", apply: (m) => { m.comboDmgMult *= 1.3; } },
  { id: "stride", name: "DEATHLESS STRIDE", desc: "Move 12% faster", icon: "🏃", accent: GOLD, tier: "common", apply: (m) => { m.moveSpeedMult *= 1.12; } },
  { id: "call", name: "SHARD CALL", desc: "Rift shards pull to you from twice as far", icon: "🧲", accent: GOLD, tier: "common", apply: (m) => { m.magnetMult *= 2; } },
  { id: "fervor", name: "BURNING FERVOR", desc: "Build fervor 50% faster", icon: "🔥", accent: VIOLET, tier: "rare", apply: (m) => { m.fervorGainMult *= 1.5; } },
  { id: "edge", name: "MORTAL EDGE", desc: "Every attack deals +15% damage", icon: "🗡️", accent: RED, tier: "rare", apply: (m) => { m.strikeDmgMult *= 1.15; } },
  { id: "bulwark", name: "BARROW BULWARK", desc: "Take 15% less damage", icon: "🛡️", accent: GUARD, tier: "rare", apply: (m) => { m.dmgTakenMult *= 0.85; } },
  { id: "feast", name: "SHARD FEAST", desc: "Rift shards heal +10 more", icon: "💎", accent: GUARD, tier: "common", apply: (m) => { m.shardHealBonus += 10; } },
  { id: "crush", name: "CRUSHING BLOWS", desc: "Heavy attacks deal +20% damage", icon: "🔨", accent: OFF, tier: "common", apply: (m) => { m.heavyDmgMult *= 1.2; } },
  { id: "execute", name: "EXECUTIONER", desc: "Instantly slay any enemy struck below 15% health", icon: "💀", accent: RED, tier: "epic", apply: (m) => { m.executeBelow = Math.max(m.executeBelow, 0.15); } },
  { id: "vigor", name: "WARDEN'S VIGOR", desc: "+25 max vitality, fully healed now", icon: "❤️", accent: GUARD, tier: "epic", apply: () => { /* handled at pick: raises maxHp+hp */ } },
];

/** Three distinct random boons for the choice screen. */
export function pick3(rng: Rng): BoonDef[] {
  const pool = [...BOONS];
  const out: BoonDef[] = [];
  for (let i = 0; i < 3 && pool.length; i++) {
    out.push(pool.splice(rng.int(0, pool.length - 1), 1)[0]);
  }
  return out;
}
