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
  padSensitivity: number; // gamepad-look multiplier (right stick)
  shake: number;      // 0..1.5 screen-shake scale
  reduceMotion: boolean;
  quality: Quality;
  fov: number;        // base field of view
  renderScale: number; // render-target resolution multiplier (0.5..1.5)
}

const KEY = "rh4-settings";
const BASE_SENS = 0.0022;

export const DEFAULT_SETTINGS: Settings = {
  sfx: 0.7, music: 0.55, sensitivity: 1, padSensitivity: 1, shake: 1, reduceMotion: false, quality: "high", fov: 80,
  renderScale: 1,
};

/**
 * First boot only: default the quality tier off the actual GPU. A software
 * rasterizer (SwiftShader/llvmpipe) or an integrated Intel part gets a lower
 * default instead of choking on "high"; a saved setting always wins.
 */
function detectQuality(): Quality {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return "low";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const r = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
    gl.getExtension("WEBGL_lose_context")?.loseContext(); // free the probe context
    if (/swiftshader|llvmpipe|software/.test(r)) return "low";
    if (/intel.*\b(hd|uhd|iris)\b/.test(r)) return "medium";
    return "high";
  } catch { return "high"; }
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch { /* private mode / bad json */ }
  return { ...DEFAULT_SETTINGS, quality: detectQuality() };
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

/** Push the settings into the live systems (audio, camera, renderer). */
export function applySettings(ctx: Ctx, s: Settings): void {
  ctx.sfx.setVolume(s.sfx);
  ctx.music.setVolume(s.music);
  ctx.cam.sensitivity = BASE_SENS * s.sensitivity;
  ctx.cam.padSensitivity = s.padSensitivity;
  ctx.cam.shakeScale = s.reduceMotion ? 0 : s.shake;
  ctx.cam.setBaseFov(s.fov);
  ctx.stage.applyQuality(s.quality);
  ctx.stage.setRenderScale(s.renderScale);
  document.body.classList.toggle("rh-no-anim", s.reduceMotion || s.quality === "low");
}
