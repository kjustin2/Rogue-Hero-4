import { World } from './sim/world';
import { CARDS, CHARACTERS, RELIC_BY_ID } from './content';
import { zoneOf, zoneColor, zoneLabel } from './sim/tempo';
import type { CharacterDef, RelicDef } from './types';

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

export class Hud {
  private hud: HTMLElement;
  private overlay: HTMLElement;
  private hpFill!: HTMLElement;
  private hpText!: HTMLElement;
  private tempoFill!: HTMLElement;
  private tempoZone!: HTMLElement;
  private cards!: HTMLElement[];
  private depthEl!: HTMLElement;
  private relicsEl!: HTMLElement;
  private bossWrap!: HTMLElement;
  private bossFill!: HTMLElement;
  private comboEl!: HTMLElement;
  private floaters: HTMLElement[] = [];
  private fCursor = 0;

  constructor(hud: HTMLElement, overlay: HTMLElement) {
    this.hud = hud; this.overlay = overlay;
    this.buildHud();
    for (let i = 0; i < 28; i++) {
      const d = document.createElement('div'); d.className = 'dmg-float'; d.style.opacity = '0';
      this.overlay.appendChild(d); this.floaters.push(d);
    }
  }

  private buildHud(): void {
    this.hud.innerHTML = `
      <div class="hud-bar hp-wrap">
        <div class="label">Vitality <span class="hp-text"></span></div>
        <div class="bar"><i class="hp-fill"></i></div>
      </div>
      <div class="hud-bar tempo-wrap">
        <div class="tempo-zone">NEUTRAL</div>
        <div class="bar"><i class="tempo-fill"></i></div>
        <div class="combo" style="margin-top:6px;font-weight:800;letter-spacing:.1em;opacity:0;"></div>
      </div>
      <div class="cards"></div>
      <div class="depth"></div>
      <div class="relics"></div>
      <div class="hud-bar boss-wrap"><div class="label">The Conductor</div><div class="bar"><i class="hp-fill" style="background:linear-gradient(90deg,#36f9ff,#ff3df0)"></i></div></div>`;
    this.hpFill = this.hud.querySelector('.hp-fill')!;
    this.hpText = this.hud.querySelector('.hp-text')!;
    this.tempoFill = this.hud.querySelector('.tempo-fill')!;
    this.tempoZone = this.hud.querySelector('.tempo-zone')!;
    this.depthEl = this.hud.querySelector('.depth')!;
    this.relicsEl = this.hud.querySelector('.relics')!;
    this.comboEl = this.hud.querySelector('.combo')!;
    this.bossWrap = this.hud.querySelector('.boss-wrap')!;
    this.bossFill = this.bossWrap.querySelector('.hp-fill')!;
    const cardsEl = this.hud.querySelector('.cards')!;
    this.cards = [];
    for (let i = 0; i < 4; i++) {
      const c = document.createElement('div'); c.className = 'card';
      c.innerHTML = `<span class="key">${i + 1}</span><div class="nm"></div><div class="meta"></div><div class="cd" style="display:none"></div>`;
      cardsEl.appendChild(c); this.cards.push(c);
    }
  }

  setLoadout(ids: string[]): void {
    this.cards.forEach((c, i) => {
      const def = CARDS[ids[i]];
      if (!def) { c.style.display = 'none'; return; }
      c.style.display = 'flex';
      c.style.borderColor = hex(def.color) + '88';
      (c.querySelector('.nm') as HTMLElement).textContent = def.name;
      (c.querySelector('.meta') as HTMLElement).textContent = `${def.tempo > 0 ? '+' : ''}${def.tempo} tempo`;
    });
  }

