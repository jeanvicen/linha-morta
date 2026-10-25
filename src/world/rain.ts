/**
 * GPU rain: camera-centred streaks that wrap inside a box (no per-frame CPU work), lit by the
 * car's headlight and hazard lights so drops glow when they cross a beam. Plus splash rings on
 * the ground and drifting fog banks.
 */
import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type Texture,
} from 'three';
import { createRng } from '../core/math';
import type { QualityLevel } from '../features/settings/settings';
import { NO_REFLECT_LAYER } from '../render/PlanarReflection';
import { FOG_GLSL } from './fog';
import { shared } from './uniforms';

export interface RainLights {
  headPos: Vector3;
  headDir: Vector3;
  headIntensity: { value: number };
  hazardA: Vector3;
  hazardB: Vector3;
  hazardIntensity: { value: number };
  /** Optional player flashlight (prologue). */
  flashPos: Vector3;
  flashDir: Vector3;
  flashIntensity: { value: number };
}

const RAIN_COUNT: Record<QualityLevel, number> = { low: 5000, medium: 11000, high: 20000, ultra: 32000 };
const SPLASH_COUNT: Record<QualityLevel, number> = { low: 120, medium: 260, high: 420, ultra: 640 };

const LIGHT_UNIFORMS_GLSL = /* glsl */ `
  uniform vec3 uHeadPos;
  uniform vec3 uHeadDir;
  uniform float uHeadIntensity;
  uniform vec3 uHazardA;
  uniform vec3 uHazardB;
  uniform float uHazardIntensity;
  uniform vec3 uFlashPos;
  uniform vec3 uFlashDir;
  uniform float uFlashIntensity;
  uniform float uLightning;

  vec3 lmPointLights( vec3 p ) {
    vec3 c = vec3( 0.0 );
    vec3 toP = p - uHeadPos;
    float d = length( toP );
    float cone = smoothstep( 0.86, 0.97, dot( toP / max( d, 1e-3 ), uHeadDir ) );
    c += vec3( 1.0, 0.92, 0.78 ) * uHeadIntensity * cone / ( 1.0 + d * d * 0.06 );
    vec3 fp = p - uFlashPos;
    float fd = length( fp );
    float fcone = smoothstep( 0.88, 0.98, dot( fp / max( fd, 1e-3 ), uFlashDir ) );
    c += vec3( 0.9, 0.95, 1.0 ) * uFlashIntensity * fcone / ( 1.0 + fd * fd * 0.15 );
    float ha = length( p - uHazardA );
    float hb = length( p - uHazardB );
    c += vec3( 1.0, 0.5, 0.1 ) * uHazardIntensity * ( 1.0 / ( 1.0 + ha * ha * 0.9 ) + 1.0 / ( 1.0 + hb * hb * 0.9 ) );
    c += vec3( 0.6, 0.66, 0.85 ) * uLightning * 1.4;
    return c;
  }
`;

function lightUniforms(lights: RainLights): Record<string, { value: unknown }> {
  return {
    uHeadPos: { value: lights.headPos },
    uHeadDir: { value: lights.headDir },
    uHeadIntensity: lights.headIntensity,
    uHazardA: { value: lights.hazardA },
    uHazardB: { value: lights.hazardB },
    uHazardIntensity: lights.hazardIntensity,
    uFlashPos: { value: lights.flashPos },
    uFlashDir: { value: lights.flashDir },
    uFlashIntensity: lights.flashIntensity,
    uLightning: shared.uLightning,
  };
}

export class Rain {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  readonly splashes: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly max = RAIN_COUNT.ultra;

  constructor(lights: RainLights, fogDensity: { value: number }) {
    const rng = createRng(17);
    const base = new PlaneGeometry(1, 1);
    base.translate(0, 0.5, 0);
    const geo = new InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position!);
    geo.setAttribute('uv', base.attributes.uv!);
    const offsets = new Float32Array(this.max * 4);
    for (let i = 0; i < this.max; i++) {
      offsets[i * 4] = rng() * 36;
      offsets[i * 4 + 1] = rng() * 22;
      offsets[i * 4 + 2] = rng() * 36;
      offsets[i * 4 + 3] = rng();
    }
    geo.setAttribute('aOffset', new InstancedBufferAttribute(offsets, 4));
    geo.instanceCount = RAIN_COUNT.high;

