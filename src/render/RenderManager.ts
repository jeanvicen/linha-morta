/**
 * Owns the WebGL 2 renderer, the post-processing chain and the frame loop. Handles resizing,
 * pixel-ratio caps, frame-rate limiting, pausing in background tabs, context loss and the
 * adaptive part of "automatic" quality (stepping down when the measured frame rate is too low).
 */
import {
  HalfFloatType,
  NoToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  SRGBColorSpace,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Emitter } from '../core/events';
import { AppError } from '../core/errors';
import { pixelRatioCap } from '../core/device';
import type { GraphicsSettings, QualityLevel } from '../features/settings/settings';
import { QUALITY_LEVELS } from '../features/settings/settings';
import type { World } from '../world/World';
import { NO_REFLECT_LAYER } from './PlanarReflection';
import { createFinalPass } from './post';

export type FrameUpdater = (dt: number, time: number) => void;

interface RenderEvents {
  contextlost: undefined;
  contextrestored: undefined;
  /** Emitted when automatic quality decides to step down. */
  autodowngrade: QualityLevel;
  fps: number;
}

export class RenderManager extends Emitter<RenderEvents> {
  readonly renderer: WebGLRenderer;
  readonly camera = new PerspectiveCamera(42, 1, 0.1, 1200);
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private finalPass: ShaderPass | null = null;
  private world: World | null = null;
  private readonly updaters = new Set<FrameUpdater>();
  private raf = 0;
  private running = false;
  private last = 0;
  private lastRender = 0;
  private time = 0;
  private graphics: GraphicsSettings | null = null;
  private dprLevel: QualityLevel = 'high';
  private samples = -1;
  private readonly size = new Vector2();
  private readonly resizeObserver: ResizeObserver | null = null;
  // Performance tracking.
  private frameCount = 0;
  private frameWindowStart = 0;
  private fps = 60;
  private slowWindows = 0;
  private warmupUntil = 0;
  autoQuality = false;
  autoLevel: QualityLevel = 'high';

