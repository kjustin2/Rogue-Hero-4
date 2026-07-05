import * as THREE from "three";

export type FloaterKind = "dmg" | "crit" | "heal" | "tempo" | "label" | "playerdmg" | "shieldbreak";

// kinds whose CSS uses the crit keyframes (vs the default rise) — see style.css
const CRIT_KINDS = new Set<FloaterKind>(["crit", "tempo", "label", "shieldbreak"]);

/**
 * DOM-based floating combat text. Projected to screen once at spawn;
 * CSS animation handles the rise/fade so per-frame cost is zero.
 */
export class Floaters {
  private root: HTMLElement;
  private pool: HTMLDivElement[] = [];
  private v = new THREE.Vector3();

  constructor(private camera: THREE.Camera) {
    this.root = document.getElementById("floaters")!;
    for (let i = 0; i < 48; i++) {
      const el = document.createElement("div");
      el.className = "floater";
      el.style.display = "none";
      this.root.appendChild(el);
      this.pool.push(el);
    }
  }

  spawn(x: number, y: number, z: number, text: string, kind: FloaterKind = "dmg", color?: string): void {
    this.v.set(x, y, z).project(this.camera);
    if (this.v.z > 1) return;
    const margin = kind === "shieldbreak" ? 190 : 42;
    const sx = Math.min(window.innerWidth - margin, Math.max(margin, (this.v.x * 0.5 + 0.5) * window.innerWidth));
    const sy = Math.min(window.innerHeight - margin, Math.max(margin, (-this.v.y * 0.5 + 0.5) * window.innerHeight));

    const el = this.pool.find((e) => e.style.display === "none");
    if (!el) return;
    el.textContent = text;
    el.className = `floater floater--${kind}`;
    // Optional per-call tint (shield-chip numbers). Cleared on pooled reuse.
    el.style.color = color ?? "";
    const drift = (Math.random() - 0.5) * 36;
    el.style.setProperty("--drift", `${drift.toFixed(0)}px`);
    el.style.left = `${sx.toFixed(0)}px`;
    el.style.top = `${sy.toFixed(0)}px`;
    el.style.display = "block";
    // Restart the animation with ZERO forced reflow: flip between two IDENTICAL @keyframes so the
    // changed animation-name replays it. The old `animation='none'; void offsetWidth` trick forced
    // a synchronous layout flush PER floater — a frame spike on multi-hit (AoE/combo/slam) frames.
    const base = CRIT_KINDS.has(kind) ? "floater-crit" : "floater-rise";
    const suffix = el.style.animationName.endsWith("-b") ? "" : "-b";
    el.style.animation = `${base}${suffix} 0.95s ease-out forwards`;
    window.setTimeout(() => (el.style.display = "none"), 950);
  }
}
