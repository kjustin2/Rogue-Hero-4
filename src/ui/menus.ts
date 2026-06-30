import type { Ctx } from "../game/ctx";

/** A single compact controls line — not a wall of text (see /game-flow menu rule). */
const CONTROLS = `<div class="legend-line"><b>WASD</b> Move · <b>Mouse</b> Look · <b>LMB/RMB</b> Attack · <b>E</b> Swap Weapon · <b>Shift</b> Dodge</div>`;

/**
 * Full-screen DOM menus rendered into #overlay. Each takes the callbacks main wires
 * to the state machine (main owns pointer-lock + state transitions; menus just
 * collect the click). The TITLE is deliberately just title + button — controls and
 * combos are taught in-HUD and on the pause screen, not dumped on the front door.
 */
export class Menus {
  private overlay = document.getElementById("overlay")!;

  constructor(private ctx: Ctx) {}

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
      <button id="start" class="primary">DESCEND</button>
      <div class="hint">Click to lock the mouse</div>
    `);
    this.wire("start", onStart);
  }

  showPause(onResume: () => void, onQuit: () => void): void {
    this.panel(`
      <div class="title small">PAUSED</div>
      ${CONTROLS}
      <button id="resume" class="primary">RESUME</button>
      <button id="quit">ABANDON RUN</button>
    `);
    this.wire("resume", onResume);
    this.wire("quit", onQuit);
  }

  showDead(stats: { time: number; kills: number }, onRetry: () => void, onQuit: () => void): void {
    this.panel(`
      <div class="title small lose">YOU FELL</div>
      <div class="stats">Survived ${stats.time.toFixed(0)}s · ${stats.kills} slain</div>
      <button id="retry" class="primary">TRY AGAIN</button>
      <button id="quit">TITLE</button>
    `);
    this.wire("retry", onRetry);
    this.wire("quit", onQuit);
  }

  showVictory(stats: { time: number; kills: number }, onAgain: () => void): void {
    this.panel(`
      <div class="title small win">THE WARDEN FALLS</div>
      <div class="stats">Cleared in ${stats.time.toFixed(0)}s · ${stats.kills} slain</div>
      <button id="again" class="primary">RUN AGAIN</button>
    `);
    this.wire("again", onAgain);
  }
}