    const material = new ShaderMaterial({
      name: 'Rain',
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: shared.uTime,
        uCameraPos: shared.uCameraPos,
        uWind: shared.uWind,
        uRain: shared.uRain,
        uFogDensity: fogDensity,
        uBox: { value: new Vector3(36, 22, 36) },
        ...lightUniforms(lights),
      },
      vertexShader: /* glsl */ `
        attribute vec4 aOffset;
        uniform float uTime;
        uniform vec3 uCameraPos;
        uniform vec2 uWind;
        uniform vec3 uBox;
        uniform float uRain;
        varying vec2 vUv;
        varying vec3 vLight;
        varying float vAlpha;
        varying vec3 vWorld;
        ${LIGHT_UNIFORMS_GLSL}
        void main() {
          float speed = 9.5 + aOffset.w * 3.0;
          vec3 vel = vec3( uWind.x * 0.55, -speed, uWind.y * 0.55 );
          vec3 p = aOffset.xyz + vel * uTime;
          vec3 boxMin = uCameraPos - vec3( uBox.x * 0.5, 7.0, uBox.z * 0.5 );
          p = mod( p - boxMin, uBox ) + boxMin;
          vec3 dir = normalize( vel );
          vec3 toCam = normalize( cameraPosition - p );
          vec3 side = normalize( cross( dir, toCam ) );
          float dist = distance( cameraPosition, p );
          float width = 0.0045 + dist * 0.0011;
          float len = 0.55 + aOffset.w * 0.35;
          vec3 world = p + side * position.x * width - dir * position.y * len;
          vWorld = world;
          vUv = uv;
          vLight = lmPointLights( world );
          float nearFade = smoothstep( 0.4, 2.2, dist );
          float farFade = 1.0 - smoothstep( 14.0, 19.0, dist );
          vAlpha = nearFade * farFade * uRain * step( aOffset.w, uRain * 1.1 );
          gl_Position = projectionMatrix * viewMatrix * vec4( world, 1.0 );
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uFogDensity;
        varying vec2 vUv;
        varying vec3 vLight;
        varying float vAlpha;
        varying vec3 vWorld;
        ${FOG_GLSL}
        void main() {
          float across = 1.0 - abs( vUv.x - 0.5 ) * 2.0;
          float along = smoothstep( 0.0, 0.25, vUv.y ) * smoothstep( 1.0, 0.6, vUv.y );
          float a = across * across * along * vAlpha;
          vec3 base = vec3( 0.045, 0.05, 0.06 );
          vec3 col = ( base + vLight * 0.55 ) * a;
          float fog = lmFogFactor( vWorld, cameraPosition, uFogDensity );
          gl_FragColor = vec4( col * ( 1.0 - fog * 0.85 ), 1.0 );
        }
      `,
    });

    this.mesh = new Mesh(geo, material);
    this.mesh.name = 'Rain';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.layers.set(NO_REFLECT_LAYER);

    // Splash rings: positions derived in the shader from a hash of (instance, cycle).
    const splashBase = new PlaneGeometry(1, 1);
    splashBase.rotateX(-Math.PI / 2);
    const sgeo = new InstancedBufferGeometry();
    sgeo.index = splashBase.index;
    sgeo.setAttribute('position', splashBase.attributes.position!);
    sgeo.setAttribute('uv', splashBase.attributes.uv!);
    const seeds = new Float32Array(SPLASH_COUNT.ultra * 2);
    for (let i = 0; i < SPLASH_COUNT.ultra; i++) {
      seeds[i * 2] = rng();
      seeds[i * 2 + 1] = rng();
    }
    const seedAttr = new InstancedBufferAttribute(seeds, 2);
    seedAttr.setUsage(DynamicDrawUsage);
    sgeo.setAttribute('aSeed', seedAttr);
    sgeo.instanceCount = SPLASH_COUNT.high;
    const splashMat = new ShaderMaterial({
      name: 'RainSplash',
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      uniforms: {
        uTime: shared.uTime,
        uCameraPos: shared.uCameraPos,
        uRain: shared.uRain,
        uColor: { value: new Color('#9aa4ad') },
        uFogDensity: fogDensity,
        ...lightUniforms(lights),
      },
      vertexShader: /* glsl */ `
        attribute vec2 aSeed;
        uniform float uTime;
        uniform vec3 uCameraPos;
        varying vec2 vUv;
        varying float vPhase;
        varying vec3 vLight;
        varying vec3 vWorld;
        ${LIGHT_UNIFORMS_GLSL}
        float h( float n ) { return fract( sin( n ) * 43758.5453 ); }
        void main() {
          float period = 0.45 + aSeed.x * 0.35;
          float t = uTime / period + aSeed.y * 10.0;
          float cycle = floor( t );
          vPhase = fract( t );
          float a = h( cycle * 12.9898 + aSeed.x * 78.233 ) * 6.2831;
          float r = sqrt( h( cycle * 39.346 + aSeed.y * 11.135 ) ) * 14.0;
          vec3 center = vec3( uCameraPos.x + cos( a ) * r, 0.012, uCameraPos.z + sin( a ) * r - 4.0 );
          float size = 0.05 + vPhase * 0.22;
          vec3 world = center + position * size;
          vWorld = world;
          vUv = uv;
          vLight = lmPointLights( world + vec3( 0.0, 0.3, 0.0 ) );
          gl_Position = projectionMatrix * viewMatrix * vec4( world, 1.0 );
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uRain;
        uniform float uFogDensity;
        varying vec2 vUv;
        varying float vPhase;
        varying vec3 vLight;
        varying vec3 vWorld;
        ${FOG_GLSL}
        void main() {
          float d = length( vUv - 0.5 ) * 2.0;
          float ring = smoothstep( 0.62, 0.85, d ) * smoothstep( 1.0, 0.86, d );
          float dot0 = smoothstep( 0.25, 0.0, d ) * smoothstep( 0.3, 0.0, vPhase );
          float a = ( ring + dot0 ) * ( 1.0 - vPhase ) * 0.4 * uRain;
          vec3 col = uColor * 0.06 + vLight * 0.4;
          float fog = lmFogFactor( vWorld, cameraPosition, uFogDensity );
          gl_FragColor = vec4( col, a * ( 1.0 - fog ) );
        }
      `,
    });
    this.splashes = new Mesh(sgeo, splashMat);
    this.splashes.name = 'RainSplashes';
    this.splashes.frustumCulled = false;
    this.splashes.renderOrder = 9;
    this.splashes.layers.set(NO_REFLECT_LAYER);
  }

  setQuality(level: QualityLevel): void {
    this.mesh.geometry.instanceCount = RAIN_COUNT[level];
    this.splashes.geometry.instanceCount = SPLASH_COUNT[level];
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.splashes.geometry.dispose();
    this.splashes.material.dispose();
  }
}

