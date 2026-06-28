// Interactive first-run tutorial: teach ONE mechanic at a time, gated on the player
// actually doing it (learning-by-doing), snappy prompts. Drives via hooks so it stays
// decoupled from the sim/render and is unit-testable.
export interface TutorialState {
  moved: boolean; rotated: boolean; attacked: boolean; dashed: boolean; cleared: boolean;
}
export interface TutorialHooks {
  prompt: (title: string, sub: string) => void; // show the current instruction
  clear: () => void;                              // tutorial finished
  spawnDummies: () => void;                       // drop a few harmless training targets
  startCombat: () => void;                        // spawn the real first wave
}

interface Step { title: string; sub: string; done: (s: TutorialState) => boolean; enter?: (h: TutorialHooks) => void; }

const STEPS: Step[] = [
  { title: 'Move — W A S D', sub: 'Walk around the arena (movement follows the camera)', done: (s) => s.moved },
  { title: 'Rotate the camera — Q / E', sub: 'Spin the view to keep threats in front of you', done: (s) => s.rotated },
  { title: 'Aim with the mouse — press 1 or Left-Click', sub: 'Destroy the training drones', enter: (h) => h.spawnDummies(), done: (s) => s.attacked },
  { title: 'Dash — SPACE', sub: 'Blink through danger (brief invulnerability)', done: (s) => s.dashed },
  { title: 'Clear the room!', sub: 'Weave glyphs as you cast — 3 same = Resonance, all 3 different = a Prismatic Rite', enter: (h) => h.startCombat(), done: (s) => s.cleared },
];

export class Tutorial {
  active = false;
  private step = 0;
  constructor(private hooks: TutorialHooks) {}

  start(): void { this.active = true; this.step = 0; this.enter(); }
  stop(): void { this.active = false; this.hooks.clear(); }

  private enter(): void { const st = STEPS[this.step]; this.hooks.prompt(st.title, st.sub); st.enter?.(this.hooks); }

  update(s: TutorialState): void {
    if (!this.active) return;
    if (!STEPS[this.step].done(s)) return;
    this.step++;
    if (this.step >= STEPS.length) { this.stop(); return; }
    this.enter();
  }
}
