import type { Ctx } from "../game/ctx";
import { WEAPONS, matchWeaponCombo, type Slot } from "../game/weapons";
import { BOSS_ANCHOR } from "../game/level";

function cssHex(c: number): string {
  return "#" + c.toString(16).padStart(6, "0");
}

/** Recipe as colored light/heavy chips (e.g. [L][L][H]) — "how to execute" at a glance. */
function recipeChips(recipe: readonly Slot[]): string {
  return recipe.map((s) => `<i class="rc rc-${s}">${s === "light" ? "L" : "H"}</i>`).join("");
}

/**
 * The in-world HUD: crosshair, health, the rift-shard counter, the equipped weapon
 * (name + its LMB/RMB attacks with cooldowns + the swap rack) and that weapon's
 * combo codex, the live combo chain, the boss bar, and the distance readout.
 */
export class Hud {
  private hud = document.getElementById("hud")!;
  private healthEl!: HTMLElement;
  private hpFill!: HTMLElement;
  private hpText!: HTMLElement;
  private shardN!: HTMLElement;
  private weaponEl!: HTMLElement;
  private codexList!: HTMLElement;
  private atkCd: Record<Slot, HTMLElement> = {} as never;
  private chain!: HTMLElement;
  private banner!: HTMLElement;
  private bossWrap!: HTMLElement;
  private bossFill!: HTMLElement;
  private objWrap!: HTMLElement;
  private objText!: HTMLElement;
  private objFill!: HTMLElement;
  private streak!: HTMLElement;
  private lockHint!: HTMLElement;
  private comboSplash!: HTMLElement;
  private comboName!: HTMLElement;
  private comboRow!: HTMLElement;

  private bannerT = 0;
  private streakCount = 0;
  private streakT = 0;
  private dmgFlash!: HTMLElement;
  private danger!: HTMLElement;
  private crosshair!: HTMLElement;
  private dashRing!: HTMLElement;
  private dmgDir!: HTMLElement;
  private fervorEl!: HTMLElement;
  private fervorFill!: HTMLElement;
  private fervorV = 0;
  private dmgDirT = 0;
  private dmgT = 0;
  private t = 0;
  private lastChain = "";

  constructor(private ctx: Ctx) {
    this.build();
    ctx.events.on("COMBO_RESOLVE", (e) => {
      const def = ctx.player.weapon.combos.find((c) => c.name === e.name);
      this.showComboSplash(e.name, def?.color ?? 0xffffff, def?.recipe ?? []);
    });
    ctx.events.on("KILL_STREAK", (e) => { this.streakCount = e.count; this.streakT = 2; });
    ctx.events.on("PLAYER_HIT", (e) => {
      this.streakCount = 0;
      this.dmgT = 0.4;
      // red edge arc pointing at the attacker (screen-relative: source yaw vs look yaw)
      const world = Math.atan2(e.srcX - ctx.player.pos.x, e.srcZ - ctx.player.pos.z);
      const rel = world - ctx.cam.yaw + Math.PI; // 0 = dead ahead
      this.dmgDir.style.transform = `translate(-50%,-50%) rotate(${rel.toFixed(3)}rad)`;
      this.dmgDirT = 0.55;
    });
    ctx.events.on("FERVOR", (e) => { this.fervorV = e.value; });
    ctx.events.on("SHARD", (e) => { this.shardN.textContent = String(e.total); });
    ctx.events.on("WEAPON_SWITCH", () => this.rebuildWeapon());
    ctx.events.on("WEAPON_UNLOCK", (e) => { this.rebuildWeapon(); this.showBanner("UNLOCKED · " + e.name, 0x9ff0e4); });
  }

