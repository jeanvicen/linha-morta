/**
 * Procedural abandoned car: a boxy 90s hatchback built from an extruded side profile that is
 * deformed (tumblehome, rounded corners, crumpled front), with glass, dirt, rust and seams resolved
 * in the shader from profile-space masks. One headlight still works; the hazard lights blink.
 */
import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Shape,
  Vector2,
  Vector3,
  type BufferAttribute,
  type BufferGeometry,
  type Texture,
} from 'three';
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { createRng, smoothstep } from '../core/math';
import { ctx2d, makeCanvas, toTexture } from './procedural/textures';
import { NO_REFLECT_LAYER } from '../render/PlanarReflection';

const FRONT_AXLE = -1.28;
const REAR_AXLE = 1.22;
const ARCH_R = 0.38;
const WHEEL_R = 0.29;
const HALF_TRACK = 0.69;
const BODY_DEPTH = 1.52;

const PROFILE_BOUNDS = { x0: -2.15, x1: 2.15, y0: 0.1, y1: 1.55 } as const;

function bodyShape(): Shape {
  const s = new Shape();
  s.moveTo(-2.02, 0.3);
  s.lineTo(-2.06, 0.4);
  s.lineTo(-2.07, 0.62);
  s.lineTo(-2.02, 0.74);
  s.quadraticCurveTo(-1.6, 0.8, -1.0, 0.86);
  s.lineTo(-0.92, 0.88);
  s.lineTo(-0.28, 1.34);
  s.quadraticCurveTo(0.5, 1.39, 1.28, 1.36);
  s.lineTo(1.52, 1.31);
  s.lineTo(1.84, 0.98);
  s.lineTo(1.92, 0.93);
  s.lineTo(1.95, 0.62);
  s.lineTo(1.97, 0.58);
  s.lineTo(1.97, 0.36);
  s.lineTo(1.9, 0.3);
  s.lineTo(REAR_AXLE + ARCH_R, 0.3);
  s.absarc(REAR_AXLE, 0.3, ARCH_R, 0, Math.PI, false);
  s.lineTo(FRONT_AXLE + ARCH_R, 0.3);
  s.absarc(FRONT_AXLE, 0.3, ARCH_R, 0, Math.PI, false);
  s.lineTo(-2.02, 0.3);
  return s;
}

function buildBodyGeometry(): BufferGeometry {
  let geo: BufferGeometry = new ExtrudeGeometry(bodyShape(), {
    depth: BODY_DEPTH,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.045,
    bevelSegments: 3,
    curveSegments: 10,
    steps: 1,
  });
  geo.translate(0, 0, -BODY_DEPTH / 2);
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo, 1e-4);
  const pos = geo.attributes.position as BufferAttribute;
  const rng = createRng(77);
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    // Tumblehome: the greenhouse leans inward.
    z *= 1 - 0.13 * smoothstep(0.88, 1.38, y);
    // Rounded corners in plan view.
    z *= 1 - 0.06 * smoothstep(-1.72, -2.1, x) - 0.05 * smoothstep(1.7, 2.0, x);
    // Crumpled front-right corner from the crash.
    const dmg = smoothstep(-1.65, -2.1, x) * smoothstep(0.05, 0.75, z);
    x += 0.16 * dmg;
    y += (Math.sin(z * 23 + y * 9) * 0.012 + (rng() - 0.5) * 0.008) * dmg;
    z -= 0.05 * dmg;
    // Hood buckled upward near the impact.
    const buckle = smoothstep(-1.15, -1.55, x) * smoothstep(-1.95, -1.6, x) * smoothstep(0.84, 0.86, y) * smoothstep(-0.1, 0.6, z);
    y += buckle * 0.045;
    pos.setXYZ(i, x, y, z);
  }
  geo = toCreasedNormals(geo, (36 * Math.PI) / 180);
  geo.computeBoundingSphere();
  return geo;
}

