import type { World } from "../sim/world.js";
import type { Bus } from "../sim/bus.js";
import type { RelicDef } from "../sim/types.js";
import { GLYPHS, forecast } from "../sim/weave.js";
import { RELICS, CHARACTERS, CARDS } from "../sim/content.js";

const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");

const CSS = `
#hud{position:fixed;inset:0;pointer-events:none;font-family:system-ui,Segoe UI,sans-serif;color:#dfe7ff;z-index:10;user-select:none}
#hud .panel{position:absolute;background:rgba(10,12,22,.55);border:1px solid rgba(120,160,255,.18);border-radius:10px;padding:8px 10px;backdrop-filter:blur(4px)}
#hp{left:18px;top:16px;width:280px}
#hpbar{height:14px;border-radius:7px;background:#1a2030;overflow:hidden;margin-top:4px}
#hpfill{height:100%;width:100%;background:linear-gradient(90deg,#36f9ff,#53ff8a);transition:width .12s}
#hptext{font-size:12px;letter-spacing:.5px;opacity:.85}
#weave{left:18px;top:74px;width:280px}
#weave .slots{display:flex;gap:8px;margin:6px 0}
#weave .slot{width:42px;height:42px;border-radius:8px;border:1px solid rgba(140,170,255,.25);display:flex;align-items:center;justify-content:center;font-size:24px;background:rgba(0,0,0,.3)}
#weave .state{font-size:12px;min-height:16px;letter-spacing:.4px}
#abilities{left:50%;bottom:18px;transform:translateX(-50%);display:flex;gap:10px}
.ability{position:relative;width:64px;height:64px;border-radius:10px;background:rgba(10,12,22,.6);border:1px solid rgba(120,160,255,.22);overflow:hidden;text-align:center}
.ability .key{position:absolute;top:3px;left:5px;font-size:11px;opacity:.7}
.ability .nm{position:absolute;bottom:4px;left:0;right:0;font-size:10px;line-height:1.1;opacity:.92}
.ability .gl{font-size:20px;margin-top:12px;display:block}
.ability .cd{position:absolute;inset:0;background:rgba(4,6,14,.78);transform-origin:bottom}
#depth{right:18px;top:16px;text-align:right;min-width:150px}
#depth .big{font-size:18px;font-weight:600;letter-spacing:1px}
#depth .sub{font-size:12px;opacity:.8}
#relics{right:18px;top:86px;display:flex;gap:6px;flex-wrap:wrap;max-width:200px;justify-content:flex-end}
#relics .chip{width:30px;height:30px;border-radius:7px;background:rgba(10,12,22,.6);border:1px solid rgba(120,160,255,.22);display:flex;align-items:center;justify-content:center;font-size:16px}
#combo{position:absolute;left:50%;top:60px;transform:translateX(-50%);font-size:26px;font-weight:700;opacity:0;transition:opacity .15s;text-shadow:0 0 12px currentColor}
#boss{position:absolute;left:50%;top:14px;transform:translateX(-50%);width:46%;display:none}
#boss .nm{font-size:13px;letter-spacing:2px;text-align:center;opacity:.9}
#bossbar{height:10px;border-radius:5px;background:#241018;overflow:hidden;margin-top:3px}
#bossfill{height:100%;width:100%;background:linear-gradient(90deg,#ff3b5c,#ff8c00)}
.floater{position:absolute;font-weight:700;font-size:16px;pointer-events:none;text-shadow:0 0 6px rgba(0,0,0,.7);transform:translate(-50%,-50%)}
#flash{position:fixed;inset:0;pointer-events:none;z-index:9;opacity:0}
.overlay{position:fixed;inset:0;z-index:20;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:rgba(4,5,12,.72);backdrop-filter:blur(3px);pointer-events:auto}
.overlay h1{font-size:40px;margin:0;letter-spacing:3px;text-shadow:0 0 24px currentColor}
.overlay p{opacity:.8;margin:0}
.cards{display:flex;gap:16px}
.reliccard{width:180px;padding:18px;border-radius:14px;background:rgba(14,18,32,.9);border:1px solid rgba(120,160,255,.3);cursor:pointer;text-align:center;transition:transform .1s,border-color .1s}
.reliccard:hover{transform:translateY(-6px);border-color:#36f9ff}
.reliccard .ic{font-size:34px}.reliccard .t{font-weight:600;margin:8px 0 4px}.reliccard .d{font-size:13px;opacity:.8}
.btn{pointer-events:auto;padding:12px 28px;border-radius:10px;background:#15263a;border:1px solid #36f9ff;color:#dfe7ff;font-size:16px;cursor:pointer;letter-spacing:1px}
.btn:hover{background:#1d3552}
`;