  private build(): void {
    this.hud.innerHTML = `
      <div id="danger"></div>
      <div id="dmgflash"></div>
      <div id="dmgdir"></div>
      <div id="crosshair"><span></span><span></span><span></span><span></span></div>
      <div id="dashring"></div>

      <div id="boss-bar"><div class="boss-name">MORDREK · BARROW KING</div><div class="boss-track"><div class="boss-fill"></div></div></div>

      <div id="objective"><div class="obj-text"></div><div class="obj-track"><div class="obj-fill"></div></div></div>

      <div id="streak"></div>

      <div id="shards"><span class="sh-ico">◆</span><span class="sh-n">0</span><span class="sh-lbl">RIFT SHARDS</span></div>

      <div id="combo-codex"><div class="cb-head">COMBOS</div><div id="codex-list"></div></div>

      <div id="combo-splash"><div class="cs-name"></div><div class="cs-row"></div></div>
      <div id="lockhint">CLICK TO AIM</div>

      <div id="banner"></div>

      <div id="bottom">
        <div id="chain"></div>
        <div id="fervor"><div class="fv-fill"></div><span class="fv-lbl">FERVOR</span></div>
        <div id="weapon"></div>
      </div>

      <div id="health">
        <div class="hp-crest"><span>✚</span></div>
        <div class="hp-body">
          <div class="hp-label">VITALITY</div>
          <div class="hp-track"><div class="hp-fill"></div><div class="hp-notch"></div></div>
          <div class="hp-text"></div>
        </div>
      </div>
    `;

    this.healthEl = this.hud.querySelector("#health")!;
    this.hpFill = this.hud.querySelector(".hp-fill")!;
    this.hpText = this.hud.querySelector(".hp-text")!;
    this.shardN = this.hud.querySelector("#shards .sh-n")!;
    this.weaponEl = this.hud.querySelector("#weapon")!;
    this.codexList = this.hud.querySelector("#codex-list")!;
    this.chain = this.hud.querySelector("#chain")!;
    this.banner = this.hud.querySelector("#banner")!;
    this.bossWrap = this.hud.querySelector("#boss-bar")!;
    this.bossFill = this.hud.querySelector(".boss-fill")!;
    this.objWrap = this.hud.querySelector("#objective")!;
    this.objText = this.hud.querySelector(".obj-text")!;
    this.objFill = this.hud.querySelector(".obj-fill")!;
    this.streak = this.hud.querySelector("#streak")!;
    this.lockHint = this.hud.querySelector("#lockhint")!;
    this.comboSplash = this.hud.querySelector("#combo-splash")!;
    this.comboName = this.hud.querySelector("#combo-splash .cs-name")!;
    this.comboRow = this.hud.querySelector("#combo-splash .cs-row")!;
    this.dmgFlash = this.hud.querySelector("#dmgflash")!;
    this.danger = this.hud.querySelector("#danger")!;
    this.crosshair = this.hud.querySelector("#crosshair")!;
    this.dashRing = this.hud.querySelector("#dashring")!;
    this.dmgDir = this.hud.querySelector("#dmgdir")!;
    this.fervorEl = this.hud.querySelector("#fervor")!;
    this.fervorFill = this.hud.querySelector("#fervor .fv-fill")!;
    this.rebuildWeapon();
  }

  /** Re-render the equipped weapon panel + its combo codex (on switch / unlock). */
  private rebuildWeapon(): void {
    const p = this.ctx.player;
    const w = p.weapon;
    const hex = cssHex(w.color);
    const dots = WEAPONS.map((def) => {
      const owned = p.weapons.includes(def.id);
      const cur = def.id === w.id;
      return `<i class="wdot${owned ? " own" : ""}${cur ? " cur" : ""}" style="--gc:${cssHex(def.color)}"></i>`;
    }).join("");
    this.weaponEl.innerHTML = `
      <div class="wp-top"><span class="wp-name" style="color:${hex}">${w.name}</span>
        <span class="wp-kind">${w.kind === "projectile" ? "RANGED" : "MELEE"}</span></div>
      <div class="wp-atks">
        <div class="atk" data-slot="light" style="--gc:${hex}"><div class="atk-cd"></div><b>LMB</b><span>FAST</span></div>
        <div class="atk" data-slot="heavy" style="--gc:${hex}"><div class="atk-cd"></div><b>RMB</b><span>STRONG</span></div>
      </div>
      <div class="wp-swap"><span class="wdots">${dots}</span><span class="wp-hint">E · SWAP ${p.weapons.length}/${WEAPONS.length}</span></div>
    `;
    this.atkCd.light = this.weaponEl.querySelector('.atk[data-slot="light"] .atk-cd')!;
    this.atkCd.heavy = this.weaponEl.querySelector('.atk[data-slot="heavy"] .atk-cd')!;
    this.codexList.innerHTML = w.combos.map((c) =>
      `<div class="cb"><span class="cb-name" style="color:${cssHex(c.color)}">${c.name}</span><span class="cb-rec">${recipeChips(c.recipe)}</span></div>`,
    ).join("");
  }

  setVisible(on: boolean): void {
    this.hud.style.display = on ? "block" : "none";
  }

  showBanner(text: string, color: number): void {
    this.comboSplash.style.animation = "none";
    this.comboSplash.style.opacity = "0";
    this.banner.textContent = text;
    this.banner.style.color = cssHex(color);
    this.banner.style.opacity = "1";
    this.banner.style.transform = "translateX(-50%) scale(1.15)";
    this.bannerT = 1.4;
  }

