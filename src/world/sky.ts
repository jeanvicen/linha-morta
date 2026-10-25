/** Procedural stormy night sky dome with drifting clouds, a hidden moon and lightning. */
import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3, type Texture } from 'three';
import { shared } from './uniforms';

export class Sky {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  readonly moonDir = new Vector3(-0.45, 0.42, -0.78).normalize();
  readonly flashDir = new Vector3(0.3, 0.5, -0.8).normalize();

  constructor(noise: Texture) {
    const material = new ShaderMaterial({
      name: 'SkyMaterial',
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: shared.uTime,
        uLightning: shared.uLightning,
        uFogColor: shared.uFogColor,
        tNoise: { value: noise },
        uZenith: { value: new Color('#020306') },
        uHorizon: { value: new Color('#121922') },
        uMoonDir: { value: this.moonDir },
        uFlashDir: { value: this.flashDir },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
          gl_Position = p.xyww;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uLightning;
        uniform vec3 uFogColor;
        uniform sampler2D tNoise;
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uMoonDir;
        uniform vec3 uFlashDir;
        varying vec3 vDir;

        float fbm( vec2 p ) {
          float v = 0.0;
          float a = 0.5;
          for ( int i = 0; i < 4; i++ ) {
            v += texture2D( tNoise, p ).r * a;
            p = p * 2.03 + vec2( 0.17, 0.31 );
            a *= 0.5;
          }
          return v / 0.9375;
        }

        void main() {
          vec3 d = normalize( vDir );
          float h = d.y;
          vec3 col = mix( uHorizon, uZenith, pow( clamp( h, 0.0, 1.0 ), 0.55 ) );

          vec2 uv = d.xz / ( max( h, 0.0 ) + 0.16 ) * 0.11;
          vec2 drift = vec2( uTime * 0.0011, uTime * 0.0004 );
          float c = fbm( uv + drift );
          float c2 = fbm( uv * 2.3 - drift * 1.7 + c * 0.15 );
          float density = smoothstep( 0.32, 0.78, c * 0.75 + c2 * 0.35 );

          float moonAmt = max( dot( d, uMoonDir ), 0.0 );
          vec3 dark = vec3( 0.006, 0.0075, 0.010 );
          vec3 lit = vec3( 0.042, 0.05, 0.064 );
          vec3 cloudCol = mix( lit, dark, density ) + vec3( 0.06, 0.07, 0.09 ) * pow( moonAmt, 6.0 ) * ( 1.0 - density * 0.7 );
          col = mix( col, cloudCol, 0.55 + density * 0.4 );
          col += vec3( 0.35, 0.42, 0.55 ) * pow( moonAmt, 180.0 ) * 0.5 * ( 1.0 - density );

          float flashShape = 0.35 + 0.65 * pow( max( dot( d, uFlashDir ), 0.0 ), 2.5 );
          col += vec3( 0.55, 0.62, 0.8 ) * uLightning * flashShape * ( 0.25 + c2 * 1.2 ) * 2.2;

          col = mix( col, uFogColor, smoothstep( 0.2, -0.03, h ) );
          gl_FragColor = vec4( col, 1.0 );
        }
      `,
    });
    this.mesh = new Mesh(new SphereGeometry(800, 48, 24), material);
    this.mesh.name = 'Sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  update(cameraPosition: Vector3): void {
    this.mesh.position.copy(cameraPosition);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
