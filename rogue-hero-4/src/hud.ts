import { World } from './sim/world';
import { CARDS, CHARACTERS, RELIC_BY_ID } from './content';
import { GLYPHS, weaveForecast } from './sim/weave';
import type { CharacterDef, RelicDef } from './types';

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

export class Hud {
  private hud: HTMLElement;
  private overlay: HTMLElement;
  private hpFill!: HTMLElement;
  private hpText!: HTMLElement;
  private weaveSlots!: HTMLElement[];
  private weaveState!: HTMLElement;
  private cards!: HTMLElement[];
  private depthEl!: HTMLElement;
  private relicsEl!: HTMLElement;
  private bossWrap!: HTMLElement;
  private bossFill!: HTMLElement;
  private comboEl!: HTMLElement;
  private floaters: HTMLElement[] = [];
  private fCursor = 0;
  private barTop!: HTMLElement;
  private barBot!: HTMLElement;
  private cineText!: HTMLElement;
  private cineTitleEl!: HTMLElement;
  private cineSubEl!: HTMLElement;
  private skipHint!: HTMLElement;
  private cineTimer = 0;
  private tutEl!: HTMLElement;
  private flashEl!: HTMLElement;

  constructor(hud: HTMLElement, overlay: HTMLElement) {
    this.hud = hud; this.overlay = overlay;
    this.buildHud();
    this.buildCinematic();
    this.tutEl = document.createElement('div'); this.tutEl.className = 'tutorial';
    this.flashEl = document.createElement('div'); this.flashEl.className = 'screenflash';
    this.overlay.append(this.tutEl, this.flashEl);
    for (let i = 0; i < 28; i++) {
      const d = document.createElement('div'); d.className = 'dmg-float'; d.style.opacity = '0';
      this.overlay.appendChild(d); this.floaters.push(d);
    }
  }

  tutorial(title: string, sub: string): void {
    this.tutEl.innerHTML = `<div class="tut-title">${title}</div><div class="tut-sub">${sub}</div>`;
    this.tutEl.classList.add('on');
  }
  clearTutorial(): void { this.tutEl.classList.remove('on'); }

  // brief full-screen impact flash (crashes, death) — strong, photogenic juice
  flash(color: string, alpha = 0.5): void {
    const el = this.flashEl;
    el.style.transition = 'none'; el.style.background = color; el.style.opacity = String(alpha);
    requestAnimationFrame(() => { el.style.transition = 'opacity .38s ease-out'; el.style.opacity = '0'; });
  }

  private buildCinematic(): void {
    const el = (cls: string) => { const d = document.createElement('div'); d.className = cls; return d; };
    this.barTop = el('letterbar'); this.barBot = el('letterbar bottom');
    this.cineText = el('cine-text');
    this.cineTitleEl = el('cine-title'); this.cineSubEl = el('cine-sub');
    this.cineText.append(this.cineTitleEl, this.cineSubEl);
    this.skipHint = el('cine-skip'); this.skipHint.textContent = 'Click / Space to skip';
    this.overlay.append(this.barTop, this.barBot, this.cineText, this.skipHint);
  }

  letterbox(on: boolean): void {
    this.barTop.classList.toggle('on', on);
    this.barBot.classList.toggle('on', on);
    this.skipHint.classList.toggle('on', on);
  }

  cinematicText(title: string, sub: string, color: string, holdMs = 1600): void {
    clearTimeout(this.cineTimer);
    this.cineTitleEl.textContent = title; this.cineTitleEl.style.color = color;
    this.cineSubEl.textContent = sub;
    this.cineText.classList.add('show');
    this.cineTimer = window.setTimeout(() => this.cineText.classList.remove('show'), holdMs);
  }

  clearCinematic(): void {
    clearTimeout(this.cineTimer);
    this.cineText.classList.remove('show');
    this.letterbox(false);
  }

