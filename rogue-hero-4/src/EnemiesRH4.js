// EnemiesRH4.js — New enemy classes for Rogue Hero 4.
// All extend the base Enemy from Enemy.js and follow the same conventions:
//   - call updateSpawn / updateTimers
//   - emit ENEMY_MELEE_HIT { damage, source: this } for player damage
//   - call room.clamp() after movement
//   - never call events.on() inside updateLogic (constructor-only)
//
// main.js should import these and add to its Enemy roster spawn pool.

import { Enemy } from './Enemy.js';
import { events } from './EventBus.js';

// ── TETHER WITCH ────────────────────────────────────────────────────
// Anti-spread support. If party members in window._players are > 300 px
// apart, ticks 1 dmg to the spread pair. In solo: passive low-threat.
export class TetherWitch extends Enemy {
  constructor(x, y) {
    super(x, y, 16, 70, 'tether_witch');
    this.tetherDist = 300;
    this.tickTimer = 0;
  }
  updateLogic(dt, player, tempo, roomMap) {
    if (!this.alive) return;
    if (this.updateSpawn(dt)) return;
    this.updateTimers(dt, player);
    if (this.staggerTimer > 0) { this.staggerTimer -= dt; return; }

    const dx = player.x - this.x, dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (this.state === 'idle' && dist < 700 && !player._phantomInkActive) this.state = 'chase';
    if (this.state === 'chase' && dist > 250) {
      const spd = 110 * this.spdMult();
      this.x += (dx / dist) * spd * dt;
      this.y += (dy / dist) * spd * dt;
    }

    this.tickTimer -= dt;
    if (this.tickTimer <= 0) {
      this.tickTimer = 0.6;
      const _all = (window._players && window._players.list) || [player];
      const _standing = _all.filter(p => p && p.alive && !p.downed);
      const ps = _standing.length ? _standing : _all; // fall back if everyone is downed
      if (ps.length >= 2) {
        for (let i = 0; i < ps.length; i++) {
          for (let j = i + 1; j < ps.length; j++) {
            const a = ps[i], b = ps[j];
            if (!a.alive || !b.alive) continue;
            const ddx = a.x - b.x, ddy = a.y - b.y;
            if (ddx * ddx + ddy * ddy > this.tetherDist * this.tetherDist) {
              events.emit('ENEMY_MELEE_HIT', { damage: 1, source: this, target: a });
              events.emit('ENEMY_MELEE_HIT', { damage: 1, source: this, target: b });
            }
          }
        }
      }
    }
    if (roomMap) { const c = roomMap.clamp(this.x, this.y, this.r); this.x = c.x; this.y = c.y; }
  }
  drawBody(ctx, _label, _color, now) { super.drawBody(ctx, 'TETHER', '#cc44ee', now); }
}

// ── MIRE TOAD ──────────────────────────────────────────────────────
// Spits puddles that slow + apply Wet (Frost cards do +50% to Wet).
export class MireToad extends Enemy {
  constructor(x, y) {
    super(x, y, 18, 65, 'mire_toad');
    this.spitCooldown = 2.5;
    this.telegraphDuration = 0.7;
    this._spitTarget = null;
  }
  updateLogic(dt, player, tempo, roomMap) {
    if (!this.alive) return;
    if (this.updateSpawn(dt)) return;
    this.updateTimers(dt, player);
    if (this.staggerTimer > 0) { this.staggerTimer -= dt; return; }
    this.spitCooldown -= dt;

    const dx = player.x - this.x, dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (this.state === 'idle' && dist < 600 && !player._phantomInkActive) this.state = 'chase';

    if (this.state === 'chase' && dist > 220) {
      const spd = 90 * this.spdMult();
      this.x += (dx / dist) * spd * dt;
      this.y += (dy / dist) * spd * dt;
    } else if (this.state === 'chase' && this.spitCooldown <= 0) {
      this.state = 'telegraph';
      this.telegraphTimer = this.telegraphDuration;
      this._spitTarget = { x: player.x, y: player.y };
    }

    if (this.state === 'telegraph') {
      this.telegraphTimer -= dt;
      if (this.telegraphTimer <= 0 && this._spitTarget) {
        events.emit('SPAWN_PUDDLE', {
          x: this._spitTarget.x, y: this._spitTarget.y,
          r: 70, slow: 0.4, wet: 3, life: 4
        });
        this.spitCooldown = 3.0;
        this.state = 'chase';
      }
    }
    if (roomMap) { const c = roomMap.clamp(this.x, this.y, this.r); this.x = c.x; this.y = c.y; }
  }
  drawBody(ctx, _l, _c, now) { super.drawBody(ctx, 'TOAD', '#558844', now); }
}