// Polished menu theme + first-person crosshair / progress (overrides the base rules above).
const POLISH = `
.overlay{background:radial-gradient(ellipse at center,rgba(8,10,22,.55) 0%,rgba(3,4,10,.92) 100%)!important;gap:22px!important}
.overlay h1{margin:0;font-weight:800;letter-spacing:7px;font-size:54px;background:linear-gradient(180deg,#eaf4ff,#7fb0ff);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;filter:drop-shadow(0 0 18px rgba(80,180,255,.55));animation:rhpulse 3.4s ease-in-out infinite}
@keyframes rhpulse{0%,100%{filter:drop-shadow(0 0 14px rgba(80,180,255,.4))}50%{filter:drop-shadow(0 0 28px rgba(120,200,255,.72))}}
.overlay p{letter-spacing:1px;opacity:.72;font-size:13px;line-height:1.7;text-align:center}
.overlay .tagline{text-transform:uppercase;letter-spacing:6px;font-size:12px;color:#7fd8ff;opacity:.9;text-shadow:0 0 14px rgba(80,200,255,.5)}
.btn{background:linear-gradient(180deg,#16384f,#0d2032)!important;border:1px solid #36f9ff!important;border-radius:12px!important;padding:14px 36px!important;font-weight:700!important;letter-spacing:3px!important;box-shadow:0 0 26px rgba(54,249,255,.22),inset 0 0 12px rgba(54,249,255,.12);transition:transform .12s,box-shadow .12s}
.btn:hover{transform:translateY(-2px);box-shadow:0 0 40px rgba(54,249,255,.5),inset 0 0 16px rgba(54,249,255,.2)!important}
.cards{gap:20px}
.reliccard{background:linear-gradient(180deg,rgba(22,28,48,.94),rgba(10,14,26,.94))!important;border:1px solid rgba(120,160,255,.28)!important;border-radius:16px!important;box-shadow:0 10px 30px rgba(0,0,0,.45);transition:transform .12s,border-color .12s,box-shadow .12s}
.reliccard:hover{transform:translateY(-8px)!important;border-color:#36f9ff!important;box-shadow:0 16px 44px rgba(54,249,255,.28)}
.reliccard .ic{filter:drop-shadow(0 0 12px currentColor)}
.reliccard .t{letter-spacing:1px;font-size:17px}
#crosshair{position:fixed;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:rgba(200,235,255,.92);box-shadow:0 0 6px rgba(120,220,255,.95),0 0 0 7px rgba(120,220,255,.10);z-index:11;pointer-events:none}
#progress{position:fixed;left:50%;top:14px;transform:translateX(-50%);width:40%;z-index:10}
#progress .lab{font-size:10px;letter-spacing:4px;text-align:center;color:#bfe0ff;opacity:.8;margin-bottom:4px}
#progress .track{height:6px;border-radius:3px;background:rgba(20,26,40,.7);overflow:hidden;box-shadow:inset 0 0 6px rgba(0,0,0,.5)}
#progress .fill{height:100%;width:0;background:linear-gradient(90deg,#36f9ff,#9d6bff);box-shadow:0 0 10px rgba(120,180,255,.6);transition:width .2s}
.settings{display:flex;flex-direction:column;gap:14px;background:rgba(14,18,32,.86);border:1px solid rgba(120,160,255,.26);border-radius:14px;padding:20px 26px;min-width:330px}
.setrow{display:flex;align-items:center;gap:14px;font-size:14px;color:#cfe0ff}
.setrow label{flex:1}
.setrow input[type=range]{flex:1;accent-color:#36f9ff}
.setrow .sval{width:28px;text-align:right;color:#7fd8ff}
#lookhint{position:fixed;left:50%;top:57%;transform:translateX(-50%);font-size:17px;font-weight:600;letter-spacing:2px;color:#eaf4ff;opacity:.96;background:rgba(8,12,24,.74);border:1px solid rgba(80,200,255,.4);padding:13px 24px;border-radius:12px;z-index:12;pointer-events:none;box-shadow:0 0 26px rgba(54,200,255,.3);animation:rhpulse 2s ease-in-out infinite}
`;

