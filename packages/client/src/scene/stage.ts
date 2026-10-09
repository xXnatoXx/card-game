import {
  Color,
  FogExp2,
  HalfFloatType,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
  WebGLRenderTarget,
  type ShaderMaterial,
} from 'three';
import { Effects } from './effects.js';
import { ditherMaterial, snapUniform } from './retro.js';
import { stepTweens } from './tween.js';

/** Roughly how many pixels tall the scene is rendered before upscaling. */
const TARGET_HEIGHT = 240;

type FrameFn = (dt: number, time: number) => void;

/** Renders the scene small, then upscales it with whole-number hard pixels and a dithered palette. */
export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(58, 4 / 3, 0.05, 60);
  private readonly target: WebGLRenderTarget;
  private readonly post: ShaderMaterial;
  /** Glitches, screen breaks, alarm, darkness and heartbeat, applied in the final pass. */
  readonly effects: Effects;
  private readonly postScene = new Scene();
  private readonly postCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly frameFns = new Set<FrameFn>();
  private last = performance.now();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.scene.background = new Color(0x000000);
    this.scene.fog = new FogExp2(0x000000, 0.095);

    this.target = new WebGLRenderTarget(320, 240, {
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      type: HalfFloatType,
    });
    this.post = ditherMaterial(this.target.texture);
    this.effects = new Effects(this.post.uniforms);
    const quad = new Mesh(new PlaneGeometry(2, 2), this.post);
    quad.frustumCulled = false;
    this.postScene.add(quad);

    // The canvas fills the 16:9 game frame; follow its size, not the window's.
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.renderer.setAnimationLoop((time) => this.frame(time));
  }

  onFrame(fn: FrameFn): () => void {
    this.frameFns.add(fn);
    return () => this.frameFns.delete(fn);
  }

  private resize(): void {
    const canvas = this.renderer.domElement;
    const w = Math.max(1, Math.round(canvas.clientWidth));
    const h = Math.max(1, Math.round(canvas.clientHeight));
    const scale = Math.max(1, Math.round(h / TARGET_HEIGHT));
    const lw = Math.ceil(w / scale);
    const lh = Math.ceil(h / scale);
    this.renderer.setSize(w, h, false);
    this.target.setSize(lw, lh);
    this.post.uniforms.lowRes!.value.set(lw, lh);
    this.post.uniforms.pixelScale!.value = scale;
    snapUniform.value.set(lw, lh);
    this.camera.aspect = lw / lh;
    this.camera.updateProjectionMatrix();
  }

  private frame(time: number): void {
    const dt = Math.min(0.1, (time - this.last) / 1000);
    this.last = time;
    stepTweens(time);
    for (const fn of this.frameFns) fn(dt, time);
    this.effects.update(dt, time);
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCamera);
  }
}
