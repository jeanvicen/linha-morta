/**
 * The wet asphalt road (ribbon mesh following the road path) and the surrounding terrain.
 * The road material is a MeshStandardMaterial extended with planar reflections stretched into
 * vertical streaks, puddle masks and animated raindrop ripples.
 */
import type {
  Texture} from 'three';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Vector2,
  type Matrix4,
} from 'three';
import { ROAD, roadCenterX, roadSlope, terrainHeight } from './layout';
import { ROAD_TEX, type RoadTextures, type SurfaceTextures } from './procedural/textures';
import { shared } from './uniforms';
import { NO_REFLECT_LAYER } from '../render/PlanarReflection';

export interface RoadReflectionInput {
  texture: Texture;
  matrix: Matrix4;
}

export interface RoadUniforms {
  uReflStrength: { value: number };
  uReflTexel: { value: Vector2 };
  tReflection: { value: Texture };
}

const CROSS: readonly [number, number][] = [
  [-6.15, -0.16],
  [-5.6, -0.03],
  [-4.6, -0.012],
  [-3.6, 0],
  [-1.8, 0.012],
  [0, 0.02],
  [1.8, 0.012],
  [3.6, 0],
  [4.6, -0.012],
  [5.6, -0.03],
  [6.15, -0.16],
];