  constructor(private readonly canvas: HTMLCanvasElement, private readonly mobile: boolean) {
    super();
    try {
      this.renderer = new WebGLRenderer({
        canvas,
        antialias: false,
        alpha: false,
        stencil: false,
        depth: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
      });
    } catch (error) {
      throw new AppError('webgl_unavailable', 'Não foi possível iniciar os gráficos 3D (WebGL 2) neste dispositivo.', { cause: error });
    }
    const r = this.renderer;
    r.outputColorSpace = SRGBColorSpace;
    r.toneMapping = NoToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = PCFShadowMap;
    r.setClearColor(0x05070a, 1);
    this.camera.layers.enable(NO_REFLECT_LAYER);

    canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored, false);
    document.addEventListener('visibilitychange', this.onVisibility);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas);
    }
    window.addEventListener('resize', this.onWindowResize);
    window.addEventListener('orientationchange', this.onWindowResize);
  }

  get currentFps(): number {
    return this.fps;
  }

  get elapsed(): number {
    return this.time;
  }

  setWorld(world: World): void {
    this.world = world;
    this.renderPass = null;
    this.rebuildComposer();
  }

  addUpdater(fn: FrameUpdater): () => void {
    this.updaters.add(fn);
    return () => this.updaters.delete(fn);
  }

  /** Applies graphics settings. `level` is the quality level used for the pixel ratio cap. */
  applyGraphics(g: GraphicsSettings, level: QualityLevel): void {
    this.graphics = g;
    this.dprLevel = level;
    const samples = g.postProcessing === 'off' ? 0 : level === 'low' ? 0 : level === 'medium' ? 2 : 4;
    if (samples !== this.samples) {
      this.samples = samples;
      this.rebuildComposer();
    }
    this.applyGraphicsUniformsOnly(g);
    this.world?.applyGraphics(g);
    this.resize();
    this.warmupUntil = this.time + 4;
    this.slowWindows = 0;
  }

  private rebuildComposer(): void {
    if (!this.world) return;
    this.composer?.dispose();
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: Math.max(0, this.samples) });
    const composer = new EffectComposer(this.renderer, target);
    this.renderPass = new RenderPass(this.world.scene, this.camera);
    this.bloomPass = new UnrealBloomPass(new Vector2(256, 256), 0.55, 0.62, 0.92);
    this.bloomPass.enabled = this.graphics?.postProcessing === 'high';
    this.finalPass = createFinalPass();
    composer.addPass(this.renderPass);
    composer.addPass(this.bloomPass);
    composer.addPass(this.finalPass);
    this.composer = composer;
    if (this.graphics) {
      const g = this.graphics;
      this.graphics = null;
      this.applyGraphicsUniformsOnly(g);
    }
    this.resize();
  }

  private applyGraphicsUniformsOnly(g: GraphicsSettings): void {
    this.graphics = g;
    if (this.bloomPass) this.bloomPass.enabled = g.postProcessing === 'high';
    if (this.finalPass) {
      const u = this.finalPass.uniforms;
      const full = g.postProcessing !== 'off';
      u.uGrain!.value = full ? 0.042 : 0;
      u.uVignette!.value = full ? 0.55 : 0.25;
      u.uAberration!.value = g.postProcessing === 'high' ? 0.0018 : 0;
      u.uGrade!.value = full ? 1 : 0.5;
    }
  }

  private pixelRatio(): number {
    const cap = pixelRatioCap(this.dprLevel, this.mobile);
    const scale = this.graphics?.resolutionScale ?? 1;
    return Math.max(0.5, Math.min(window.devicePixelRatio || 1, cap) * scale);
  }

  private onWindowResize = (): void => this.resize();

  resize(): void {
    const w = Math.max(1, Math.floor(this.canvas.clientWidth || window.innerWidth));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight || window.innerHeight));
    const dpr = this.pixelRatio();
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(dpr);
    this.composer?.setSize(w, h);
    this.renderer.getDrawingBufferSize(this.size);
    if (this.finalPass) this.finalPass.uniforms.uResolution!.value.copy(this.size);
    if (this.bloomPass) this.bloomPass.resolution.set(this.size.x / 2, this.size.y / 2);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewportListeners.forEach((fn) => fn(w, h));
  }

  private readonly viewportListeners = new Set<(w: number, h: number) => void>();
  onViewport(fn: (w: number, h: number) => void): () => void {
    this.viewportListeners.add(fn);
    fn(Math.max(1, this.canvas.clientWidth || window.innerWidth), Math.max(1, this.canvas.clientHeight || window.innerHeight));
    return () => this.viewportListeners.delete(fn);
  }

  /** Compiles all scene shaders up front (uses KHR_parallel_shader_compile when available). */
  async precompile(): Promise<void> {
    if (!this.world) return;
    try {
      await this.renderer.compileAsync(this.world.scene, this.camera);
    } catch (error) {
      throw new AppError('shader_compile_failed', 'Falha ao preparar os efeitos gráficos.', { cause: error });
    }
  }

  /** Renders one frame immediately (used to warm up GPU resources before revealing the scene). */
  renderOnce(): void {
    this.frame(performance.now(), true);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.frameWindowStart = this.last;
    this.frameCount = 0;
    this.warmupUntil = this.time + 4;
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    const limit = this.graphics?.fpsLimit ?? 0;
    if (limit > 0 && now - this.lastRender < 1000 / limit - 1.5) return;
    this.frame(now, false);
  };

  private frame(now: number, force: boolean): void {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.lastRender = now;
    if (!force) this.time += dt;
    for (const fn of this.updaters) fn(dt, this.time);
    if (this.world && this.composer) {
      this.world.update(dt, this.time, this.camera);
      this.composer.render(dt);
      // The mirror is rendered after the main pass (one frame of latency): by then the shadow maps
      // exist, and the road samples last frame's reflection, which is imperceptible at these speeds.
      this.world.renderReflection(this.camera);
      if (this.finalPass) this.finalPass.uniforms.uTime!.value = this.time;
    }
    if (!force) this.trackPerformance(now);
  }

  private trackPerformance(now: number): void {
    this.frameCount++;
    const elapsed = now - this.frameWindowStart;
    if (elapsed < 2000) return;
    this.fps = (this.frameCount * 1000) / elapsed;
    this.frameCount = 0;
    this.frameWindowStart = now;
    this.emit('fps', this.fps);
    if (!this.autoQuality || this.time < this.warmupUntil) return;
    const limit = this.graphics?.fpsLimit ?? 0;
    const threshold = limit === 30 ? 25 : 42;
    if (this.fps < threshold) this.slowWindows++;
    else this.slowWindows = Math.max(0, this.slowWindows - 1);
    if (this.slowWindows >= 2) {
      this.slowWindows = 0;
      const index = QUALITY_LEVELS.indexOf(this.autoLevel);
      if (index > 0) {
        this.autoLevel = QUALITY_LEVELS[index - 1]!;
        this.emit('autodowngrade', this.autoLevel);
      }
    }
  }

  private onVisibility = (): void => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
    } else if (this.running) {
      this.last = performance.now();
      this.frameWindowStart = this.last;
      this.frameCount = 0;
      this.warmupUntil = this.time + 3;
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this.tick);
    }
  };

  private onContextLost = (event: Event): void => {
    event.preventDefault();
    cancelAnimationFrame(this.raf);
    this.emit('contextlost', undefined);
  };

  private onContextRestored = (): void => {
    this.emit('contextrestored', undefined);
    if (this.running) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
  };

  dispose(): void {
    this.stop();
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('resize', this.onWindowResize);
    window.removeEventListener('orientationchange', this.onWindowResize);
    this.resizeObserver?.disconnect();
    this.composer?.dispose();
    this.renderer.dispose();
  }
}
