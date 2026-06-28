export type Glyph = "ember" | "frost" | "storm" | "void";
export type CardKind = "strike" | "bolt" | "arc" | "dash" | "volley" | "nova" | "siphon" | "overload";
export type EnemyKind = "darter" | "brute" | "caster" | "splitter" | "boss";

export interface CardDef {
  id: CardKind; name: string; kind: CardKind; cooldown: number; glyph: Glyph;
  damage: number; range: number; speed?: number; count?: number; color: number;
}
export interface CharDef {
  id: string; name: string; title: string; hp: number; speed: number; color: number;
  loadout: CardKind[];
  weavePower?: number; dmgResist?: number; hurtWard?: number; dashIframe?: number;
  postDashCrit?: boolean; unlock?: string;
}
export interface EnemyDef {
  kind: EnemyKind; name: string; hp: number; speed: number; radius: number;
  damage: number; touch: number; color: number;
  ranged?: boolean; fireRate?: number; splits?: number; scoreboard?: boolean;
}
export interface RelicDef { id: string; name: string; icon: string; desc: string; }
export interface BiomeDef { name: string; fog: number; ground: number; accent: number; }

export interface CardState { def: CardDef; cd: number; }

export interface Player {
  x: number; z: number; angle: number;
  hp: number; maxHp: number; speed: number; radius: number;
  char: CharDef; cards: CardState[];
  weave: Glyph[]; empower: number; ward: number; iframe: number;
  combo: number; comboTimer: number; castMult: number;
  dashCritArmed: boolean; relics: Set<string>;
}
export interface Enemy {
  kind: EnemyKind; def: EnemyDef; x: number; z: number; angle: number;
  hp: number; maxHp: number; radius: number; elite: boolean; alive: boolean;
  cd: number; lungeCd: number; stun: number; slow: number; hitFlash: number;
  lunging: number; lungeDx: number; lungeDz: number;
  windup: number; markX: number; markZ: number;
  phase: number; patternCd: number; summonCd: number;
  dormant: boolean;
}
export interface Projectile {
  x: number; z: number; vx: number; vz: number; life: number; radius: number;
  damage: number; friendly: boolean; pierce: number; color: number; hits: Set<Enemy>;
}
export interface Pickup { x: number; z: number; heal: number; life: number; }