/** Profile-space masks. mask1: R side glass, G windshield/rear glass, B black trim. mask2: R dirt, G rust, B seams. */
function buildMasks(): { mask1: Texture; mask2: Texture; crack: Texture } {
  const W = 1024;
  const H = Math.round((W * (PROFILE_BOUNDS.y1 - PROFILE_BOUNDS.y0)) / (PROFILE_BOUNDS.x1 - PROFILE_BOUNDS.x0));
  const px = (x: number): number => ((x - PROFILE_BOUNDS.x0) / (PROFILE_BOUNDS.x1 - PROFILE_BOUNDS.x0)) * W;
  const py = (y: number): number => H - ((y - PROFILE_BOUNDS.y0) / (PROFILE_BOUNDS.y1 - PROFILE_BOUNDS.y0)) * H;
  const rng = createRng(909);

  const c1 = makeCanvas(W, H);
  const m1 = ctx2d(c1);
  m1.fillStyle = '#000';
  m1.fillRect(0, 0, W, H);
  m1.globalCompositeOperation = 'lighter';
  // Side windows (front door, rear door/quarter) separated by the B-pillar.
  m1.fillStyle = 'rgb(255,0,0)';
  const window = (pts: [number, number][]): void => {
    m1.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? m1.moveTo(px(x), py(y)) : m1.lineTo(px(x), py(y))));
    m1.closePath();
    m1.fill();
  };
  window([
    [-0.8, 0.93],
    [-0.3, 1.29],
    [0.3, 1.31],
    [0.3, 0.93],
  ]);
  window([
    [0.42, 0.93],
    [0.42, 1.31],
    [1.22, 1.315],
    [1.46, 1.26],
    [1.7, 0.98],
  ]);
  // Windshield and rear glass bands along the outline.
  m1.strokeStyle = 'rgb(0,255,0)';
  m1.lineCap = 'butt';
  m1.lineWidth = W * 0.03;
  m1.beginPath();
  m1.moveTo(px(-0.86), py(0.925));
  m1.lineTo(px(-0.33), py(1.305));
  m1.stroke();
  m1.beginPath();
  m1.moveTo(px(1.55), py(1.27));
  m1.lineTo(px(1.81), py(1.0));
  m1.stroke();
  // Black rubber side molding and window frames.
  m1.fillStyle = 'rgb(0,0,255)';
  m1.fillRect(px(-1.9), py(0.66), px(1.88) - px(-1.9), py(0.6) - py(0.66));
  m1.lineWidth = W * 0.006;
  m1.strokeStyle = 'rgb(0,0,255)';
  m1.strokeRect(px(0.3), py(1.31), px(0.42) - px(0.3), py(0.93) - py(1.31));

  const c2 = makeCanvas(W, H);
  const m2 = ctx2d(c2);
  m2.fillStyle = '#000';
  m2.fillRect(0, 0, W, H);
  m2.globalCompositeOperation = 'lighter';
  // Mud splashed from the wheels, heavier near the bottom.
  const mud = m2.createLinearGradient(0, py(0.3), 0, py(0.9));
  mud.addColorStop(0, 'rgba(255,0,0,0.95)');
  mud.addColorStop(0.45, 'rgba(255,0,0,0.35)');
  mud.addColorStop(1, 'rgba(255,0,0,0)');
  m2.fillStyle = mud;
  m2.fillRect(0, 0, W, H);
  for (let i = 0; i < 260; i++) {
    const x = PROFILE_BOUNDS.x0 + rng() * (PROFILE_BOUNDS.x1 - PROFILE_BOUNDS.x0);
    const y = 0.3 + Math.pow(rng(), 2) * 0.55;
    m2.fillStyle = `rgba(255,0,0,${0.2 + rng() * 0.5})`;
    m2.beginPath();
    m2.ellipse(px(x), py(y), 2 + rng() * 8, 1 + rng() * 4, rng() * Math.PI, 0, Math.PI * 2);
    m2.fill();
  }
  // Dirty rain streaks running down from the windows.
  for (let i = 0; i < 70; i++) {
    const x = -0.8 + rng() * 2.5;
    const y0 = 0.95 + rng() * 0.2;
    const len = 0.1 + rng() * 0.35;
    m2.strokeStyle = `rgba(255,0,0,${0.15 + rng() * 0.25})`;
    m2.lineWidth = 1 + rng() * 2.5;
    m2.beginPath();
    m2.moveTo(px(x), py(y0));
    m2.lineTo(px(x + (rng() - 0.5) * 0.02), py(y0 - len));
    m2.stroke();
  }
  // Rust around the wheel arches and sills.
  for (const ax of [FRONT_AXLE, REAR_AXLE]) {
    for (let i = 0; i < 36; i++) {
      const a = Math.PI * (0.05 + rng() * 0.9);
      const r = ARCH_R + 0.02 + rng() * 0.07;
      m2.fillStyle = `rgba(0,255,0,${0.25 + rng() * 0.6})`;
      m2.beginPath();
      m2.ellipse(px(ax + Math.cos(a) * r), py(0.3 + Math.sin(a) * r), 2 + rng() * 7, 2 + rng() * 5, rng() * 3, 0, Math.PI * 2);
      m2.fill();
    }
  }
  for (let i = 0; i < 40; i++) {
    m2.fillStyle = `rgba(0,255,0,${0.2 + rng() * 0.5})`;
    m2.beginPath();
    m2.ellipse(px(-0.8 + rng() * 1.6), py(0.33 + rng() * 0.06), 3 + rng() * 9, 1 + rng() * 3, 0, 0, Math.PI * 2);
    m2.fill();
  }
  // Panel seams: doors, hood line, fuel cap, door handles.
  m2.strokeStyle = 'rgb(0,0,255)';
  m2.lineWidth = 2;
  const seam = (pts: [number, number][]): void => {
    m2.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? m2.moveTo(px(x), py(y)) : m2.lineTo(px(x), py(y))));
    m2.stroke();
  };
  seam([
    [-0.86, 0.9],
    [-0.9, 0.34],
  ]);
  seam([
    [0.36, 1.32],
    [0.36, 0.33],
  ]);
  seam([
    [1.36, 0.93],
    [1.55, 0.36],
  ]);
  seam([
    [-1.0, 0.86],
    [-1.02, 0.7],
    [-2.0, 0.7],
  ]);
  m2.fillStyle = 'rgb(0,0,255)';
  m2.fillRect(px(0.12), py(0.86), px(0.28) - px(0.12), 4);
  m2.fillRect(px(1.0), py(0.86), px(1.14) - px(1.0), 4);
  m2.beginPath();
  m2.arc(px(1.62), py(0.8), 9, 0, Math.PI * 2);
  m2.stroke();

  // Spider-web crack on the windshield (mapped by z / y on the glass).
  const CS = 512;
  const c3 = makeCanvas(CS, CS);
  const m3 = ctx2d(c3);
  m3.fillStyle = '#000';
  m3.fillRect(0, 0, CS, CS);
  m3.strokeStyle = '#fff';
  const ix = CS * 0.66;
  const iy = CS * 0.42;
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + rng() * 0.2;
    let x = ix;
    let y = iy;
    m3.lineWidth = 1 + rng() * 1.5;
    m3.beginPath();
    m3.moveTo(x, y);
    const len = CS * (0.15 + rng() * 0.45);
    for (let s = 0; s < 8; s++) {
      x += Math.cos(a + (rng() - 0.5) * 0.4) * (len / 8);
      y += Math.sin(a + (rng() - 0.5) * 0.4) * (len / 8);
      m3.lineTo(x, y);
    }
    m3.stroke();
  }
  for (let ring = 1; ring < 6; ring++) {
    m3.lineWidth = 1;
    m3.beginPath();
    const r = ring * CS * 0.035 + rng() * 6;
    for (let k = 0; k <= 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const rr = r * (0.85 + rng() * 0.3);
      if (k === 0) m3.moveTo(ix + Math.cos(a) * rr, iy + Math.sin(a) * rr);
      else m3.lineTo(ix + Math.cos(a) * rr, iy + Math.sin(a) * rr);
    }
    m3.stroke();
  }
  const grad = m3.createRadialGradient(ix, iy, 0, ix, iy, CS * 0.06);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  m3.fillStyle = grad;
  m3.fillRect(0, 0, CS, CS);

  const opts = { srgb: false, repeat: false } as const;
  return { mask1: toTexture(c1, opts), mask2: toTexture(c2, opts), crack: toTexture(c3, opts) };
}

