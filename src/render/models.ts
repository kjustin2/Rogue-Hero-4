import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";

/**
 * Meshy-generated GLB assets, preloaded ONCE at boot (before systems build and
 * before stage.warmUp(), so their shaders compile under the loading screen).
 * Every model is optional: `get()`/`getRigged()` return null when the file is
 * missing, failed to parse, or `?noglb` is set — callers keep their procedural
 * fallback so dev/CI never depend on a download.
 */
export interface ModelSpec {
  /** File under /models/ (no extension). Rigged models also load `<file>@<clip>.glb`. */
  file: string;
  /** Target size in world units along `axis` after normalization. */
  size: number;
  /** Which box dimension `size` measures. Default "y" (height). */
  axis?: "y" | "z" | "max";
  /** Rest the box bottom at y=0 (characters/props). Default true; weapons use false (centered). */
  ground?: boolean;
  /** Rigged characters: clip labels — each loaded from `<file>@<clip>.glb` animations[0]. */
  clips?: string[];
}

/** The full Meshy asset catalog. Sizes are world-unit targets after normalization. */
export const MODEL_SPECS: ModelSpec[] = [
  // weapon viewmodels — sized by longest axis, centered (oriented at the swap site)
  { file: "wpn-crossbow", size: 1.15, axis: "max", ground: false },
  { file: "wpn-greatsword", size: 1.6, axis: "max", ground: false },
  { file: "wpn-bombard", size: 1.15, axis: "max", ground: false },
  { file: "wpn-prismrod", size: 1.45, axis: "max", ground: false },
  { file: "wpn-stormstaff", size: 1.55, axis: "max", ground: false },
  // static enemies — centered like their procedural bodies (their groups float at bodyY)
  { file: "enm-wraith", size: 1.9, ground: false },
  { file: "enm-spitter", size: 1.9, ground: false },
  // rigged walkers — feet at y=0
  { file: "enm-husk", size: 1.9, clips: ["walk", "attack", "flinch", "death", "idle"] },
  { file: "enm-brute", size: 3.2, clips: ["walk", "attack", "flinch", "death", "idle"] },
  { file: "enm-ghoul", size: 1.5, clips: ["walk", "attack", "flinch", "death", "idle"] },
  { file: "enm-archer", size: 1.8, clips: ["walk", "attack", "flinch", "death", "idle"] },
  // boss + props
  { file: "boss-barrowking", size: 9.2 },
  { file: "prop-gargoyle", size: 2.3 },
  { file: "prop-knight", size: 2.5 },
];

interface StaticEntry { kind: "static"; template: THREE.Group }
interface RiggedEntry { kind: "rigged"; template: THREE.Group; clips: THREE.AnimationClip[] }

export interface RiggedInstance {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
}

export class Models {
  private loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private entries = new Map<string, StaticEntry | RiggedEntry>();
  private disabled = new URLSearchParams(location.search).has("noglb");

  /** Load every spec (missing files resolve to fallback-at-call-site). Call before warmUp. */
  async preload(specs: ModelSpec[]): Promise<void> {
    if (this.disabled) return;
    await Promise.allSettled(specs.map((s) => this.loadOne(s)));
  }

  private async loadOne(spec: ModelSpec): Promise<void> {
    try {
      const base = spec.clips?.length ? `${spec.file}@rig` : spec.file;
      const gltf = await this.loader.loadAsync(`models/${base}.glb`);
      const template = this.normalize(gltf.scene, spec);
      if (spec.clips?.length) {
        const clips: THREE.AnimationClip[] = [];
        for (const label of spec.clips) {
          try {
            const cg = await this.loader.loadAsync(`models/${spec.file}@${label}.glb`);
            const clip = cg.animations[0];
            if (clip) { clip.name = label; clips.push(clip); }
          } catch { /* clip missing — the state just keeps the procedural motion */ }
        }
        this.entries.set(spec.file, { kind: "rigged", template, clips });
      } else {
        this.entries.set(spec.file, { kind: "static", template });
      }
    } catch { /* missing/broken file — caller falls back to procedural */ }
  }

  /** Uniform-scale to spec.size, recenter XZ, ground or center Y, fix Meshy material quirks. */
  private normalize(root: THREE.Group, spec: ModelSpec): THREE.Group {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const dim = new THREE.Vector3();
    box.getSize(dim);
    const axis = spec.axis ?? "y";
    const measure = axis === "max" ? Math.max(dim.x, dim.y, dim.z) : axis === "z" ? dim.z : dim.y;
    const s = spec.size / Math.max(1e-6, measure);
    const wrap = new THREE.Group();
    wrap.add(root);
    root.scale.setScalar(s);
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    const cy = (box.min.y + box.max.y) / 2;
    root.position.set(-cx * s, (spec.ground ?? true) ? -box.min.y * s : -cy * s, -cz * s);
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats as THREE.MeshStandardMaterial[]) {
          mat.side = THREE.FrontSide; // Meshy exports DoubleSide — overdraw + broken normals
          if (mat.envMapIntensity !== undefined) mat.envMapIntensity = 0.6;
          mat.userData.shared = true; // clones share materials — never dispose per-instance
        }
      }
    });
    return wrap;
  }

  /** Clone of a static model (shared geometry + materials), or null → use the fallback. */
  get(name: string): THREE.Group | null {
    const e = this.entries.get(name);
    if (!e || e.kind !== "static") return null;
    return e.template.clone(true);
  }

  /** SkeletonUtils clone + per-instance mixer with one action per clip, or null. */
  getRigged(name: string): RiggedInstance | null {
    const e = this.entries.get(name);
    if (!e || e.kind !== "rigged") return null;
    const root = SkeletonUtils.clone(e.template) as THREE.Group;
    const mixer = new THREE.AnimationMixer(root);
    const actions: Record<string, THREE.AnimationAction> = {};
    for (const clip of e.clips) actions[clip.name] = mixer.clipAction(clip);
    return { root, mixer, actions };
  }

  /** Which models actually loaded — asserted by the smoke. */
  status(): Record<string, "glb" | "rigged"> {
    const out: Record<string, "glb" | "rigged"> = {};
    for (const [k, v] of this.entries) out[k] = v.kind === "rigged" ? "rigged" : "glb";
    return out;
  }

  /**
   * One hidden clone of everything loaded, parented into the scene so warmUp()'s
   * renderer.compile() builds their programs at boot (compile ignores `visible`).
   * Skinned meshes compile a different program than static ones — the rigged clone
   * in the rack is what prevents the first walker spawn from stalling a live frame.
   */
  buildWarmRack(): THREE.Group {
    const rack = new THREE.Group();
    rack.visible = false;
    for (const [k, v] of this.entries) {
      rack.add(v.kind === "rigged" ? (this.getRigged(k)?.root ?? new THREE.Group()) : v.template.clone(true));
    }
    return rack;
  }
}
