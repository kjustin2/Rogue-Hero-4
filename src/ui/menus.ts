import type { Ctx } from "../game/ctx";
import { ACTION_LABELS, codeLabel, type Action } from "../core/input";
import { loadSettings, saveSettings, applySettings, type Settings } from "../core/settings";
import { WEAPONS } from "../game/weapons";
import type { BoonDef } from "../game/boons";

export interface TitleMeta {
  clears: number;
  unlockedStarts: string[];
  bestTime: number;
}

export interface RunStatsView {
  time: number;
  kills: number;
  dmgDealt: number;
  dmgTaken: number;
  combos: number;
  bestStreak: number;
  shards: number;
  bestTime: number;
}

/** Actions shown on the Controls screen (skip pause-rebinding to keep it simple). */
const REBINDABLE: Action[] = ["up", "down", "left", "right", "light", "heavy", "switch", "dash"];

/**
 * Full-screen DOM menus rendered into #overlay. The TITLE is deliberately just the
 * title + buttons (Descend / Controls / Settings) — controls and combos are taught
 * in-HUD, not dumped on the front door (see /game-flow menu rule). Settings + Controls
 * are ported (trimmed) from Rogue-Hero-3; main owns pointer-lock + state transitions.
 */
export class Menus {
  private overlay = document.getElementById("overlay")!;
  settings: Settings = loadSettings();
  private startWeapon: string = WEAPONS[0].id;
  private fs = false; // mirrored OS fullscreen state (Electron only)

  constructor(private ctx: Ctx) {
    const nat = window.rh3native;
    if (nat) {
      void nat.isFullscreen().then((v) => { this.fs = v; });
      nat.onFullscreenChange((v) => { this.fs = v; }); // stays true after F11 too
    }
  }

  /** Apply the current settings to the live systems + persist. Called at boot + on change. */
  apply(): void {
    applySettings(this.ctx, this.settings);
    saveSettings(this.settings);
  }

  clear(): void {
    this.overlay.innerHTML = "";
  }

  private panel(html: string): HTMLElement {
    this.overlay.innerHTML = `<div class="menu">${html}</div>`;
    this.overlay.querySelectorAll("button").forEach((b) => {
      b.addEventListener("mouseenter", () => this.ctx.events.emit("UI_HOVER", {}));
    });
    return this.overlay.querySelector(".menu")!;
  }

  private wire(id: string, fn: () => void): void {
    const el = this.overlay.querySelector("#" + id);
    el?.addEventListener("click", () => { this.ctx.events.emit("UI_CLICK", {}); fn(); });
  }

  showTitle(meta: TitleMeta, onStart: (startWeapon?: string) => void): void {
    // starting-weapon rack — the first-clear meta unlock
    const rack = meta.clears > 0 && meta.unlockedStarts.length > 1
      ? `<div class="start-rack"><span class="sr-lbl">BEGIN WITH</span>` + WEAPONS
          .filter((w) => meta.unlockedStarts.includes(w.id))
          .map((w) => `<button class="sr-btn${w.id === this.startWeapon ? " on" : ""}" data-w="${w.id}" style="--gc:#${w.color.toString(16).padStart(6, "0")}">${w.name}</button>`)
          .join("") + `</div>`
      : "";
    const laurels = meta.clears > 0
      ? `<div class="meta-line">${meta.clears} CLEAR${meta.clears > 1 ? "S" : ""} · BEST ${meta.bestTime.toFixed(0)}s</div>`
      : "";
    this.panel(`
      <div class="title">ROGUE HERO <b>IV</b></div>
      <div class="subtitle">RIFT CAUSEWAY</div>
      ${laurels}
      <div class="menu-buttons">
        <button id="start" class="primary">DESCEND</button>
        <button id="controls">CONTROLS</button>
        <button id="settings">SETTINGS</button>
      </div>
      ${rack}
    `);
    this.overlay.querySelectorAll<HTMLButtonElement>(".sr-btn").forEach((b) => b.addEventListener("click", () => {
      this.startWeapon = b.dataset.w!;
      this.ctx.events.emit("UI_CLICK", {});
      this.showTitle(meta, onStart);
    }));
    this.wire("start", () => onStart(this.startWeapon));
    this.wire("controls", () => this.showControls(() => this.showTitle(meta, onStart)));
    this.wire("settings", () => this.showSettings(() => this.showTitle(meta, onStart)));
  }

