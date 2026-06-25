// Web Audio: plays the CC0 Kenney Ogg SFX, plus a synthesized neon ambient bed
// (original work). Safe in headless — failures degrade to silence, never throw.
const BASE = import.meta.env.BASE_URL;
const SFX = ['shoot', 'shoot2', 'hit', 'kill', 'enemy-attack', 'swap', 'pickup', 'dash', 'land', 'crash'];

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxGain!: GainNode;
  private musicGain!: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private last = new Map<string, number>();
  private musicOn = false;
  muted = false;

  async init(): Promise<void> {
    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.85; this.master.connect(this.ctx.destination);
      this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = 0.65; this.sfxGain.connect(this.master);
      this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.0; this.musicGain.connect(this.master);
      await Promise.all(SFX.map((n) => this.load(n)));
    } catch { this.ctx = null; }
  }

  private async load(name: string): Promise<void> {
    if (!this.ctx) return;
    try {
      const res = await fetch(`${BASE}assets/sounds/${name}.ogg`);
      const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
      this.buffers.set(name, buf);
    } catch { /* missing sound → silent */ }
  }

  resume(): void { this.ctx?.resume(); }

  play(name: string, vol = 1): void {
    if (!this.ctx || this.muted) return;
    const buf = this.buffers.get(name); if (!buf) return;
    const now = this.ctx.currentTime;
    if ((this.last.get(name) ?? -1) > now - 0.045) return; // throttle machine-gun repeats
    this.last.set(name, now);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(g); g.connect(this.sfxGain); src.start();
  }

  // Generative neon drone: detuned oscillators through a slow filter sweep.
  startMusic(): void {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    const t = this.ctx.currentTime;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 520; filter.Q.value = 6;
    filter.connect(this.musicGain);
    const freqs = [55, 82.4, 110, 164.8];
    const types: OscillatorType[] = ['sine', 'sawtooth', 'triangle', 'sine'];
    freqs.forEach((f, i) => {
      const o = this.ctx!.createOscillator(); o.type = types[i]; o.frequency.value = f;
      o.detune.value = (i - 1.5) * 6;
      const g = this.ctx!.createGain(); g.gain.value = i === 3 ? 0.12 : 0.3;
      o.connect(g); g.connect(filter); o.start();
    });
    // slow LFO sweeps the cutoff for movement
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.06;
    const lfoG = this.ctx.createGain(); lfoG.gain.value = 360;
    lfo.connect(lfoG); lfoG.connect(filter.frequency); lfo.start();
    this.musicGain.gain.setTargetAtTime(0.16, t, 3);
  }

  setMusic(on: boolean): void {
    if (!this.ctx) return;
    this.musicGain.gain.setTargetAtTime(on ? 0.16 : 0.0, this.ctx.currentTime, 0.6);
  }
}