function buildRoadGeometry(step: number): BufferGeometry {
  const rows = Math.ceil((ROAD.zEnd - ROAD.zStart) / step) + 1;
  const cols = CROSS.length;
  const pos = new Float32Array(rows * cols * 3);
  const uv = new Float32Array(rows * cols * 2);
  const nrm = new Float32Array(rows * cols * 3);
  let dist = 0;
  let prevX: number = roadCenterX(ROAD.zStart);
  let prevZ: number = ROAD.zStart;
  for (let r = 0; r < rows; r++) {
    const z = Math.min(ROAD.zEnd, ROAD.zStart + r * step);
    const cx = roadCenterX(z);
    dist += Math.hypot(cx - prevX, z - prevZ);
    prevX = cx;
    prevZ = z;
    const s = roadSlope(z);
    const len = Math.hypot(1, s);
    const nx = 1 / len;
    const nz = -s / len;
    for (let c = 0; c < cols; c++) {
      const [lat, y] = CROSS[c]!;
      const i = r * cols + c;
      pos[i * 3] = cx + lat * nx;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z + lat * nz;
      uv[i * 2] = (lat + ROAD_TEX.width / 2) / ROAD_TEX.width;
      uv[i * 2 + 1] = dist / ROAD_TEX.length;
      nrm[i * 3 + 1] = 1;
    }
  }
  const index: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      index.push(a, d, b, b, d, e);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('uv', new BufferAttribute(uv, 2));
  geo.setAttribute('normal', new BufferAttribute(nrm, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

export function createRoad(textures: RoadTextures, noise: Texture, reflection: RoadReflectionInput): { mesh: Mesh; uniforms: RoadUniforms } {
  const material = new MeshStandardMaterial({
    name: 'WetAsphalt',
    map: textures.map,
    roughnessMap: textures.orm,
    normalMap: textures.normal,
    normalScale: new Vector2(0.9, 0.9),
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.55,
  });

  const uniforms: RoadUniforms = {
    uReflStrength: { value: 1 },
    uReflTexel: { value: new Vector2(1 / 512, 1 / 512) },
    tReflection: { value: reflection.texture },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, {
      uReflMatrix: { value: reflection.matrix },
      uTime: shared.uTime,
      uRain: shared.uRain,
      uLightning: shared.uLightning,
      tWorldNoise: { value: noise },
    });

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform mat4 uReflMatrix;
        varying vec4 vReflCoord;
        varying vec3 vRoadWorld;`,
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
        vec4 lmWorld = modelMatrix * vec4( transformed, 1.0 );
        vRoadWorld = lmWorld.xyz;
        vReflCoord = uReflMatrix * lmWorld;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform sampler2D tReflection;
        uniform sampler2D tWorldNoise;
        uniform float uReflStrength;
        uniform vec2 uReflTexel;
        uniform float uTime;
        uniform float uRain;
        uniform float uLightning;
        varying vec4 vReflCoord;
        varying vec3 vRoadWorld;

        float lmHash( vec2 p ) {
          p = fract( p * vec2( 123.34, 456.21 ) );
          p += dot( p, p + 45.32 );
          return fract( p.x * p.y );
        }

        // Expanding ripple rings from raindrops, 2 layers of jittered cells. Returns a gradient.
        vec2 lmRipples( vec2 p, float t ) {
          vec2 grad = vec2( 0.0 );
          for ( int layer = 0; layer < 2; layer++ ) {
            vec2 cell = floor( p );
            vec2 f = fract( p );
            float h = lmHash( cell + float( layer ) * 17.0 );
            vec2 center = vec2( lmHash( cell + 3.1 ), lmHash( cell + 7.7 ) ) * 0.6 + 0.2;
            float phase = fract( t * ( 0.75 + h * 0.5 ) + h );
            vec2 dv = f - center;
            float d = length( dv );
            float radius = phase * 0.45;
            float ring = sin( clamp( ( d - radius ) * 40.0, -3.14159, 3.14159 ) );
            float band = 1.0 - smoothstep( 0.0, 0.08, abs( d - radius ) );
            float fade = ( 1.0 - phase ) * ( 1.0 - phase ) * band * step( d, 0.5 );
            grad += ( dv / max( d, 1e-3 ) ) * ring * fade;
            p = p * 1.37 + vec2( 4.3, 1.7 );
          }
          return grad;
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        float roughnessFactor = roughness;
        vec4 lmOrm = texture2D( roughnessMap, vRoughnessMapUv );
        float lmLarge = texture2D( tWorldNoise, vRoadWorld.xz * 0.011 ).r;
        float lmPuddle = max( lmOrm.r, smoothstep( 0.66, 0.8, lmLarge ) * smoothstep( 0.3, 0.6, lmOrm.r + lmLarge * 0.5 ) );
        roughnessFactor *= mix( lmOrm.g, lmOrm.g * 0.8, uRain );
        roughnessFactor = mix( roughnessFactor, 0.025, lmPuddle );
        diffuseColor.rgb *= mix( 1.0, 0.82, lmPuddle );`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        vec2 lmRip = lmRipples( vRoadWorld.xz * 2.6, uTime ) * uRain;
        vec3 lmRipView = mat3( viewMatrix ) * vec3( lmRip.x, 0.0, lmRip.y );
        normal = normalize( mix( normal, nonPerturbedNormal, lmPuddle * 0.85 ) + lmRipView * lmPuddle * 0.12 );`,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        {
          vec3 lmV = normalize( cameraPosition - vRoadWorld );
          float lmNdV = clamp( lmV.y, 0.0, 1.0 );
          float lmFres = 0.03 + 0.97 * pow( 1.0 - lmNdV, 5.0 );
          vec2 lmUv = vReflCoord.xy / vReflCoord.w;
          vec2 lmDistort = ( normal.xy - nonPerturbedNormal.xy );
          lmUv += lmDistort * mix( 0.05, 0.02, lmPuddle );
          float lmSpread = mix( 18.0, 1.5, lmPuddle ) * uReflTexel.y;
          vec3 lmRefl = vec3( 0.0 );
          float lmW = 0.0;
          for ( int i = -4; i <= 4; i++ ) {
            float w = 1.0 - abs( float( i ) ) / 5.0;
            vec2 o = vec2( float( i ) * uReflTexel.x * 0.6, float( i ) * lmSpread );
            lmRefl += texture2D( tReflection, lmUv + o ).rgb * w;
            lmW += w;
          }
          lmRefl /= lmW;
          float lmWet = mix( 0.32, 1.0, lmPuddle ) * uReflStrength;
          outgoingLight = mix( outgoingLight, outgoingLight * 0.55, lmPuddle * uReflStrength ) + lmRefl * lmFres * lmWet;
        }
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => 'lm-wet-asphalt-v1';

  const mesh = new Mesh(buildRoadGeometry(1), material);
  mesh.name = 'Road';
  mesh.receiveShadow = true;
  // Only on the no-reflect layer: the main camera enables it, the mirror camera does not.
  mesh.layers.set(NO_REFLECT_LAYER);
  return { mesh, uniforms };
}

export function createTerrain(textures: SurfaceTextures, segments: number): Mesh {
  const width = 760;
  const depth = ROAD.zEnd - ROAD.zStart + 80;
  const geo = new PlaneGeometry(width, depth, segments, Math.round(segments * (depth / width)));
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, (ROAD.zStart + ROAD.zEnd) / 2);
  const pos = geo.attributes.position as BufferAttribute;
  const uv = geo.attributes.uv as BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = terrainHeight(x, z);
    pos.setY(i, y);
    uv.setXY(i, x / 5.5, z / 5.5);
    const macro = 0.78 + 0.32 * (0.5 + 0.5 * Math.sin(x * 0.07 + Math.sin(z * 0.05) * 2.0));
    const nearRoad = Math.abs(x - roadCenterX(z));
    const mud = nearRoad < 10 ? 0.82 : 1;
    c.setRGB(macro * mud, macro * mud, macro * mud * 0.96);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const material = new MeshStandardMaterial({
    name: 'Ground',
    map: textures.map,
    normalMap: textures.normal,
    roughnessMap: textures.rough ?? null,
    roughness: 1,
    metalness: 0,
    vertexColors: true,
    envMapIntensity: 0.3,
    normalScale: new Vector2(0.7, 0.7),
  });
  const mesh = new Mesh(geo, material);
  mesh.name = 'Terrain';
  mesh.receiveShadow = true;
  return mesh;
}
