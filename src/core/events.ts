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
  KILL: { x: number; z: number; kind: string; elite?: boolean };
  /** Running kill streak count (resets when the player is idle/hit). */
  KILL_STREAK: { count: number };
  /** The player was hit. */
  PLAYER_HIT: { dmg: number; srcX: number; srcZ: number; srcY: number };
  PLAYER_DIED: Record<string, never>;
  /** Player dash with i-frames. */
  DODGE: Record<string, never>;
  HEAL: { amount: number };
  /** A named weapon combo resolved (chained light/heavy). `tier` 1..3 scales the fanfare. */
  COMBO_RESOLVE: { name: string; tier: number };
  /** Combo-momentum meter 0..1 (1 = next heavy is free + empowered). */
  FERVOR: { value: number };
  /** A rift shard was collected — drives the HUD shard counter. `total` is the running count. */
  SHARD: { total: number };
  /** A new weapon unlocked at a shard threshold. */
  WEAPON_UNLOCK: { id: string; name: string };
  /** Claimed a weapon while carrying the max — main opens the swap choice. */
  WEAPON_OFFER: { id: string };
  /** The player switched the equipped weapon. */
  WEAPON_SWITCH: { id: string; name: string };
  /** Boss health changed — drives the boss bar. */
  BOSS_HP: { hp: number; maxHp: number };
  BOSS_INTRO: { name: string };
  /** Boss crossed a phase threshold — main plays a short transition cutscene. */
  BOSS_PHASE: { phase: number };
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