  /** The between-gate decision beat: claim one of three boons. */
  showBoons(boons: BoonDef[], onPick: (b: BoonDef) => void): void {
    const cards = boons.map((b, i) =>
      `<button class="boon" data-i="${i}"><span class="boon-name">${b.name}</span><span class="boon-desc">${b.desc}</span></button>`,
    ).join("");
    this.panel(`
      <div class="title small">THE WAY OPENS</div>
      <div class="subtitle">CLAIM A BOON</div>
      <div class="boon-cards">${cards}</div>
    `);
    this.overlay.querySelectorAll<HTMLButtonElement>(".boon").forEach((b) => b.addEventListener("click", () => {
      this.ctx.events.emit("UI_CLICK", {});
      onPick(boons[parseInt(b.dataset.i!, 10)]);
    }));
  }

  showPause(onResume: () => void, onQuit: () => void): void {
    this.panel(`
      <div class="title small">PAUSED</div>
      <div class="menu-buttons">
        <button id="resume" class="primary">RESUME</button>
        <button id="controls">CONTROLS</button>
        <button id="settings">SETTINGS</button>
        <button id="quit">ABANDON RUN</button>
      </div>
    `);
    this.wire("resume", onResume);
    this.wire("controls", () => this.showControls(() => this.showPause(onResume, onQuit)));
    this.wire("settings", () => this.showSettings(() => this.showPause(onResume, onQuit)));
    this.wire("quit", onQuit);
  }

