/**
 * The shared context hub. Every system reaches its peers through `ctx`, and each
 * imports only this interface (type-only) — never its peers directly — so there are
 * no runtime import cycles. `main.ts` fills the Ctx during boot.
 */
import type { Stage } from "../render/stage";
import type { Models } from "../render/models";
import type { FpsCamera } from "../render/fpsCamera";
import type { Particles } from "../render/particles";
import type { SwordTrail } from "../render/trail";
import type { Telegraphs } from "../render/telegraphs";
import type { Floaters } from "../render/floaters";
import type { Input } from "../core/input";
import type { EventBus } from "../core/events";
import type { Rng } from "../core/rng";
import type { Sfx } from "../audio/sfx";
import type { Music } from "../audio/music";
import type { Level } from "./level";
import type { Player } from "./player";
import type { Combat } from "./combat";
import type { EnemyManager } from "./enemies";
import type { Projectiles } from "./projectiles";
import type { Pickups } from "./pickups";
import type { Boss } from "./boss";

export interface Ctx {
  stage: Stage;
  /** Preloaded GLB models (Meshy) — every get() is nullable; callers keep procedural fallbacks. */
  models: Models;
  cam: FpsCamera;
  input: Input;
  events: EventBus;
  rng: Rng;
  // feel layer
  fx: Particles;
  trail: SwordTrail;
  tele: Telegraphs;
  floaters: Floaters;
  // audio
  sfx: Sfx;
  music: Music;
  // game
  level: Level;
  player: Player;
  combat: Combat;
  enemies: EnemyManager;
  projectiles: Projectiles;
  pickups: Pickups;
  boss: Boss | null;
  /** True during active first-person gameplay (not menu/pause/dead/victory). */
  playing: boolean;
  /** Remaining hit-stop time (seconds). main scales the frame dt while > 0. */
  hitstop: number;
}
