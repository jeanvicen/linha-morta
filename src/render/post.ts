/**
 * Final full-screen pass: ACES filmic tone mapping, cool cinematic grade, vignette, subtle
 * chromatic aberration, animated film grain and dithering (prevents banding in dark gradients).
 * Replaces three's OutputPass so everything happens in a single draw.
 */
import { Vector2 } from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

export function createFinalPass(): ShaderPass {
  const pass = new ShaderPass({
    name: 'FinalGradePass',
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uExposure: { value: 1.15 },
      uGrain: { value: 0.045 },
      uVignette: { value: 0.55 },
      uAberration: { value: 0.0018 },
      uGrade: { value: 1.0 },
      uResolution: { value: new Vector2(1, 1) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float uTime;
      uniform float uExposure;
      uniform float uGrain;
      uniform float uVignette;
      uniform float uAberration;
      uniform float uGrade;
      uniform vec2 uResolution;
      varying vec2 vUv;

      // ACES filmic (Stephen Hill fit), same curve family used by three.js.
      vec3 RRTAndODTFit( vec3 v ) {
        vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
        vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
        return a / b;
      }
      vec3 acesFilmic( vec3 color ) {
        const mat3 ACESInputMat = mat3(
          vec3( 0.59719, 0.07600, 0.02840 ),
          vec3( 0.35458, 0.90834, 0.13383 ),
          vec3( 0.04823, 0.01566, 0.83777 )
        );
        const mat3 ACESOutputMat = mat3(
          vec3(  1.60475, -0.10208, -0.00327 ),
          vec3( -0.53108,  1.10813, -0.07276 ),
          vec3( -0.07367, -0.00605,  1.07602 )
        );
        color *= uExposure / 0.6;
        color = ACESInputMat * color;
        color = RRTAndODTFit( color );
        color = ACESOutputMat * color;
        return clamp( color, 0.0, 1.0 );
      }
      vec3 linearToSRGB( vec3 c ) {
        return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, c ) );
      }
      float hash( vec2 p ) {
        vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
        p3 += dot( p3, p3.yzx + 33.33 );
        return fract( ( p3.x + p3.y ) * p3.z );
      }

      void main() {
        vec2 centered = vUv - 0.5;
        float r2 = dot( centered, centered );
        vec2 offset = centered * r2 * uAberration * 4.0;
        vec3 col;
        col.r = texture2D( tDiffuse, vUv + offset ).r;
        col.g = texture2D( tDiffuse, vUv ).g;
        col.b = texture2D( tDiffuse, vUv - offset ).b;

        col = acesFilmic( col );

        // Grade: cool, slightly desaturated shadows; neutral highlights.
        float luma = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
        vec3 graded = mix( vec3( luma ), col, 0.86 );
        graded *= mix( vec3( 0.93, 0.99, 1.07 ), vec3( 1.03, 1.0, 0.96 ), smoothstep( 0.05, 0.6, luma ) );
        graded = graded * 0.985 + vec3( 0.004, 0.006, 0.009 );
        col = mix( col, graded, uGrade );

        float vig = smoothstep( 0.85, 0.18, r2 * 2.2 );
        col *= mix( 1.0, vig, uVignette );

        col = linearToSRGB( col );

        float n = hash( vUv * uResolution + fract( uTime * 13.37 ) * 1000.0 ) - 0.5;
        col += n * uGrain * ( 1.0 - luma * 0.5 );
        // Triangular dither to break up 8-bit banding.
        col += ( hash( vUv * uResolution + 0.71 ) + hash( vUv * uResolution + 1.37 ) - 1.0 ) / 255.0;
        gl_FragColor = vec4( col, 1.0 );
      }
    `,
  });
  pass.needsSwap = true;
  return pass;
}