export class Hud {
  root: HTMLElement;
  private hpFill: HTMLElement; private hpText: HTMLElement;
  private slots: HTMLElement[] = []; private weaveState: HTMLElement;
  private abilEls: { root: HTMLElement; cd: HTMLElement; gl: HTMLElement; nm: HTMLElement; key: HTMLElement }[] = [];
  private depthEl: HTMLElement; private relicsEl: HTMLElement; private comboEl: HTMLElement;
  private bossEl: HTMLElement; private bossFill: HTMLElement;
  private flash: HTMLElement; private overlay: HTMLElement | null = null;
  private progEl!: HTMLElement; private progFill!: HTMLElement; private lookHintEl!: HTMLElement;
  private floaters: { el: HTMLDivElement; x: number; z: number; life: number; ttl: number; vy: number }[] = [];

  constructor(bus: Bus) {
    const style = document.createElement("style"); style.textContent = CSS + POLISH; document.head.appendChild(style);
    this.root = el("div"); this.root.id = "hud"; document.body.appendChild(this.root);

    const hp = panel("hp"); hp.innerHTML = `<div id="hptext">VITALITY</div><div id="hpbar"><div id="hpfill"></div></div>`; this.root.appendChild(hp);
    this.hpFill = q("#hpfill"); this.hpText = q("#hptext");

    const weave = panel("weave");
    weave.innerHTML = `<div style="font-size:12px;letter-spacing:2px;opacity:.8">SPELL WEAVE</div><div class="slots">${"<div class='slot'>·</div>".repeat(3)}</div><div class="state"></div>`;
    this.root.appendChild(weave);
    this.slots = Array.from(weave.querySelectorAll(".slot")) as HTMLElement[];
    this.weaveState = weave.querySelector(".state") as HTMLElement;

    const ab = el("div"); ab.id = "abilities"; this.root.appendChild(ab);
    for (let i = 0; i < 4; i++) {
      const a = el("div"); a.className = "ability";
      a.innerHTML = `<span class="key">${i + 1}</span><span class="gl"></span><span class="nm"></span><div class="cd"></div>`;
      ab.appendChild(a);
      this.abilEls.push({ root: a, cd: a.querySelector(".cd") as HTMLElement, gl: a.querySelector(".gl") as HTMLElement, nm: a.querySelector(".nm") as HTMLElement, key: a.querySelector(".key") as HTMLElement });
    }

    const depth = panel("depth"); depth.innerHTML = `<div class="big"></div><div class="sub"></div>`; this.root.appendChild(depth); this.depthEl = depth;
    this.relicsEl = el("div"); this.relicsEl.id = "relics"; this.root.appendChild(this.relicsEl);
    this.comboEl = el("div"); this.comboEl.id = "combo"; this.root.appendChild(this.comboEl);
    this.bossEl = el("div"); this.bossEl.id = "boss"; this.bossEl.innerHTML = `<div class="nm">THE CONDUCTOR</div><div id="bossbar"><div id="bossfill"></div></div>`; this.root.appendChild(this.bossEl);
    this.bossFill = this.bossEl.querySelector("#bossfill") as HTMLElement;
    this.flash = el("div"); this.flash.id = "flash"; document.body.appendChild(this.flash);

    const cross = el("div"); cross.id = "crosshair"; this.root.appendChild(cross);
    this.progEl = el("div"); this.progEl.id = "progress";
    this.progEl.innerHTML = `<div class="lab">PATH TO THE CONDUCTOR</div><div class="track"><div class="fill"></div></div>`;
    this.root.appendChild(this.progEl); this.progFill = this.progEl.querySelector(".fill") as HTMLElement;

    this.lookHintEl = el("div"); this.lookHintEl.id = "lookhint"; this.lookHintEl.style.display = "none";
    this.lookHintEl.textContent = "▶  CLICK TO PLAY  —  move mouse to look  ·  WASD to move  ·  1–4 cast  ·  Space dash";
    this.root.appendChild(this.lookHintEl);

    bus.on("damage", (e) => this.spawnFloater(e.x, e.z, e.heal ? "+" + e.amount : "" + e.amount, e.heal ? "#53ff8a" : e.crit ? "#ffd166" : "#ff7b9c"));
    bus.on("weave:resolve", (e) => this.doFlash(e.hot ? "rgba(255,120,40,.5)" : "rgba(180,230,255,.55)"));
    bus.on("run:lose", () => this.doFlash("rgba(255,40,60,.55)"));
  }

  private spawnFloater(x: number, z: number, text: string, color: string) {
    const fEl = el("div") as HTMLDivElement; fEl.className = "floater"; fEl.textContent = text; fEl.style.color = color;
    this.root.appendChild(fEl);
    this.floaters.push({ el: fEl, x, z, life: 0.7, ttl: 0.7, vy: 0 });
    if (this.floaters.length > 40) { const old = this.floaters.shift()!; old.el.remove(); }
  }