function plateTexture(): Texture {
  const c = makeCanvas(512, 160);
  const ctx = ctx2d(c);
  ctx.fillStyle = '#e9e9e4';
  ctx.fillRect(0, 0, 512, 160);
  ctx.fillStyle = '#1d3f8f';
  ctx.fillRect(0, 0, 512, 34);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('BRASIL', 256, 25);
  ctx.fillStyle = '#121212';
  ctx.font = 'bold 92px monospace';
  ctx.fillText('LMT1A00', 256, 132);
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, 506, 154);
  // Grime.
  const g = ctx.createLinearGradient(0, 160, 0, 40);
  g.addColorStop(0, 'rgba(60,45,30,0.55)');
  g.addColorStop(1, 'rgba(60,45,30,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 160);
  return toTexture(c, { repeat: false });
}

function tireGeometry(): BufferGeometry {
  const pts: Vector2[] = [];
  const w = 0.09;
  const inner = 0.19;
  const profile: [number, number][] = [
    [inner, -w],
    [WHEEL_R - 0.03, -w],
    [WHEEL_R - 0.005, -w * 0.75],
    [WHEEL_R, -w * 0.3],
    [WHEEL_R, w * 0.3],
    [WHEEL_R - 0.005, w * 0.75],
    [WHEEL_R - 0.03, w],
    [inner, w],
  ];
  for (const [r, y] of profile) pts.push(new Vector2(r, y));
  const geo = new LatheGeometry(pts, 36);
  geo.rotateX(Math.PI / 2);
  return geo;
}

