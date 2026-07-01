import type { Ctx } from "../game/ctx";
import { ACTION_LABELS, codeLabel, type Action } from "../core/input";
import { loadSettings, saveSettings, applySettings, type Settings } from "../core/settings";

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

  constructor(private ctx: Ctx) {}

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

  showTitle(onStart: () => void): void {
    this.panel(`
      <div class="title">ROGUE HERO <b>IV</b></div>
      <div class="subtitle">RIFT CAUSEWAY</div>
      <div class="menu-buttons">
        <button id="start" class="primary">DESCEND</button>
        <button id="controls">CONTROLS</button>
        <button id="settings">SETTINGS</button>
      </div>
    `);
    this.wire("start", onStart);
    this.wire("controls", () => this.showControls(() => this.showTitle(onStart)));
    this.wire("settings", () => this.showSettings(() => this.showTitle(onStart)));
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

  showDead(stats: { time: number; kills: number }, onRetry: () => void, onQuit: () => void): void {
    this.panel(`
      <div class="title small lose">YOU FELL</div>
      <div class="stats">Survived ${stats.time.toFixed(0)}s · ${stats.kills} slain</div>
      <div class="menu-buttons">
        <button id="retry" class="primary">TRY AGAIN</button>
        <button id="quit">TITLE</button>
      </div>
    `);
    this.wire("retry", onRetry);
    this.wire("quit", onQuit);
  }

  showVictory(stats: { time: number; kills: number }, onAgain: () => void): void {
    this.panel(`
      <div class="title small win">THE BARROW KING FALLS</div>
      <div class="stats">Cleared in ${stats.time.toFixed(0)}s · ${stats.kills} slain</div>
      <div class="menu-buttons">
        <button id="again" class="primary">RUN AGAIN</button>
      </div>
    `);
    this.wire("again", onAgain);
  }
}