  private doFlash(color: string) {
    this.flash.style.background = color; this.flash.style.opacity = "1";
    this.flash.style.transition = "none"; requestAnimationFrame(() => { this.flash.style.transition = "opacity .35s"; this.flash.style.opacity = "0"; });
  }

  update(world: World, project: (x: number, y: number, z: number) => { x: number; y: number; vis: boolean }, dt: number) {
    const p = world.player; if (!p) return;
    this.hpFill.style.width = Math.max(0, (p.hp / p.maxHp) * 100) + "%";
    this.hpText.textContent = `VITALITY  ${Math.ceil(p.hp)} / ${p.maxHp}`;

    for (let i = 0; i < 3; i++) {
      const g = p.weave[i];
      this.slots[i].textContent = g ? GLYPHS[g].sym : "·";
      this.slots[i].style.color = g ? hex(GLYPHS[g].color) : "rgba(160,180,220,.4)";
    }
    this.weaveState.textContent = p.empower > 0 ? `⚡ EMPOWERED ×${p.empower}` : p.ward > 0 ? "❄ WARDED" : forecast(p.weave);
    this.weaveState.style.color = p.empower > 0 ? "#ffd166" : p.ward > 0 ? "#bfeaff" : "rgba(210,220,255,.7)";

    for (let i = 0; i < 4; i++) {
      const cs = p.cards[i], a = this.abilEls[i];
      if (!cs) { a.root.style.visibility = "hidden"; continue; }
      a.root.style.visibility = "visible";
      a.gl.textContent = GLYPHS[cs.def.glyph].sym; a.gl.style.color = hex(cs.def.color);
      a.nm.textContent = cs.def.name;
      a.cd.style.transform = `scaleY(${Math.max(0, cs.cd / cs.def.cooldown)})`;
    }

    this.depthEl.querySelector(".big")!.textContent = `DEPTH ${world.depth}`;
    this.depthEl.querySelector(".sub")!.innerHTML = `${world.biome.name} · Kills ${world.kills}`;

    const relics = [...p.relics];
    if (this.relicsEl.childElementCount !== relics.length) {
      this.relicsEl.innerHTML = relics.map((id) => { const r = RELICS.find((x) => x.id === id)!; return `<div class="chip" title="${r.name}">${r.icon}</div>`; }).join("");
    }

    if (p.combo >= 3) { this.comboEl.style.opacity = "1"; this.comboEl.textContent = `${p.combo} COMBO`; this.comboEl.style.color = p.combo >= 8 ? "#ffd166" : "#36f9ff"; }
    else this.comboEl.style.opacity = "0";

    const boss = world.boss;
    if (boss) { this.bossEl.style.display = "block"; this.bossFill.style.width = (boss.hp / boss.maxHp) * 100 + "%"; this.progEl.style.display = "none"; }
    else { this.bossEl.style.display = "none"; this.progEl.style.display = "block"; this.progFill.style.width = (world.progress * 100) + "%"; }

    // floaters
    let n = 0;
    for (const f of this.floaters) {
      f.life -= dt;
      if (f.life <= 0) { f.el.remove(); continue; }
      f.vy += 26 * dt;
      const s = project(f.x, 0.9, f.z);
      f.el.style.left = s.x + "px"; f.el.style.top = (s.y - (f.ttl - f.life) * 38) + "px";
      f.el.style.opacity = s.vis ? String(Math.min(1, f.life / 0.3)) : "0";
      this.floaters[n++] = f;
    }
    this.floaters.length = n;
  }

  showDraft(choices: RelicDef[], onPick: (id: string) => void) {
    this.clearOverlay();
    const o = el("div") as HTMLDivElement; o.className = "overlay";
    o.innerHTML = `<h1 style="color:#36f9ff">CHOOSE A RELIC</h1><p>Room cleared — take one</p>`;
    const cards = el("div"); cards.className = "cards";
    for (const r of choices) {
      const c = el("div"); c.className = "reliccard";
      c.innerHTML = `<div class="ic">${r.icon}</div><div class="t">${r.name}</div><div class="d">${r.desc}</div>`;
      c.onclick = () => { this.clearOverlay(); onPick(r.id); };
      cards.appendChild(c);
    }
    o.appendChild(cards); document.body.appendChild(o); this.overlay = o;
  }

  showEnd(win: boolean, depth: number, kills: number, onRetry: () => void) {
    this.clearOverlay();
    const o = el("div") as HTMLDivElement; o.className = "overlay";
    o.innerHTML = `<h1 style="color:${win ? "#53ff8a" : "#ff3b5c"}">${win ? "VICTORY" : "YOU FELL"}</h1><p>Depth ${depth} · ${kills} kills</p>`;
    const b = el("button"); b.className = "btn"; b.textContent = "RUN AGAIN"; b.onclick = () => { this.clearOverlay(); onRetry(); };
    o.appendChild(b); document.body.appendChild(o); this.overlay = o;
  }

