import type { Bus } from "./sim/bus.js";

// Synthesized Web Audio — no asset files. Click-free SFX (exponential gain envelopes),
// one shared noise buffer, a compressor-limited master, and a minimal generative pad/arp.
// All calls guard on a running context, so headless (no user gesture) stays console-clean.
export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicGain!: GainNode;
  private noiseBuf!: AudioBuffer;
  private arp = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(bus: Bus) {
    const resume = () => this.ensure();
    addEventListener("pointerdown", resume);
    addEventListener("keydown", resume);
    bus.on("sfx", ({ id }) => this.play(id));
    bus.on("weave:resolve", (e) => this.crash(e.hot));
    bus.on("run:win", () => this.jingle(true));
    bus.on("run:lose", () => this.jingle(false));
  }

  private ensure() {
    if (this.ctx) { if (this.ctx.state !== "running") void this.ctx.resume(); return; }
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      this.ctx = ctx;
      this.master = ctx.createGain(); this.master.gain.value = 0.5;
      const comp = ctx.createDynamicsCompressor();
      this.master.connect(comp); comp.connect(ctx.destination);
      const n = ctx.sampleRate;
      this.noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0); let last = 0;
      for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      this.startMusic();
    } catch { this.ctx = null; }
  }

  private ok() { return !!this.ctx && this.ctx.state === "running"; }
  private now() { return this.ctx!.currentTime; }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number) {
    if (!this.ok()) return;
    const t = this.now(), o = this.ctx!.createOscillator(), g = this.ctx!.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }

  private noise(dur: number, vol: number, freq = 1400, type: BiquadFilterType = "lowpass") {
    if (!this.ok()) return;
    const t = this.now(), s = this.ctx!.createBufferSource(), f = this.ctx!.createBiquadFilter(), g = this.ctx!.createGain();
    s.buffer = this.noiseBuf; f.type = type; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + dur + 0.02);
  }

  private play(id: string) {
    switch (id) {
      case "cast": this.tone(520, 0.12, "square", 0.1, 820); break;
      case "hit": this.tone(190, 0.08, "sine", 0.16, 90); this.noise(0.06, 0.1, 2400, "bandpass"); break;
      case "kill": this.tone(300, 0.18, "triangle", 0.15, 120); this.noise(0.12, 0.09, 1600); break;
      case "hurt": this.tone(120, 0.22, "sawtooth", 0.17, 60); this.noise(0.12, 0.13, 500); break;
      // "crash" handled by crash() via the weave:resolve event
    }
  }

  private crash(hot: boolean) {
    if (!this.ok()) return;
    this.tone(hot ? 160 : 300, 0.5, "sawtooth", 0.2, hot ? 60 : 140);
    this.noise(0.4, 0.18, hot ? 1800 : 3200);
    this.tone(80, 0.6, "sine", 0.16, 40);
  }

  private jingle(win: boolean) {
    const seq = win ? [440, 660, 880, 1100] : [330, 260, 200, 150];
    seq.forEach((f, i) => setTimeout(() => this.tone(f, 0.32, "triangle", 0.16), i * 150));
  }

  // minimal ambient bed: a quiet held drone + a slow pentatonic arp
  private startMusic() {
    if (!this.ctx) return;
    this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.12; this.musicGain.connect(this.master);
    const drone = this.ctx.createOscillator(); drone.type = "sine"; drone.frequency.value = 55;
    const dg = this.ctx.createGain(); dg.gain.value = 0.5; drone.connect(dg); dg.connect(this.musicGain); drone.start();
    const scale = [220, 261.6, 293.7, 329.6, 392, 440];
    this.timer = setInterval(() => {
      if (!this.ok()) return;
      if (Math.random() < 0.55) {
        const f = scale[(this.arp++) % scale.length] * (Math.random() < 0.3 ? 2 : 1);
        const t = this.now(), o = this.ctx!.createOscillator(), g = this.ctx!.createGain();
        o.type = "triangle"; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        o.connect(g); g.connect(this.musicGain); o.start(t); o.stop(t + 0.55);
      }
    }, 480);
  }
}
