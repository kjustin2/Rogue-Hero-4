import type { Zone } from '../bus';
import { NEON } from '../content';

// TEMPO — the signature resource. 0..100, neutral 50, always decaying toward 50.
// Cards shove it around; the zones change what your attacks do; hitting 0 or 100
// triggers a crash (an AoE burst) and resets to 50.
export const TEMPO_NEUTRAL = 50;

export function zoneOf(t: number): Zone {
  if (t >= 90) return 'critical';
  if (t >= 70) return 'hot';
  if (t <= 12) return 'cold';
  if (t <= 30) return 'cool';
  if (t >= 58) return 'warm';
  return 'neutral';
}

// Outgoing damage multiplier: ramps from ×1.0 at 70 up to ×1.5 at 100 (HOT/CRITICAL).
export function dmgMult(t: number): number {
  return t >= 70 ? 1 + ((t - 70) / 30) * 0.5 : 1;
}

// Incoming damage multiplier: COLD zone is defensive (−25%).
export function incomingMult(t: number): number {
  return t <= 30 ? 0.75 : 1;
}

// Bonus pierce/chain targets when the tempo is CRITICAL.
export function critPierce(t: number): number {
  return t >= 90 ? 2 : 0;
}

export function zoneColor(z: Zone): number {
  switch (z) {
    case 'cold': return NEON.ice;
    case 'cool': return NEON.cyan;
    case 'warm': return NEON.amber;
    case 'hot': return NEON.red;
    case 'critical': return NEON.mag;
    default: return 0xbcd6e6;
  }
}

export function zoneLabel(z: Zone): string {
  return z.toUpperCase();
}
