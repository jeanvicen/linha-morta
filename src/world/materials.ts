/**
 * Shader patches shared by foliage materials: wind sway in world space (works with instancing)
 * and leaf flutter. Applied through onBeforeCompile so the PBR lighting, shadows and fog of the
 * standard materials are preserved.
 */
import type { Material, WebGLProgramParametersWithUniforms } from 'three';
import { shared } from './uniforms';

export interface WindOptions {
  /** Sway amplitude per meter² of height (object space). */
  sway: number;
  /** Leaf flutter amplitude in meters (0 disables). */
  flutter?: number;
  /** Shift used to compute the height factor (e.g. for meshes whose base is not at y = 0). */
  baseY?: number;
}

export function windVertexPatch(shader: WebGLProgramParametersWithUniforms, opts: WindOptions): void {
  shader.uniforms.uTime = shared.uTime;
  shader.uniforms.uWind = shared.uWind;
  shader.uniforms.uGust = shared.uGust;
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      /* glsl */ `#include <common>
      uniform float uTime;
      uniform vec2 uWind;
      uniform float uGust;`,
    )
    .replace(
      '#include <begin_vertex>',
      /* glsl */ `#include <begin_vertex>
      {
        vec3 lmInst = vec3( 0.0 );
        vec3 lmWorldWind = vec3( uWind.x, 0.0, uWind.y );
        vec3 lmLocalWind = lmWorldWind;
        #ifdef USE_INSTANCING
          lmInst = instanceMatrix[ 3 ].xyz;
          lmLocalWind = ( lmWorldWind * mat3( instanceMatrix ) ) / max( dot( instanceMatrix[ 0 ].xyz, instanceMatrix[ 0 ].xyz ), 1e-4 );
        #endif
        float lmPhase = dot( lmInst.xz, vec2( 0.173, 0.091 ) );
        float lmH = max( position.y - ${(opts.baseY ?? 0).toFixed(3)}, 0.0 );
        float lmGustWave = 0.55 + 0.45 * sin( uTime * 0.55 + lmPhase ) * sin( uTime * 0.23 + lmPhase * 1.7 );
        float lmSway = lmH * lmH * ${opts.sway.toExponential(4)} * ( 0.6 + uGust * 0.8 ) * lmGustWave;
        float lmOsc = 0.65 + 0.35 * sin( uTime * 1.6 + lmPhase * 2.3 + lmH * 0.15 );
        transformed += lmLocalWind * lmSway * lmOsc;
        ${
          opts.flutter
            ? `float lmF = sin( uTime * 7.0 + dot( position, vec3( 3.1, 1.7, 2.3 ) ) + lmPhase ) * ${opts.flutter.toFixed(4)} * ( 0.5 + uGust );
        transformed += objectNormal * lmF * min( lmH * 0.3, 1.0 );`
            : ''
        }
      }`,
    );
}

/** Applies the wind patch to a material and its depth material (so shadows sway too). */
export function applyWind(material: Material, opts: WindOptions, key: string): void {
  material.onBeforeCompile = (shader) => windVertexPatch(shader, opts);
  material.customProgramCacheKey = () => `lm-wind-${key}`;
}
