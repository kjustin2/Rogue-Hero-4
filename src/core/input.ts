import * as THREE from "three";

/**
 * Keyboard + mouse + gamepad input.
 *
 * Two layers:
 *  - Low-level: raw key/mouse state with per-frame edge detection (down/pressed,
 *    mouseHeld/mousePressed). Used for rebinding capture and the aim raycast.
 *  - Action layer: rebindable action→codes map + a fixed gamepad mapping. Game
 *    systems query `actionDown`/`actionPressed`/`moveVector`/`aimDir` so controls
 *    can be remapped and a controller "just works".
 *
 * Call pollGamepad() + updateAim() once per frame before consumers, endFrame() after.
 */

export type Action =
  | "up" | "down" | "left" | "right"
  | "light" | "heavy" | "switch" | "dash" | "pause";

export const ACTIONS: Action[] = [
  "up", "down", "left", "right", "light", "heavy", "switch", "dash", "pause",
];

export const ACTION_LABELS: Record<Action, string> = {
  up: "Forward", down: "Back", left: "Strafe Left", right: "Strafe Right",
  light: "Light Attack", heavy: "Heavy Attack", switch: "Swap Weapon",
  dash: "Dash", pause: "Pause",
};

export type Bindings = Record<Action, string[]>;

const DEFAULT_BINDINGS: Bindings = {
  up: ["KeyW", "ArrowUp"],
  down: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  light: ["Mouse0", "KeyJ"],
  heavy: ["Mouse2", "KeyK"],
  switch: ["KeyE", "KeyQ"],
  dash: ["Space", "ShiftLeft"],
  pause: ["Escape"],
};

/**
 * Standard-mapping gamepad buttons per action (not rebindable in v1).
 * Attack + all three cards live on the four shoulder buttons (LT/RT/LB/RB) so
 * combat fingers never leave the triggers; the face buttons handle dodge (A),
 * crash (B), switch-target (Y), and final-boss mercy hold (X).
 */
const PAD_ACTION: Partial<Record<Action, number[]>> = {
  light: [7],      // RT
  heavy: [5],      // RB
  switch: [4],     // LB
  dash: [0],       // A
  pause: [9],      // Start
};

const DEADZONE = 0.28;
const BINDS_KEY = "rh4-binds";

function loadBindings(): Bindings {
  try {
    const raw = localStorage.getItem(BINDS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Bindings>;
      const merged = { ...DEFAULT_BINDINGS };
      for (const a of ACTIONS) if (Array.isArray(parsed[a])) merged[a] = parsed[a] as string[];
      return merged;
    }
  } catch { /* fall through */ }
  return structuredCloneBindings(DEFAULT_BINDINGS);
}

function structuredCloneBindings(b: Bindings): Bindings {
  const out = {} as Bindings;
  for (const a of ACTIONS) out[a] = [...b[a]];
  return out;
}

/** Human-readable label for a binding code. */
export function codeLabel(code: string): string {
  if (code.startsWith("Mouse")) return ["LMB", "MMB", "RMB"][+code.slice(5)] ?? code;
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Arrow")) return code.slice(5) + " Arrow";
  return code.replace(/Left|Right/, "").trim() || code;
}

export class Input {
  private held = new Set<string>();
  private pressedThisFrame = new Set<string>();
  readonly pointer = new THREE.Vector2();
  mouseHeld = [false, false, false];
  mousePressed = [false, false, false];
  readonly aimPoint = new THREE.Vector3();
  enabled = true;

  // First-person mouse-look: accumulated relative motion while pointer is locked,
  // drained once per frame by the camera (consumeMouseDelta).
  private mouseDX = 0;
  private mouseDY = 0;
  pointerLocked = false;
  private realLocked = false; // document-truth lock state (events only; never faked)
  /** True while WE asked for the unlock (menu/boon transitions) — those change events
   *  must not read as "the player broke the lock" (they can arrive a state later). */
  private expectUnlock = false;
  /** Fired when the pointer LEAVES lock (Esc in a locked FPS, alt-tab) — main pauses. */
  onPointerUnlock: (() => void) | null = null;
  /** Net mouse-wheel notches accumulated since last consume (down = +1). */
  private wheelSteps = 0;

