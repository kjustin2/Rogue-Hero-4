import type { Glyph } from '../types';
import { NEON } from '../content';

// SPELL WEAVING — the signature mechanic (replaces TEMPO). Every ability carries an arcane glyph.
// Casting pushes its glyph onto a 3-slot weave; the moment 3 are woven, the pattern RESOLVES into
// a burst and resets:
//   • 3 of the same glyph  → RESONANCE  (themed nova + EMPOWER your next casts; Frost also Wards you)
//   • all 3 different       → PRISMATIC RITE (the biggest finisher — huge nova + strong empower)
//   • 2 + 1                 → SURGE      (a medium burst of the majority glyph)
// The whole game is sequencing your 4 abilities to bait the weave you want. Legible (you see the
// 3 slots + the rule), informed (you know what each glyph adds), and every 3rd cast pays off.

export interface GlyphMeta { name: string; sym: string; color: number; }
export const GLYPHS: Record<Glyph, GlyphMeta> = {
  ember: { name: 'Ember', sym: '▲', color: 0xff5a3c },
  frost: { name: 'Frost', sym: '▼', color: NEON.ice },
  storm: { name: 'Storm', sym: '◆', color: NEON.cyan },
  void:  { name: 'Void',  sym: '✶', color: NEON.violet },
};

export type WeaveKind = 'resonance' | 'surge' | 'prismatic';

// classify a completed 3-glyph weave into its outcome + the element it's themed to
export function classifyWeave(g: Glyph[]): { kind: WeaveKind; element: Glyph } {
  const uniq = new Set(g);
  if (uniq.size === 1) return { kind: 'resonance', element: g[0] };
  if (uniq.size === 3) return { kind: 'prismatic', element: g[0] };
  const counts: Partial<Record<Glyph, number>> = {};
  for (const x of g) counts[x] = (counts[x] ?? 0) + 1;
  const maj = (g.find((x) => counts[x] === 2) ?? g[0]);
  return { kind: 'surge', element: maj };
}

export function weaveColor(kind: WeaveKind, element: Glyph): number {
  return kind === 'prismatic' ? NEON.mag : GLYPHS[element].color;
}

export function weaveLabel(kind: WeaveKind, element: Glyph): string {
  if (kind === 'prismatic') return 'PRISMATIC RITE';
  if (kind === 'resonance') return GLYPHS[element].name.toUpperCase() + ' RESONANCE';
  return GLYPHS[element].name.toUpperCase() + ' SURGE';
}

// What a given set of slots is on track to become (the INFORMED hint shown in the HUD).
export function weaveForecast(g: Glyph[]): string {
  if (g.length === 0) return 'weave 3 glyphs';
  if (g.length >= 3) return weaveLabel(...Object.values(classifyWeave(g.slice(0, 3))) as [WeaveKind, Glyph]);
  const uniq = new Set(g);
  if (g.length === 2) {
    if (uniq.size === 1) return 'match → RESONANCE';
    return 'differ → PRISMATIC · match → SURGE';
  }
  return 'same×3 = Resonance · all 3 = Prismatic';
}