export interface CarLights {
  /** World-space position of the working headlight. */
  headlightPos: Vector3;
  /** World-space direction of the headlight beam. */
  headlightDir: Vector3;
  hazardFront: Vector3;
  hazardRear: Vector3;
}

export class AbandonedCar {
  readonly group = new Group();
  readonly lights: CarLights = {
    headlightPos: new Vector3(),
    headlightDir: new Vector3(),
    hazardFront: new Vector3(),
    hazardRear: new Vector3(),
  };
  /** Axis-aligned footprint in the car's local frame, for collisions. */
  readonly halfExtents = new Vector2(2.1, 0.86);
  private readonly hazardMaterial: MeshStandardMaterial;
  private readonly headlightMaterial: MeshStandardMaterial;
  private readonly taillightMaterial: MeshStandardMaterial;
  private readonly disposables: { dispose(): void }[] = [];

  constructor(shadowBlob: Texture) {
    const { mask1, mask2, crack } = buildMasks();
    const paint = new MeshPhysicalMaterial({
      name: 'CarPaint',
      color: '#b3ab9b',
      roughness: 0.45,
      metalness: 0,
      clearcoat: 0.7,
      clearcoatRoughness: 0.18,
      envMapIntensity: 0.9,
    });
    paint.onBeforeCompile = (shader) => {
      shader.uniforms.tMask1 = { value: mask1 };
      shader.uniforms.tMask2 = { value: mask2 };
      shader.uniforms.tCrack = { value: crack };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCarLocal;\nvarying vec3 vCarNormal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCarLocal = position;\nvCarNormal = normal;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
          uniform sampler2D tMask1;
          uniform sampler2D tMask2;
          uniform sampler2D tCrack;
          varying vec3 vCarLocal;
          varying vec3 vCarNormal;
          float lmGlass;
          float lmDirt;
          float lmTrim;
          float lmCrack;`,
        )
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
          {
            vec2 muv = vec2( ( vCarLocal.x - ${PROFILE_BOUNDS.x0.toFixed(3)} ) / ${(PROFILE_BOUNDS.x1 - PROFILE_BOUNDS.x0).toFixed(3)},
                             ( vCarLocal.y - ${PROFILE_BOUNDS.y0.toFixed(3)} ) / ${(PROFILE_BOUNDS.y1 - PROFILE_BOUNDS.y0).toFixed(3)} );
            vec3 m1 = texture2D( tMask1, muv ).rgb;
            vec3 m2 = texture2D( tMask2, muv ).rgb;
            vec3 nObj = normalize( vCarNormal );
            float isSide = smoothstep( 0.55, 0.8, abs( nObj.z ) );
            float halfW = 0.81 * ( 1.0 - 0.13 * smoothstep( 0.88, 1.38, vCarLocal.y ) );
            float pillarOk = 1.0 - smoothstep( halfW - 0.17, halfW - 0.11, abs( vCarLocal.z ) );
            lmGlass = clamp( mix( m1.g * pillarOk * step( 0.25, nObj.y + abs( nObj.x ) ), m1.r, isSide ), 0.0, 1.0 );
            lmTrim = m1.b * isSide;
            lmDirt = m2.r;
            float rust = m2.g;
            float seam = m2.b * isSide;
            vec2 cuv = vec2( vCarLocal.z / 1.3 + 0.5, ( vCarLocal.y - 0.9 ) / 0.42 );
            lmCrack = texture2D( tCrack, cuv ).r * step( vCarLocal.x, -0.2 ) * ( 1.0 - isSide );
            vec3 paintCol = diffuseColor.rgb;
            paintCol = mix( paintCol, paintCol * vec3( 0.42, 0.36, 0.29 ), lmDirt * 0.85 );
            paintCol = mix( paintCol, vec3( 0.12, 0.05, 0.02 ), rust * 0.9 );
            paintCol = mix( paintCol, vec3( 0.012 ), lmTrim );
            paintCol *= 1.0 - seam * 0.85;
            diffuseColor.rgb = mix( paintCol, vec3( 0.004, 0.005, 0.006 ) + lmCrack * 0.25, lmGlass );
          }`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          /* glsl */ `#include <roughnessmap_fragment>
          roughnessFactor = mix( mix( roughnessFactor, 0.85, lmDirt * 0.8 ), 0.05 + lmCrack * 0.5, lmGlass );
          roughnessFactor = mix( roughnessFactor, 0.6, lmTrim );`,
        );
    };
    paint.customProgramCacheKey = () => 'lm-car-paint-v1';

