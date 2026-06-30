import type { Ctx } from "../game/ctx";
import type { Quality } from "../render/stage";

/**
 * Player settings — audio, look sensitivity, screen-feel, and graphics quality.
 * Loaded from localStorage at boot, applied through the live systems, and re-saved
 * on every change. Ported (trimmed) from the Rogue-Hero-3 settings model.
 */
export interface Settings {
  sfx: number;        // 0..1
  music: number;      // 0..1
  sensitivity: number; // mouse-look multiplier (×0.0022 base)
  shake: number;      // 0..1.5 screen-shake scale
  reduceMotion: boolean;
  quality: Quality;
  fov: number;        // base field of view
}

const KEY = "rh4-settings";
const BASE_SENS = 0.0022;

export const DEFAULT_SETTINGS: Settings = {
  sfx: 0.7, music: 0.55, sensitivity: 1, shake: 1, reduceMotion: false, quality: "high", fov: 80,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch { /* private mode / bad json */ }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

/** Push the settings into the live systems (audio, camera, renderer). */
export function applySettings(ctx: Ctx, s: Settings): void {
  ctx.sfx.setVolume(s.sfx);
  ctx.music.setVolume(s.music);
  ctx.cam.sensitivity = BASE_SENS * s.sensitivity;
  ctx.cam.shakeScale = s.reduceMotion ? 0 : s.shake;
  ctx.cam.setBaseFov(s.fov);
  ctx.stage.applyQuality(s.quality);
  document.body.classList.toggle("rh-no-anim", s.reduceMotion || s.quality === "low");
}
