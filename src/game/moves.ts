/**
 * The limited moveset — three "glyphs" the player weaves. Pure data; the player
 * controller reads timings, combat reads damage/arc. Chaining glyphs resolves into
 * named combos (see combos.ts) — that's the whole game's identity.
 */
export type GlyphId = "strike" | "cleave" | "bolt";

export interface MoveDef {
  id: GlyphId;
  name: string;
  key: string; // HUD hint
  kind: "melee" | "ranged";
  /** Emissive theme color (blade tint, bolt color, HUD sigil). */
  color: number;
  damage: number;
  /** Melee swing half-arc + reach. Unused for ranged. */
  arc: number;
  range: number;
  knockback: number;
  /** Viewmodel/animation timing (seconds). The hit lands at `windup`. */
  windup: number;
  active: number;
  recovery: number;
  /** Per-glyph cooldown before it can be cast again. */
  cooldown: number;
}

export const MOVES: Record<GlyphId, MoveDef> = {
  strike: {
    id: "strike", name: "STRIKE", key: "LMB", kind: "melee", color: 0x46e0ff,
    damage: 9, arc: 1.75, range: 3.0, knockback: 3,
    windup: 0.06, active: 0.16, recovery: 0.1, cooldown: 0.28,
  },
  cleave: {
    id: "cleave", name: "CLEAVE", key: "RMB", kind: "melee", color: 0xff7a3c,
    damage: 20, arc: 2.8, range: 3.5, knockback: 9,
    windup: 0.16, active: 0.22, recovery: 0.22, cooldown: 0.7,
  },
  bolt: {
    id: "bolt", name: "BOLT", key: "E", kind: "ranged", color: 0xc28bff,
    damage: 12, arc: 0, range: 0, knockback: 2,
    windup: 0.08, active: 0.06, recovery: 0.16, cooldown: 0.5,
  },
};

export const GLYPH_ORDER: GlyphId[] = ["strike", "cleave", "bolt"];

export function moveDuration(m: MoveDef): number {
  return m.windup + m.active + m.recovery;
}