  // ----------------------------------------------------------------- settings
  showSettings(back: () => void): void {
    const s = this.settings;
    const seg = (val: boolean, on: string, off: string, attr: string): string =>
      `<div class="seg"><button class="qbtn${val ? " on" : ""}" data-${attr}="1">${on}</button>` +
      `<button class="qbtn${!val ? " on" : ""}" data-${attr}="0">${off}</button></div>`;
    const qbtns = (["low", "medium", "high"] as const)
      .map((q) => `<button class="qbtn${s.quality === q ? " on" : ""}" data-q="${q}">${q.toUpperCase()}</button>`).join("");

    this.panel(`
      <div class="title small">SETTINGS</div>
      <div class="settings">
        <div class="set-row"><span>SFX VOLUME</span><input type="range" min="0" max="1" step="0.05" value="${s.sfx}" data-set="sfx"></div>
        <div class="set-row"><span>MUSIC VOLUME</span><input type="range" min="0" max="1" step="0.05" value="${s.music}" data-set="music"></div>
        <div class="set-row"><span>MOUSE SENSITIVITY</span><input type="range" min="0.3" max="2.5" step="0.05" value="${s.sensitivity}" data-set="sensitivity"></div>
        <div class="set-row"><span>SCREEN SHAKE</span><input type="range" min="0" max="1.5" step="0.1" value="${s.shake}" data-set="shake"></div>
        <div class="set-row"><span>FIELD OF VIEW</span><input type="range" min="68" max="100" step="1" value="${s.fov}" data-set="fov"></div>
        <div class="set-row"><span>REDUCE MOTION</span>${seg(s.reduceMotion, "ON", "OFF", "rm")}</div>
        <div class="set-row"><span>GRAPHICS QUALITY</span><div class="seg">${qbtns}</div></div>
        ${window.rh3native ? `<div class="set-row"><span>DISPLAY</span>${seg(this.fs, "FULLSCREEN", "WINDOWED", "fs")}</div>` : ""}
      </div>
      <div class="menu-buttons">
        <button id="rebind">REBIND CONTROLS</button>
        <button id="back" class="primary">BACK</button>
      </div>
    `);
    const root = this.overlay.querySelector(".menu")!;
    root.querySelectorAll<HTMLInputElement>("input[data-set]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const k = inp.dataset.set as keyof Settings;
        (s as unknown as Record<string, number>)[k] = parseFloat(inp.value);
        this.apply();
      });
    });
    root.querySelectorAll<HTMLButtonElement>("[data-q]").forEach((b) => b.addEventListener("click", () => {
      s.quality = b.dataset.q as Settings["quality"]; this.apply(); this.ctx.events.emit("UI_CLICK", {}); this.showSettings(back);
    }));
    root.querySelectorAll<HTMLButtonElement>("[data-rm]").forEach((b) => b.addEventListener("click", () => {
      s.reduceMotion = b.dataset.rm === "1"; this.apply(); this.ctx.events.emit("UI_CLICK", {}); this.showSettings(back);
    }));
    root.querySelectorAll<HTMLButtonElement>("[data-fs]").forEach((b) => b.addEventListener("click", () => {
      this.ctx.events.emit("UI_CLICK", {});
      void window.rh3native?.setFullscreen(b.dataset.fs === "1").then((v) => { this.fs = v; this.showSettings(back); });
    }));
    this.wire("rebind", () => this.showControls(() => this.showSettings(back)));
    this.wire("back", back);
  }

  // ----------------------------------------------------------------- controls (rebind)
  showControls(back: () => void): void {
    const rows = REBINDABLE.map((a) => {
      const code = this.ctx.input.bindings[a][0] ?? "";
      return `<div class="set-row"><span>${ACTION_LABELS[a]}</span><button class="keybtn" data-act="${a}">${codeLabel(code)}</button></div>`;
    }).join("");
    this.panel(`
      <div class="title small">CONTROLS</div>
      <div class="settings">
        ${rows}
        <div class="set-hint">Mouse aims · LMB light attack · RMB heavy attack · E swaps weapon. Click a key to rebind.</div>
      </div>
      <div class="menu-buttons">
        <button id="reset">RESET DEFAULTS</button>
        <button id="back" class="primary">BACK</button>
      </div>
    `);
    const root = this.overlay.querySelector(".menu")!;
    root.querySelectorAll<HTMLButtonElement>(".keybtn").forEach((b) => b.addEventListener("click", () => {
      const act = b.dataset.act as Action;
      b.textContent = "…press a key";
      b.classList.add("listening");
      this.ctx.input.captureNext(act, () => { this.ctx.events.emit("UI_CLICK", {}); this.showControls(back); });
    }));
    this.wire("reset", () => { this.ctx.input.resetBindings(); this.showControls(back); });
    this.wire("back", back);
  }

  private statGrid(s: RunStatsView): string {
    const rows: [string, string][] = [
      ["TIME", `${s.time.toFixed(0)}s`],
      ["SLAIN", String(s.kills)],
      ["DAMAGE DEALT", String(Math.round(s.dmgDealt))],
      ["DAMAGE TAKEN", String(Math.round(s.dmgTaken))],
      ["COMBOS", String(s.combos)],
      ["BEST STREAK", `${s.bestStreak}×`],
      ["SHARDS", String(s.shards)],
    ];
    return `<div class="stat-grid">` + rows.map(([k, v]) => `<div class="sg-row"><span>${k}</span><b>${v}</b></div>`).join("") + `</div>`;
  }

  showDead(stats: RunStatsView, onRetry: () => void, onQuit: () => void): void {
    this.panel(`
      <div class="title small lose">YOU FELL</div>
      ${this.statGrid(stats)}
      <div class="menu-buttons">
        <button id="retry" class="primary">TRY AGAIN</button>
        <button id="quit">TITLE</button>
      </div>
    `);
    this.wire("retry", onRetry);
    this.wire("quit", onQuit);
  }

  showVictory(stats: RunStatsView, onAgain: () => void): void {
    this.panel(`
      <div class="title small win">THE BARROW KING FALLS</div>
      ${this.statGrid(stats)}
      <div class="menu-buttons">
        <button id="again" class="primary">RUN AGAIN</button>
        <button id="totitle">TITLE</button>
      </div>
    `);
    this.wire("again", onAgain);
    this.wire("totitle", () => location.reload());
  }
}
