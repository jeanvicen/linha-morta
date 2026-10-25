/**
 * Height-aware exponential fog. three.js only provides distance fog, so the standard fog chunks are
 * replaced globally (before any material compiles) with a version that also accumulates dense mist
 * near the ground. World positions are reconstructed from the view matrix (rigid transform), which
 * works for instanced meshes too.
 */
import { ShaderChunk } from 'three';

let installed = false;

export const FOG_HEIGHT = {
  /** Extra density at ground level. */
  density: 0.028,
  /** How fast the ground mist thins out with altitude (1/m). */
  falloff: 0.32,
} as const;

export function installHeightFog(): void {
  if (installed) return;
  installed = true;

  ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
#endif
`;

  ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorldPos = ( mvPosition.xyz - viewMatrix[ 3 ].xyz ) * mat3( viewMatrix );
#endif
`;

  ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif

  float lmHeightFog( vec3 worldPos, vec3 camPos, float density ) {
    vec3 ray = worldPos - camPos;
    float dist = length( ray );
    float rdY = ray.y / max( dist, 1e-4 );
    float base = 1.0 - exp( - density * density * dist * dist );
    const float FALLOFF = ${FOG_HEIGHT.falloff.toFixed(4)};
    const float HDENS = ${FOG_HEIGHT.density.toFixed(4)};
    float camH = max( camPos.y, -2.0 );
    float k = FALLOFF * rdY * dist;
    float integral = abs( k ) > 1e-3 ? ( 1.0 - exp( - k ) ) / ( FALLOFF * rdY ) : dist;
    float heightAmount = HDENS * exp( - FALLOFF * camH ) * integral;
    return clamp( 1.0 - ( 1.0 - base ) * exp( - heightAmount ), 0.0, 1.0 );
  }
#endif
`;

  ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = lmHeightFog( vFogWorldPos, cameraPosition, fogDensity );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;
}

/** GLSL version of the same fog for custom ShaderMaterials (rain, light cones, fog cards). */
export const FOG_GLSL = /* glsl */ `
  float lmFogFactor( vec3 worldPos, vec3 camPos, float density ) {
    vec3 ray = worldPos - camPos;
    float dist = length( ray );
    float rdY = ray.y / max( dist, 1e-4 );
    float base = 1.0 - exp( - density * density * dist * dist );
    const float FALLOFF = ${FOG_HEIGHT.falloff.toFixed(4)};
    const float HDENS = ${FOG_HEIGHT.density.toFixed(4)};
    float camH = max( camPos.y, -2.0 );
    float k = FALLOFF * rdY * dist;
    float integral = abs( k ) > 1e-3 ? ( 1.0 - exp( - k ) ) / ( FALLOFF * rdY ) : dist;
    float heightAmount = HDENS * exp( - FALLOFF * camH ) * integral;
    return clamp( 1.0 - ( 1.0 - base ) * exp( - heightAmount ), 0.0, 1.0 );
  }
`;