// ── BLOOMSPAWN ──────────────────────────────────────────────────────
// Reactive splitter. Buds a smaller copy every 5s up to maxBuds.
export class Bloomspawn extends Enemy {
  constructor(x, y) {
    super(x, y, 14, 50, 'bloomspawn');
    this.budTimer = 5.0;
    this.maxBuds = 4;
  }
  updateLogic(dt, player, tempo, roomMap) {
    if (!this.alive) return;
    if (this.updateSpawn(dt)) return;
    this.updateTimers(dt, player);
    if (this.staggerTimer > 0) { this.staggerTimer -= dt; return; }
    this.budTimer -= dt;
    if (this.budTimer <= 0 && this.maxBuds > 0) {
      this.maxBuds--;
      this.budTimer = 5.0;
      events.emit('SPAWN_BLOOMSPAWN', {
        x: this.x + (Math.random() - 0.5) * 40,
        y: this.y + (Math.random() - 0.5) * 40,
      });
    }
    const dx = player.x - this.x, dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (this.state === 'idle' && dist < 600 && !player._phantomInkActive) this.state = 'chase';
    if (this.state === 'chase' && dist > 60) {
      const spd = 120 * this.spdMult();
      this.x += (dx / dist) * spd * dt;
      this.y += (dy / dist) * spd * dt;
    }
    if (roomMap) { const c = roomMap.clamp(this.x, this.y, this.r); this.x = c.x; this.y = c.y; }
  }
  drawBody(ctx, _l, _c, now) { super.drawBody(ctx, 'BLOOM', '#aacc44', now); }
}

// ── IRON CHOIR ──────────────────────────────────────────────────────
// Buff bot that heals nearby allies; silence-vulnerable.
export class IronChoir extends Enemy {
  constructor(x, y) {
    super(x, y, 16, 80, 'iron_choir');
    this.singTimer = 0;
    this.songRadius = 130;
  }
  updateLogic(dt, player, tempo, roomMap) {
    if (!this.alive) return;
    if (this.updateSpawn(dt)) return;
    this.updateTimers(dt, player);
    if (this.staggerTimer > 0) { this.staggerTimer -= dt; return; }
    this.singTimer += dt;
    if (this.singTimer > 0.5) {
      this.singTimer = 0;
      events.emit('CHOIR_HEAL', { x: this.x, y: this.y, r: this.songRadius, hp: 1 });
    }
    const dx = player.x - this.x, dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (this.state === 'idle' && dist < 800) this.state = 'chase';
    if (this.state === 'chase' && dist > 280) {
      const spd = 70 * this.spdMult();
      this.x += (dx / dist) * spd * dt;
      this.y += (dy / dist) * spd * dt;
    }
    if (roomMap) { const c = roomMap.clamp(this.x, this.y, this.r); this.x = c.x; this.y = c.y; }
  }
  drawBody(ctx, _l, _c, now) {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.songRadius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,150,0.15)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    super.drawBody(ctx, 'CHOIR', '#ddcc88', now);
  }
}

// ── STATIC HOUND ───────────────────────────────────────────────────
// Lightning bruiser. Charges in a line; damages on contact.
export class StaticHound extends Enemy {
  constructor(x, y) {
    super(x, y, 14, 60, 'static_hound');
    this.chargeCooldown = 2.0;
    this.zapShotTimer = 0.55;
    this.charging = false;
    this.chargeDir = { x: 0, y: 0 };
    this.chargeTimer = 0;
  }
  updateLogic(dt, player, tempo, roomMap, allEnemies, projectiles) {
    if (!this.alive) return;
    if (this.updateSpawn(dt)) return;
    this.updateTimers(dt, player);
    if (this.staggerTimer > 0) { this.staggerTimer -= dt; return; }
    this.chargeCooldown -= dt;

    const dx = player.x - this.x, dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (this.state === 'idle' && dist < 700 && !player._phantomInkActive) this.state = 'chase';

    if (this.charging) {
      this.chargeTimer -= dt;
      this.x += this.chargeDir.x * 760 * dt;
      this.y += this.chargeDir.y * 760 * dt;
      if (this.chargeTimer <= 0) this.charging = false;
      const _all = (window._players && window._players.list) || [player];
      const _standing = _all.filter(p => p && p.alive && !p.downed);
      const ps = _standing.length ? _standing : _all; // fall back if everyone is downed
      for (const p of ps) {
        if (!p.alive) continue;
        const pdx = p.x - this.x, pdy = p.y - this.y;
        if (pdx * pdx + pdy * pdy < (p.r + this.r + 4) ** 2) {
          events.emit('ENEMY_MELEE_HIT', { damage: 2, source: this, target: p });
          this.charging = false;
        }
      }
    } else if (this.state === 'chase' && this.chargeCooldown <= 0 && dist > 130 && dist < 360) {
      this.charging = true;
      this.chargeTimer = 0.42;
      this.chargeDir = { x: dx / dist, y: dy / dist };
      this.chargeCooldown = 1.7;
    } else if (this.state === 'chase' && dist > 60) {
      const spd = 245 * this.spdMult();
      this.x += (dx / dist) * spd * dt;
      this.y += (dy / dist) * spd * dt;
    }
    if (!this.charging && this.state === 'chase' && projectiles && dist > 210 && dist < 660) {
      this.zapShotTimer -= dt;
      if (this.zapShotTimer <= 0) {
        this.zapShotTimer = 0.78;
        projectiles.spawn(this.x, this.y, dx / dist, dy / dist, 560, 1, '#88ccff', 'static_hound', false, 1.35);
      }
    }
    if (roomMap) { const c = roomMap.clamp(this.x, this.y, this.r); this.x = c.x; this.y = c.y; }
  }
  drawBody(ctx, _l, _c, now) { super.drawBody(ctx, this.charging ? 'ZAP!' : 'HOUND', '#88ccff', now); }
}

