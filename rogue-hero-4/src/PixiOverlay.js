const BIOME_STYLE = {
  pollen: { drift: 0.24, speed: 7, spin: 0.16, shape: 'soft', alpha: 0.16 },
  snow: { drift: 0.12, speed: 12, spin: 0.04, shape: 'diamond', alpha: 0.14 },
  ash: { drift: 0.28, speed: 16, spin: 0.32, shape: 'soft', alpha: 0.13 },
  bubbles: { drift: 0.18, speed: -10, spin: 0.06, shape: 'ring', alpha: 0.13 },
  motes: { drift: 0.42, speed: 6, spin: 0.5, shape: 'diamond', alpha: 0.18 },
  steam: { drift: 0.14, speed: -14, spin: 0.09, shape: 'soft', alpha: 0.11 },
};

export class PixiOverlay {
  constructor({ root, width, height }) {
    this.enabled = false;
    this.width = width;
    this.height = height;
    this.time = 0;
    this._scanlineSprite = null;
    this._vignetteSprite = null;
    this._particles = [];
    this._pulses = [];
    this._lastThemeKey = '';

    const PIXI = globalThis.PIXI;
    if (!PIXI || !PIXI.Application) return;

    try {
      this.PIXI = PIXI;
      this.app = new PIXI.Application({
        width,
        height,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(globalThis.devicePixelRatio || 1, 2),
      });

      const view = this.app.view;
      view.id = 'pixi-overlay';
      view.setAttribute('aria-hidden', 'true');
      root.appendChild(view);

      this.ambientLayer = new PIXI.Container();
      this.ribbonLayer = new PIXI.Graphics();
      this.pulseLayer = new PIXI.Graphics();
      this.overlayLayer = new PIXI.Container();
      this.caLayer = new PIXI.Graphics();
      this.app.stage.addChild(this.ambientLayer, this.ribbonLayer, this.pulseLayer, this.overlayLayer, this.caLayer);
      this.app.ticker.maxFPS = 24;

      this._textures = this._buildTextures();
      this.enabled = true;
      this.resize(width, height);
      this._seedParticles(true);
      this.app.ticker.add(() => this._tick(this.app.ticker.deltaMS / 1000));
    } catch (err) {
      console.warn('[PixiOverlay] PixiJS overlay disabled:', err);
    }
  }

  resize(width, height) {
    if (!this.enabled) return;
    this.width = width;
    this.height = height;
    this.app.renderer.resize(width, height);
    this._rebuildScanlines();
    this._rebuildVignette();
    this._seedParticles(false);
  }

  flashImpact(color) {
    if (!this.enabled) return;
    const theme = this._theme();
    this._pulses.push({
      x: this.width * 0.5,
      y: this.height * 0.5,
      age: 0,
      life: 0.42,
      color: this._toNumber(color || theme.accent),
    });
  }

  drawScanlines() {
    if (!this.enabled || !this._scanlineSprite) return false;
    this._scanlineSprite.visible = true;
    return true;
  }

  drawVignette() {
    if (!this.enabled || !this._vignetteSprite) return false;
    this._vignetteSprite.visible = true;
    return true;
  }

  drawCAFlash(progress) {
    if (!this.enabled) return false;
    const p = Math.max(0, Math.min(1, progress || 0));
    this.caLayer.clear();
    if (p <= 0) return true;

    const theme = this._theme();
    const alpha = p * 0.26;
      const sideW = Math.max(44, this.width * 0.12);
    this.caLayer.blendMode = this.PIXI.BLEND_MODES.ADD;
    this.caLayer.beginFill(0xff1f55, alpha);
    this.caLayer.drawRect(0, 0, sideW, this.height);
    this.caLayer.endFill();
    this.caLayer.beginFill(0x2cc8ff, alpha);
    this.caLayer.drawRect(this.width - sideW, 0, sideW, this.height);
    this.caLayer.endFill();
    this.caLayer.lineStyle(2, this._toNumber(theme.accent), p * 0.35);
    this.caLayer.drawRoundedRect(18, 18, Math.max(0, this.width - 36), Math.max(0, this.height - 36), 18);
    return true;
  }

  clearCAFlash() {
    if (this.enabled) this.caLayer.clear();
  }

