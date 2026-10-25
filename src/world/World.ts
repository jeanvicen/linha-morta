/**
 * Assembles the abandoned highway: sky, fog, terrain, road, car, vegetation, props, rain and
 * lighting. Building is split into async stages so the loading screen can report real progress.
 */
import {
  Color,
  FogExp2,
  Group,
  PMREMGenerator,
  Scene,
  type PerspectiveCamera,
  type Texture,
  Vector2,
  type WebGLRenderer,
} from 'three';
import { yieldToMain } from '../core/dom';
import type { GraphicsSettings, QualityLevel } from '../features/settings/settings';
import { AbandonedCar } from './car';
import { installHeightFog } from './fog';
import { Lighting, type LightingEvents } from './lighting';
import { NoiseField } from './procedural/noise';
import {
  createBarkTextures,
  createFoliageAtlas,
  createGlowTexture,
  createGroundTextures,
  createNoiseDataTexture,
  createRoadTextures,
  createShadowBlobTexture,
  type RoadTextures,
  type SurfaceTextures,
} from './procedural/textures';
import { Props, createTreeline } from './props';
import { FogBanks, Rain } from './rain';
import { createRoad, createTerrain, type RoadUniforms } from './road';
import { Sky } from './sky';
import { shared } from './uniforms';
import { Forest, Grass } from './vegetation';
import { PlanarReflection } from '../render/PlanarReflection';

export const BASE_FOG_COLOR = new Color('#1a2027');
const FOG_DENSITY = 0.019;

interface WorldTextures {
  road: RoadTextures;
  ground: SurfaceTextures;
  barkE: SurfaceTextures;
  barkD: SurfaceTextures;
  foliage: Texture;
  glow: Texture;
  blob: Texture;
  noise: Texture;
}

export type WorldStage = 'textures' | 'scene' | 'vegetation' | 'atmosphere';

export class World {
  readonly scene = new Scene();
  readonly reflection = new PlanarReflection(0.5);
  readonly fogDensity = { value: FOG_DENSITY };
  readonly fogColor = new Color().copy(BASE_FOG_COLOR);
  sky!: Sky;
  car!: AbandonedCar;
  forest!: Forest;
  grass!: Grass;
  props!: Props;
  rain!: Rain;
  fogBanks!: FogBanks;
  lighting!: Lighting;
  private roadUniforms!: RoadUniforms;
  private textures!: WorldTextures;
  private readonly disposers: (() => void)[] = [];
  private readonly hideInReflection: { visible: boolean }[] = [];
  private envMap: Texture | null = null;
  private reduceFlashes = false;
  private readonly drawSize = new Vector2();
  private shadowsOn: boolean | null = null;

  constructor(private readonly renderer: WebGLRenderer) {
    installHeightFog();
    this.scene.fog = new FogExp2(this.fogColor.getHex(), FOG_DENSITY);
    this.scene.background = null;
  }

  /** Runs one build stage. Stages must be executed in order. */
  async build(stage: WorldStage, level: QualityLevel, events: LightingEvents = {}): Promise<void> {
    switch (stage) {
      case 'textures':
        return this.buildTextures(level);
      case 'scene':
        return this.buildScene(level);
      case 'vegetation':
        return this.buildVegetation();
      case 'atmosphere':
        return this.buildAtmosphere(events);
    }
  }

  private async buildTextures(level: QualityLevel): Promise<void> {
    const big = level === 'high' || level === 'ultra';
    const aniso = Math.min(this.renderer.capabilities.getMaxAnisotropy(), big ? 8 : 4);
    const noise = new NoiseField(256, 1, 6, 4);
    await yieldToMain();
    const detail = new NoiseField(128, 2, 4, 8);
    await yieldToMain();
    const road = createRoadTextures(big ? 1024 : 512, noise, detail, aniso);
    await yieldToMain();
    const ground = createGroundTextures(big ? 512 : 256, noise, detail, aniso);
    await yieldToMain();
    const barkE = createBarkTextures('eucalyptus', big ? 256 : 128, noise, detail);
    const barkD = createBarkTextures('dark', big ? 256 : 128, noise, detail);
    await yieldToMain();
    const foliage = createFoliageAtlas(big ? 1024 : 512);
    await yieldToMain();
    this.textures = {
      road,
      ground,
      barkE,
      barkD,
      foliage,
      glow: createGlowTexture(),
      blob: createShadowBlobTexture(),
      noise: createNoiseDataTexture(noise),
    };
    this.disposers.push(() => {
      const t = this.textures;
      for (const tex of [t.road.map, t.road.orm, t.road.normal, t.ground.map, t.ground.normal, t.ground.rough, t.barkE.map, t.barkE.normal, t.barkD.map, t.barkD.normal, t.foliage, t.glow, t.blob, t.noise]) tex?.dispose();
    });
  }

  private async buildScene(level: QualityLevel): Promise<void> {
    const t = this.textures;
    this.sky = new Sky(t.noise);
    this.scene.add(this.sky.mesh);
    this.disposers.push(() => this.sky.dispose());

    const terrain = createTerrain(t.ground, level === 'low' ? 110 : level === 'medium' ? 160 : 230);
    this.scene.add(terrain);
    this.disposers.push(() => {
      terrain.geometry.dispose();
      (terrain.material as { dispose(): void }).dispose();
    });
    await yieldToMain();

    const road = createRoad(t.road, t.noise, { texture: this.reflection.target.texture, matrix: this.reflection.textureMatrix });
    this.roadUniforms = road.uniforms;
    this.scene.add(road.mesh);
    this.hideInReflection.push(road.mesh);
    this.disposers.push(() => {
      road.mesh.geometry.dispose();
      (road.mesh.material as { dispose(): void }).dispose();
    });

    this.car = new AbandonedCar(t.blob);
    this.scene.add(this.car.group);
    this.disposers.push(() => this.car.dispose());
    await yieldToMain();

    this.props = new Props(t.glow);
    this.scene.add(this.props.group);
    const treeline = createTreeline();
    this.scene.add(treeline.mesh);
    this.disposers.push(() => this.props.dispose(), treeline.dispose);
  }