    const body = new Mesh(buildBodyGeometry(), paint);
    body.castShadow = true;
    body.receiveShadow = true;
    body.name = 'CarBody';
    this.group.add(body);

    const plastic = new MeshStandardMaterial({ color: '#0d0d0e', roughness: 0.55, metalness: 0 });
    const chrome = new MeshStandardMaterial({ color: '#8c8f93', roughness: 0.35, metalness: 0.9 });
    const rubber = new MeshStandardMaterial({ color: '#0b0b0b', roughness: 0.82, metalness: 0 });
    const rim = new MeshStandardMaterial({ color: '#5a5d61', roughness: 0.5, metalness: 0.75 });
    this.disposables.push(paint, plastic, chrome, rubber, rim, mask1, mask2, crack);

    // Bumpers.
    const bumperGeo = new RoundedBoxGeometry(0.16, 0.22, 1.66, 3, 0.05);
    const front = new Mesh(bumperGeo, plastic);
    front.position.set(-2.02, 0.46, -0.02);
    front.rotation.y = 0.05;
    const rear = new Mesh(bumperGeo, plastic);
    rear.position.set(1.97, 0.46, 0);
    for (const b of [front, rear]) {
      b.castShadow = true;
      this.group.add(b);
    }

    // Lights.
    this.headlightMaterial = new MeshStandardMaterial({ color: '#d8d6cf', emissive: '#fff1d6', emissiveIntensity: 9, roughness: 0.15 });
    const deadLight = new MeshStandardMaterial({ color: '#1a1b1c', roughness: 0.2, metalness: 0.2 });
    this.taillightMaterial = new MeshStandardMaterial({ color: '#3a0505', emissive: '#ff1a0a', emissiveIntensity: 0.35, roughness: 0.25 });
    this.hazardMaterial = new MeshStandardMaterial({ color: '#40260a', emissive: '#ff8a1c', emissiveIntensity: 0, roughness: 0.25 });
    this.disposables.push(this.headlightMaterial, deadLight, this.taillightMaterial, this.hazardMaterial);
    const lensGeo = new RoundedBoxGeometry(0.04, 0.14, 0.34, 2, 0.015);
    const headL = new Mesh(lensGeo, this.headlightMaterial);
    headL.position.set(-2.07, 0.665, -0.47);
    const headR = new Mesh(lensGeo, deadLight);
    headR.position.set(-1.94, 0.655, 0.43);
    headR.rotation.set(0.1, 0.25, 0.08);
    const grille = new Mesh(new BoxGeometry(0.03, 0.12, 0.5), plastic);
    grille.position.set(-2.06, 0.66, -0.02);
    const sigGeo = new RoundedBoxGeometry(0.05, 0.1, 0.12, 2, 0.015);
    const sigFL = new Mesh(sigGeo, this.hazardMaterial);
    sigFL.position.set(-2.05, 0.665, -0.73);
    const sigFR = new Mesh(sigGeo, this.hazardMaterial);
    sigFR.position.set(-1.9, 0.66, 0.66);
    const tailGeo = new RoundedBoxGeometry(0.04, 0.2, 0.3, 2, 0.015);
    const tailL = new Mesh(tailGeo, this.taillightMaterial);
    tailL.position.set(1.955, 0.76, -0.55);
    const tailR = tailL.clone();
    tailR.position.z = 0.55;
    const ambGeo = new RoundedBoxGeometry(0.045, 0.2, 0.1, 2, 0.015);
    const ambL = new Mesh(ambGeo, this.hazardMaterial);
    ambL.position.set(1.955, 0.76, -0.75);
    const ambR = ambL.clone();
    ambR.position.z = 0.75;
    this.group.add(headL, headR, grille, sigFL, sigFR, tailL, tailR, ambL, ambR);