// ── BOSS: HOLLOW KING ──────────────────────────────────────────────
// 3 phases: chase / spawn clones / "controls invert" (8 s window)
// RH4 fast skirmisher: teleports sideways, then slices through the player lane.
export class RiftSkater extends Enemy {
  constructor(x, y) {
    super(x, y, 13, 72, 'rift_skater');
    this.attackCooldown = 1.0;
    this.sliceTimer = 0;
    this.sliceDir = { x: 1, y: 0 };
    this.strafePhase = (x * 0.017 + y * 0.011) % (Math.PI * 2);
    this.telegraphDuration = 0.38;
  }

  updateLogic(dt, player, tempo, roomMap) {
    if (!this.alive) return;
    if (this.updateSpawn(dt)) return;
    this.updateTimers(dt, player);
    if (this.staggerTimer > 0) { this.staggerTimer -= dt; return; }

    const dx = player.x - this.x, dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    if (this.state === 'idle' && dist < 820 && !player._phantomInkActive) this.state = 'chase';

    if (this.sliceTimer > 0) {
      this.sliceTimer -= dt;
      this.x += this.sliceDir.x * 840 * dt;
      this.y += this.sliceDir.y * 840 * dt;
      const pdx = player.x - this.x, pdy = player.y - this.y;
      if (!player.dodging && pdx * pdx + pdy * pdy < (player.r + this.r + 8) ** 2) {
        events.emit('ENEMY_MELEE_HIT', { damage: 2, source: this, target: player });
        this.sliceTimer = 0;
      }
    } else if (this.state === 'chase') {
      this.attackCooldown -= dt;
      const strafeX = -dy / dist;
      const strafeY = dx / dist;
      this.strafePhase += dt * 3.5;
      const side = Math.sin(this.strafePhase) > 0 ? 1 : -1;
      if (dist > 170) {
        this.x += (dx / dist) * 335 * this.spdMult() * dt;
        this.y += (dy / dist) * 335 * this.spdMult() * dt;
      }
      this.x += strafeX * side * 180 * this.spdMult() * dt;
      this.y += strafeY * side * 180 * this.spdMult() * dt;

      if (this.attackCooldown <= 0 && dist < 360) {
        this.sliceDir = { x: dx / dist, y: dy / dist };
        this.sliceTimer = 0.24;
        this.attackCooldown = 0.82;
        events.emit('SCREEN_SHAKE', { duration: 0.03, intensity: 0.06 });
      }
    }

    if (roomMap) { const c = roomMap.clamp(this.x, this.y, this.r); this.x = c.x; this.y = c.y; }
  }

  drawTelegraph(ctx) {
    if (this.sliceTimer > 0) {
      ctx.strokeStyle = 'rgba(120,255,255,0.55)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(this.x - this.sliceDir.x * 80, this.y - this.sliceDir.y * 80);
      ctx.lineTo(this.x + this.sliceDir.x * 160, this.y + this.sliceDir.y * 160);
      ctx.stroke();
    }
  }

  drawBody(ctx, _l, _c, now) { super.drawBody(ctx, 'RIFT', '#66f6ff', now); }
}

// RH4 ranged pressure: fires rotating prism volleys that force constant movement.
export class PrismSentry extends Enemy {
  constructor(x, y) {
    super(x, y, 17, 90, 'prism_sentry');
    this.fireTimer = 1.1;
    this.angle = (x * 0.01 + y * 0.013) % (Math.PI * 2);
  }

  updateLogic(dt, player, tempo, roomMap, allEnemies, projectiles) {
    if (!this.alive) return;
    if (this.updateSpawn(dt)) return;
    this.updateTimers(dt, player);
    if (this.staggerTimer > 0) { this.staggerTimer -= dt; return; }

    const dx = player.x - this.x, dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    if (this.state === 'idle' && dist < 900) this.state = 'chase';
    if (this.state === 'chase') {
      if (dist > 430) {
        this.x += (dx / dist) * 150 * this.spdMult() * dt;
        this.y += (dy / dist) * 150 * this.spdMult() * dt;
      } else if (dist < 240) {
        this.x -= (dx / dist) * 190 * this.spdMult() * dt;
        this.y -= (dy / dist) * 190 * this.spdMult() * dt;
      }

      this.fireTimer -= dt;
      this.angle += dt * 1.6;
      if (this.fireTimer <= 0 && projectiles) {
        this.fireTimer = 0.85;
        const base = Math.atan2(dy, dx);
        for (let i = -1; i <= 1; i++) {
          const a = base + i * 0.24 + Math.sin(this.angle) * 0.12;
          projectiles.spawn(this.x, this.y, Math.cos(a), Math.sin(a), 430, 1, '#ff77ff', 'prism_sentry', false, 1.8);
        }
      }
    }

    if (roomMap) { const c = roomMap.clamp(this.x, this.y, this.r); this.x = c.x; this.y = c.y; }
  }