  private buildHud(): void {
    // Bottom HUD is ONE responsive flex row (hp | tempo | cards) so the groups can never
    // overlap at any window size/aspect — fixed pixel positions caused overlapping HUD.
    this.hud.innerHTML = `
      <div class="relics"></div>
      <div class="depth panel"></div>
      <div class="hud-bar boss-wrap panel"><div class="label">The Conductor</div><div class="bar"><i class="hp-fill" style="background:linear-gradient(90deg,#4dfbff,#ff5cf2)"></i></div></div>
      <div class="hud-bottom">
        <div class="hud-bar hp-wrap panel">
          <div class="label">Vitality <span class="hp-text"></span></div>
          <div class="bar"><i class="hp-fill"></i></div>
        </div>
        <div class="hud-bar weave-wrap panel">
          <div class="weave-label">SPELL WEAVE</div>
          <div class="weave-slots">
            <span class="weave-slot"></span><span class="weave-slot"></span><span class="weave-slot"></span>
          </div>
          <div class="weave-state"></div>
          <div class="combo"></div>
        </div>
        <div class="cards"></div>
      </div>`;
    this.hpFill = this.hud.querySelector('.hp-fill')!;
    this.hpText = this.hud.querySelector('.hp-text')!;
    this.weaveSlots = Array.from(this.hud.querySelectorAll<HTMLElement>('.weave-slot'));
    this.weaveState = this.hud.querySelector('.weave-state')!;
    this.depthEl = this.hud.querySelector('.depth')!;
    this.relicsEl = this.hud.querySelector('.relics')!;
    this.comboEl = this.hud.querySelector('.combo')!;
    this.bossWrap = this.hud.querySelector('.boss-wrap')!;
    this.bossFill = this.bossWrap.querySelector('.hp-fill')!;
    const cardsEl = this.hud.querySelector('.cards')!;
    this.cards = [];
    for (let i = 0; i < 4; i++) {
      const c = document.createElement('div'); c.className = 'card';
      c.innerHTML = `<span class="key">${i + 1}</span><div class="nm"></div><div class="meta"></div><div class="cd"></div><i class="cdbar"></i>`;
      cardsEl.appendChild(c); this.cards.push(c);
    }
  }

  setLoadout(ids: string[]): void {
    this.cards.forEach((c, i) => {
      const def = CARDS[ids[i]];
      if (!def) { c.style.display = 'none'; return; }
      c.style.display = 'flex';
      c.style.borderColor = hex(def.color) + 'cc';
      (c.querySelector('.nm') as HTMLElement).textContent = def.name;
      const gm = GLYPHS[def.glyph];
      const meta = c.querySelector('.meta') as HTMLElement;
      meta.textContent = `${gm.sym} ${gm.name}`; meta.style.color = hex(gm.color);
      (c.querySelector('.cdbar') as HTMLElement).style.background = hex(def.color);
    });
  }

  update(w: World): void {
    const pl = w.player; if (!pl) return;
    this.hpFill.style.width = `${Math.max(0, (pl.hp / pl.maxHp) * 100)}%`;
    this.hpText.textContent = `${Math.ceil(pl.hp)} / ${pl.maxHp}`;
    // spell weave: light up the slots already woven, show what they're on track to become
    this.weaveSlots.forEach((s, i) => {
      const g = pl.weave[i];
      if (g) { const gm = GLYPHS[g]; s.textContent = gm.sym; s.style.color = hex(gm.color); s.style.borderColor = hex(gm.color) + 'cc'; s.classList.add('lit'); }
      else { s.textContent = '·'; s.style.color = '#5a6a86'; s.style.borderColor = '#2a3550'; s.classList.remove('lit'); }
    });
    const empowered = pl.empower > 0, warded = pl.ward > 0;
    this.weaveState.textContent = empowered ? `⚡ EMPOWERED ×${pl.empower}` : warded ? '❄ WARDED' : weaveForecast(pl.weave);
    this.weaveState.style.color = empowered ? '#ffe27a' : warded ? hex(GLYPHS.frost.color) : '#9fb8e0';
    this.comboEl.style.opacity = pl.combo >= 3 ? '1' : '0';
    this.comboEl.textContent = pl.combo >= 3 ? `${pl.combo} COMBO` : '';
    this.comboEl.style.color = pl.combo >= 8 ? '#ff5cf2' : '#ffc24d';
    this.cards.forEach((c, i) => {
      const cs = pl.cards[i]; if (!cs) return;
      const def = CARDS[cs.id];
      const cd = c.querySelector('.cd') as HTMLElement;
      const bar = c.querySelector('.cdbar') as HTMLElement;
      if (cs.cd > 0) {
        c.classList.add('cool'); cd.textContent = cs.cd.toFixed(1);
        bar.style.width = `${Math.max(0, 100 - (cs.cd / def.cooldown) * 100)}%`;
      } else { c.classList.remove('cool'); bar.style.width = '100%'; }
    });
    this.depthEl.innerHTML = `<b style="color:${hex(w.biome.accent)}">${w.biome.name}</b> · DEPTH ${w.run.depth}<br>Kills ${w.run.kills}`;
    this.relicsEl.innerHTML = w.run.relics.map((id) => {
      const r = RELIC_BY_ID.get(id); return r ? `<span class="relic-chip" title="${r.name}: ${r.desc}">${r.icon}</span>` : '';
    }).join('');
    if (w.boss) { this.bossWrap.style.display = 'block'; this.bossFill.style.width = `${Math.max(0, (w.boss.hp / w.boss.maxHp) * 100)}%`; }
    else this.bossWrap.style.display = 'none';
  }