  _tick(dt) {
    if (!this.enabled) return;
    this.time += Math.min(dt, 0.05);

    const state = globalThis._rh4GameState || '';
    const inCombat = state === 'playing' || state === 'prep';
    this.ambientLayer.visible = !inCombat;
    this.ribbonLayer.visible = !inCombat;
    if (inCombat) {
      this._drawPulses(dt);
      return;
    }

    const theme = this._theme();
    const key = `${theme.kind}|${theme.accent}|${theme.ambient}`;
    if (key !== this._lastThemeKey) {
      this._lastThemeKey = key;
      this._seedParticles(true);
    }

    this._updateParticles(dt, theme);
    this._drawRibbons(theme);
    this._drawPulses(dt);
  }

  _updateParticles(dt, theme) {
    const style = BIOME_STYLE[theme.kind] || BIOME_STYLE.pollen;
    const accent = this._toNumber(theme.ambient || theme.accent);
    const alt = this._toNumber(theme.accent);

    for (let i = 0; i < this._particles.length; i++) {
      const p = this._particles[i];
      p.x += (Math.sin(this.time * 0.8 + p.phase) * style.drift * 32 + p.vx) * dt;
      p.y += (style.speed + p.vy) * dt;
      p.rotation += style.spin * dt * p.spinDir;

      if (p.y < -30 || p.y > this.height + 30 || p.x < -40 || p.x > this.width + 40) {
        this._resetParticle(p, theme, true);
      }

      p.sprite.x = p.x;
      p.sprite.y = p.y;
      p.sprite.rotation = p.rotation;
      p.sprite.alpha = style.alpha * (0.55 + Math.sin(this.time * p.twinkle + p.phase) * 0.22 + 0.22);
      p.sprite.tint = i % 3 === 0 ? alt : accent;
    }
  }

  _drawRibbons(theme) {
    const g = this.ribbonLayer;
    const accent = this._toNumber(theme.accent);
    const ambient = this._toNumber(theme.ambient || theme.accent);
    g.clear();
    g.blendMode = this.PIXI.BLEND_MODES.ADD;

    for (let band = 0; band < 3; band++) {
      const yBase = this.height * (0.22 + band * 0.24);
      const amp = 12 + band * 7;
      const phase = this.time * (0.42 + band * 0.08) + band * 1.7;
      g.lineStyle(0.8 + band * 0.45, band % 2 ? ambient : accent, 0.025 + band * 0.012);
      g.moveTo(-20, yBase + Math.sin(phase) * amp);
      for (let x = 0; x <= this.width + 40; x += 90) {
        const y = yBase + Math.sin(phase + x * 0.011) * amp + Math.cos(phase * 0.7 + x * 0.006) * amp * 0.5;
        g.lineTo(x, y);
      }
    }
  }