/** Soft, drifting fog banks (camera-facing cards with animated noise). */
export class FogBanks {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly max = 40;

  constructor(noise: Texture, fogDensity: { value: number }) {
    const rng = createRng(61);
    const base = new PlaneGeometry(1, 1);
    const geo = new InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position!);
    geo.setAttribute('uv', base.attributes.uv!);
    const data = new Float32Array(this.max * 4);
    for (let i = 0; i < this.max; i++) {
      // Distributed along the road ahead of the default camera, mostly low to the ground.
      const z = 20 - rng() * 220;
      const lateral = (rng() - 0.5) * 50;
      data[i * 4] = lateral;
      data[i * 4 + 1] = 0.6 + Math.pow(rng(), 2) * 4;
      data[i * 4 + 2] = z;
      data[i * 4 + 3] = rng();
    }
    geo.setAttribute('aData', new InstancedBufferAttribute(data, 4));
    geo.instanceCount = 16;
    const material = new ShaderMaterial({
      name: 'FogBanks',
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: shared.uTime,
        uFogColor: shared.uFogColor,
        uLightning: shared.uLightning,
        uWind: shared.uWind,
        tNoise: { value: noise },
        uFogDensity: fogDensity,
      },
      vertexShader: /* glsl */ `
        attribute vec4 aData;
        uniform float uTime;
        uniform vec2 uWind;
        varying vec2 vUv;
        varying float vSeed;
        varying float vFade;
        varying vec3 vWorld;
        void main() {
          vec3 center = aData.xyz;
          center.x += sin( uTime * 0.03 + aData.w * 6.28 ) * 3.0 + uWind.x * uTime * 0.05;
          center.x = mod( center.x + 30.0, 60.0 ) - 30.0;
          float w = 18.0 + aData.w * 22.0;
          float hgt = 5.0 + aData.w * 5.0;
          vec3 right = vec3( viewMatrix[ 0 ][ 0 ], viewMatrix[ 1 ][ 0 ], viewMatrix[ 2 ][ 0 ] );
          vec3 world = center + right * position.x * w + vec3( 0.0, 1.0, 0.0 ) * position.y * hgt;
          vWorld = world;
          float d = distance( cameraPosition, center );
          vFade = smoothstep( 4.0, 14.0, d ) * ( 1.0 - smoothstep( 90.0, 160.0, d ) );
          vUv = uv;
          vSeed = aData.w;
          gl_Position = projectionMatrix * viewMatrix * vec4( world, 1.0 );
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uFogColor;
        uniform float uLightning;
        uniform sampler2D tNoise;
        varying vec2 vUv;
        varying float vSeed;
        varying float vFade;
        varying vec3 vWorld;
        void main() {
          vec2 p = vUv * vec2( 1.6, 0.7 ) + vec2( uTime * 0.008 + vSeed * 5.0, vSeed * 3.0 );
          float n = texture2D( tNoise, p ).r * 0.6 + texture2D( tNoise, p * 2.7 - uTime * 0.012 ).r * 0.4;
          float edge = smoothstep( 0.0, 0.3, vUv.x ) * smoothstep( 1.0, 0.7, vUv.x ) * smoothstep( 0.0, 0.25, vUv.y ) * smoothstep( 1.0, 0.45, vUv.y );
          float a = smoothstep( 0.35, 0.85, n ) * edge * vFade * 0.33;
          vec3 col = uFogColor * ( 1.25 + uLightning * 3.0 );
          gl_FragColor = vec4( col, a );
        }
      `,
    });
    this.mesh = new Mesh(geo, material);
    this.mesh.name = 'FogBanks';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.layers.set(NO_REFLECT_LAYER);
  }

  setQuality(level: QualityLevel): void {
    this.mesh.geometry.instanceCount = { low: 8, medium: 14, high: 22, ultra: 32 }[level];
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
