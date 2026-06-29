import type { Ctx } from "../game/ctx";
import { MOVES, GLYPH_ORDER, type GlyphId } from "../game/moves";
import { COMBOS, matchCombo } from "../game/combos";
import { BOSS_ANCHOR } from "../game/level";

function cssHex(c: number): string {
  return "#" + c.toString(16).padStart(6, "0");
}

/** Recipe as colored input-key chips (e.g. [LMB][LMB][RMB]) — "how to execute" at a glance. */
function recipeChips(gl: readonly GlyphId[]): string {
  return gl.map((g) => `<i class="rc" style="--gc:${cssHex(MOVES[g].color)}">${MOVES[g].key}</i>`).join("");
}

/**
 * The in-world HUD: crosshair, health, the three glyph cooldowns, the live combo
 * chain + a static combo codex (so chains read as "clear"), the boss bar, and the
 * objective/distance readout. Built once, then refreshed by direct ref updates.
 */
export class Hud {
  private hud = document.getElementById("hud")!;
  private hpFill!: HTMLElement;
  private hpText!: HTMLElement;
  private slot: Record<GlyphId, { ready: HTMLElement; cd: HTMLElement }> = {} as never;
  private chain!: HTMLElement;
  private banner!: HTMLElement;
  private bossWrap!: HTMLElement;
  private bossFill!: HTMLElement;
  private objWrap!: HTMLElement;
  private objText!: HTMLElement;
  private objFill!: HTMLElement;
  private streak!: HTMLElement;
  private lockHint!: HTMLElement;
  private comboFlash!: HTMLElement;
  private comboSplash!: HTMLElement;
  private comboName!: HTMLElement;
  private comboRow!: HTMLElement;

  private bannerT = 0;
  private streakCount = 0;
  private streakT = 0;
  private dmgFlash!: HTMLElement;
  private danger!: HTMLElement;
  private crosshair!: HTMLElement;
  private dmgT = 0;
  private t = 0;

  constructor(private ctx: Ctx) {
    this.build();
    ctx.events.on("COMBO_RESOLVE", (e) => {
      const def = COMBOS.find((c) => c.name === e.name);
      this.showComboSplash(e.name, def?.color ?? 0xffffff, def?.recipe ?? []);
    });
    ctx.events.on("KILL_STREAK", (e) => { this.streakCount = e.count; this.streakT = 2; });
    ctx.events.on("PLAYER_HIT", () => { this.streakCount = 0; this.dmgT = 0.4; });
  }

  private build(): void {
    const glyphCells = GLYPH_ORDER.map((g) => {
      const m = MOVES[g];
      return `<div class="glyph" data-g="${g}" style="--gc:${cssHex(m.color)}">
        <div class="glyph-cd"></div>
        <div class="glyph-key">${m.key}</div>
        <div class="glyph-name">${m.name}</div>
      </div>`;
    }).join("");

    const codex = COMBOS.map((c) =>
      `<div class="cb"><span class="cb-name" style="color:${cssHex(c.color)}">${c.name}</span><span class="cb-rec">${recipeChips(c.recipe)}</span></div>`,
    ).join("");

    this.hud.innerHTML = `
      <div id="danger"></div>
      <div id="dmgflash"></div>
      <div id="combo-flash"></div>
      <div id="crosshair"><span></span><span></span><span></span><span></span></div>

      <div id="boss-bar"><div class="boss-name">RIFT WARDEN</div><div class="boss-track"><div class="boss-fill"></div></div></div>

      <div id="objective"><div class="obj-text"></div><div class="obj-track"><div class="obj-fill"></div></div></div>

      <div id="streak"></div>

      <div id="combo-codex"><div class="cb-head">COMBOS</div>${codex}</div>

      <div id="combo-splash"><div class="cs-name"></div><div class="cs-row"></div></div>
      <div id="lockhint">CLICK TO AIM</div>

      <div id="banner"></div>

      <div id="bottom">
        <div id="chain"></div>
        <div id="glyphs">${glyphCells}</div>
      </div>

      <div id="health"><div class="hp-track"><div class="hp-fill"></div></div><div class="hp-text"></div></div>
    `;

    this.hpFill = this.hud.querySelector(".hp-fill")!;
    this.hpText = this.hud.querySelector(".hp-text")!;
    this.chain = this.hud.querySelector("#chain")!;
    this.banner = this.hud.querySelector("#banner")!;
    this.bossWrap = this.hud.querySelector("#boss-bar")!;
    this.bossFill = this.hud.querySelector(".boss-fill")!;
    this.objWrap = this.hud.querySelector("#objective")!;
    this.objText = this.hud.querySelector(".obj-text")!;
    this.objFill = this.hud.querySelector(".obj-fill")!;
    this.streak = this.hud.querySelector("#streak")!;
    this.lockHint = this.hud.querySelector("#lockhint")!;
    this.comboFlash = this.hud.querySelector("#combo-flash")!;
    this.comboSplash = this.hud.querySelector("#combo-splash")!;
    this.comboName = this.hud.querySelector("#combo-splash .cs-name")!;
    this.comboRow = this.hud.querySelector("#combo-splash .cs-row")!;
    this.dmgFlash = this.hud.querySelector("#dmgflash")!;
    this.danger = this.hud.querySelector("#danger")!;
    this.crosshair = this.hud.querySelector("#crosshair")!;
    for (const g of GLYPH_ORDER) {
      const cell = this.hud.querySelector(`.glyph[data-g="${g}"]`)!;
      this.slot[g] = { ready: cell as HTMLElement, cd: cell.querySelector(".glyph-cd") as HTMLElement };
    }
  }

