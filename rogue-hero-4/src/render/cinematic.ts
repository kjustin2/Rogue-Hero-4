import * as THREE from 'three';

// Lightweight cutscene system: a timeline of camera shots interpolated around a
// captured focus point. Offsets are relative to focus on X/Z, absolute on Y.
// The sim is frozen while a cinematic plays (main holds mode='cutscene'), so the
// focus is static — captured once at play().
export interface Shot {
  dur: number;
  pos: [number, number, number];      // start camera offset from focus (x,z) + abs y
  posTo: [number, number, number];    // end camera offset
  look?: [number, number, number];    // start look offset
  lookTo?: [number, number, number];  // end look offset
  fov?: number;
  fovTo?: number;
  ease?: (t: number) => number;
  onStart?: () => void;
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const DEFAULT_FOV = 52;

export class Cinematic {
  active = false;
  private cam: THREE.PerspectiveCamera;
  private shots: Shot[] = [];
  private i = 0;
  private t = 0;
  private focus = new THREE.Vector3();
  private done: () => void = () => {};
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();

  constructor(cam: THREE.PerspectiveCamera) { this.cam = cam; }

  play(shots: Shot[], focus: THREE.Vector3, onDone: () => void): void {
    if (shots.length === 0) { onDone(); return; }
    this.shots = shots; this.focus.copy(focus); this.done = onDone;
    this.i = 0; this.t = 0; this.active = true;
    shots[0].onStart?.();
    this.apply(shots[0], 0);
  }

  skip(): void {
    if (!this.active) return;
    this.active = false;
    this.cam.fov = DEFAULT_FOV; this.cam.updateProjectionMatrix();
    this.done();
  }

  update(dt: number): void {
    if (!this.active) return;
    const shot = this.shots[this.i];
    this.t += dt;
    const raw = Math.min(1, this.t / shot.dur);
    this.apply(shot, (shot.ease ?? easeInOut)(raw));
    if (raw >= 1) {
      this.i++; this.t = 0;
      if (this.i >= this.shots.length) {
        this.active = false;
        this.cam.fov = DEFAULT_FOV; this.cam.updateProjectionMatrix();
        this.done();
      } else {
        this.shots[this.i].onStart?.();
      }
    }
  }

  private apply(s: Shot, e: number): void {
    const f = this.focus;
    this.pos.set(f.x + lerp(s.pos[0], s.posTo[0], e), lerp(s.pos[1], s.posTo[1], e), f.z + lerp(s.pos[2], s.posTo[2], e));
    this.cam.position.copy(this.pos);
    const l0 = s.look ?? [0, 1.4, 0], l1 = s.lookTo ?? s.look ?? [0, 1.4, 0];
    this.look.set(f.x + lerp(l0[0], l1[0], e), lerp(l0[1], l1[1], e), f.z + lerp(l0[2], l1[2], e));
    this.cam.lookAt(this.look);
    if (s.fov != null) { this.cam.fov = lerp(s.fov, s.fovTo ?? s.fov, e); this.cam.updateProjectionMatrix(); }
  }
}
