// Shared data shapes for the sim. Kept Three.js-free so the whole sim is
// headless-testable. The ground plane is XZ; +y is up (handled only in render).

export type CardKind = 'strike' | 'bolt' | 'arc' | 'dash' | 'volley' | 'nova' | 'siphon' | 'overload';

// SPELL WEAVING: every ability carries an arcane glyph. Casting pushes its glyph onto a 3-slot
// weave; when 3 are woven the pattern RESOLVES (3 same = Resonance, all different = Prismatic Rite,
// 2+1 = Surge). See sim/weave.ts.
export type Glyph = 'ember' | 'frost' | 'storm' | 'void';

export interface CardDef {
  id: string;
  name: string;
  kind: CardKind;
  cooldown: number;     // seconds
  glyph: Glyph;         // arcane glyph woven on cast
  damage: number;       // base damage per hit
  range: number;        // reach (melee cone / projectile life) or radius (arc/nova)
  speed?: number;       // projectile speed (bolt/volley)
  count?: number;       // projectiles (volley) or arc/cone width factor
  color: number;        // neon hex
  desc: string;
}

export interface CharacterDef {
  id: string;
  name: string;
  title: string;
  hp: number;
  speed: number;        // units/sec
  loadout: string[];    // 4 card ids
  color: number;
  blurb: string;
  // passives, read by the sim:
  weavePower?: number;      // multiplier on weave-burst damage/empower (Pyre, default 1)
  dmgResist?: number;       // 0..1 incoming damage reduction
  hurtWard?: number;        // seconds of defensive Ward granted when hit (Frost)
  dashIframe?: number;      // bonus i-frame seconds on dash (Shadow)
  postDashCrit?: boolean;   // next hit after dash crits (Shadow)
  unlock: string;           // human-readable unlock condition ('' = default)
}

export type EnemyKind = 'darter' | 'brute' | 'caster' | 'splitter' | 'boss';

export interface EnemyDef {
  kind: EnemyKind;
  name: string;
  hp: number;
  speed: number;
  radius: number;
  damage: number;       // contact / projectile damage
  touch: number;        // contact attack cooldown
  color: number;
  ranged?: boolean;     // keeps distance and fires bolts
  fireRate?: number;    // seconds between shots (ranged)
  splits?: number;      // spawns N darters on death (splitter)
  scoreboard?: boolean; // boss: show boss bar
}

export interface RelicDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
}

export interface BiomeDef {
  id: string;
  name: string;
  fog: number;          // fog color
  ground: number;       // grid/ground tint
  accent: number;       // neon accent
}

export type GameMode = 'title' | 'select' | 'playing' | 'draft' | 'gameover' | 'win' | 'cutscene';