  private async buildVegetation(): Promise<void> {
    const t = this.textures;
    this.forest = new Forest(this.renderer, {
      foliage: t.foliage,
      barkEucalyptus: { map: t.barkE.map, normal: t.barkE.normal },
      barkDark: { map: t.barkD.map, normal: t.barkD.normal },
    });
    this.scene.add(this.forest.group);
    await yieldToMain();
    this.grass = new Grass();
    this.scene.add(this.grass.group);
    this.disposers.push(() => this.forest.dispose(), () => this.grass.dispose());
  }

  private async buildAtmosphere(events: LightingEvents): Promise<void> {
    const t = this.textures;
    this.lighting = new Lighting(this.car.lights, t.glow, t.noise, this.fogDensity, events);
    this.scene.add(this.lighting.group);
    this.rain = new Rain(this.lighting.rainLights, this.fogDensity);
    this.fogBanks = new FogBanks(t.noise, this.fogDensity);
    this.scene.add(this.rain.mesh, this.rain.splashes, this.fogBanks.mesh);
    this.disposers.push(() => this.lighting.dispose(), () => this.rain.dispose(), () => this.fogBanks.dispose());
    await yieldToMain();

    // Image-based lighting from the stormy sky so wet surfaces pick up faint reflections.
    const pmrem = new PMREMGenerator(this.renderer);
    const envScene = new Scene();
    const envSky = new Sky(t.noise);
    envScene.add(envSky.mesh);
    envScene.add(new Group());
    this.envMap = pmrem.fromScene(envScene, 0.02, 1, 1000).texture;
    envSky.dispose();
    pmrem.dispose();
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 1;
    this.disposers.push(() => this.envMap?.dispose());
  }

  applyGraphics(g: GraphicsSettings): void {
    this.forest.setDensity(g.density);
    this.grass.setDensity(g.density);
    this.rain.setQuality(g.particles);
    this.fogBanks.setQuality(g.particles);
    this.lighting.setShadows(g.shadows);
    const shadowsOn = g.shadows !== 'off';
    this.renderer.shadowMap.enabled = shadowsOn;
    this.reflection.enabled = g.reflections !== 'off';
    this.reflection.scale = g.reflections === 'high' ? 0.5 : 0.3;
    this.roadUniforms.uReflStrength.value = g.reflections === 'off' ? 0 : 1;
    // Toggling shadow maps requires shader recompilation for receivers.
    if (this.shadowsOn === shadowsOn) return;
    const first = this.shadowsOn === null;
    this.shadowsOn = shadowsOn;
    if (first) return;
    this.scene.traverse((o) => {
      const mat = (o as { material?: { needsUpdate: boolean } | { needsUpdate: boolean }[] }).material;
      if (Array.isArray(mat)) mat.forEach((m) => (m.needsUpdate = true));
      else if (mat) mat.needsUpdate = true;
    });
  }

  setAccessibility(reduceFlashes: boolean, reducedMotion: boolean): void {
    this.reduceFlashes = reduceFlashes;
    this.lighting.reduceFlashes = reduceFlashes;
    this.lighting.reducedMotion = reducedMotion;
  }

  setEventsEnabled(enabled: boolean): void {
    this.lighting.eventsEnabled = enabled;
  }

  /** Called by the renderer before the main pass. */
  renderReflection(camera: PerspectiveCamera): void {
    if (!this.reflection.enabled) return;
    const size = this.renderer.getDrawingBufferSize(this.drawSize);
    this.reflection.setSize(size.x, size.y);
    this.roadUniforms.uReflTexel.value.set(1 / this.reflection.target.width, 1 / this.reflection.target.height);
    this.reflection.render(this.renderer, this.scene, camera, this.hideInReflection);
  }

  update(dt: number, time: number, camera: PerspectiveCamera): void {
    shared.uTime.value = time;
    shared.uCameraPos.value.copy(camera.position);
    // Gusty wind.
    const gust = 0.5 + 0.5 * Math.sin(time * 0.13) * Math.sin(time * 0.071 + 1.1);
    shared.uGust.value = gust;
    shared.uWind.value.set(1.2 + gust * 1.4, 0.4 + gust * 0.5);

    this.lighting.update(dt, time, BASE_FOG_COLOR, this.fogColor);
    this.lighting.followCamera(camera.position);
    (this.scene.fog as FogExp2).color.copy(this.fogColor);
    (this.scene.fog as FogExp2).density = this.fogDensity.value;
    shared.uFogColor.value.copy(this.fogColor);
    this.car.setLightLevels(this.lighting.rainLights.hazardIntensity.value / 1.2, this.lighting.headlight.intensity / 160, 0);
    this.props.update(time, this.reduceFlashes);
    this.sky.update(camera.position);
    this.forest.update(camera.position);
  }

  dispose(): void {
    for (const d of this.disposers.reverse()) {
      try {
        d();
      } catch (error) {
        console.warn('[world] dispose failed', error);
      }
    }
    this.reflection.dispose();
  }
}
