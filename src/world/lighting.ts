/**
 * Cinematic lighting: dim moonlight through storm clouds, the car's surviving headlight with a
 * volumetric beam, blinking hazard lights, mysterious distant headlights in the fog and lightning.
 */
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  PointLight,
  Quaternion,
  ShaderMaterial,
  SpotLight,
  Vector3,
  type Sprite,
  type SpriteMaterial,
  type Texture,
} from 'three';
import { clamp, damp, fbm1D } from '../core/math';
import type { ShadowQuality } from '../features/settings/settings';
import { NO_REFLECT_LAYER } from '../render/PlanarReflection';
import type { CarLights } from './car';
import { FOG_GLSL } from './fog';
import { createGlow, roadPoint } from './props';
import type { RainLights } from './rain';
import { shared } from './uniforms';

export interface LightingEvents {
  onThunder?: (intensity: number, delaySeconds: number) => void;
  onHazardRelay?: (on: boolean) => void;
  onDistantLights?: (active: boolean) => void;
}

const SHADOW_SIZES: Record<ShadowQuality, { spot: number; moon: number }> = {
  off: { spot: 0, moon: 0 },
  low: { spot: 512, moon: 0 },
  high: { spot: 1024, moon: 2048 },
  ultra: { spot: 2048, moon: 4096 },
};

function createBeam(noise: Texture, fogDensity: { value: number }): Mesh<CylinderGeometry, ShaderMaterial> {
  const length = 26;
  const geo = new CylinderGeometry(0.09, 5.2, length, 40, 16, true);
  geo.translate(0, -length / 2, 0);
  geo.rotateX(Math.PI / 2); // tip at the origin, cone extends along -Z
  const mat = new ShaderMaterial({
    name: 'HeadlightBeam',
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms: {
      uTime: shared.uTime,
      uIntensity: { value: 1 },
      uColor: { value: new Color('#ffe9c8') },
      tNoise: { value: noise },
      uLength: { value: length },
      uFogDensity: fogDensity,
      uRain: shared.uRain,
    },
    vertexShader: /* glsl */ `
      uniform float uLength;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying float vAlong;
      void main() {
        vec4 w = modelMatrix * vec4( position, 1.0 );
        vWorld = w.xyz;
        vNormalW = normalize( mat3( modelMatrix ) * normal );
        vAlong = clamp( -position.z / uLength, 0.0, 1.0 );
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uIntensity;
      uniform vec3 uColor;
      uniform sampler2D tNoise;
      uniform float uFogDensity;
      uniform float uRain;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying float vAlong;
      ${FOG_GLSL}
      void main() {
        vec3 V = normalize( cameraPosition - vWorld );
        float facing = abs( dot( normalize( vNormalW ), V ) );
        float body = pow( facing, 2.2 );
        float atten = pow( 1.0 - vAlong, 1.6 ) * smoothstep( 0.0, 0.04, vAlong );
        float dust = texture2D( tNoise, vWorld.xz * 0.08 + vec2( uTime * 0.02, uTime * 0.01 ) ).r;
        float streaks = texture2D( tNoise, vec2( vWorld.x * 0.9 + vWorld.z * 0.9, vWorld.y * 0.15 + uTime * 1.6 ) ).r;
        float ground = smoothstep( -0.05, 0.6, vWorld.y );
        float a = body * atten * ground * ( 0.55 + dust * 0.6 ) * ( 0.85 + streaks * 0.3 * uRain );
        float fog = lmFogFactor( vWorld, cameraPosition, uFogDensity );
        gl_FragColor = vec4( uColor * a * uIntensity * 0.16 * ( 1.0 - fog * 0.7 ), 1.0 );
      }
    `,
  });
  const mesh = new Mesh(geo, mat);
  mesh.name = 'HeadlightBeam';
  mesh.frustumCulled = false;
  mesh.renderOrder = 11;
  mesh.layers.set(NO_REFLECT_LAYER);
  return mesh;
}

