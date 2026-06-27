// Typed event bus. Every event name + payload is declared here, so a typo'd
// emit is a compile error. Render / audio / HUD subscribe; the sim only emits.
export type Zone = 'cold' | 'cool' | 'neutral' | 'warm' | 'hot' | 'critical';

export interface EventMap {
  'fx:hit': { x: number; z: number; color: number; power: number };
  'fx:cast': { x: number; z: number; color: number; kind: string };
  'fx:death': { x: number; z: number; color: number; big?: boolean };
  'fx:crash': { x: number; z: number; hot: boolean };
  'fx:telegraph': { x: number; z: number; radius: number; dur: number; color: number }; // attack warning marker
  'fx:pickup': { x: number; z: number; color: number };
  'fx:shake': { power: number };
  'sfx': { name: string; vol?: number };
  'damage': { x: number; z: number; amount: number; crit: boolean; heal?: boolean };
  'enemy:killed': { elite: boolean };
  'room:clear': {};
  'portal:open': {};
  'player:dead': {};
  'run:win': {};
  'tempo:crash': { hot: boolean };
}

type Handler<K extends keyof EventMap> = (p: EventMap[K]) => void;

export class Bus {
  private map = new Map<keyof EventMap, Set<Handler<any>>>();
  on<K extends keyof EventMap>(k: K, fn: Handler<K>): () => void {
    let set = this.map.get(k);
    if (!set) { set = new Set(); this.map.set(k, set); }
    set.add(fn);
    return () => set!.delete(fn);
  }
  emit<K extends keyof EventMap>(k: K, p: EventMap[K]): void {
    const set = this.map.get(k);
    if (set) for (const fn of set) fn(p);
  }
}
