import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { View, neonEnvTex } from './view';

// Renderer + graded post chain. The full bloom stack stalls under SwiftShader,
// so ?lowfx (and ?nofx) drop to a plain blit — same scene, no composer.
export class Stage {
  renderer: THREE.WebGLRenderer;
  view: View;
  private composer?: EffectComposer;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, view: View, lowfx: boolean) {
    this.canvas = canvas; this.view = view;
    // preserveDrawingBuffer under lowfx lets the headless harness sample the canvas.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowfx, powerPreference: 'high-performance', preserveDrawingBuffer: lowfx });
    this.renderer.setPixelRatio(lowfx ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    // image-based lighting: a neon environment so the reflective floor + metallic surfaces pick
    // up a premium neon sheen (the iconic wet-arena look) without a per-frame reflection pass.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const eq = neonEnvTex();
    view.scene.environment = pmrem.fromEquirectangular(eq).texture;
    eq.dispose(); pmrem.dispose();
    this.resize();

    if (!lowfx) {
      const c = new EffectComposer(this.renderer);
      c.addPass(new RenderPass(view.scene, view.camera));
      const { w, h } = this.size();
      // strength, radius, threshold — threshold high so only true emissive glows bloom
      // (lit floor/walls stay crisp), keeping the neon punch without washing the scene.
      c.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.72, 0.5, 0.82));
      c.addPass(new OutputPass());
      this.composer = c;
    }
    window.addEventListener('resize', () => this.resize());
  }

  private size(): { w: number; h: number } {
    return { w: Math.max(1, this.canvas.clientWidth), h: Math.max(1, this.canvas.clientHeight) };
  }

  resize(): void {
    const { w, h } = this.size();
    this.renderer.setSize(w, h, false);
    this.view.camera.aspect = w / h;
    this.view.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
  }

  render(dt: number): void {
    this.view.sync(dt);
    if (this.composer) this.composer.render();
    else this.renderer.render(this.view.scene, this.view.camera);
  }

  frameStats(): { drawCalls: number; triangles: number; geometries: number; textures: number; programs: number } {
    const info = this.renderer.info;
    return {
      drawCalls: info.render.calls, triangles: info.render.triangles,
      geometries: info.memory.geometries, textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
    };
  }
}