export class Lighting {
  readonly group = new Group();
  readonly hemi = new HemisphereLight('#3d4a5c', '#0c0e0c', 0.75);
  readonly moon = new DirectionalLight('#9db3d8', 0.32);
  readonly headlight = new SpotLight('#ffe7c2', 160, 75, 0.42, 0.55, 1.6);
  readonly hazardA = new PointLight('#ff8f22', 0, 13, 1.6);
  readonly hazardB = new PointLight('#ff8f22', 0, 13, 1.6);
  readonly distant = new PointLight('#e8ecff', 0, 45, 1.4);
  readonly flashlight = new SpotLight('#f1f4ff', 0, 32, 0.36, 0.45, 1.5);
  readonly rainLights: RainLights;
  private readonly beam: Mesh<CylinderGeometry, ShaderMaterial>;
  private readonly hazardGlows: Sprite[];
  private readonly headGlow: Sprite;
  private readonly distantGlows: Sprite[];
  private readonly moonColor = new Color('#9db3d8');
  private readonly flashColor = new Color('#c9d6ff');
  private readonly baseFog = new Color();
  private hazardLevel = 0;
  private hazardOn = false;
  private headLevel = 1;
  private headFlickerUntil = 0;
  private nextHeadFlicker = 9;
  private nextLightning = 7;
  private lightningStart = -10;
  private lightningStrength = 1;
  private nextDistant = 18;
  private distantStart = -100;
  private readonly events: LightingEvents;
  private time = 0;
  reduceFlashes = false;
  reducedMotion = false;
  /** When false, lightning and distant lights are not scheduled (e.g. during the loading screen). */
  eventsEnabled = true;
  /** Scripted override for the distant lights (prologue ending): road z and brightness. */
  scriptedDistant: { z: number; level: number } | null = null;