  drawBody(ctx, _l, _c, now) { super.drawBody(ctx, 'PRISM', '#ff77ff', now); }
}

// RH4 tempo predator: dives when the player is hot and punishes static play.
export class TempoLeech extends Enemy {
  constructor(x, y) {
    super(x, y, 15, 86, 'tempo_leech');
    this.diveCooldown = 1.8;
    this.leechBoltTimer = 0.9;
    this.diveTimer = 0;
    this.diveDir = { x: 0, y: 0 };
  }

  updateLogic(dt, player, tempo, roomMap, allEnemies, projectiles) {
    if (!this.alive) return;
    if (this.updateSpawn(dt)) return;
    this.updateTimers(dt, player);
    if (this.staggerTimer > 0) { this.staggerTimer -= dt; return; }

    const dx = player.x - this.x, dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    if (this.state === 'idle' && dist < 820) this.state = 'chase';

    if (this.diveTimer > 0) {
      this.diveTimer -= dt;
      this.x += this.diveDir.x * 780 * dt;
      this.y += this.diveDir.y * 780 * dt;
    } else if (this.state === 'chase') {
      this.diveCooldown -= dt;
      const hotMult = tempo.value >= 70 ? 1.35 : 1.0;
      this.x += (dx / dist) * 245 * hotMult * this.spdMult() * dt;
      this.y += (dy / dist) * 245 * hotMult * this.spdMult() * dt;
      if (this.diveCooldown <= 0 && dist < 320) {
        this.diveDir = { x: dx / dist, y: dy / dist };
        this.diveTimer = 0.30;
        this.diveCooldown = tempo.value >= 70 ? 0.82 : 1.15;
      }
      if (projectiles && dist > 190 && dist < 620) {
        this.leechBoltTimer -= dt;
        if (this.leechBoltTimer <= 0) {
          this.leechBoltTimer = tempo.value >= 70 ? 0.48 : 0.76;
          projectiles.spawn(this.x, this.y, dx / dist, dy / dist, 500, 1, '#ff4488', 'tempo_leech', false, 1.45);
        }
      }
    }

    const pdx = player.x - this.x, pdy = player.y - this.y;
    if (!player.dodging && pdx * pdx + pdy * pdy < (player.r + this.r + 4) ** 2) {
      events.emit('ENEMY_MELEE_HIT', { damage: 1, source: this, target: player });
      if (tempo && typeof tempo._add === 'function') tempo._add(-8);
      this.diveTimer = 0;
    }
    if (roomMap) { const c = roomMap.clamp(this.x, this.y, this.r); this.x = c.x; this.y = c.y; }
  }

  drawBody(ctx, _l, _c, now) { super.drawBody(ctx, 'LEECH', '#ff4488', now); }
}

// RH4 assassin: constant gap-close pressure with a short recoil after contact.
export class SurgeMantis extends Enemy {
  constructor(x, y) {
    super(x, y, 13, 64, 'surge_mantis');
    this.pounceCooldown = 0.65;
    this.pounceTimer = 0;
    this.pounceDir = { x: 1, y: 0 };
    this.telegraphDuration = 0.22;
  }

  updateLogic(dt, player, tempo, roomMap) {
    if (!this.alive) return;
    if (this.updateSpawn(dt)) return;
    this.updateTimers(dt, player);
    if (this.staggerTimer > 0) { this.staggerTimer -= dt; return; }

    const dx = player.x - this.x, dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    if (this.state === 'idle' && dist < 900 && !player._phantomInkActive) this.state = 'chase';

    if (this.pounceTimer > 0) {
      this.pounceTimer -= dt;
      this.x += this.pounceDir.x * 980 * dt;
      this.y += this.pounceDir.y * 980 * dt;
    } else if (this.state === 'chase') {
      this.pounceCooldown -= dt;
      const orbitX = -dy / dist;
      const orbitY = dx / dist;
      this.x += (dx / dist) * 360 * this.spdMult() * dt;
      this.y += (dy / dist) * 360 * this.spdMult() * dt;
      this.x += orbitX * Math.sin(performance.now() * 0.018 + this.x) * 150 * this.spdMult() * dt;
      this.y += orbitY * Math.sin(performance.now() * 0.018 + this.y) * 150 * this.spdMult() * dt;
      if (this.pounceCooldown <= 0 && dist < 420) {
        this.pounceDir = { x: dx / dist, y: dy / dist };
        this.pounceTimer = 0.20;
        this.pounceCooldown = 0.55;
      }
    }

    if (!player.dodging) {
      const pdx = player.x - this.x, pdy = player.y - this.y;
      if (pdx * pdx + pdy * pdy < (player.r + this.r + 6) ** 2) {
        events.emit('ENEMY_MELEE_HIT', { damage: 2, source: this, target: player });
        this.pounceTimer = 0;
        this.x -= this.pounceDir.x * 34;
        this.y -= this.pounceDir.y * 34;
      }
    }

    if (roomMap) { const c = roomMap.clamp(this.x, this.y, this.r); this.x = c.x; this.y = c.y; }
  }

