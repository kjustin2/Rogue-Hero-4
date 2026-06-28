import type { CardDef, CardKind, CharDef, EnemyDef, EnemyKind, RelicDef, BiomeDef } from "./types.js";

export const NEON = {
  cyan: 0x36f9ff, mag: 0xff3df0, amber: 0xffb340, red: 0xff3b5c,
  violet: 0x9d6bff, green: 0x53ff8a, ice: 0xbfeaff, ember: 0xff5a3c,
  enemyShot: 0xff5a2a,
};

export const CARDS: Record<CardKind, CardDef> = {
  strike:   { id: "strike",   name: "Pulse Strike",    kind: "strike",   cooldown: 0.42, glyph: "storm", damage: 17, range: 3.4,  color: NEON.cyan },
  bolt:     { id: "bolt",     name: "Arc Bolt",        kind: "bolt",     cooldown: 0.5,  glyph: "storm", damage: 15, range: 24, speed: 28, color: NEON.cyan },
  arc:      { id: "arc",      name: "Whirl",           kind: "arc",      cooldown: 1.4,  glyph: "ember", damage: 24, range: 4.8,  color: NEON.amber },
  dash:     { id: "dash",     name: "Phase Dash",      kind: "dash",     cooldown: 1.0,  glyph: "void",  damage: 12, range: 8,    color: NEON.violet },
  volley:   { id: "volley",   name: "Splinter Volley", kind: "volley",   cooldown: 1.7,  glyph: "void",  damage: 10, range: 22, speed: 26, count: 5, color: NEON.mag },
  nova:     { id: "nova",     name: "Frost Nova",      kind: "nova",     cooldown: 2.4,  glyph: "frost", damage: 20, range: 6.5,  color: NEON.ice },
  siphon:   { id: "siphon",   name: "Siphon Lash",     kind: "siphon",   cooldown: 1.1,  glyph: "frost", damage: 15, range: 3.8,  color: NEON.green },
  overload: { id: "overload", name: "Overload",        kind: "overload", cooldown: 6.0,  glyph: "ember", damage: 0,  range: 0,    color: NEON.red },
};

export const CHARACTERS: CharDef[] = [
  { id: "pyre",   name: "Pyre",   title: "Ember Blade",  hp: 100, speed: 8.6, color: NEON.amber, loadout: ["strike", "bolt", "arc", "dash"], weavePower: 1.5 },
  { id: "frost",  name: "Frost",  title: "Glacial Ward", hp: 135, speed: 7.4, color: NEON.cyan,  loadout: ["strike", "nova", "arc", "dash"], dmgResist: 0.2, hurtWard: 1.2, unlock: "Finish a run" },
  { id: "shadow", name: "Shadow", title: "Phantom Edge", hp: 80,  speed: 9.6, color: NEON.mag,   loadout: ["bolt", "volley", "dash", "siphon"], dashIframe: 0.35, postDashCrit: true, unlock: "Reach depth 3" },
];

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  darter:   { kind: "darter",   name: "Darter",        hp: 20,  speed: 9.7, radius: 0.7, damage: 9,  touch: 0.7, color: NEON.red },
  brute:    { kind: "brute",    name: "Brute",         hp: 78,  speed: 4.7, radius: 1.2, damage: 22, touch: 1.0, color: NEON.amber },
  caster:   { kind: "caster",   name: "Caster",        hp: 30,  speed: 5.6, radius: 0.8, damage: 11, touch: 0,   color: NEON.violet, ranged: true, fireRate: 1.25 },
  splitter: { kind: "splitter", name: "Splitter",      hp: 46,  speed: 6.2, radius: 1.0, damage: 12, touch: 0.9, color: NEON.green, splits: 2 },
  boss:     { kind: "boss",     name: "The Conductor", hp: 620, speed: 3.8, radius: 2.5, damage: 24, touch: 1.1, color: NEON.cyan,  ranged: true, fireRate: 0.95, scoreboard: true },
};

export const RELICS: RelicDef[] = [
  { id: "razor",      name: "Razor Battery", icon: "✦", desc: "+18% damage" },
  { id: "iron",       name: "Iron Pulse",    icon: "⬢", desc: "+30 max HP, healed now" },
  { id: "metronome",  name: "Metronome",     icon: "⟳", desc: "Resonance grants 3 empowered casts" },
  { id: "runaway",    name: "Runaway Core",  icon: "▲", desc: "Weave bursts +35% radius" },
  { id: "grease",     name: "Comet Grease",  icon: "≫", desc: "+20% move speed" },
  { id: "siphon",     name: "Siphon Coil",   icon: "◍", desc: "Kills heal 5 HP" },
  { id: "overcharge", name: "Overcharge",    icon: "✺", desc: "Weave bursts +70% damage & radius" },
  { id: "resonator",  name: "Resonator",     icon: "◈", desc: "Empowered casts pierce +2" },
];

export const BIOMES: BiomeDef[] = [
  { name: "Voidline",  fog: 0x140a1e, ground: 0x0b0b16, accent: NEON.mag },
  { name: "Verdant",   fog: 0x07140e, ground: 0x0a1410, accent: NEON.green },
  { name: "Cathedral", fog: 0x1a1206, ground: 0x14110a, accent: NEON.amber },
];

// The road: X is the narrow lateral axis, Z is forward progress toward the boss.
export const ROAD_HALF = 18;            // half-width (X clamps to [-18, 18]) — wide path
export const ROAD_LEN = 160;            // length (Z clamps to [0, 160])
export const ROAD_START = 7;            // player start Z
export const BOSS_AT = ROAD_LEN - 14;   // boss sits near the far end
export const MAX_ACTS = 3;              // beat 3 bosses = win the run
