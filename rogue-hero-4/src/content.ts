import type { CardDef, CharacterDef, EnemyDef, RelicDef, BiomeDef, EnemyKind } from './types';

// Neon-arcane palette.
export const NEON = {
  cyan: 0x36f9ff, mag: 0xff3df0, amber: 0xffb340,
  red: 0xff3b5c, violet: 0x9d6bff, green: 0x53ff8a, ice: 0xbfeaff,
};

export const CARDS: Record<string, CardDef> = {
  strike:   { id: 'strike',   name: 'Pulse Strike',    kind: 'strike',   cooldown: 0.42, tempo: 9,   damage: 17, range: 3.4, count: 1, color: NEON.cyan,   desc: 'Close arc swing. Fast, builds tempo.' },
  bolt:     { id: 'bolt',     name: 'Arc Bolt',        kind: 'bolt',     cooldown: 0.5,  tempo: 8,   damage: 15, range: 24, speed: 28, color: NEON.cyan,    desc: 'Fire a homing-straight bolt at the aim.' },
  arc:      { id: 'arc',      name: 'Whirl',           kind: 'arc',      cooldown: 1.4,  tempo: 15,  damage: 24, range: 4.8, color: NEON.amber,  desc: 'Spinning AoE around you. Strong tempo.' },
  dash:     { id: 'dash',     name: 'Phase Dash',      kind: 'dash',     cooldown: 1.0,  tempo: -6,  damage: 12, range: 8,  color: NEON.violet, desc: 'Blink through enemies, leaving a shock.' },
  volley:   { id: 'volley',   name: 'Splinter Volley', kind: 'volley',   cooldown: 1.7,  tempo: 18,  damage: 10, range: 22, speed: 26, count: 5, color: NEON.mag, desc: 'Spray 5 splinters in a cone.' },
  nova:     { id: 'nova',     name: 'Frost Nova',      kind: 'nova',     cooldown: 2.4,  tempo: -24, damage: 20, range: 6.5, color: NEON.ice,    desc: 'Slow + damage burst. Slams toward COLD.' },
  siphon:   { id: 'siphon',   name: 'Siphon Lash',     kind: 'siphon',   cooldown: 1.1,  tempo: -8,  damage: 15, range: 3.8, color: NEON.green,  desc: 'Melee lash that heals on hit.' },
  overload: { id: 'overload', name: 'Overload',        kind: 'overload', cooldown: 6.0,  tempo: 32,  damage: 0,  range: 0,  color: NEON.red,    desc: 'Surge tempo — bait a HOT crash.' },
};

export const CHARACTERS: CharacterDef[] = [
  { id: 'pyre',   name: 'Pyre',   title: 'Ember Blade',   hp: 100, speed: 8.6, color: NEON.amber,
    loadout: ['strike', 'bolt', 'arc', 'dash'], tempoGain: 1.5, unlock: '',
    blurb: 'Tempo gains +50%. Lives in the HOT zone and rides the crashes.' },
  { id: 'frost',  name: 'Frost',  title: 'Glacial Ward',  hp: 135, speed: 7.4, color: NEON.cyan,
    loadout: ['strike', 'nova', 'arc', 'dash'], dmgResist: 0.2, hurtTempo: -12, unlock: 'Finish a run',
    blurb: 'Takes 20% less damage; being hit pushes tempo toward COLD power.' },
  { id: 'shadow', name: 'Shadow', title: 'Phantom Edge',  hp: 80, speed: 9.6, color: NEON.mag,
    loadout: ['bolt', 'volley', 'dash', 'siphon'], dashIframe: 0.35, postDashCrit: true, unlock: 'Reach depth 3',
    blurb: 'Fragile glass cannon. Long dash i-frames; the hit after a dash crits.' },
];

const E = (kind: EnemyKind, def: Omit<EnemyDef, 'kind'>): EnemyDef => ({ kind, ...def });
export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  darter:   E('darter',   { name: 'Darter',   hp: 20,  speed: 9.7, radius: 0.7, damage: 9,  touch: 0.7, color: NEON.mag }),
  brute:    E('brute',    { name: 'Brute',    hp: 78,  speed: 4.7, radius: 1.2, damage: 22, touch: 1.0, color: NEON.red }),
  caster:   E('caster',   { name: 'Caster',   hp: 30,  speed: 5.6, radius: 0.8, damage: 11, touch: 0,   color: NEON.violet, ranged: true, fireRate: 1.25 }),
  splitter: E('splitter', { name: 'Splitter', hp: 46,  speed: 6.2, radius: 1.0, damage: 12, touch: 0.9, color: NEON.green, splits: 2 }),
  boss:     E('boss',     { name: 'The Conductor', hp: 620, speed: 3.8, radius: 2.5, damage: 24, touch: 1.1, color: NEON.cyan, ranged: true, fireRate: 0.95, scoreboard: true }),
};

export const RELICS: RelicDef[] = [
  { id: 'razor',      name: 'Razor Battery', icon: '⚡', desc: '+18% damage' },
  { id: 'iron',       name: 'Iron Pulse',    icon: '🛡️', desc: '+30 max HP (healed now)' },
  { id: 'metronome',  name: 'Metronome',     icon: '⏱️', desc: 'Tempo decays 50% slower' },
  { id: 'runaway',    name: 'Runaway Core',  icon: '🔥', desc: 'No tempo decay while HOT' },
  { id: 'grease',     name: 'Comet Grease',  icon: '💨', desc: '+20% move speed' },
  { id: 'siphon',     name: 'Siphon Coil',   icon: '🩸', desc: 'Kills heal 5 HP' },
  { id: 'overcharge', name: 'Overcharge',    icon: '💥', desc: 'Crashes deal +70% damage & radius' },
  { id: 'resonator',  name: 'Resonator',     icon: '🔮', desc: 'CRITICAL tempo pierces +2 targets' },
];
export const RELIC_BY_ID = new Map(RELICS.map((r) => [r.id, r]));

export const BIOMES: BiomeDef[] = [
  { id: 'voidline',  name: 'Voidline',  fog: 0x0b0420, ground: 0x1a1038, accent: NEON.mag },
  { id: 'verdant',   name: 'Verdant',   fog: 0x07140f, ground: 0x123026, accent: NEON.green },
  { id: 'cathedral', name: 'Cathedral', fog: 0x180a14, ground: 0x2a1020, accent: NEON.amber },
];

export const ARENA = 30; // half-extent of the square arena (units)
export const BOSS_DEPTH = 6; // depth at which the boss room appears (= win)
