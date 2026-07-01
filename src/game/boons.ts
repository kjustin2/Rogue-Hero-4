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
}

export function defaultMods(): PlayerMods {
  return {
    lifesteal: 0, dashCdMult: 1, comboDmgMult: 1, moveSpeedMult: 1, magnetMult: 1,
    fervorGainMult: 1, chargeRateMult: 1, dmgTakenMult: 1, shardHealBonus: 0,
    heavyDmgMult: 1, comboWindowBonus: 0,
  };
}

export interface BoonDef {
  id: string;
  name: string;
  desc: string;
  apply(m: PlayerMods): void;
}

export const BOONS: BoonDef[] = [
  { id: "leech", name: "SOUL LEECH", desc: "Heal for 6% of all damage you deal", apply: (m) => { m.lifesteal += 0.06; } },
  { id: "wind", name: "GRAVE WIND", desc: "Dash returns 25% faster", apply: (m) => { m.dashCdMult *= 0.75; } },
  { id: "wrath", name: "RITE OF WRATH", desc: "Combo finishers deal +30% damage", apply: (m) => { m.comboDmgMult *= 1.3; } },
  { id: "stride", name: "DEATHLESS STRIDE", desc: "+12% movement speed", apply: (m) => { m.moveSpeedMult *= 1.12; } },
  { id: "call", name: "SHARD CALL", desc: "Rift shards fly to you from twice as far", apply: (m) => { m.magnetMult *= 2; } },
  { id: "fervor", name: "BURNING FERVOR", desc: "Fervor builds 50% faster", apply: (m) => { m.fervorGainMult *= 1.5; } },
  { id: "draw", name: "SWIFT DRAW", desc: "Heavy charges draw 60% faster", apply: (m) => { m.chargeRateMult *= 1.6; } },
  { id: "bulwark", name: "BARROW BULWARK", desc: "Take 15% less damage", apply: (m) => { m.dmgTakenMult *= 0.85; } },
  { id: "feast", name: "SHARD FEAST", desc: "Rift shards heal +10 more", apply: (m) => { m.shardHealBonus += 10; } },
  { id: "crush", name: "CRUSHING BLOWS", desc: "Heavy attacks deal +20% damage", apply: (m) => { m.heavyDmgMult *= 1.2; } },
  { id: "tempo", name: "LINGERING TEMPO", desc: "Combo chains last 0.5s longer", apply: (m) => { m.comboWindowBonus += 0.5; } },
  { id: "vigor", name: "WARDEN'S VIGOR", desc: "+25 max vitality, healed on pick", apply: () => { /* handled at pick: raises maxHp+hp */ } },
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
