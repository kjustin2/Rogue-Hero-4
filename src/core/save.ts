/**
 * Meta progression, persisted to localStorage (origin-keyed — the Electron shell's
 * fixed port 41730 is what keeps this alive across launches). Versioned; unknown
 * shapes are discarded rather than half-migrated.
 */
export interface SaveData {
  v: 1;
  clears: number;
  bestTime: number; // seconds, 0 = none
  totalKills: number;
  /** Weapon ids the player may START a run with (unlocked by clearing with them held). */
  unlockedStarts: string[];
}

const KEY = "rh4-save";

export function defaultSave(): SaveData {
  return { v: 1, clears: 0, bestTime: 0, totalKills: 0, unlockedStarts: [] };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as SaveData;
      if (d && d.v === 1) return { ...defaultSave(), ...d };
    }
  } catch { /* private mode / bad json */ }
  return defaultSave();
}

export function writeSave(s: SaveData): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