  update(w: World): void {
    const pl = w.player; if (!pl) return;
    this.hpFill.style.width = `${Math.max(0, (pl.hp / pl.maxHp) * 100)}%`;
    this.hpText.textContent = `${Math.ceil(pl.hp)} / ${pl.maxHp}`;
    this.tempoFill.style.width = `${pl.tempo}%`;
    const z = zoneOf(pl.tempo);
    this.tempoZone.textContent = zoneLabel(z);
    this.tempoZone.style.color = hex(zoneColor(z));
    this.comboEl.style.opacity = pl.combo >= 3 ? '1' : '0';
    this.comboEl.textContent = pl.combo >= 3 ? `${pl.combo} COMBO` : '';
    this.comboEl.style.color = pl.combo >= 8 ? '#ff3df0' : '#ffb340';
    this.cards.forEach((c, i) => {
      const cs = pl.cards[i]; if (!cs) return;
      const def = CARDS[cs.id];
      const cd = c.querySelector('.cd') as HTMLElement;
      if (cs.cd > 0) { c.classList.add('cool'); cd.style.display = 'flex'; cd.textContent = cs.cd.toFixed(1); }
      else { c.classList.remove('cool'); cd.style.display = 'none'; }
      void def;
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
    d.style.fontSize = text.startsWith('-') ? '20px' : '16px';
    requestAnimationFrame(() => {
      d.style.transition = 'transform .7s ease-out, opacity .7s ease-out';
      d.style.transform = 'translate(-50%,-44px)'; d.style.opacity = '0';
    });
  }

  // ---- overlay screens ----------------------------------------------------
  private screen(html: string): HTMLElement {
    this.overlay.querySelector('.screen')?.remove();
    const s = document.createElement('div'); s.className = 'screen'; s.innerHTML = html;
    this.overlay.appendChild(s); return s;
  }
  hideOverlay(): void { this.overlay.querySelector('.screen')?.remove(); }

  showTitle(onPlay: () => void): void {
    const s = this.screen(`
      <div class="title-big">ROGUE HERO 4</div>
      <div class="subtitle">Neon · Arcane · Relentless</div>
      <button class="btn" data-play>Enter the Voidline</button>
      <div class="hint">WASD move · Mouse aim · 1-4 / Click cast · Space dash · Ride the TEMPO, bait the crash</div>`);
    s.querySelector('[data-play]')!.addEventListener('click', onPlay);
  }

  showSelect(unlocked: Set<string>, onPick: (id: string) => void, onBack: () => void): void {
    const cards = CHARACTERS.map((c: CharacterDef) => {
      const open = c.unlock === '' || unlocked.has(c.id);
      return `<button class="pick" data-id="${c.id}" ${open ? '' : 'disabled'} style="border-color:${hex(c.color)}66">
        <span class="tag" style="color:${hex(c.color)}">${c.title}</span>
        <h3>${c.name}</h3><p>${open ? c.blurb : '🔒 ' + c.unlock}</p>
        <div class="meta">HP ${c.hp} · ${c.loadout.map((l) => CARDS[l].name).join(' · ')}</div>
      </button>`;
    }).join('');
    const s = this.screen(`<div class="subtitle">Choose your vessel</div><div class="row">${cards}</div><button class="btn" data-back>Back</button>`);
    s.querySelectorAll<HTMLButtonElement>('.pick').forEach((b) => {
      if (!b.disabled) b.addEventListener('click', () => onPick(b.dataset.id!));
    });
    s.querySelector('[data-back]')!.addEventListener('click', onBack);
  }

  showDraft(options: RelicDef[], onPick: (id: string) => void): void {
    const picks = options.map((r) => `<button class="pick" data-id="${r.id}">
      <span class="tag">Relic</span><h3>${r.icon} ${r.name}</h3><p>${r.desc}</p></button>`).join('');
    const s = this.screen(`<div class="title-big" style="font-size:38px">ROOM CLEARED</div><div class="subtitle">Take a relic</div><div class="row">${picks}</div>`);
    s.querySelectorAll<HTMLButtonElement>('.pick').forEach((b) => b.addEventListener('click', () => onPick(b.dataset.id!)));
  }

  showEnd(win: boolean, w: World, onRetry: () => void, onMenu: () => void): void {
    const s = this.screen(`
      <div class="title-big" style="${win ? '' : 'background:linear-gradient(90deg,#ff3b5c,#ffb340);-webkit-background-clip:text;background-clip:text;'}">${win ? 'VOIDLINE BROKEN' : 'YOU FELL'}</div>
      <div class="subtitle">${win ? 'The Conductor is silenced' : 'Depth ' + w.run.depth}</div>
      <p style="opacity:.85">Kills ${w.run.kills} · Relics ${w.run.relics.length} · ${CHARACTERS.find((c) => c.id === w.run.charId)?.name}</p>
      <div class="row"><button class="btn" data-retry>Run Again</button><button class="btn" data-menu>Main Menu</button></div>`);
    s.querySelector('[data-retry]')!.addEventListener('click', onRetry);
    s.querySelector('[data-menu]')!.addEventListener('click', onMenu);
  }
}