  drawBody(ctx, _l, _c, now) { super.drawBody(ctx, this.pounceTimer > 0 ? 'LUNGE' : 'MANTIS', '#39ff88', now); }
}

// RH4 gunner: strafes fast and fires short, readable bursts.
export class PulseGunner extends Enemy {
  constructor(x, y) {
    super(x, y, 15, 74, 'pulse_gunner');
    this.fireTimer = 0.55;
    this.strafePhase = (x + y) * 0.01;
  }

  updateLogic(dt, player, tempo, roomMap, allEnemies, projectiles) {
    if (!this.alive) return;
    if (this.updateSpawn(dt)) return;
    this.updateTimers(dt, player);
    if (this.staggerTimer > 0) { this.staggerTimer -= dt; return; }

    const dx = player.x - this.x, dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    if (this.state === 'idle' && dist < 960) this.state = 'chase';
    if (this.state === 'chase') {
      const sideX = -dy / dist;
      const sideY = dx / dist;
      this.strafePhase += dt * 5.8;
      if (dist > 390) {
        this.x += (dx / dist) * 255 * this.spdMult() * dt;
        this.y += (dy / dist) * 255 * this.spdMult() * dt;
      } else if (dist < 250) {
        this.x -= (dx / dist) * 300 * this.spdMult() * dt;
        this.y -= (dy / dist) * 300 * this.spdMult() * dt;
      }
      this.x += sideX * Math.sin(this.strafePhase) * 260 * this.spdMult() * dt;
      this.y += sideY * Math.sin(this.strafePhase) * 260 * this.spdMult() * dt;

      this.fireTimer -= dt;
      if (this.fireTimer <= 0 && projectiles) {
        this.fireTimer = 0.58;
        const base = Math.atan2(dy, dx);
        for (let i = -1; i <= 1; i++) {
          const a = base + i * 0.16;
          projectiles.spawn(this.x, this.y, Math.cos(a), Math.sin(a), 430, 1, '#38f8ff', 'pulse_gunner', false, 1.8);
        }
      }
    }

    if (roomMap) { const c = roomMap.clamp(this.x, this.y, this.r); this.x = c.x; this.y = c.y; }
  }

  drawBody(ctx, _l, _c, now) { super.drawBody(ctx, 'PULSE', '#38f8ff', now); }
}

// RH4 turret: anchors space with rotating all-direction bullet rings.
export class RadialTurret extends Enemy {
  constructor(x, y) {
    super(x, y, 18, 92, 'radial_turret');
    this.fireTimer = 0.45;
    this.spin = (x * 0.009 + y * 0.013) % (Math.PI * 2);
  }

  updateLogic(dt, player, tempo, roomMap, allEnemies, projectiles) {
    if (!this.alive) return;
    if (this.updateSpawn(dt)) return;
    this.updateTimers(dt, player);
    if (this.staggerTimer > 0) { this.staggerTimer -= dt; return; }

    const dx = player.x - this.x, dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    if (this.state === 'idle' && dist < 980) this.state = 'chase';
    if (this.state === 'chase' && dist > 520) {
      this.x += (dx / dist) * 70 * this.spdMult() * dt;
      this.y += (dy / dist) * 70 * this.spdMult() * dt;
    }
    this.spin += dt * 2.8;
    this.fireTimer -= dt;
    if (this.fireTimer <= 0 && projectiles) {
      this.fireTimer = 1.05;
      const shots = 8;
      for (let i = 0; i < shots; i++) {
        const a = this.spin + (Math.PI * 2 * i) / shots;
        projectiles.spawn(this.x, this.y, Math.cos(a), Math.sin(a), 315, 1, '#ffdd55', 'radial_turret', false, 2.15);
      }
    }
    if (roomMap) { const c = roomMap.clamp(this.x, this.y, this.r); this.x = c.x; this.y = c.y; }
  }

  drawBody(ctx, _l, _c, now) { super.drawBody(ctx, 'TURRET', '#ffdd55', now); }
}

// RH4 heavy turret: alternating 12-shot rings and aimed cross bursts.
export class SpiralPylon extends Enemy {
  constructor(x, y) {
    super(x, y, 20, 116, 'spiral_pylon');
    this.fireTimer = 0.8;
    this.spin = (x + y) * 0.01;
  }

  updateLogic(dt, player, tempo, roomMap, allEnemies, projectiles) {
    if (!this.alive) return;
    if (this.updateSpawn(dt)) return;
    this.updateTimers(dt, player);
    if (this.staggerTimer > 0) { this.staggerTimer -= dt; return; }
    const dx = player.x - this.x, dy = player.y - this.y;
    const base = Math.atan2(dy, dx);
    this.spin += dt * 3.9;
    this.fireTimer -= dt;
    if (this.fireTimer <= 0 && projectiles) {
      this.fireTimer = 1.25;
      for (let i = 0; i < 12; i++) {
        const a = this.spin + (Math.PI * 2 * i) / 12;
        projectiles.spawn(this.x, this.y, Math.cos(a), Math.sin(a), 285, 1, '#ff6b35', 'spiral_pylon', false, 2.35);
      }
      for (let i = -1; i <= 1; i++) {
        const a = base + i * 0.18;
        projectiles.spawn(this.x, this.y, Math.cos(a), Math.sin(a), 430, 2, '#ffffff', 'spiral_pylon', false, 1.8);
      }
    }
    if (roomMap) { const c = roomMap.clamp(this.x, this.y, this.r); this.x = c.x; this.y = c.y; }
  }