  _drawPulses(dt) {
    const g = this.pulseLayer;
    g.clear();
    g.blendMode = this.PIXI.BLEND_MODES.ADD;

    for (let i = this._pulses.length - 1; i >= 0; i--) {
      const p = this._pulses[i];
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        this._pulses.splice(i, 1);
        continue;
      }
      const alpha = (1 - t) * 0.38;
      const r = 120 + t * Math.max(this.width, this.height) * 0.42;
      g.lineStyle(3 * (1 - t) + 0.5, p.color, alpha);
      g.drawCircle(p.x, p.y, r);
      g.lineStyle(1, 0xffffff, alpha * 0.45);
      g.drawCircle(p.x, p.y, r * 0.72);
    }
  }

  _seedParticles(resetExisting) {
    if (!this.enabled || !this._textures) return;
    const target = Math.max(18, Math.min(48, Math.round((this.width * this.height) / 38000)));
    const theme = this._theme();

    while (this._particles.length < target) {
      const sprite = new this.PIXI.Sprite(this._textures.soft);
      sprite.anchor.set(0.5);
      sprite.blendMode = this.PIXI.BLEND_MODES.ADD;
      this.ambientLayer.addChild(sprite);
      const p = { sprite };
      this._particles.push(p);
      this._resetParticle(p, theme, false);
    }

    while (this._particles.length > target) {
      const p = this._particles.pop();
      this.ambientLayer.removeChild(p.sprite);
      p.sprite.destroy();
    }

    if (resetExisting) {
      for (const p of this._particles) this._resetParticle(p, theme, false);
    }
  }

  _resetParticle(p, theme, edgeOnly) {
    const style = BIOME_STYLE[theme.kind] || BIOME_STYLE.pollen;
    p.x = edgeOnly ? Math.random() * this.width : Math.random() * this.width;
    p.y = edgeOnly
      ? (style.speed >= 0 ? -20 - Math.random() * 40 : this.height + 20 + Math.random() * 40)
      : Math.random() * this.height;
    p.vx = (Math.random() - 0.5) * 18;
    p.vy = (Math.random() - 0.5) * 14;
    p.phase = Math.random() * Math.PI * 2;
    p.twinkle = 1.5 + Math.random() * 2.8;
    p.spinDir = Math.random() < 0.5 ? -1 : 1;
    p.rotation = Math.random() * Math.PI * 2;

    const texture = this._textures[style.shape] || this._textures.soft;
    p.sprite.texture = texture;
    p.sprite.scale.set(0.16 + Math.random() * 0.42);
    p.sprite.tint = this._toNumber(theme.ambient || theme.accent);
  }

  _replaceSprite(current, texture) {
    if (current) {
      this.overlayLayer.removeChild(current);
      current.destroy({ children: true, texture: true, baseTexture: true });
    }
    const sprite = new this.PIXI.Sprite(texture);
    sprite.width = this.width;
    sprite.height = this.height;
    sprite.eventMode = 'none';
    this.overlayLayer.addChild(sprite);
    return sprite;
  }

  _buildTextures() {
    return {
      soft: this.PIXI.Texture.from(this._circleCanvas(64, false)),
      ring: this.PIXI.Texture.from(this._circleCanvas(64, true)),
      diamond: this.PIXI.Texture.from(this._diamondCanvas(64)),
    };
  }

  _circleCanvas(size, ring) {
    const off = document.createElement('canvas');
    off.width = size;
    off.height = size;
    const ctx = off.getContext('2d');
    const c = size / 2;
    if (ring) {
      ctx.strokeStyle = 'rgba(255,255,255,0.82)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(c, c, size * 0.25, 0, Math.PI * 2);
      ctx.stroke();
      return off;
    }
    const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return off;
  }

  _diamondCanvas(size) {
    const off = document.createElement('canvas');
    off.width = size;
    off.height = size;
    const ctx = off.getContext('2d');
    const c = size / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.beginPath();
    ctx.moveTo(c, 8);
    ctx.lineTo(size - 8, c);
    ctx.lineTo(c, size - 8);
    ctx.lineTo(8, c);
    ctx.closePath();
    ctx.fill();
    return off;
  }

  _rebuildScanlines() {
    const off = document.createElement('canvas');
    off.width = this.width;
    off.height = this.height;
    const ctx = off.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.025)';
    for (let y = 1; y < this.height; y += 3) ctx.fillRect(0, y, this.width, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.006)';
    for (let y = 0; y < this.height; y += 9) ctx.fillRect(0, y, this.width, 1);
    this._scanlineSprite = this._replaceSprite(this._scanlineSprite, this.PIXI.Texture.from(off));
  }

  _rebuildVignette() {
    const off = document.createElement('canvas');
    off.width = this.width;
    off.height = this.height;
    const ctx = off.getContext('2d');
    const cx = this.width / 2;
    const cy = this.height / 2;
    const grad = ctx.createRadialGradient(cx, cy, this.height * 0.24, cx, cy, this.height * 0.86);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.72, 'rgba(0,0,0,0.08)');
    grad.addColorStop(1, 'rgba(0,0,0,0.38)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);
    this._vignetteSprite = this._replaceSprite(this._vignetteSprite, this.PIXI.Texture.from(off));
  }

  _theme() {
    const biome = globalThis._biome || globalThis.window?._biome;
    return {
      kind: biome?.ambience?.kind || 'motes',
      accent: biome?.palette?.accent || '#7df9ff',
      ambient: biome?.palette?.ambient || biome?.ambience?.color || '#b7fff4',
    };
  }

  _toNumber(hex) {
    if (typeof hex !== 'string') return 0x7df9ff;
    const clean = hex.trim().replace('#', '').slice(0, 6);
    const n = Number.parseInt(clean, 16);
    return Number.isFinite(n) ? n : 0x7df9ff;
  }
}
