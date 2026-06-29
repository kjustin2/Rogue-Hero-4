import type { Ctx } from "../game/ctx";
import { MOVES, GLYPH_ORDER, type GlyphId } from "../game/moves";
import { COMBOS, matchCombo } from "../game/combos";
import { BOSS_ANCHOR } from "../game/level";

function cssHex(c: number): string {
  return "#" + c.toString(16).padStart(6, "0");
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
  private objText!: HTMLElement;
  private objFill!: HTMLElement;
  private streak!: HTMLElement;

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
    ctx.events.on("COMBO_RESOLVE", (e) => this.showBanner(e.name, COMBOS.find((c) => c.name === e.name)?.color ?? 0xffffff));
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
      `<div class="cb"><span class="cb-name" style="color:${cssHex(c.color)}">${c.name}</span><span class="cb-rec">${c.blurb}</span></div>`,
    ).join("");

    this.hud.innerHTML = `
      <div id="danger"></div>
      <div id="dmgflash"></div>
      <div id="crosshair"><span></span><span></span><span></span><span></span></div>

      <div id="boss-bar"><div class="boss-name">RIFT WARDEN</div><div class="boss-track"><div class="boss-fill"></div></div></div>

      <div id="objective"><div class="obj-text"></div><div class="obj-track"><div class="obj-fill"></div></div></div>

      <div id="streak"></div>

      <div id="combo-codex"><div class="cb-head">COMBOS</div>${codex}</div>

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
    this.objText = this.hud.querySelector(".obj-text")!;
    this.objFill = this.hud.querySelector(".obj-fill")!;
    this.streak = this.hud.querySelector("#streak")!;
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
    this.banner.textContent = text;
    this.banner.style.color = cssHex(color);
    this.banner.style.opacity = "1";
    this.banner.style.transform = "translateX(-50%) scale(1.15)";
    this.bannerT = 1.4;
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
    this.hpFill.style.background = frac > 0.3 ? "linear-gradient(90deg,#2bd4ff,#8affd0)" : "linear-gradient(90deg,#ff4252,#ff8a3d)";
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

    // boss bar
    const boss = this.ctx.boss;
    if (boss) {
      this.bossWrap.style.opacity = "1";
      this.bossFill.style.width = (Math.max(0, boss.hp / boss.maxHp) * 100).toFixed(1) + "%";
    } else {
      this.bossWrap.style.opacity = "0";
    }

    // objective / distance
    if (boss && boss.alive) {
      this.objText.textContent = "DEFEAT THE RIFT WARDEN";
      this.objFill.style.width = "100%";
    } else {
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