  floater(sx: number, sy: number, text: string, color: string): void {
    const d = this.floaters[this.fCursor]; this.fCursor = (this.fCursor + 1) % this.floaters.length;
    d.textContent = text; d.style.color = color; d.style.left = `${sx}px`; d.style.top = `${sy}px`;
    d.style.transition = 'none'; d.style.transform = 'translate(-50%,0)'; d.style.opacity = '1';
    d.style.fontSize = text.startsWith('-') ? '22px' : '17px';
    requestAnimationFrame(() => {
      d.style.transition = 'transform .7s ease-out, opacity .7s ease-out';
      d.style.transform = 'translate(-50%,-48px)'; d.style.opacity = '0';
    });
  }

  // ---- overlay screens ----------------------------------------------------
  private screen(html: string): HTMLElement {
    this.overlay.querySelector('.screen')?.remove();
    // content sits inside a beveled neon PANEL (auto-hugs content) so menus read as crafted
    // SC2-style frames instead of text floating over the arena (the VLM flagged "no container").
    const s = document.createElement('div'); s.className = 'screen';
    s.innerHTML = `<div class="screen-inner">${html}</div>`;
    this.overlay.appendChild(s); return s.querySelector('.screen-inner') as HTMLElement;
  }
  hideOverlay(): void { this.overlay.querySelector('.screen')?.remove(); }

  showTitle(onPlay: () => void, onTutorial: () => void, onHow: () => void, onExit: () => void): void {
    const s = this.screen(`
      <div class="title-big">ROGUE HERO 4</div>
      <div class="subtitle">Neon · Arcane · Relentless</div>
      <p class="hint" style="max-width:520px;font-size:15px;opacity:0.95">Weave arcane glyphs — every 3 casts complete a weave: match for Resonance,
        mix for a room-clearing Prismatic Rite. Clear six depths and silence The Conductor.</p>
      <div class="row"><button class="btn primary" data-play>▶ Play</button></div>
      <div class="row">
        <button class="btn" data-tut>⌁ Tutorial</button>
        <button class="btn" data-how>How to Play</button>
        <button class="btn" data-exit>⏻ Exit</button>
      </div>`);
    s.querySelector('[data-play]')!.addEventListener('click', onPlay);
    s.querySelector('[data-tut]')!.addEventListener('click', onTutorial);
    s.querySelector('[data-how]')!.addEventListener('click', onHow);
    s.querySelector('[data-exit]')!.addEventListener('click', onExit);
  }