  drawBody(ctx, _l, _c, now) { super.drawBody(ctx, 'PYLON', '#ff6b35', now); }
}

// RH4 pack leader: sprints at the player and overclocks nearby enemies.
export class OverdriveImp extends Enemy {
  constructor(x, y) {
    super(x, y, 12, 52, 'overdrive_imp');
    this.pulseTimer = 0.4;
    this.shotTimer = 0.75;
    this.auraRadius = 150;
  }

  updateLogic(dt, player, tempo, roomMap, allEnemies, projectiles) {
    if (!this.alive) return;
    if (this.updateSpawn(dt)) return;
    this.updateTimers(dt, player);
    if (this.staggerTimer > 0) { this.staggerTimer -= dt; return; }

    const dx = player.x - this.x, dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    if (this.state === 'idle' && dist < 920 && !player._phantomInkActive) this.state = 'chase';
    if (this.state === 'chase' && dist > 34) {
      const zig = Math.sin(performance.now() * 0.018 + this.x * 0.03);
      const sideX = -dy / dist;
      const sideY = dx / dist;
      this.x += ((dx / dist) * 420 + sideX * zig * 180) * this.spdMult() * dt;
      this.y += ((dy / dist) * 420 + sideY * zig * 180) * this.spdMult() * dt;
    }

    this.pulseTimer -= dt;
    if (this.pulseTimer <= 0) {
      this.pulseTimer = 0.35;
      if (Array.isArray(allEnemies)) {
        for (const e of allEnemies) {
          if (!e || e === this || !e.alive || e.isBoss) continue;
          const ex = e.x - this.x, ey = e.y - this.y;
          if (ex * ex + ey * ey < this.auraRadius * this.auraRadius) {
            if (!e._overdriveBaseSpd) e._overdriveBaseSpd = e.difficultySpdMult || 1;
            e.difficultySpdMult = Math.max(e.difficultySpdMult || 1, e._overdriveBaseSpd * 1.18);
          }
        }
      }
    }
    if (this.state === 'chase' && projectiles) {
      this.shotTimer -= dt;
      if (this.shotTimer <= 0) {
        this.shotTimer = 0.72;
        for (let i = 0; i < 4; i++) {
          const a = Math.atan2(dy, dx) + (i - 1.5) * 0.28;
          projectiles.spawn(this.x, this.y, Math.cos(a), Math.sin(a), 455, 1, '#ff4f6d', 'overdrive_imp', false, 1.3);
        }
      }
    }

    if (!player.dodging) {
      const pdx = player.x - this.x, pdy = player.y - this.y;
      if (pdx * pdx + pdy * pdy < (player.r + this.r + 3) ** 2) {
        events.emit('ENEMY_MELEE_HIT', { damage: 1, source: this, target: player });
      }
    }

    if (roomMap) { const c = roomMap.clamp(this.x, this.y, this.r); this.x = c.x; this.y = c.y; }
  }

  drawBody(ctx, _l, _c, now) {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.auraRadius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,80,80,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
    super.drawBody(ctx, 'IMP', '#ff4f6d', now);
  }
}

export class BossHollowKing extends Enemy {
  constructor(x, y) {
    // F4 boss — bumped 350 → 800 HP. Old value was tuned before relics +
    // mastery cards stacked up; F4 was clearing in 1–2 dumps.
    super(x, y, 28, 800, 'boss_hollow_king');
    this.phase = 1;
    this.cloneSpawnTimer = 3.0;
    this.boltTimer = 0.7;
  }
  updateLogic(dt, player, tempo, roomMap, allEnemies, projectiles) {
    if (!this.alive) return;
    if (this.updateSpawn(dt)) return;
    this.updateTimers(dt, player);
    if (this.staggerTimer > 0) { this.staggerTimer -= dt; return; }

    const hpPct = this.hp / this.maxHp;
    const newPhase = hpPct > 0.66 ? 1 : (hpPct > 0.33 ? 2 : 3);
    if (newPhase !== this.phase) {
      this.phase = newPhase;
      events.emit('BOSS_PHASE', { boss: this, phase: this.phase });
      if (this.phase === 3) events.emit('CONTROLS_INVERT', { duration: 8 });
    }

    const dx = player.x - this.x, dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 60) {
      const spd = (this.phase === 3 ? 560 : (this.phase === 2 ? 430 : 360)) * this.spdMult();
      this.x += (dx / dist) * spd * dt;
      this.y += (dy / dist) * spd * dt;
    } else if (this.attackCooldown <= 0) {
      // Tighter melee cadence + heavier hits.
      events.emit('ENEMY_MELEE_HIT', { damage: this.phase >= 3 ? 4 : 3, source: this });
      this.attackCooldown = this.phase >= 3 ? 0.26 : 0.38;
    }
    this.boltTimer -= dt;
    if (this.boltTimer <= 0 && projectiles) {
      this.boltTimer = this.phase >= 3 ? 0.34 : 0.48;
      const base = Math.atan2(dy, dx);
      const shots = this.phase >= 2 ? 3 : 2;
      for (let i = 0; i < shots; i++) {
        const a = base + (i - (shots - 1) / 2) * 0.22;
        projectiles.spawn(this.x, this.y, Math.cos(a), Math.sin(a), 560, 2, '#aa33ff', 'boss_hollow_king', false, 1.5);
      }
    }

