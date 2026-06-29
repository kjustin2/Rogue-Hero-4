/**
 * Combo system — chaining glyphs (moves.ts) within a time window resolves named
 * combos with a big damage multiplier and a signature effect. Pure logic: the
 * matcher is suffix-based and has no engine deps, so it's unit-checkable
 * (comboSelfCheck) and deterministic.
 */
import type { GlyphId } from "./moves";

export type ComboEffect = "slam" | "lance" | "quake" | "nova";

export interface ComboDef {
  name: string;
  /** Glyph sequence, matched as a suffix of the recent cast buffer. */
  recipe: GlyphId[];
  /** 1..3 — scales the on-resolve fanfare (flash/shake/sfx). */
  tier: number;
  /** Multiplier applied to the resolving move's hit damage. */
  damageMult: number;
  effect: ComboEffect;
  /** AoE radius the effect clears around the impact. */
  radius: number;
  color: number;
  /** Human-readable recipe for the codex/HUD. */
  blurb: string;
}

export const COMBOS: ComboDef[] = [
  {
    name: "CRESCENDO", recipe: ["strike", "strike", "cleave"], tier: 2,
    damageMult: 2.6, effect: "slam", radius: 4.5, color: 0xff7a3c,
    blurb: "Strike · Strike · Cleave",
  },
  {
    name: "ARC LANCE", recipe: ["bolt", "bolt", "strike"], tier: 2,
    damageMult: 2.2, effect: "lance", radius: 2.2, color: 0x46e0ff,
    blurb: "Bolt · Bolt · Strike",
  },
  {
    name: "QUAKE", recipe: ["cleave", "cleave"], tier: 1,
    damageMult: 2.0, effect: "quake", radius: 6.0, color: 0xffd24a,
    blurb: "Cleave · Cleave",
  },
  {
    name: "VOID NOVA", recipe: ["strike", "cleave", "bolt"], tier: 3,
    damageMult: 3.2, effect: "nova", radius: 7.5, color: 0xc28bff,
    blurb: "Strike · Cleave · Bolt",
  },
];

// Longest recipe first so a 3-chain wins over a contained 2-chain.
const BY_LEN = [...COMBOS].sort((a, b) => b.recipe.length - a.recipe.length);

/** The longest combo whose recipe is a suffix of `recent`, or null. */
export function matchCombo(recent: readonly GlyphId[]): ComboDef | null {
  for (const c of BY_LEN) {
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
 * Runnable self-check (ponytail: the one check the combo logic leaves behind).
 * Returns a list of failures — empty means healthy. Wired into the smoke via
 * window.__rh4.checkCombos().
 */
export function comboSelfCheck(): string[] {
  const fail: string[] = [];
  const eq = (a: ComboDef | null, name: string | null) => (a?.name ?? null) === name;

  // Each recipe resolves to itself.
  for (const c of COMBOS) {
    if (!eq(matchCombo(c.recipe), c.name)) fail.push(`recipe ${c.name} did not self-match`);
  }
  // Suffix match: a longer buffer ending in a recipe still resolves.
  if (!eq(matchCombo(["bolt", "strike", "strike", "cleave"]), "CRESCENDO")) {
    fail.push("suffix match failed for CRESCENDO");
  }
  // 3-chain beats a contained 2-chain: ...strike,cleave,bolt is VOID NOVA, not QUAKE.
  if (!eq(matchCombo(["strike", "cleave", "bolt"]), "VOID NOVA")) {
    fail.push("VOID NOVA should beat shorter combos");
  }
  // Non-matching tail resolves to nothing.
  if (!eq(matchCombo(["bolt", "cleave"]), null)) fail.push("unexpected match for bolt,cleave");
  return fail;
}