  showComboSplash(name: string, color: number, recipe: readonly Slot[]): void {
    this.banner.style.opacity = "0";
    this.bannerT = 0;
    const hex = cssHex(color);
    this.comboName.textContent = name;
    this.comboName.style.color = hex;
    this.comboRow.innerHTML = recipeChips(recipe);
    this.comboSplash.style.animation = "none";
    void this.comboSplash.offsetWidth;
    this.comboSplash.style.animation = "combo-pop 1.5s cubic-bezier(.2,.9,.2,1)";
  }

  update(dt: number): void {
    const p = this.ctx.player;
    this.t += dt;

    const frac = Math.max(0, p.hp / p.maxHp);

    if (this.dmgT > 0) { this.dmgT -= dt; this.dmgFlash.style.opacity = Math.max(0, this.dmgT / 0.4).toFixed(2); }
    else this.dmgFlash.style.opacity = "0";
    if (frac < 0.35 && p.alive) {
      const sev = (0.35 - frac) / 0.35;
      this.danger.style.opacity = (sev * (0.55 + 0.45 * Math.sin(this.t * 6))).toFixed(2);
    } else {
      this.danger.style.opacity = "0";
    }
    this.hpFill.style.width = (frac * 100).toFixed(1) + "%";
    this.hpFill.style.background = frac > 0.3 ? "linear-gradient(180deg,#ffe2a0,#ffb24a 48%,#e07a2a)" : "linear-gradient(180deg,#ff8a6a,#ff4252 58%,#b81e2e)";
    this.healthEl.classList.toggle("low", frac < 0.35 && p.alive);
    this.hpText.textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;

    // weapon attack cooldowns (light/heavy)
    const w = p.weapon;
    this.atkCd.light.style.height = (Math.max(0, p.cooldowns.light / w.light.cooldown) * 100).toFixed(0) + "%";
    this.atkCd.heavy.style.height = (Math.max(0, p.cooldowns.heavy / w.heavy.cooldown) * 100).toFixed(0) + "%";

    // combo chain pips + "armed" glow when the current buffer already forms a combo
    const buf = p.buffer;
    const armed = matchWeaponCombo(buf, w);
    // buffer only changes on attack — skip the innerHTML reparse+reflow on the ~99% of
    // frames it's identical (usually "" while idle).
    const chainHtml = buf.map((s) => `<span class="pip pip-${s}"></span>`).join("")
      + (armed ? `<span class="pip-armed" style="color:${cssHex(armed.color)}">▶ ${armed.name}</span>` : "");
    if (chainHtml !== this.lastChain) { this.chain.innerHTML = chainHtml; this.lastChain = chainHtml; }

    this.crosshair.classList.toggle("weak", this.ctx.combat.isAimingWeak());
    // dash cooldown ring: a conic sweep that empties as the dash returns
    const cd = p.dashCd01();
    this.dashRing.style.opacity = cd > 0 ? "0.85" : "0";
    if (cd > 0) this.dashRing.style.background = `conic-gradient(rgba(255,194,74,0.9) ${((1 - cd) * 360).toFixed(0)}deg, rgba(255,255,255,0.12) 0deg)`;
    // damage-direction arc
    if (this.dmgDirT > 0) { this.dmgDirT -= dt; this.dmgDir.style.opacity = Math.min(1, this.dmgDirT / 0.3).toFixed(2); }
    else this.dmgDir.style.opacity = "0";
    // fervor meter
    this.fervorFill.style.width = (this.fervorV * 100).toFixed(1) + "%";
    this.fervorEl.classList.toggle("full", this.fervorV >= 1);
    this.fervorEl.style.opacity = this.fervorV > 0.01 ? "1" : "0";
    this.lockHint.style.opacity = this.ctx.playing && !this.ctx.input.pointerLocked && p.alive ? "1" : "0";

    const boss = this.ctx.boss && !this.ctx.boss.dormant ? this.ctx.boss : null;
    if (boss) {
      this.bossWrap.style.opacity = "1";
      this.bossFill.style.width = (Math.max(0, boss.hp / boss.maxHp) * 100).toFixed(1) + "%";
    } else {
      this.bossWrap.style.opacity = "0";
    }

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

    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.banner.style.opacity = "0";
      else this.banner.style.transform = `translateX(-50%) scale(${(1 + this.bannerT * 0.12).toFixed(3)})`;
    }

    if (this.streakT > 0) {
      this.streakT -= dt;
      this.streak.style.opacity = this.streakCount >= 3 ? "1" : "0";
      this.streak.textContent = this.streakCount >= 3 ? `${this.streakCount}× STREAK` : "";
    } else {
      this.streak.style.opacity = "0";
    }
  }
}