  showSelect(unlocked: Set<string>, onPick: (id: string) => void) {
    this.clearOverlay();
    const o = el("div") as HTMLDivElement; o.className = "overlay";
    o.innerHTML = `<h1 style="color:#36f9ff">CHOOSE YOUR HERO</h1>`;
    const cards = el("div"); cards.className = "cards";
    for (const c of CHARACTERS) {
      const locked = !unlocked.has(c.id);
      const glyphs = c.loadout.map((id) => `<span style="color:${hex(GLYPHS[CARDS[id].glyph].color)}">${GLYPHS[CARDS[id].glyph].sym}</span>`).join(" ");
      const card = el("div"); card.className = "reliccard"; card.style.width = "200px";
      if (locked) { card.style.opacity = "0.45"; card.style.cursor = "not-allowed"; }
      card.innerHTML = `<div class="ic" style="color:${hex(c.color)}">◈</div><div class="t">${c.name}</div>` +
        `<div class="d">${c.title}</div><div style="margin:8px 0;font-size:22px;letter-spacing:4px">${glyphs}</div>` +
        `<div class="d">HP ${c.hp} · SPD ${c.speed}</div>` + (locked ? `<div class="d" style="color:#ff7b9c;margin-top:6px">🔒 ${c.unlock}</div>` : "");
      if (!locked) card.onclick = () => { this.clearOverlay(); onPick(c.id); };
      cards.appendChild(card);
    }
    o.appendChild(cards); document.body.appendChild(o); this.overlay = o;
  }

  showStart(onStart: () => void) {
    this.clearOverlay();
    const o = el("div") as HTMLDivElement; o.className = "overlay";
    o.innerHTML = `<div class="tagline">a neon-arcane descent</div><h1>ROGUE HERO&nbsp;5</h1>` +
      `<p>WASD move · mouse look (click to lock) · 1–4 cast · Space dash<br>weave 3 glyphs to resolve · reach the Conductor at the end of the road</p>`;
    const b = el("button"); b.className = "btn"; b.textContent = "ENTER THE VOIDLINE"; b.onclick = () => { this.clearOverlay(); onStart(); };
    o.appendChild(b); document.body.appendChild(o); this.overlay = o;
  }

  lookHint(show: boolean) { this.lookHintEl.style.display = show ? "block" : "none"; }

  showPause(settings: { sens: number; invertY: boolean }, save: () => void, onResume: () => void) {
    this.clearOverlay();
    const o = el("div") as HTMLDivElement; o.className = "overlay";
    o.innerHTML = `<h1>PAUSED</h1>`;
    const panel = el("div"); panel.className = "settings";
    const row1 = el("div"); row1.className = "setrow"; row1.innerHTML = `<label>Mouse sensitivity</label>`;
    const slider = el("input") as HTMLInputElement; slider.type = "range"; slider.min = "0.3"; slider.max = "2.5"; slider.step = "0.1"; slider.value = String(settings.sens);
    const sval = el("span"); sval.className = "sval"; sval.textContent = settings.sens.toFixed(1);
    slider.oninput = () => { settings.sens = parseFloat(slider.value); sval.textContent = settings.sens.toFixed(1); save(); };
    row1.appendChild(slider); row1.appendChild(sval); panel.appendChild(row1);
    const row2 = el("div"); row2.className = "setrow";
    const cb = el("input") as HTMLInputElement; cb.type = "checkbox"; cb.id = "invy"; cb.checked = settings.invertY;
    cb.onchange = () => { settings.invertY = cb.checked; save(); };
    const lab = el("label"); lab.setAttribute("for", "invy"); lab.textContent = "Invert mouse Y";
    row2.appendChild(cb); row2.appendChild(lab); panel.appendChild(row2);
    o.appendChild(panel);
    const b = el("button"); b.className = "btn"; b.textContent = "RESUME"; b.onclick = () => { this.clearOverlay(); onResume(); };
    o.appendChild(b); document.body.appendChild(o); this.overlay = o;
  }

  clearOverlay() { if (this.overlay) { this.overlay.remove(); this.overlay = null; } }
}

// tiny DOM helpers
function el(tag: string) { return document.createElement(tag); }
function panel(id: string) { const d = el("div"); d.className = "panel"; d.id = id; return d; }
function q(sel: string) { return document.querySelector(sel) as HTMLElement; }
