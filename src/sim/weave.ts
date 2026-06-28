import type { Glyph } from "./types.js";

export const GLYPHS: Record<Glyph, { name: string; sym: string; color: number }> = {
  ember: { name: "Ember", sym: "▲", color: 0xff5a3c },
  frost: { name: "Frost", sym: "▼", color: 0xbfeaff },
  storm: { name: "Storm", sym: "◆", color: 0x36f9ff },
  void:  { name: "Void",  sym: "✶", color: 0x9d6bff },
};

export type ResolveKind = "resonance" | "prismatic" | "surge";

// Classify the 3-glyph weave: 1 unique = Resonance, 3 unique = Prismatic, else Surge (majority element).
export function classify(g: Glyph[]): { kind: ResolveKind; element: Glyph } {
  const uniq = new Set(g);
  if (uniq.size === 1) return { kind: "resonance", element: g[0] };
  if (uniq.size === 3) return { kind: "prismatic", element: g[0] };
  const counts: Partial<Record<Glyph, number>> = {};
  for (const x of g) counts[x] = (counts[x] ?? 0) + 1;
  let major: Glyph = g[0];
  for (const x of g) if ((counts[x] ?? 0) > (counts[major] ?? 0)) major = x;
  return { kind: "surge", element: major };
}

// Player-facing forecast hint for the current partial weave (informed decision).
export function forecast(w: Glyph[]): string {
  if (w.length === 0) return "weave 3 glyphs";
  if (w.length === 1) return "same×3 = Resonance · all 3 = Prismatic";
  if (w.length === 2) return w[0] === w[1] ? "match → RESONANCE" : "differ → PRISMATIC · match → SURGE";
  const { kind, element } = classify(w);
  if (kind === "prismatic") return "PRISMATIC RITE";
  return `${GLYPHS[element].name.toUpperCase()} ${kind === "resonance" ? "RESONANCE" : "SURGE"}`;
}
