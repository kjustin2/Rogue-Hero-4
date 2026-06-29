import type { Ctx } from "../game/ctx";
import { COMBOS } from "../game/combos";

function cssHex(c: number): string {
  return "#" + c.toString(16).padStart(6, "0");
}

const CONTROLS = `
  <div class="legend">
    <div><b>WASD</b> Move</div><div><b>Mouse</b> Look</div>
    <div><b>LMB / J</b> Strike</div><div><b>RMB / K</b> Cleave</div>
    <div><b>E</b> Bolt</div><div><b>Shift / Space</b> Dodge</div>
  </div>`;

const COMBO_LIST = `<div class="combo-help">` + COMBOS.map((c) =>
  `<div><span style="color:${cssHex(c.color)}">${c.name}</span> — ${c.blurb}</div>`,
).join("") + `</div>`;

/**
 * Full-screen DOM menus rendered into #overlay. Each takes the callbacks main wires
 * to the state machine (main owns pointer-lock + state transitions; menus just
 * collect the click).
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
      <p class="blurb">Weave the three glyphs down the causeway. Chain them for devastating combos.
      Cut through the rift-born and bring down the Warden at the end.</p>
      ${CONTROLS}
      ${COMBO_LIST}
      <button id="start" class="primary">DESCEND</button>
      <div class="hint">Click to lock the mouse · Esc to pause</div>
    `);
    this.wire("start", onStart);
  }

  showPause(onResume: () => void, onQuit: () => void): void {
    this.panel(`
      <div class="title small">PAUSED</div>
      ${CONTROLS}
      ${COMBO_LIST}
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
