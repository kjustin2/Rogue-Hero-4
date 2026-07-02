import type { EventBus } from "../core/events";

interface ToneOpts {
  f: number;
  /** Frequency to slide to over the duration. */
  f2?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  delay?: number;
}

interface NoiseOpts {
  dur: number;
  freq: number;
  q?: number;
  gain?: number;
  type?: BiquadFilterType;
  /** Filter frequency slide target. */
  freq2?: number;
  delay?: number;
}

/**
 * Fully procedural SFX — every sound is synthesised from oscillators and
 * filtered noise at call time. Headless-safe: silently no-ops without
 * AudioContext. The context resumes on the first user gesture (main.ts).
 */
export class Sfx {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientNodes: AudioNode[] = [];
  private ambientGain: GainNode | null = null;
  volume = 0.7;
  private noiseBuf: AudioBuffer | null = null;
  private lastLightHitAt = -Infinity;
  private lastHeavyHitAt = -Infinity;
  private lastKillAt = -Infinity;
  private lastExplosionAt = -Infinity;

  constructor(events: EventBus) {
    try {
      this.ac = new AudioContext();
      // Volume knob feeds a professional master bus, not the raw output:
      //   master → compressor/limiter (glue + clip protection) → high-shelf (tame
      //   digital fizz) → makeup gain → destination, with a parallel convolver-reverb
      //   send for arena space. Every sound benefits without per-sound changes.
      this.master = this.ac.createGain();
      this.master.gain.value = this.volume;

      const comp = this.ac.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 22;
      comp.ratio.value = 3.2;
      comp.attack.value = 0.003;
      comp.release.value = 0.16;

      const shelf = this.ac.createBiquadFilter();
      shelf.type = "highshelf";
      shelf.frequency.value = 7200;
      shelf.gain.value = -4; // soften harsh upper fizz for a warmer, less brittle mix

      const makeup = this.ac.createGain();
      makeup.gain.value = 1.3; // restore loudness lost to the compressor

      this.master.connect(comp);
      comp.connect(shelf);
      shelf.connect(makeup);
      makeup.connect(this.ac.destination); // dry path

      // Parallel reverb send — a short, dark plate gives the arena a sense of space.
      const convolver = this.ac.createConvolver();
      convolver.buffer = this.makeImpulse(1.1, 2.6);
      const wet = this.ac.createGain();
      wet.gain.value = 0.16;
      makeup.connect(convolver);
      convolver.connect(wet);
      wet.connect(this.ac.destination); // wet path

      // Shared 2s white-noise buffer
      const len = this.ac.sampleRate * 2;
      this.noiseBuf = this.ac.createBuffer(1, len, this.ac.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } catch {
      this.ac = null;
    }

    events.on("ENEMY_HIT", (e) => this.enemyHit(!!e.heavy));
    events.on("KILL", () => this.kill());
    events.on("PLAYER_HIT", () => this.hurt());
    events.on("DODGE", () => this.dodge());
    events.on("KILL_STREAK", (e) => this.streak(e.count));
    events.on("HEAL", () => this.heal());
    events.on("UI_HOVER", () => this.uiHover());
    events.on("UI_CLICK", () => this.uiClick());
  }

  resume(): void {
    if (this.ac?.state === "suspended") void this.ac.resume();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  // ---------------------------------------------------------------- helpers
  private tone(o: ToneOpts): void {
    if (!this.ac || !this.master) return;
    const t0 = this.ac.currentTime + (o.delay ?? 0);
    const osc = this.ac.createOscillator();
    const g = this.ac.createGain();
    osc.type = o.type ?? "sine";
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.f2 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t0 + o.dur);
    const gain = o.gain ?? 0.18;
    const attack = o.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.05);
  }