  showHowTo(onBack: () => void): void {
    const row = (keys: string[], desc: string) =>
      `<div class="howto-row"><div class="howto-keys">${keys.map((k) => `<span class="kbd">${k}</span>`).join('')}</div><div class="howto-desc">${desc}</div></div>`;
    const s = this.screen(`
      <div class="title-big" style="font-size:46px">HOW TO PLAY</div>
      <div class="howto-grid">
        ${row(['W', 'A', 'S', 'D'], 'Move (relative to the camera)')}
        ${row(['Q', 'E'], 'Rotate camera to keep enemies in view')}
        ${row(['Mouse'], 'Aim — your hero faces the cursor')}
        ${row(['1', '2', '3', '4'], 'Cast your four abilities')}
        ${row(['L-Click'], 'Cast ability 1 · <b>R-Click</b> casts ability 2')}
        ${row(['Space'], 'Dash — blink through danger (i-frames)')}
        ${row(['WEAVE'], 'Each cast weaves a glyph. <b>3 same</b> = Resonance · <b>all 3 different</b> = Prismatic Rite · <b>2+1</b> = Surge')}
      </div>
      <p class="hint" style="max-width:620px">Goal: clear each room, grab a relic, and descend six depths to beat
        <b style="color:#4dfbff">The Conductor</b>. Sequence your spells to bait the weave you want — that's the skill.</p>
      <button class="btn primary" data-back>Got it</button>`);
    s.querySelector('[data-back]')!.addEventListener('click', onBack);
  }

  showSelect(unlocked: Set<string>, onPick: (id: string) => void, onBack: () => void): void {
    const cards = CHARACTERS.map((c: CharacterDef) => {
      const open = c.unlock === '' || unlocked.has(c.id);
      return `<button class="pick" data-id="${c.id}" ${open ? '' : 'disabled'} style="border-color:${hex(c.color)}88">
        <span class="tag" style="color:${hex(c.color)}">${c.title}</span>
        <h3>${c.name}</h3><p>${open ? c.blurb : '🔒 Unlock: ' + c.unlock}</p>
        <div class="meta">HP ${c.hp} · ${c.loadout.map((l) => CARDS[l].name).join(' · ')}</div>
      </button>`;
    }).join('');
    const s = this.screen(`<div class="title-big" style="font-size:46px">CHOOSE YOUR VESSEL</div>
      <div class="subtitle">Pick a hero to descend with</div>
      <div class="row">${cards}</div><button class="btn" data-back>◂ Back</button>`);
    s.querySelectorAll<HTMLButtonElement>('.pick').forEach((b) => {
      if (!b.disabled) b.addEventListener('click', () => onPick(b.dataset.id!));
    });
    s.querySelector('[data-back]')!.addEventListener('click', onBack);
  }

  showDraft(options: RelicDef[], onPick: (id: string) => void): void {
    const picks = options.map((r) => `<button class="pick" data-id="${r.id}" style="min-height:170px">
      <span class="tag" style="color:#5dff9b">Relic</span><h3>${r.icon} ${r.name}</h3><p>${r.desc}</p></button>`).join('');
    const s = this.screen(`<div class="title-big" style="font-size:48px;color:#5dff9b;text-shadow:0 0 28px #5dff9b99,0 4px 12px #000">ROOM CLEARED</div>
      <div class="subtitle">Choose a relic — pick 1 of 3</div><div class="row">${picks}</div>`);
    s.querySelectorAll<HTMLButtonElement>('.pick').forEach((b) => b.addEventListener('click', () => onPick(b.dataset.id!)));
  }

  showEnd(win: boolean, w: World, onRetry: () => void, onMenu: () => void): void {
    const color = win ? '#5dff9b' : '#ff4d68';
    const s = this.screen(`
      <div class="title-big" style="color:${color};text-shadow:0 0 30px ${color}aa,0 4px 12px #000">${win ? 'VICTORY' : 'YOU FELL'}</div>
      <div class="subtitle">${win ? 'The Conductor is silenced' : 'Defeated at depth ' + w.run.depth}</div>
      <p style="color:#d7e6ff;font-size:16px">Kills <b>${w.run.kills}</b> · Relics <b>${w.run.relics.length}</b> · ${CHARACTERS.find((c) => c.id === w.run.charId)?.name}</p>
      <div class="row"><button class="btn primary" data-retry>↻ Run Again</button><button class="btn" data-menu>Main Menu</button></div>`);
    s.querySelector('[data-retry]')!.addEventListener('click', onRetry);
    s.querySelector('[data-menu]')!.addEventListener('click', onMenu);
  }
}
