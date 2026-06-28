import type { EnemyKind, RelicDef } from "./types.js";
import type { ResolveKind } from "./weave.js";

// Typed event bus: the sim only EMITS; render/HUD/audio subscribe. A typo'd emit
// or a bad payload is a compile error.
export interface EventMap {
  "fx:cast":     { x: number; z: number; color: number };
  "fx:hit":      { x: number; z: number; color: number; crit: boolean };
  "fx:death":    { x: number; z: number; color: number; big: boolean };
  "fx:slash":    { x: number; z: number; angle: number; color: number };
  "fx:shock":    { x: number; z: number; radius: number; color: number };
  "fx:crash":    { x: number; z: number; color: number; hot: boolean };
  "fx:shake":    { power: number };
  "fx:dash":     { x: number; z: number; tx: number; tz: number; color: number };
  "weave:resolve": { kind: ResolveKind; hot: boolean; x: number; z: number; color: number };
  "damage":      { x: number; z: number; amount: number; crit: boolean; heal: boolean };
  "enemy:killed": { kind: EnemyKind; x: number; z: number };
  "player:hurt": { amount: number };
  "room:clear":  Record<string, never>;
  "draft:open":  { choices: RelicDef[] };
  "run:win":     Record<string, never>;
  "run:lose":    Record<string, never>;
  "sfx":         { id: string };
}
type Handler<K extends keyof EventMap> = (p: EventMap[K]) => void;

export class Bus {
  private map = new Map<keyof EventMap, Set<Function>>();
  on<K extends keyof EventMap>(k: K, h: Handler<K>): () => void {
    let s = this.map.get(k);
    if (!s) { s = new Set(); this.map.set(k, s); }
    s.add(h);
    return () => s!.delete(h);
  }
  emit<K extends keyof EventMap>(k: K, p: EventMap[K]): void {
    const s = this.map.get(k);
    if (s) for (const h of s) (h as Handler<K>)(p);
  }
}