  private noise(o: NoiseOpts): void {
    if (!this.ac || !this.master || !this.noiseBuf) return;
    const t0 = this.ac.currentTime + (o.delay ?? 0);
    const src = this.ac.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = this.ac.createBiquadFilter();
    filter.type = o.type ?? "bandpass";
    filter.frequency.setValueAtTime(o.freq, t0);
    if (o.freq2 !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(40, o.freq2), t0 + o.dur);
    filter.Q.value = o.q ?? 1;
    const g = this.ac.createGain();
    const gain = o.gain ?? 0.18;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0, Math.random());
    src.stop(t0 + o.dur + 0.05);
  }

  /** A stereo decaying-noise impulse response for the reverb send (procedural — no asset). */
  private makeImpulse(seconds: number, decay: number): AudioBuffer | null {
    if (!this.ac) return null;
    const rate = this.ac.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ac.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  // ---------------------------------------------------------------- combat
  private enemyHit(heavy: boolean): void {
    const now = performance.now();
    if (heavy) {
      if (now - this.lastHeavyHitAt < 55) return;
      this.lastHeavyHitAt = now;
      this.hitHeavy();
      return;
    }
    if (now - this.lastLightHitAt < 28) return;
    this.lastLightHitAt = now;
    this.hit();
  }

  private hit(): void {
    // Crisp thwack: a short tonal knock + a tight transient + a touch of sub.
    this.tone({ f: 240, f2: 120, dur: 0.05, type: "triangle", gain: 0.12 });
    this.noise({ dur: 0.045, freq: 3200, q: 1.2, gain: 0.08 });
    this.tone({ f: 95, f2: 55, dur: 0.07, type: "sine", gain: 0.1 });
  }

  private hitHeavy(): void {
    // Deeper, weightier impact — body + crack + sub.
    this.tone({ f: 150, f2: 55, dur: 0.16, type: "sine", gain: 0.26 });
    this.tone({ f: 300, f2: 150, dur: 0.06, type: "triangle", gain: 0.12 });
    this.noise({ dur: 0.14, freq: 800, freq2: 220, q: 0.9, gain: 0.14, type: "lowpass" });
  }

  private kill(): void {
    const now = performance.now();
    if (now - this.lastKillAt < 38) return;
    this.lastKillAt = now;
    // A satisfying pop: quick downward chirp, airy burst, soft thump.
    this.tone({ f: 520, f2: 120, dur: 0.13, type: "triangle", gain: 0.13 });
    this.noise({ dur: 0.2, freq: 2400, freq2: 500, q: 0.7, gain: 0.1, type: "bandpass" });
    this.tone({ f: 110, f2: 45, dur: 0.16, type: "sine", gain: 0.12, delay: 0.01 });
  }

  private hurt(): void {
    // A dull, sickening thud — less buzz, more body.
    this.tone({ f: 190, f2: 70, dur: 0.2, type: "sine", gain: 0.22 });
    this.noise({ dur: 0.16, freq: 420, freq2: 160, q: 0.7, gain: 0.13, type: "lowpass" });
  }

  private dodge(): void {
    this.noise({ dur: 0.16, freq: 600, freq2: 2400, q: 2, gain: 0.09 });
  }

  private streak(count: number): void {
    const base = 520 + Math.min(count, 10) * 60;
    this.tone({ f: base, dur: 0.07, type: "triangle", gain: 0.1 });
    this.tone({ f: base * 1.5, dur: 0.1, type: "triangle", gain: 0.09, delay: 0.05 });
  }

  cardReady(): void {
    this.tone({ f: 660, dur: 0.06, type: "triangle", gain: 0.06 });
    this.tone({ f: 990, dur: 0.1, type: "triangle", gain: 0.05, delay: 0.04 });
  }

  /** A bright rising triad when the player hits the Critical tempo zone. */
  critical(): void {
    const f = [523, 659, 784, 1047];
    f.forEach((hz, i) => this.tone({ f: hz, dur: 0.16, type: "triangle", gain: 0.06, delay: i * 0.05 }));
  }

  // ---------------------------------------------------------------- enemies
  explosion(): void {
    const now = performance.now();
    if (now - this.lastExplosionAt < 55) return;
    this.lastExplosionAt = now;
    this.tone({ f: 90, f2: 30, dur: 0.4, type: "sine", gain: 0.3 });
    this.noise({ dur: 0.45, freq: 1200, freq2: 100, q: 0.5, gain: 0.26, type: "lowpass" });
  }

  beamFire(): void {
    this.noise({ dur: 0.25, freq: 3000, freq2: 500, q: 2, gain: 0.2 });
    this.tone({ f: 1100, f2: 200, dur: 0.2, type: "sawtooth", gain: 0.12 });
  }

  /** Blunt, non-explosive projectile impact — a dull thunk, clearly NOT a boom. */
  thud(): void {
    this.tone({ f: 130, f2: 55, dur: 0.09, type: "sine", gain: 0.16 });
    this.noise({ dur: 0.06, freq: 500, freq2: 180, q: 0.8, gain: 0.09, type: "lowpass" });
  }

  /**
   * Distinct wind-up cue per boss attack family — the EAR tells you what's coming
   * even when the floor telegraph is behind you.
   */
  tell(kind: string): void {
    switch (kind) {
      case "volley": // three quick ascending ticks — bolts incoming
        for (let i = 0; i < 3; i++) this.tone({ f: 620 + i * 160, dur: 0.06, type: "triangle", gain: 0.09, delay: i * 0.09 });
        break;
      case "beam": // rising saw sweep — get off the line
        this.tone({ f: 180, f2: 950, dur: 0.6, type: "sawtooth", gain: 0.08 });
        break;
      case "sweep":
      case "harvest": // metallic shing — the blade is coming around
        this.noise({ dur: 0.35, freq: 3600, freq2: 5200, q: 3, gain: 0.1 });
        this.tone({ f: 1150, f2: 1500, dur: 0.28, type: "triangle", gain: 0.07 });
        break;
      case "gravewave": // deep pulsing rumble — ready the dash
        for (let i = 0; i < 3; i++) this.tone({ f: 52, f2: 40, dur: 0.16, type: "sine", gain: 0.24, delay: i * 0.18 });
        this.noise({ dur: 0.55, freq: 160, q: 0.6, gain: 0.1, type: "lowpass" });
        break;
      case "shift": // airy whoosh — he is moving
        this.noise({ dur: 0.3, freq: 300, freq2: 1400, q: 1.2, gain: 0.12 });
        break;
      default: // slam / collapse: low double-thump
        this.tone({ f: 90, f2: 60, dur: 0.12, type: "sine", gain: 0.2 });
        this.tone({ f: 110, f2: 70, dur: 0.14, type: "sine", gain: 0.22, delay: 0.16 });
    }
  }

  // ---------------------------------------------------------------- boss
  bossRoar(): void {
    this.tone({ f: 85, f2: 58, dur: 0.85, type: "sawtooth", gain: 0.22 });
    this.tone({ f: 128, f2: 86, dur: 0.7, type: "sawtooth", gain: 0.13 });
    this.tone({ f: 44, f2: 32, dur: 0.9, type: "sine", gain: 0.2 });
    this.noise({ dur: 0.7, freq: 280, q: 0.6, gain: 0.13, type: "lowpass" });
  }

  /** A huge, layered detonation when a boss falls. */
  bossDeath(): void {
    this.tone({ f: 80, f2: 22, dur: 0.7, type: "sine", gain: 0.34 });
    this.noise({ dur: 0.6, freq: 1600, freq2: 70, q: 0.5, gain: 0.26, type: "lowpass" });
    this.noise({ dur: 0.4, freq: 4200, freq2: 900, q: 0.8, gain: 0.12, delay: 0.04 });
    this.tone({ f: 360, f2: 60, dur: 0.4, type: "sawtooth", gain: 0.12, delay: 0.02 });
    this.tone({ f: 58, f2: 26, dur: 0.5, type: "sine", gain: 0.22, delay: 0.2 }); // second concussion
  }

  bossDash(): void {
    this.noise({ dur: 0.22, freq: 350, freq2: 1500, q: 1.4, gain: 0.16 });
  }

  bossLeap(): void {
    this.noise({ dur: 0.35, freq: 250, freq2: 900, q: 1.2, gain: 0.13 });
  }

  bossSlam(): void {
    this.tone({ f: 70, f2: 28, dur: 0.5, type: "sine", gain: 0.32 });
    this.noise({ dur: 0.4, freq: 800, freq2: 90, q: 0.6, gain: 0.24, type: "lowpass" });
  }

  // ---------------------------------------------------------------- UI / meta
  private uiHover(): void {
    this.tone({ f: 700, dur: 0.04, type: "sine", gain: 0.035 });
  }

  private uiClick(): void {
    this.tone({ f: 600, f2: 920, dur: 0.06, type: "sine", gain: 0.06 });
    this.tone({ f: 1200, dur: 0.03, type: "sine", gain: 0.03, delay: 0.01 });
  }

  private heal(): void {
    this.tone({ f: 520, f2: 660, dur: 0.2, type: "sine", gain: 0.09 });
    this.tone({ f: 780, f2: 990, dur: 0.25, type: "sine", gain: 0.07, delay: 0.08 });
  }

  relicPickup(): void {
    this.tone({ f: 660, dur: 0.12, type: "triangle", gain: 0.1 });
    this.tone({ f: 880, dur: 0.14, type: "triangle", gain: 0.1, delay: 0.08 });
    this.tone({ f: 1320, dur: 0.22, type: "sine", gain: 0.08, delay: 0.16 });
  }

  unlockFanfare(): void {
    const notes = [660, 880, 990, 1320];
    notes.forEach((f, i) => this.tone({ f, dur: 0.25, type: "triangle", gain: 0.09, delay: i * 0.1 }));
  }

  /** Player melee whoosh — heavier, lower for a Cleave. */
  meleeSwing(heavy: boolean): void {
    this.noise({ dur: heavy ? 0.22 : 0.12, freq: heavy ? 320 : 640, freq2: heavy ? 1700 : 2600, q: 1.6, gain: heavy ? 0.12 : 0.08 });
  }

  /** Bolt cast — a quick arcane zap. */
  boltCast(): void {
    this.tone({ f: 620, f2: 1500, dur: 0.16, type: "sawtooth", gain: 0.09 });
    this.noise({ dur: 0.12, freq: 1200, freq2: 400, q: 2, gain: 0.05 });
  }

  /** Dash whoosh. */
  dashWhoosh(): void {
    this.noise({ dur: 0.18, freq: 420, freq2: 1700, q: 1.2, gain: 0.1 });
  }

  bossIntroSting(): void {
    // Cinematic riser → low impact. A slow swell of two low sines a fifth apart,
    // a filtered noise rise, then a sub drop — tense, not the old buzzy detune.
    this.tone({ f: 70, dur: 1.5, type: "sine", gain: 0.22, attack: 0.55 });
    this.tone({ f: 105, dur: 1.4, type: "sine", gain: 0.13, attack: 0.65 });
    this.noise({ dur: 1.2, freq: 200, freq2: 1500, q: 0.5, gain: 0.05, type: "bandpass" });
    this.tone({ f: 50, f2: 30, dur: 1.0, type: "sine", gain: 0.22, delay: 1.15 });
  }

  victory(): void {
    const notes = [523, 659, 784, 1046, 1318];
    notes.forEach((f, i) => this.tone({ f, dur: 0.4, type: "triangle", gain: 0.1, delay: i * 0.13 }));
  }

  defeat(): void {
    const notes = [392, 311, 262, 196];
    notes.forEach((f, i) => this.tone({ f, dur: 0.5, type: "sine", gain: 0.12, delay: i * 0.22 }));
  }

  /** Low evolving pad for the menus. */
  startAmbient(): void {
    if (!this.ac || !this.master || this.ambientNodes.length) return;
    const t0 = this.ac.currentTime;
    this.ambientGain = this.ac.createGain();
    this.ambientGain.gain.setValueAtTime(0.0001, t0);
    this.ambientGain.gain.exponentialRampToValueAtTime(0.05, t0 + 2.5);
    const filter = this.ac.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 320;
    const lfo = this.ac.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = this.ac.createGain();
    lfoGain.gain.value = 140;
    lfo.connect(lfoGain).connect(filter.frequency);
    for (const f of [55, 82.5, 110.3]) {
      const o = this.ac.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.detune.value = Math.random() * 8 - 4;
      o.connect(filter);
      o.start();
      this.ambientNodes.push(o);
    }
    filter.connect(this.ambientGain).connect(this.master);
    lfo.start();
    this.ambientNodes.push(lfo, filter);
  }

  stopAmbient(): void {
    if (!this.ac || !this.ambientGain) return;
    const t = this.ac.currentTime;
    this.ambientGain.gain.cancelScheduledValues(t);
    this.ambientGain.gain.setValueAtTime(this.ambientGain.gain.value, t);
    this.ambientGain.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    const nodes = this.ambientNodes;
    this.ambientNodes = [];
    this.ambientGain = null;
    window.setTimeout(() => {
      for (const n of nodes) {
        if (n instanceof OscillatorNode) {
          try { n.stop(); } catch { /* already stopped */ }
        }
        n.disconnect();
      }
    }, 1400);
  }
}