  setVisible(on: boolean): void {
    this.hud.style.display = on ? "block" : "none";
  }

  showBanner(text: string, color: number): void {
    // a state banner (wave/gate/boss) clears any combo splash so the two never stack
    this.comboSplash.style.animation = "none";
    this.comboFlash.style.animation = "none";
    this.comboSplash.style.opacity = "0";
    this.banner.textContent = text;
    this.banner.style.color = cssHex(color);
    this.banner.style.opacity = "1";
    this.banner.style.transform = "translateX(-50%) scale(1.15)";
    this.bannerT = 1.4;
  }

  /** Big centered combo payoff: name + recipe chips + a color flash that snaps in. */
  showComboSplash(name: string, color: number, recipe: readonly GlyphId[]): void {
    // a combo splash clears any state banner so the two never overlap
    this.banner.style.opacity = "0";
    this.bannerT = 0;
    const hex = cssHex(color);
    this.comboName.textContent = name;
    this.comboName.style.color = hex;
    this.comboRow.innerHTML = recipeChips(recipe);
    this.comboFlash.style.setProperty("--cc", hex);
    // restart the CSS animations (none → reflow → set) so each combo replays the pop
    this.comboSplash.style.animation = "none";
    this.comboFlash.style.animation = "none";
    void this.comboSplash.offsetWidth;
    this.comboSplash.style.animation = "combo-pop 1.5s cubic-bezier(.2,.9,.2,1)";
    this.comboFlash.style.animation = "combo-flash .6s ease-out";
  }

  update(dt: number): void {
    const p = this.ctx.player;
    this.t += dt;

    // health
    const frac = Math.max(0, p.hp / p.maxHp);

    // damage flash + low-HP danger vignette
    if (this.dmgT > 0) { this.dmgT -= dt; this.dmgFlash.style.opacity = Math.max(0, this.dmgT / 0.4).toFixed(2); }
    else this.dmgFlash.style.opacity = "0";
    if (frac < 0.35 && p.alive) {
      const sev = (0.35 - frac) / 0.35;
      this.danger.style.opacity = (sev * (0.55 + 0.45 * Math.sin(this.t * 6))).toFixed(2);
    } else {
      this.danger.style.opacity = "0";
    }
    this.hpFill.style.width = (frac * 100).toFixed(1) + "%";
    this.hpFill.style.background = frac > 0.3 ? "linear-gradient(90deg,#ffb24a,#ffe2a0)" : "linear-gradient(90deg,#ff4252,#ff8a3d)";
    this.hpText.textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;

    // glyph cooldowns
    for (const g of GLYPH_ORDER) {
      const cd = p.cooldowns[g];
      const max = MOVES[g].cooldown;
      this.slot[g].cd.style.height = (Math.max(0, cd / max) * 100).toFixed(0) + "%";
      this.slot[g].ready.classList.toggle("on-cd", cd > 0.01);
    }

    // combo chain pips + "armed" glow when the current buffer already forms a combo
    const buf = p.buffer;
    const armed = matchCombo(buf);
    this.chain.innerHTML = buf.map((g) => `<span class="pip" style="background:${cssHex(MOVES[g].color)}"></span>`).join("")
      + (armed ? `<span class="pip-armed" style="color:${cssHex(armed.color)}">▶ ${armed.name}</span>` : "");

    // crosshair turns gold when the aim ray is on the boss weak point
    this.crosshair.classList.toggle("weak", this.ctx.combat.isAimingWeak());

    // "CLICK TO AIM" prompt whenever we're playing but the mouse isn't captured
    this.lockHint.style.opacity = this.ctx.playing && !this.ctx.input.pointerLocked && p.alive ? "1" : "0";

    // boss bar
    const boss = this.ctx.boss;
    if (boss) {
      this.bossWrap.style.opacity = "1";
      this.bossFill.style.width = (Math.max(0, boss.hp / boss.maxHp) * 100).toFixed(1) + "%";
    } else {
      this.bossWrap.style.opacity = "0";
    }

    // objective / distance — only the distance-to-boss tracker on the causeway.
    // Hidden during the fight (the boss HP bar already labels the Warden) so the two
    // bars don't read as a confusing double health bar.
    if (boss && boss.alive) {
      this.objWrap.style.opacity = "0";
    } else {
      this.objWrap.style.opacity = "1";
      const total = BOSS_ANCHOR.z;
      const done = Math.min(1, Math.max(0, p.pos.z / total));
      const remaining = Math.max(0, Math.round(total - p.pos.z));
      this.objText.textContent = `RIFT WARDEN  ·  ${remaining}m`;
      this.objFill.style.width = (done * 100).toFixed(0) + "%";
    }

    // banner decay
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.banner.style.opacity = "0";
      else this.banner.style.transform = `translateX(-50%) scale(${(1 + this.bannerT * 0.12).toFixed(3)})`;
    }

    // kill streak
    if (this.streakT > 0) {
      this.streakT -= dt;
      this.streak.style.opacity = this.streakCount >= 3 ? "1" : "0";
      this.streak.textContent = this.streakCount >= 3 ? `${this.streakCount}× STREAK` : "";
    } else {
      this.streak.style.opacity = "0";
    }
  }
}