  bindings: Bindings = loadBindings();

  // Gamepad
  gamepadConnected = false;
  /** Fired when a controller is plugged in / unplugged — main.ts shows a toast. */
  onGamepadChange: ((connected: boolean, id: string) => void) | null = null;
  padId = "";
  padMapping = "";
  private padIndex = -1;
  private padHeld: boolean[] = [];
  private padPressed: boolean[] = [];
  private padAxes: number[] = [];
  private lastKbm = 0;
  private lastPad = -1;

  // Rebinding capture
  private capturing: ((code: string | null) => void) | null = null;

  private ray = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      if (this.capturing) {
        e.preventDefault();
        const cb = this.capturing;
        this.capturing = null;
        cb(e.code === "Escape" ? null : e.code);
        return;
      }
      if (e.code === "Space") e.preventDefault();
      if (e.repeat) return;
      this.lastKbm = performance.now();
      this.held.add(e.code);
      this.pressedThisFrame.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.held.delete(e.code));
    window.addEventListener("blur", () => {
      this.held.clear();
      this.mouseHeld = [false, false, false];
    });
    window.addEventListener("pointermove", (e) => {
      this.lastKbm = performance.now();
      if (this.pointerLocked) {
        this.mouseDX += e.movementX || 0;
        this.mouseDY += e.movementY || 0;
      } else {
        this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
        this.pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
      }
    });
    document.addEventListener("pointerlockchange", () => {
      // realLocked tracks the DOCUMENT's truth only — the test harness fakes
      // `pointerLocked`, and Chromium fires a change event for exitPointerLock even
      // when nothing was locked, which must never read as "the player broke the lock".
      const rwas = this.realLocked;
      this.realLocked = document.pointerLockElement === this.canvas;
      this.pointerLocked = this.realLocked;
      if (!this.realLocked) {
        this.mouseDX = 0; this.mouseDY = 0;
        // Esc in a locked FPS is swallowed by the browser to exit lock (no keydown
        // reaches us) — a GENUINE lock loss during play is the pause request; a
        // change WE requested (menu/boon transitions) is not.
        if (rwas && !this.expectUnlock) this.onPointerUnlock?.();
        this.expectUnlock = false;
      }
    });
    window.addEventListener("wheel", (e) => { if (this.enabled) this.wheelSteps += Math.sign(e.deltaY); }, { passive: true });
    this.canvas.addEventListener("pointerdown", (e) => {
      if (e.button >= 3) return;
      if (this.capturing) {
        const cb = this.capturing;
        this.capturing = null;
        cb(`Mouse${e.button}`);
        return;
      }
      this.lastKbm = performance.now();
      this.mouseHeld[e.button] = true;
      this.mousePressed[e.button] = true;
    });
    window.addEventListener("pointerup", (e) => {
      if (e.button < 3) this.mouseHeld[e.button] = false;
    });
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    // Event-driven detection: Chromium fires these the moment it registers a pad
    // (the first button press after a page gesture). Far more reliable than waiting
    // for a poll to happen to catch it, and it lets us surface a "connected" toast.
    window.addEventListener("gamepadconnected", (e) => {
      const gp = (e as GamepadEvent).gamepad;
      this.lastPad = performance.now(); // a freshly plugged-in pad means to be used
      this.setPadConnected(true, gp);
    });
    window.addEventListener("gamepaddisconnected", (e) => {
      const gp = (e as GamepadEvent).gamepad;
      if (gp.index === this.padIndex) this.setPadConnected(false);
    });
  }

  /** Single source of truth for connect state — dedupes the event + poll paths. */
  private setPadConnected(on: boolean, gp?: Gamepad): void {
    if (on === this.gamepadConnected) {
      if (on && gp) { this.padIndex = gp.index; this.padId = gp.id; this.padMapping = gp.mapping; }
      return;
    }
    this.gamepadConnected = on;
    if (on && gp) { this.padIndex = gp.index; this.padId = gp.id; this.padMapping = gp.mapping; }
    if (!on) { this.padHeld = []; this.padAxes = []; this.padPressed = []; }
    this.onGamepadChange?.(on, on ? (gp?.id ?? this.padId) : this.padId);
  }

  // ------------------------------------------------------------ pointer lock (first-person look)
  lockPointer(): void {
    this.expectUnlock = false;
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === "function") p.catch(() => { /* no gesture / hidden window */ });
    } catch { /* not allowed yet */ }
  }
  unlockPointer(): void {
    this.expectUnlock = true;
    try { document.exitPointerLock(); } catch { /* ignore */ }
  }

  /** Net mouse-wheel notches since last call (scroll down = +1) — for weapon cycling. */
  consumeWheelStep(): number { const s = this.wheelSteps; this.wheelSteps = 0; return s; }

  // per-frame scratch returns — these run every frame on the hottest paths; a fresh literal each
  // call was steady GC churn. Callers read the result immediately, so a reused object is safe.
  private _md = { dx: 0, dy: 0 };
  private _mv = { x: 0, z: 0 };
  private _aim = { x: 0, z: 0 };

  /** Drain accumulated locked-pointer motion (pixels) since last call. */
  consumeMouseDelta(): { dx: number; dy: number } {
    this._md.dx = this.mouseDX;
    this._md.dy = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return this._md;
  }

  // ------------------------------------------------------------ low level
  down(code: string): boolean {
    return this.enabled && this.held.has(code);
  }

  pressed(code: string): boolean {
    return this.enabled && this.pressedThisFrame.has(code);
  }

  private codeDown(code: string): boolean {
    if (code.startsWith("Mouse")) return this.mouseHeld[+code.slice(5)] ?? false;
    return this.held.has(code);
  }

  private codePressed(code: string): boolean {
    if (code.startsWith("Mouse")) return this.mousePressed[+code.slice(5)] ?? false;
    return this.pressedThisFrame.has(code);
  }

  // ------------------------------------------------------------ action layer
  actionDown(a: Action): boolean {
    if (!this.enabled) return false;
    const codes = this.bindings[a];
    for (let i = 0; i < codes.length; i++) if (this.codeDown(codes[i])) return true;
    const pad = PAD_ACTION[a];
    if (pad) for (let i = 0; i < pad.length; i++) if (this.padHeld[pad[i]]) return true;
    return false;
  }

  actionPressed(a: Action): boolean {
    if (!this.enabled) return false;
    const codes = this.bindings[a];
    for (let i = 0; i < codes.length; i++) if (this.codePressed(codes[i])) return true;
    const pad = PAD_ACTION[a];
    if (pad) for (let i = 0; i < pad.length; i++) if (this.padPressed[pad[i]]) return true;
    return false;
  }

  /** Pause edge, ignoring `enabled` (must work while paused) — gamepad Start only; keyboard handled by main. */
  pauseEdgeRaw(): boolean {
    const pad = PAD_ACTION.pause;
    if (pad) for (let i = 0; i < pad.length; i++) if (this.padPressed[pad[i]]) return true;
    return false;
  }

  /** Combined keyboard/stick movement direction, magnitude 0..1 (analog from a stick). */
  moveVector(): { x: number; z: number } {
    const mv = this._mv;
    if (!this.enabled) { mv.x = 0; mv.z = 0; return mv; }
    const gx = this.padAxes[0] ?? 0;
    const gz = this.padAxes[1] ?? 0;
    if (Math.hypot(gx, gz) > DEADZONE) {
      const len = Math.hypot(gx, gz);
      const m = Math.min(1, len);
      mv.x = (gx / len) * m; mv.z = (gz / len) * m;
      return mv;
    }
    let x = 0, z = 0;
    if (this.actionDown("left")) x -= 1;
    if (this.actionDown("right")) x += 1;
    if (this.actionDown("up")) z -= 1;
    if (this.actionDown("down")) z += 1;
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    mv.x = x; mv.z = z;
    return mv;
  }

  /** Right-stick aim direction (world XZ), or null when centered. */
  aimDir(): { x: number; z: number } | null {
    const x = this.padAxes[2] ?? 0;
    const z = this.padAxes[3] ?? 0;
    if (Math.hypot(x, z) < DEADZONE) return null;
    const len = Math.hypot(x, z) || 1;
    this._aim.x = x / len; this._aim.z = z / len;
    return this._aim;
  }

  get usingGamepad(): boolean {
    return this.gamepadConnected && this.lastPad >= this.lastKbm;
  }

  // ------------------------------------------------------------ raw pad (menu nav)
  /** Raw gamepad button edge this frame — for DOM menu navigation. */
  padEdge(button: number): boolean {
    return this.padPressed[button] ?? false;
  }

  /** Raw gamepad axis value (−1..1) — for DOM menu navigation. */
  padAxis(i: number): number {
    return this.padAxes[i] ?? 0;
  }

  /** Swallow button edges the menu consumed so they can't leak into gameplay this frame. */
  consumePadEdge(...buttons: number[]): void {
    for (const b of buttons) this.padPressed[b] = false;
  }

  // ------------------------------------------------------------ rebinding
  /** Capture the next key/mouse press for `action`. cb runs with the new code, or null if cancelled (Esc). */
  captureNext(action: Action, done: (rebound: boolean) => void): void {
    this.capturing = (code) => {
      if (code) {
        this.bindings[action] = [code];
        this.saveBindings();
      }
      done(code !== null);
    };
  }

  resetBindings(): void {
    this.bindings = structuredCloneBindings(DEFAULT_BINDINGS);
    this.saveBindings();
  }

  private saveBindings(): void {
    try { localStorage.setItem(BINDS_KEY, JSON.stringify(this.bindings)); } catch { /* private mode */ }
  }

  // ------------------------------------------------------------ gamepad poll
  pollGamepad(): void {
    const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : null;
    let gp: Gamepad | null = null;
    // Prefer the pad we already track; otherwise take the first connected one.
    if (pads) {
      if (this.padIndex >= 0 && pads[this.padIndex]) gp = pads[this.padIndex];
      if (!gp) for (const p of pads) if (p && p.connected) { gp = p; break; }
    }
    this.padPressed.length = 0; // reuse the array (was a fresh [] every frame → GC churn)
    if (!gp) {
      // Backstop the disconnect event (some setups never fire it).
      if (this.gamepadConnected) this.setPadConnected(false);
      this.padHeld.length = 0;
      this.padAxes.length = 0;
      return;
    }
    // Backstop the connect event (e.g. a pad already held down before page load).
    if (!this.gamepadConnected) this.setPadConnected(true, gp);
    else { this.padIndex = gp.index; this.padId = gp.id; this.padMapping = gp.mapping; }
    this.padAxes.length = 0;
    for (let i = 0; i < gp.axes.length; i++) this.padAxes[i] = gp.axes[i];
    let activity = false;
    for (let i = 0; i < gp.buttons.length; i++) {
      const p = gp.buttons[i].pressed;
      if (p && !this.padHeld[i]) { this.padPressed[i] = true; activity = true; }
      this.padHeld[i] = p;
      if (p) activity = true;
    }
    for (const ax of this.padAxes) if (Math.abs(ax) > DEADZONE) activity = true;
    if (activity) this.lastPad = performance.now();
  }

  /** Any controller button pressed THIS frame — used to skip cinematics with a pad. */
  anyButtonEdge(): boolean {
    return this.padPressed.some(Boolean);
  }

  // ------------------------------------------------------------ aim raycast
  updateAim(camera: THREE.Camera, planeY = 0): void {
    this.groundPlane.constant = -planeY;
    this.ray.setFromCamera(this.pointer, camera);
    const hit = new THREE.Vector3();
    if (this.ray.ray.intersectPlane(this.groundPlane, hit)) {
      this.aimPoint.copy(hit);
    }
  }

  endFrame(): void {
    this.pressedThisFrame.clear();
    this.mousePressed = [false, false, false];
  }
}