    // License plates.
    const plateTex = plateTexture();
    const plateMat = new MeshStandardMaterial({ map: plateTex, roughness: 0.5, metalness: 0.1 });
    this.disposables.push(plateTex, plateMat);
    const plateGeo = new PlaneGeometry(0.4, 0.13);
    const plateF = new Mesh(plateGeo, plateMat);
    plateF.position.set(-2.105, 0.47, -0.02);
    plateF.rotation.set(0, -Math.PI / 2 + 0.05, 0.06);
    const plateR = new Mesh(plateGeo, plateMat);
    plateR.position.set(2.055, 0.47, 0);
    plateR.rotation.y = Math.PI / 2;
    this.group.add(plateF, plateR);

    // Mirrors and wipers.
    const mirrorGeo = new RoundedBoxGeometry(0.12, 0.1, 0.16, 2, 0.03);
    for (const side of [-1, 1]) {
      const m = new Mesh(mirrorGeo, plastic);
      m.position.set(-0.82, 0.98, side * 0.86);
      m.castShadow = true;
      this.group.add(m);
    }
    const wiperGeo = new BoxGeometry(0.02, 0.015, 0.5);
    for (const z of [-0.35, 0.25]) {
      const w = new Mesh(wiperGeo, plastic);
      w.position.set(-0.86, 0.94, z);
      w.rotation.set(0.6, 0.2, 0);
      this.group.add(w);
    }