  constructor(car: CarLights, glow: Texture, noise: Texture, fogDensity: { value: number }, events: LightingEvents = {}) {
    this.events = events;
    this.group.add(this.hemi, this.moon, this.moon.target, this.headlight, this.headlight.target, this.hazardA, this.hazardB, this.distant, this.flashlight, this.flashlight.target);

    this.moon.position.set(-40, 60, -50);
    this.moon.shadow.camera.left = -38;
    this.moon.shadow.camera.right = 38;
    this.moon.shadow.camera.top = 38;
    this.moon.shadow.camera.bottom = -38;
    this.moon.shadow.camera.near = 1;
    this.moon.shadow.camera.far = 180;
    this.moon.shadow.bias = -0.0004;
    this.moon.shadow.normalBias = 0.03;
    this.moon.shadow.radius = 3;

    this.headlight.position.copy(car.headlightPos);
    this.headlight.target.position.copy(car.headlightPos).addScaledVector(car.headlightDir, 10);
    this.headlight.shadow.bias = -0.0006;
    this.headlight.shadow.normalBias = 0.02;
    this.headlight.shadow.camera.near = 0.3;
    this.headlight.shadow.camera.far = 60;
    this.headlight.shadow.radius = 2;
    this.hazardA.position.copy(car.hazardFront);
    this.hazardB.position.copy(car.hazardRear);
    this.flashlight.shadow.bias = -0.0005;

    this.beam = createBeam(noise, fogDensity);
    this.beam.position.copy(car.headlightPos);
    const q = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(), car.headlightDir, new Vector3(0, 1, 0)));
    this.beam.quaternion.copy(q);
    this.group.add(this.beam);

    this.headGlow = createGlow(glow, '#fff0d8', 6, 0.7);
    this.headGlow.position.copy(car.headlightPos).addScaledVector(car.headlightDir, 0.08);
    this.hazardGlows = [createGlow(glow, '#ff8a1c', 5, 0.55), createGlow(glow, '#ff8a1c', 5, 0.55)];
    this.hazardGlows[0]!.position.copy(car.hazardFront);
    this.hazardGlows[1]!.position.copy(car.hazardRear);
    this.distantGlows = [createGlow(glow, '#f2f4ff', 12, 2.6), createGlow(glow, '#f2f4ff', 12, 2.6)];
    for (const s of [this.headGlow, ...this.hazardGlows, ...this.distantGlows]) this.group.add(s);
    for (const s of this.distantGlows) s.visible = false;

    this.rainLights = {
      headPos: this.headlight.position,
      headDir: car.headlightDir,
      headIntensity: { value: 1 },
      hazardA: this.hazardA.position,
      hazardB: this.hazardB.position,
      hazardIntensity: { value: 0 },
      flashPos: this.flashlight.position,
      flashDir: new Vector3(0, 0, -1),
      flashIntensity: { value: 0 },
    };
  }

  setShadows(quality: ShadowQuality): void {
    const sizes = SHADOW_SIZES[quality];
    const configure = (light: SpotLight | DirectionalLight, size: number): void => {
      light.castShadow = size > 0;
      if (size > 0 && light.shadow.mapSize.x !== size) {
        light.shadow.mapSize.set(size, size);
        light.shadow.map?.dispose();
        light.shadow.map = null;
      }
    };
    configure(this.headlight, sizes.spot);
    configure(this.moon, sizes.moon);
    configure(this.flashlight, sizes.spot > 0 ? Math.min(1024, sizes.spot) : 0);
  }

  /** Keeps the moon's shadow frustum centred near the camera (snapped to avoid shimmering). */
  followCamera(pos: Vector3): void {
    const snap = 4;
    const cx = Math.round(pos.x / snap) * snap;
    const cz = Math.round((pos.z - 12) / snap) * snap;
    this.moon.target.position.set(cx, 0, cz);
    this.moon.position.set(cx - 40, 60, cz - 50);
  }

  update(dt: number, time: number, baseFogColor: Color, fogColorOut: Color): void {
    this.time = time;

    // Hazard lights: ~80 blinks per minute with an incandescent ramp.
    const on = time % 0.75 < 0.38;
    if (on !== this.hazardOn) {
      this.hazardOn = on;
      this.events.onHazardRelay?.(on);
    }
    this.hazardLevel = damp(this.hazardLevel, on ? 1 : 0, on ? 30 : 14, dt);
    const hz = this.hazardLevel;
    this.hazardA.intensity = hz * 5;
    this.hazardB.intensity = hz * 5;
    this.rainLights.hazardIntensity.value = hz * 1.2;
    for (const g of this.hazardGlows) (g.material as SpriteMaterial).opacity = hz;

    // Dying headlight: occasional flicker.
    let head = 1;
    if (!this.reduceFlashes) {
      if (time > this.nextHeadFlicker) {
        this.headFlickerUntil = time + 0.6 + Math.random() * 0.8;
        this.nextHeadFlicker = time + 7 + Math.random() * 16;
      }
      if (time < this.headFlickerUntil) head = clamp(0.55 + fbm1D(time * 22, 4) * 0.9, 0.05, 1);
    }
    head *= 0.93 + 0.07 * fbm1D(time * 1.3, 9);
    this.headLevel = damp(this.headLevel, head, 40, dt);
    this.headlight.intensity = 160 * this.headLevel;
    this.beam.material.uniforms.uIntensity!.value = this.headLevel;
    this.rainLights.headIntensity.value = this.headLevel * 1.4;
    (this.headGlow.material as SpriteMaterial).opacity = this.headLevel;

    // Lightning.
    let flash = 0;
    if (this.eventsEnabled && time > this.nextLightning) {
      this.lightningStart = time;
      this.lightningStrength = 0.6 + Math.random() * 0.4;
      this.nextLightning = time + 14 + Math.random() * 26;
      this.events.onThunder?.(this.lightningStrength, 1.2 + Math.random() * 3);
    }
    const lt = time - this.lightningStart;
    if (lt >= 0 && lt < 1.2) {
      const pulse = (t: number, at: number, width: number): number => Math.exp(-((t - at) ** 2) / (width * width));
      flash = (pulse(lt, 0.05, 0.03) * 1.0 + pulse(lt, 0.2, 0.04) * 0.55 + pulse(lt, 0.34, 0.05) * 0.85 + Math.exp(-Math.max(0, lt - 0.34) * 5) * 0.12 * (lt > 0.34 ? 1 : 0)) * this.lightningStrength;
      if (this.reduceFlashes) flash = Math.min(flash, 0.12) * 0.6;
    }
    shared.uLightning.value = flash;
    this.moon.intensity = 0.32 + flash * 9;
    this.moon.color.copy(this.moonColor).lerp(this.flashColor, clamp(flash, 0, 1));
    this.hemi.intensity = 0.75 + flash * 2.2;
    fogColorOut.copy(baseFogColor).lerp(this.baseFog.setRGB(0.09, 0.1, 0.13), clamp(flash * 0.8, 0, 1));

    // Mysterious distant headlights approaching through the fog, then vanishing.
    if (this.eventsEnabled && time > this.nextDistant && time - this.distantStart > 40) {
      this.distantStart = time;
      this.nextDistant = time + 45 + Math.random() * 45;
      this.events.onDistantLights?.(true);
    }
    const dtime = time - this.distantStart;
    const duration = 26;
    if (this.scriptedDistant) {
      const { z, level } = this.scriptedDistant;
      const p = roadPoint(z, -1.8);
      for (let i = 0; i < 2; i++) {
        const g = this.distantGlows[i]!;
        g.visible = level > 0.01;
        g.position.set(p.x + (i === 0 ? -0.72 : 0.72), 0.75, p.z);
        (g.material as SpriteMaterial).opacity = Math.min(1, level);
        g.scale.setScalar(2.6 * Math.max(1, level));
      }
      this.distant.position.set(p.x, 1.2, p.z + 3);
      this.distant.intensity = level * 60;
    } else if (dtime >= 0 && dtime < duration) {
      const t = dtime / duration;
      const z = -270 + t * 150;
      const fadeIn = clamp(dtime / 3, 0, 1);
      const fadeOut = 1 - clamp((dtime - (duration - 2.5)) / 2.5, 0, 1);
      const level = fadeIn * fadeOut;
      const p = roadPoint(z, -1.8);
      for (let i = 0; i < 2; i++) {
        const g = this.distantGlows[i]!;
        g.visible = level > 0.01;
        g.position.set(p.x + (i === 0 ? -0.72 : 0.72), 0.75, p.z);
        (g.material as SpriteMaterial).opacity = level;
        g.scale.setScalar(2.6);
      }
      this.distant.position.set(p.x, 1.2, p.z + 3);
      this.distant.intensity = level * 60;
      if (dtime + dt >= duration) this.events.onDistantLights?.(false);
    } else {
      for (const g of this.distantGlows) g.visible = false;
      this.distant.intensity = 0;
    }
  }

  /** Points the player's flashlight (prologue). */
  setFlashlight(on: boolean, position: Vector3, direction: Vector3): void {
    this.flashlight.intensity = on ? 55 : 0;
    this.flashlight.position.copy(position);
    this.flashlight.target.position.copy(position).add(direction);
    this.rainLights.flashPos.copy(position);
    this.rainLights.flashDir.copy(direction);
    this.rainLights.flashIntensity.value = on ? 1 : 0;
  }

  get elapsed(): number {
    return this.time;
  }

  dispose(): void {
    this.beam.geometry.dispose();
    this.beam.material.dispose();
    for (const s of [this.headGlow, ...this.hazardGlows, ...this.distantGlows]) s.material.dispose();
    this.headlight.dispose();
    this.moon.dispose();
    this.flashlight.dispose();
  }
}