    if (this.phase >= 2) {
      this.cloneSpawnTimer -= dt;
      if (this.cloneSpawnTimer <= 0) {
        // Faster clone summons in P3 keep pressure up between melee ranges.
        this.cloneSpawnTimer = this.phase >= 3 ? 1.55 : 2.15;
        events.emit('SPAWN_HOLLOW_CLONE', {
          x: this.x + (Math.random() - 0.5) * 200,
          y: this.y + (Math.random() - 0.5) * 200,
        });
      }
    }
    if (roomMap) { const c = roomMap.clamp(this.x, this.y, this.r); this.x = c.x; this.y = c.y; }
  }
  drawBody(ctx, _l, _c, now) { super.drawBody(ctx, 'HOLLOW KING', '#660066', now); }
}

// ── BOSS: VAULT ENGINE ─────────────────────────────────────────────
// 4 rotating weak points. Players must hit them in tempo with each
// other (rewards Group Tempo Resonance).
export class BossVaultEngine extends Enemy {
  constructor(x, y) {
    super(x, y, 36, 500, 'boss_vault_engine');
    this.weakPoints = [
      { angle: 0, hp: 1 }, { angle: Math.PI / 2, hp: 1 },
      { angle: Math.PI, hp: 1 }, { angle: 3 * Math.PI / 2, hp: 1 },
    ];
    this.cycleTimer = 0;
    this.streamTimer = 0.35;
  }
  updateLogic(dt, player, _tempo, roomMap, allEnemies, projectiles) {
    if (!this.alive) return;
    if (this.updateSpawn(dt)) return;
    this.updateTimers(dt, player);
    if (this.staggerTimer > 0) { this.staggerTimer -= dt; return; }
    this.cycleTimer += dt;
    for (const wp of this.weakPoints) wp.angle += dt * 1.25;
    // Radial shock on every 4 s cycle — SPAWN_GROUND_WAVE is directional and
    // requires a card def; emitting one without a def threw inside the
    // update loop and froze the game. Do the radial damage directly.
    this._pulseFx = Math.max(0, (this._pulseFx || 0) - dt);
    this.streamTimer -= dt;
    if (this.streamTimer <= 0 && projectiles) {
      this.streamTimer = 0.42;
      for (let i = 0; i < 4; i++) {
        const a = this.weakPoints[i].angle;
        projectiles.spawn(this.x, this.y, Math.cos(a), Math.sin(a), 430, 1, '#ffdd55', 'boss_vault_engine', false, 1.55);
      }
    }
    if (this.cycleTimer > 1.45) {
      this.cycleTimer = 0;
      this._pulseFx = 0.5;
      const PULSE_RADIUS = 220;
      const all = (window._players && window._players.list) || [player];
      for (const p of all) {
        if (!p || !p.alive) continue;
        const dx = p.x - this.x, dy = p.y - this.y;
        if (dx * dx + dy * dy < PULSE_RADIUS * PULSE_RADIUS) {
          events.emit('ENEMY_MELEE_HIT', { damage: 2, source: this, target: p });
        }
      }
      if (projectiles) {
        for (let i = 0; i < 14; i++) {
          const a = (Math.PI * 2 * i) / 14 + this.weakPoints[0].angle;
          projectiles.spawn(this.x, this.y, Math.cos(a), Math.sin(a), 390, 1, '#ffaa00', 'boss_vault_engine', false, 1.9);
        }
      }
    }
    if (roomMap) { const c = roomMap.clamp(this.x, this.y, this.r); this.x = c.x; this.y = c.y; }
  }
  drawBody(ctx, _l, _c, now) {
    super.drawBody(ctx, 'VAULT ENGINE', '#bb9933', now);
    for (const wp of this.weakPoints) {
      if (wp.hp <= 0) continue;
      const wx = this.x + Math.cos(wp.angle) * 50;
      const wy = this.y + Math.sin(wp.angle) * 50;
      ctx.beginPath();
      ctx.arc(wx, wy, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#ffaa00';
      ctx.fill();
    }
    if (this._pulseFx > 0) {
      const t = 1 - this._pulseFx / 0.5;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 40 + t * 180, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,170,0,${(1 - t) * 0.8})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
}

// ── BOSS: AURORA (Voidline) ────────────────────────────────────────
// Telegraphs gravity wells centered on random alive players.
export class BossAurora extends Enemy {
  constructor(x, y) {
    // F5 (final) boss — pre-fix the wells fired ENEMY_MELEE_HIT WITHOUT
    // checking whether the player was inside the circle, so the telegraph
    // was meaningless ("hits me whether I'm in or out"). Also nerfed HP
    // 600 → 480 since the broken telegraph was forcing players into mash
    // builds to outpace it. Damage tuned to match the now-meaningful
    // dodgeability.
    super(x, y, 40, 480, 'boss_aurora');
    this.wellTimer = 1.0;          // initial breathing room before first well
    this.wellPeriod = 1.05;
    this.wellDmg = 5;
    this.wells = [];
    this.boltTimer = 0.45;
    // Telegraph timing constants — exposed so the draw step can render a
    // matching "fill" animation that grows as the well approaches detonate.
    this.WELL_TELEGRAPH = 0.82;
    this.WELL_RADIUS = 90;
  }
  updateLogic(dt, player, _tempo, roomMap, allEnemies, projectiles) {
    if (!this.alive) return;
    if (this.updateSpawn(dt)) return;
    this.updateTimers(dt, player);
    if (this.staggerTimer > 0) { this.staggerTimer -= dt; return; }
    this.wellTimer -= dt;
    if (this.wellTimer <= 0) {
      this.wellTimer = this.wellPeriod;
      const _all = (window._players && window._players.list) || [player];
      const _standing = _all.filter(p => p && p.alive && !p.downed);
      const ps = _standing.length ? _standing : _all;
      const target = ps[Math.floor(Math.random() * ps.length)];
      if (target && target.alive) {
        this.wells.push({
          x: target.x, y: target.y,
          t: this.WELL_TELEGRAPH,
          r: this.WELL_RADIUS,
          // Lock in target colour so we can paint a personalised marker; helps
          // 4P parties tell which player is the focus of an incoming well.
          targetIdx: typeof target.playerIndex === 'number' ? target.playerIndex : 0,
        });
        events.emit('PLAY_SOUND', 'sigil');
      }
    }
    for (let i = this.wells.length - 1; i >= 0; i--) {
      const w = this.wells[i];
      w.t -= dt;
      if (w.t <= 0) {
        // Bug fix: only damage players ACTUALLY inside the well's radius.
        // The pre-fix path emitted a generic ENEMY_MELEE_HIT that the global
        // resolver routed to the local player regardless of position.
        const _all = (window._players && window._players.list) || [player];
        for (const p of _all) {
          if (!p || !p.alive || p.downed) continue;
          const ddx = p.x - w.x, ddy = p.y - w.y;
          const tr = w.r + p.r;
          if (ddx * ddx + ddy * ddy < tr * tr) {
            events.emit('ENEMY_MELEE_HIT', { damage: this.wellDmg, source: this, target: p });
          }
        }
        events.emit('SCREEN_SHAKE', { duration: 0.18, intensity: 0.35 });
        events.emit('PLAY_SOUND', 'crash');
        this.wells.splice(i, 1);
      }
    }
    const cx = window.CANVAS_W / 2, cy = window.CANVAS_H / 2;
    const dx = cx - this.x, dy = cy - this.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 5) { this.x += (dx / d) * 200 * dt; this.y += (dy / d) * 200 * dt; }
    this.boltTimer -= dt;
    if (this.boltTimer <= 0 && projectiles) {
      this.boltTimer = 0.38;
      const tx = player.x - this.x, ty = player.y - this.y;
      const base = Math.atan2(ty, tx);
      for (let i = -1; i <= 1; i++) {
        const a = base + i * 0.20;
        projectiles.spawn(this.x, this.y, Math.cos(a), Math.sin(a), 560, 2, '#cc88ff', 'boss_aurora', false, 1.45);
      }
    }
    if (roomMap) { const c = roomMap.clamp(this.x, this.y, this.r); this.x = c.x; this.y = c.y; }
  }
  drawBody(ctx, _l, _c, now) {
    for (const w of this.wells) {
      const total = this.WELL_TELEGRAPH;
      const elapsed = total - w.t;
      const tFrac = Math.max(0, Math.min(1, elapsed / total));
      // Outer ring — boundary of the kill zone, drawn solid so it's
      // unambiguous where the safe edge is.
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(220,150,255,${0.55 + tFrac * 0.4})`;
      ctx.lineWidth = 3;
      ctx.stroke();
      // Inner fill — grows from 0 → full as the well approaches detonation.
      // Gives a clear "imminent" tell so the player knows when to clear.
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.r * tFrac, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(180,80,255,${0.18 + tFrac * 0.35})`;
      ctx.fill();
      // Last 0.35s: cross-hair style danger flash.
      if (w.t < 0.35) {
        const flash = (Math.sin(now * 30) + 1) * 0.5;
        ctx.beginPath();
        ctx.arc(w.x, w.y, w.r - 4, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,80,180,${0.6 + flash * 0.4})`;
        ctx.lineWidth = 5;
        ctx.stroke();
      }
    }
    super.drawBody(ctx, 'AURORA', '#cc88ff', now);
  }
}