    // Wheels (front-right tire is flat).
    const tire = tireGeometry();
    const rimGeo = new CylinderGeometry(0.17, 0.17, 0.16, 24);
    rimGeo.rotateX(Math.PI / 2);
    const hubGeo = new CylinderGeometry(0.1, 0.12, 0.17, 18);
    hubGeo.rotateX(Math.PI / 2);
    const wheels: [number, number, boolean][] = [
      [FRONT_AXLE, -HALF_TRACK, false],
      [FRONT_AXLE, HALF_TRACK, true],
      [REAR_AXLE, -HALF_TRACK, false],
      [REAR_AXLE, HALF_TRACK, false],
    ];
    for (const [x, z, flat] of wheels) {
      const wheel = new Group();
      const t = new Mesh(tire, rubber);
      const r = new Mesh(rimGeo, rim);
      const hub = new Mesh(hubGeo, chrome);
      t.castShadow = true;
      wheel.add(t, r, hub);
      wheel.position.set(x, flat ? WHEEL_R - 0.06 : WHEEL_R, z);
      if (flat) {
        wheel.scale.set(1.04, 0.8, 1.05);
        wheel.rotation.x = -0.1;
      }
      wheel.rotation.y = x < 0 ? -0.32 : 0;
      this.group.add(wheel);
    }

    // Contact shadow (ambient occlusion under the car) – not reflected.
    const blobMat = new MeshBasicMaterial({ map: shadowBlob, transparent: true, depthWrite: false, color: '#000000', opacity: 0.85 });
    const blob = new Mesh(new PlaneGeometry(5.2, 2.6), blobMat);
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.025;
    blob.renderOrder = 1;
    blob.layers.set(NO_REFLECT_LAYER);
    this.group.add(blob);
    this.disposables.push(blobMat);

    // Glass shards scattered in front of the car, sparkling in the light.
    const shardMat = new MeshStandardMaterial({ color: '#cfd8dc', roughness: 0.05, metalness: 0.6, side: DoubleSide, envMapIntensity: 2 });
    const shardGeo = new PlaneGeometry(0.035, 0.025);
    const shards = new InstancedMesh(shardGeo, shardMat, 140);
    const rng = createRng(31);
    const m = new Matrix4();
    const q = new Quaternion();
    const s = new Vector3();
    const p = new Vector3();
    const dummy = new Object3D();
    for (let i = 0; i < shards.count; i++) {
      p.set(-2.3 - Math.pow(rng(), 1.5) * 2.4, 0.04, 0.2 + (rng() - 0.3) * 1.6);
      dummy.rotation.set(-Math.PI / 2 + (rng() - 0.5) * 0.4, rng() * Math.PI, 0);
      q.copy(dummy.quaternion);
      const sc = 0.5 + rng() * 1.3;
      s.set(sc, sc, sc);
      shards.setMatrixAt(i, m.compose(p, q, s));
    }
    shards.instanceMatrix.needsUpdate = true;
    this.group.add(shards);
    this.disposables.push(shardMat, shardGeo);

    // Crash pose: off-axis in the lane, nose toward the left shoulder, tilted onto the flat tire.
    this.group.position.set(1.7, 0, -2.0);
    this.group.rotation.set(0, -Math.PI / 3, 0);
    body.rotation.x = 0.035;
    body.rotation.z = 0.012;
    this.group.updateMatrixWorld(true);
    this.computeLightAnchors();
  }

  private computeLightAnchors(): void {
    const m = this.group.matrixWorld;
    this.lights.headlightPos.set(-2.12, 0.665, -0.47).applyMatrix4(m);
    this.lights.headlightDir.set(-1, -0.06, -0.08).normalize().transformDirection(m);
    this.lights.hazardFront.set(-2.1, 0.67, -0.74).applyMatrix4(m);
    this.lights.hazardRear.set(2.0, 0.76, -0.76).applyMatrix4(m);
  }

  /** Hazard blink (0 – 1) and headlight level (0 – 1) are driven by the lighting controller. */
  setLightLevels(hazard: number, headlight: number, brake: number): void {
    this.hazardMaterial.emissiveIntensity = hazard * 14;
    this.headlightMaterial.emissiveIntensity = 0.4 + headlight * 9;
    this.taillightMaterial.emissiveIntensity = 0.35 + brake * 3;
  }

  /** Converts a world point into the car's local XZ frame (for collisions/interactions). */
  toLocal(point: Vector3, out: Vector3): Vector3 {
    return this.group.worldToLocal(out.copy(point));
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
    for (const d of this.disposables) d.dispose();
  }
}
