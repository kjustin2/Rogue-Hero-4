/**
 * Typed synchronous pub-sub. Event names and payloads are compile-checked —
 * a typo'd emit is a type error, not a silent no-op.
 *
 * Sim systems only `emit`; render / HUD / audio subscribe.
 */
export interface EventMap {
  /** An enemy/boss took damage. Drives hit sfx, sparks, floaters. */
  ENEMY_HIT: { x: number; y: number; z: number; dmg: number; heavy: boolean; killed: boolean };
  /** An enemy died. */
  KILL: { x: number; z: number; kind: string };
  /** Running kill streak count (resets when the player is idle/hit). */
  KILL_STREAK: { count: number };
  /** The player was hit. */
  PLAYER_HIT: { dmg: number; srcX: number; srcZ: number };
  PLAYER_DIED: Record<string, never>;
  /** Player dash with i-frames. */
  DODGE: Record<string, never>;
  HEAL: { amount: number };
  /** A named glyph-combo resolved (chained moves). `tier` 1..3 scales the fanfare. */
  COMBO_RESOLVE: { name: string; tier: number };
  /** Boss health changed — drives the boss bar. */
  BOSS_HP: { hp: number; maxHp: number };
  BOSS_INTRO: { name: string };
  BOSS_DEFEATED: { x: number; z: number };
  RUN_VICTORY: Record<string, never>;
  UI_HOVER: Record<string, never>;
  UI_CLICK: Record<string, never>;
}

type Handler<K extends keyof EventMap> = (payload: EventMap[K]) => void;

export class EventBus {
  private handlers = new Map<keyof EventMap, Set<Handler<keyof EventMap>>>();

  on<K extends keyof EventMap>(name: K, fn: Handler<K>): () => void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(fn as Handler<keyof EventMap>);
    return () => set.delete(fn as Handler<keyof EventMap>);
  }

  emit<K extends keyof EventMap>(name: K, payload: EventMap[K]): void {
    const set = this.handlers.get(name);
    if (!set) return;
    for (const fn of set) (fn as Handler<K>)(payload);
  }
}
