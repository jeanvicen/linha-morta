/**
 * Procedural vegetation: eucalyptus plantation (typical along Brazilian rural highways), dense
 * broadleaf forest, palms, bushes and tall roadside grass. Trees are generated as branch meshes
 * plus alpha-tested leaf cards, instanced, and swapped for baked impostors in the distance.
 */
import {
  AmbientLight,
  BufferAttribute,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  HalfFloatType,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Quaternion,
  RGBADepthPacking,
  Scene,
  Vector3,
  WebGLRenderTarget,
  type BufferGeometry,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng, randRange } from '../core/math';
import type { QualityLevel } from '../features/settings/settings';
import { ROAD, isClearZone, lateralOffset, roadCenterX, terrainHeight } from './layout';
import { applyWind } from './materials';
import { ATLAS, type AtlasRegion } from './procedural/textures';

type Rng = () => number;

export type TreeKind = 'eucalyptus' | 'broadleaf' | 'palm' | 'bush';

interface TreeVariant {
  kind: TreeKind;
  trunk: BufferGeometry | null;
  leaves: BufferGeometry;
  height: number;
  radius: number;
  bark: 'eucalyptus' | 'dark';
}

// ---------------------------------------------------------------------------------------------
// Geometry generation
// ---------------------------------------------------------------------------------------------

const UP = new Vector3(0, 1, 0);

function segment(start: Vector3, end: Vector3, r0: number, r1: number, radial: number): BufferGeometry {
  const dir = new Vector3().subVectors(end, start);
  const len = dir.length();
  const geo = new CylinderGeometry(r1, r0, len, radial, 1, true);
  const uv = geo.attributes.uv as BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * (len / 2.2));
  geo.translate(0, len / 2, 0);
  geo.applyQuaternion(new Quaternion().setFromUnitVectors(UP, dir.normalize()));
  geo.translate(start.x, start.y, start.z);
  return geo;
}

function leafCard(center: Vector3, size: number, region: AtlasRegion, rng: Rng, canopyCenter: Vector3, hang = 0.0): BufferGeometry {
  const geo = new PlaneGeometry(size, size);
  const uv = geo.attributes.uv as BufferAttribute;
  const r = ATLAS[region];
  for (let i = 0; i < uv.count; i++) uv.setXY(i, r.u + uv.getX(i) * 0.5, r.v + uv.getY(i) * 0.5);
  // Hanging cards: the top edge is anchored at the twig.
  geo.translate(0, -size * hang, 0);
  geo.rotateY(rng() * Math.PI * 2);
  geo.rotateX((rng() - 0.5) * 0.9);
  geo.rotateZ((rng() - 0.5) * 0.6);
  geo.translate(center.x, center.y, center.z);
  // Spherical normals give canopies a soft, volumetric shading instead of flat cards.
  const pos = geo.attributes.position as BufferAttribute;
  const nrm = geo.attributes.normal as BufferAttribute;
  const n = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.set(pos.getX(i) - canopyCenter.x, (pos.getY(i) - canopyCenter.y) * 0.8 + 0.4, pos.getZ(i) - canopyCenter.z).normalize();
    nrm.setXYZ(i, n.x, n.y, n.z);
  }
  return geo;
}

function eucalyptus(rng: Rng): TreeVariant {
  const height = randRange(rng, 19, 27);
  const trunks: BufferGeometry[] = [];
  const leaves: BufferGeometry[] = [];
  const lean = new Vector3((rng() - 0.5) * 0.6, 0, (rng() - 0.5) * 0.6);
  const pts: Vector3[] = [];
  const steps = 9;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push(new Vector3(lean.x * t * t * height * 0.05 + Math.sin(t * 5 + rng()) * 0.08, t * height, lean.z * t * t * height * 0.05));
  }
  const baseR = randRange(rng, 0.17, 0.24);
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    trunks.push(segment(pts[i]!, pts[i + 1]!, baseR * (1 - t0 * 0.82), baseR * (1 - t1 * 0.82), 7));
  }
  const canopyCenter = new Vector3(pts[steps]!.x, height * 0.8, pts[steps]!.z);
  const branchCount = 9 + Math.floor(rng() * 5);
  for (let b = 0; b < branchCount; b++) {
    const t = 0.55 + rng() * 0.4;
    const base = pts[Math.floor(t * steps)]!.clone();
    base.y = t * height;
    const a = rng() * Math.PI * 2;
    const len = randRange(rng, 1.6, 3.6) * (1.1 - t * 0.5);
    const end = base.clone().add(new Vector3(Math.cos(a) * len, len * randRange(rng, 0.35, 0.8), Math.sin(a) * len));
    trunks.push(segment(base, end, baseR * 0.22, 0.02, 4));
    const clusters = 3 + Math.floor(rng() * 3);
    for (let c = 0; c < clusters; c++) {
      const k = 0.4 + (c / clusters) * 0.6;
      const p = base.clone().lerp(end, k).add(new Vector3((rng() - 0.5) * 0.8, rng() * 0.4, (rng() - 0.5) * 0.8));
      leaves.push(leafCard(p, randRange(rng, 1.6, 2.4), 'eucalyptus', rng, canopyCenter, 0.35));
    }
  }
  for (let c = 0; c < 8; c++) {
    const p = canopyCenter.clone().add(new Vector3((rng() - 0.5) * 2.2, height * 0.12 + rng() * 2.5, (rng() - 0.5) * 2.2));
    leaves.push(leafCard(p, randRange(rng, 1.6, 2.2), 'eucalyptus', rng, canopyCenter, 0.35));
  }
  return { kind: 'eucalyptus', trunk: mergeGeometries(trunks)!, leaves: mergeGeometries(leaves)!, height, radius: 3.5, bark: 'eucalyptus' };
}

function broadleaf(rng: Rng): TreeVariant {
  const height = randRange(rng, 9, 15);
  const trunks: BufferGeometry[] = [];
  const leaves: BufferGeometry[] = [];
  const canopyCenter = new Vector3(0, height * 0.68, 0);
  const grow = (start: Vector3, dir: Vector3, len: number, r: number, depth: number): void => {
    const end = start.clone().addScaledVector(dir, len);
    trunks.push(segment(start, end, r, r * 0.68, depth === 0 ? 8 : depth === 1 ? 6 : 4));
    if (depth >= 3 || r < 0.03) {
      for (let c = 0; c < 4; c++) {
        const p = end.clone().add(new Vector3((rng() - 0.5) * 1.6, (rng() - 0.3) * 1.2, (rng() - 0.5) * 1.6));
        leaves.push(leafCard(p, randRange(rng, 1.6, 2.6), 'broadleaf', rng, canopyCenter));
      }
      return;
    }
    const children = depth === 0 ? 3 + Math.floor(rng() * 2) : 2 + Math.floor(rng() * 2);
    for (let i = 0; i < children; i++) {
      const nd = dir
        .clone()
        .add(new Vector3((rng() - 0.5) * 1.6, rng() * 0.5 + 0.15, (rng() - 0.5) * 1.6))
        .normalize();
      grow(end, nd, len * randRange(rng, 0.55, 0.78), r * 0.62, depth + 1);
    }
  };
  grow(new Vector3(0, -0.3, 0), new Vector3((rng() - 0.5) * 0.15, 1, (rng() - 0.5) * 0.15).normalize(), height * 0.45, randRange(rng, 0.22, 0.34), 0);
  return { kind: 'broadleaf', trunk: mergeGeometries(trunks)!, leaves: mergeGeometries(leaves)!, height, radius: 4.5, bark: 'dark' };
}

function palm(rng: Rng): TreeVariant {
  const height = randRange(rng, 7, 11);
  const trunks: BufferGeometry[] = [];
  const fronds: BufferGeometry[] = [];
  const bend = new Vector3(randRange(rng, -1.4, 1.4), 0, randRange(rng, -1.4, 1.4));
  let prev = new Vector3(0, -0.2, 0);
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const p = new Vector3(bend.x * t * t, t * height, bend.z * t * t);
    trunks.push(segment(prev, p, 0.2 - (i - 1) * 0.006, 0.2 - i * 0.006, 7));
    prev = p;
  }
  const top = prev;
  const count = 13 + Math.floor(rng() * 4);
  for (let f = 0; f < count; f++) {
    const a = (f / count) * Math.PI * 2 + rng() * 0.3;
    const len = randRange(rng, 3.2, 4.4);
    const geo = new PlaneGeometry(1.5, len, 1, 6);
    const uv = geo.attributes.uv as BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, ATLAS.palm.u + uv.getX(i) * 0.5, ATLAS.palm.v + uv.getY(i) * 0.5);
    geo.translate(0, len / 2, 0);
    // Arch the frond: rises, then droops under its own weight.
    const pos = geo.attributes.position as BufferAttribute;
    const lift = randRange(rng, 0.3, 0.9);
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / len;
      pos.setXYZ(i, pos.getX(i) * (1 - t * 0.3), t * len * 0.95, Math.sin(t * Math.PI * 0.5) * lift * len * 0.4 - t * t * len * 0.55);
    }
    geo.rotateX(-Math.PI / 2 + 0.25);
    geo.rotateY(a);
    geo.translate(top.x, top.y, top.z);
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal as BufferAttribute;
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, nrm.getX(i) * 0.4, Math.abs(nrm.getY(i)) * 0.6 + 0.6, nrm.getZ(i) * 0.4);
    fronds.push(geo);
  }
  return { kind: 'palm', trunk: mergeGeometries(trunks)!, leaves: mergeGeometries(fronds)!, height, radius: 4, bark: 'dark' };
}

function bush(rng: Rng): TreeVariant {
  const leaves: BufferGeometry[] = [];
  const r = randRange(rng, 0.9, 1.6);
  const center = new Vector3(0, r * 0.6, 0);
  const count = 26 + Math.floor(rng() * 14);
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const e = rng() * Math.PI * 0.5;
    const p = new Vector3(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r * 0.9 + 0.2, Math.sin(a) * Math.cos(e) * r);
    leaves.push(leafCard(p, randRange(rng, 0.9, 1.5), rng() > 0.55 ? 'fern' : 'broadleaf', rng, center));
  }
  return { kind: 'bush', trunk: null, leaves: mergeGeometries(leaves)!, height: r * 2, radius: r, bark: 'dark' };
}

// ---------------------------------------------------------------------------------------------
// Instancing, impostors and LOD
// ---------------------------------------------------------------------------------------------

interface Instance {
  variant: number;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  /** Random key used for density filtering. */
  key: number;
  /** Collision radius (0 = no collision). */
  collide: number;
}

interface VariantMeshes {
  trunk: InstancedMesh | null;
  leaves: InstancedMesh;
  impostor: InstancedMesh;
}

const DENSITY_FRACTION: Record<QualityLevel, number> = { low: 0.4, medium: 0.62, high: 0.85, ultra: 1 };
const NEAR_DISTANCE: Record<QualityLevel, number> = { low: 32, medium: 46, high: 62, ultra: 85 };

export interface ForestTextures {
  foliage: Texture;
  barkEucalyptus: { map: Texture; normal: Texture };
  barkDark: { map: Texture; normal: Texture };
}

export class Forest {
  readonly group = new Group();
  private readonly variants: TreeVariant[] = [];
  private readonly meshes: VariantMeshes[] = [];
  private readonly instances: Instance[] = [];
  private readonly impostorTargets: WebGLRenderTarget[] = [];
  private readonly materials: MeshStandardMaterial[] = [];
  private density: QualityLevel = 'high';
  private readonly lastUpdate = new Vector3(1e9, 0, 0);
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly v = new Vector3();
  private readonly s = new Vector3();

  constructor(renderer: WebGLRenderer, tex: ForestTextures) {
    const rng = createRng(2024);
    for (let i = 0; i < 4; i++) this.variants.push(eucalyptus(rng));
    for (let i = 0; i < 3; i++) this.variants.push(broadleaf(rng));
    for (let i = 0; i < 2; i++) this.variants.push(palm(rng));
    for (let i = 0; i < 2; i++) this.variants.push(bush(rng));

    const leafMat = new MeshStandardMaterial({
      name: 'Leaves',
      map: tex.foliage,
      alphaTest: 0.42,
      side: DoubleSide,
      roughness: 0.62,
      metalness: 0,
      color: '#8b9a88',
      envMapIntensity: 0.4,
    });
    applyWind(leafMat, { sway: 0.0011, flutter: 0.04 }, 'leaves');
    const leafDepth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, map: tex.foliage, alphaTest: 0.42, side: DoubleSide });
    applyWind(leafDepth, { sway: 0.0011 }, 'leaves-depth');
    const barkE = new MeshStandardMaterial({ name: 'BarkEucalyptus', map: tex.barkEucalyptus.map, normalMap: tex.barkEucalyptus.normal, roughness: 0.7, color: '#a7a39a' });
    applyWind(barkE, { sway: 0.0011 }, 'bark-e');
    const barkD = new MeshStandardMaterial({ name: 'BarkDark', map: tex.barkDark.map, normalMap: tex.barkDark.normal, roughness: 0.8, color: '#8a8278' });
    applyWind(barkD, { sway: 0.0011 }, 'bark-d');
    this.materials.push(leafMat, barkE, barkD);

    const MAX_PER_VARIANT = 1400;
    for (const variant of this.variants) {
      const leaves = new InstancedMesh(variant.leaves, leafMat, MAX_PER_VARIANT);
      leaves.customDepthMaterial = leafDepth;
      leaves.castShadow = true;
      leaves.receiveShadow = true;
      leaves.count = 0;
      leaves.frustumCulled = false;
      let trunk: InstancedMesh | null = null;
      if (variant.trunk) {
        trunk = new InstancedMesh(variant.trunk, variant.bark === 'eucalyptus' ? barkE : barkD, MAX_PER_VARIANT);
        trunk.castShadow = true;
        trunk.receiveShadow = true;
        trunk.count = 0;
        trunk.frustumCulled = false;
        this.group.add(trunk);
      }
      const impostor = this.bakeImpostor(renderer, variant, variant.bark === 'eucalyptus' ? barkE : barkD, leafMat, MAX_PER_VARIANT * 2);
      this.group.add(leaves, impostor);
      this.meshes.push({ trunk, leaves, impostor });
    }
    this.scatter();
  }

  /** Renders a variant from the side into a texture and builds a cross-quad impostor mesh. */
  private bakeImpostor(renderer: WebGLRenderer, variant: TreeVariant, barkMat: MeshStandardMaterial, leafMat: MeshStandardMaterial, max: number): InstancedMesh {
    const w = variant.radius * 2.4;
    const h = variant.height * 1.08;
    const resH = 256;
    const resW = Math.max(32, Math.round((resH * w) / h / 4) * 4);
    const target = new WebGLRenderTarget(resW, resH, { type: HalfFloatType, generateMipmaps: true, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter });
    this.impostorTargets.push(target);
    const scene = new Scene();
    scene.add(new AmbientLight(0xffffff, 1));
    const basicLeaf = new MeshBasicMaterial({ map: leafMat.map, alphaTest: 0.42, side: DoubleSide, color: leafMat.color });
    const basicBark = new MeshBasicMaterial({ map: barkMat.map, color: barkMat.color });
    scene.add(new Mesh(variant.leaves, basicLeaf));
    if (variant.trunk) scene.add(new Mesh(variant.trunk, basicBark));
    const cam = new OrthographicCamera(-w / 2, w / 2, h, 0, -50, 50);
    cam.position.set(0, 0, 10);
    cam.lookAt(0, 0, 0);
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearAlpha();
    const prevColor = renderer.getClearColor(new Color());
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevClear);
    basicLeaf.dispose();
    basicBark.dispose();

    const a = new PlaneGeometry(w, h);
    a.translate(0, h / 2, 0);
    const b = a.clone().rotateY(Math.PI / 2);
    const geo = mergeGeometries([a, b])!;
    const nrm = geo.attributes.normal as BufferAttribute;
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, nrm.getX(i) * 0.3, 0.9, nrm.getZ(i) * 0.3);
    const mat = new MeshStandardMaterial({ map: target.texture, alphaTest: 0.5, side: DoubleSide, roughness: 0.85, metalness: 0, color: '#c7c7c7' });
    applyWind(mat, { sway: 0.0006 }, 'impostor');
    this.materials.push(mat);
    const mesh = new InstancedMesh(geo, mat, max);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.name = `Impostor-${variant.kind}`;
    return mesh;
  }

  private scatter(): void {
    const rng = createRng(99);
    const euc = [0, 1, 2, 3];
    const broad = [4, 5, 6];
    const palms = [7, 8];
    const bushes = [9, 10];
    const pick = (list: number[]): number => list[Math.floor(rng() * list.length)]!;
    const add = (variant: number, x: number, z: number, scale: number, collide: number): void => {
      if (isClearZone(x, z, 0.4)) return;
      this.instances.push({ variant, x, y: terrainHeight(x, z) - 0.15, z, rot: rng() * Math.PI * 2, scale, key: rng(), collide });
    };

    // Left side: eucalyptus plantation in slightly irregular rows.
    for (let z = ROAD.zStart + 20; z < ROAD.zEnd - 10; z += 3.3) {
      for (let d = 9.5; d < 52; d += 3.1) {
        if (rng() < 0.1) continue;
        const x = roadCenterX(z) - d + (rng() - 0.5) * 0.9;
        add(pick(euc), x, z + (rng() - 0.5) * 0.9, randRange(rng, 0.85, 1.12), 0.35);
      }
    }
    // Right side: dense mixed forest with bushes and palms near the edge.
    for (let i = 0; i < 2600; i++) {
      const z = randRange(rng, ROAD.zStart + 20, ROAD.zEnd - 10);
      const d = 8.8 + Math.pow(rng(), 1.3) * 52;
      const x = roadCenterX(z) + d;
      const r = rng();
      if (d < 14 && r < 0.35) add(pick(bushes), x, z, randRange(rng, 0.8, 1.4), 0);
      else if (d < 22 && r < 0.45) add(pick(palms), x, z, randRange(rng, 0.85, 1.15), 0.3);
      else add(pick(broad), x, z, randRange(rng, 0.8, 1.3), 0.35);
    }
    // Undergrowth between the eucalyptus rows.
    for (let i = 0; i < 700; i++) {
      const z = randRange(rng, ROAD.zStart + 20, ROAD.zEnd - 10);
      const d = 8.5 + rng() * 40;
      add(pick(bushes), roadCenterX(z) - d, z, randRange(rng, 0.6, 1.1), 0);
    }
    // A few trees framing the opening shot near the camera.
    add(4, -7.8, 13, 1.25, 0.35);
    add(9, -7.2, 8.5, 1.3, 0);
    add(5, 10.5, 6, 1.2, 0.35);
    add(9, 8.6, 2.5, 1.2, 0);
    // Stable order for density filtering.
    this.instances.sort((a, b) => a.key - b.key);
  }

  setDensity(level: QualityLevel): void {
    this.density = level;
    this.lastUpdate.set(1e9, 0, 0);
  }

  /** Re-buckets instances into detailed/impostor meshes when the camera has moved. */
  update(cameraPos: Vector3, force = false): void {
    if (!force && this.lastUpdate.distanceToSquared(cameraPos) < 16) return;
    this.lastUpdate.copy(cameraPos);
    const fraction = DENSITY_FRACTION[this.density];
    const near2 = NEAR_DISTANCE[this.density] ** 2;
    const counts = this.meshes.map(() => ({ near: 0, far: 0 }));
    for (const inst of this.instances) {
      if (inst.key > fraction) continue;
      const mesh = this.meshes[inst.variant]!;
      const count = counts[inst.variant]!;
      const dx = inst.x - cameraPos.x;
      const dz = inst.z - cameraPos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 260 * 260) continue;
      this.q.setFromAxisAngle(UP, inst.rot);
      this.v.set(inst.x, inst.y, inst.z);
      this.s.setScalar(inst.scale);
      this.m.compose(this.v, this.q, this.s);
      if (d2 < near2) {
        if (count.near >= mesh.leaves.instanceMatrix.count) continue;
        mesh.leaves.setMatrixAt(count.near, this.m);
        mesh.trunk?.setMatrixAt(count.near, this.m);
        count.near++;
      } else {
        if (count.far >= mesh.impostor.instanceMatrix.count) continue;
        // Face the impostor toward the camera to hide the cross-quad.
        this.q.setFromAxisAngle(UP, Math.atan2(dx, dz) + Math.PI / 4);
        this.m.compose(this.v, this.q, this.s);
        mesh.impostor.setMatrixAt(count.far, this.m);
        count.far++;
      }
    }
    this.meshes.forEach((mesh, i) => {
      const c = counts[i]!;
      mesh.leaves.count = c.near;
      mesh.leaves.instanceMatrix.needsUpdate = true;
      if (mesh.trunk) {
        mesh.trunk.count = c.near;
        mesh.trunk.instanceMatrix.needsUpdate = true;
      }
      mesh.impostor.count = c.far;
      mesh.impostor.instanceMatrix.needsUpdate = true;
    });
  }

  /** Tree trunks near a point, for first-person collisions. */
  collidersNear(x: number, z: number, radius: number, out: { x: number; z: number; r: number }[]): void {
    out.length = 0;
    const fraction = DENSITY_FRACTION[this.density];
    for (const inst of this.instances) {
      if (inst.collide === 0 || inst.key > fraction) continue;
      const dx = inst.x - x;
      const dz = inst.z - z;
      if (dx * dx + dz * dz < radius * radius) out.push({ x: inst.x, z: inst.z, r: inst.collide * inst.scale });
    }
  }

  dispose(): void {
    for (const v of this.variants) {
      v.trunk?.dispose();
      v.leaves.dispose();
    }
    for (const m of this.meshes) m.impostor.geometry.dispose();
    for (const t of this.impostorTargets) t.dispose();
    for (const m of this.materials) m.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// Grass
// ---------------------------------------------------------------------------------------------

function grassClump(rng: Rng, blades: number, minH: number, maxH: number, spread: number): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let base = 0;
  for (let b = 0; b < blades; b++) {
    const h = randRange(rng, minH, maxH);
    const w = randRange(rng, 0.018, 0.035);
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * spread;
    const ox = Math.cos(a) * r;
    const oz = Math.sin(a) * r;
    const facing = rng() * Math.PI * 2;
    const bendDir = rng() * Math.PI * 2;
    const bend = randRange(rng, 0.1, 0.45) * h;
    const segs = 4;
    const fx = Math.cos(facing);
    const fz = Math.sin(facing);
    const tone = randRange(rng, 0.75, 1.15);
    const dry = rng() < 0.25;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const cx = ox + Math.cos(bendDir) * bend * t * t;
      const cz = oz + Math.sin(bendDir) * bend * t * t;
      const y = h * t - bend * 0.25 * t * t;
      const hw = w * (1 - t * 0.92);
      positions.push(cx - fx * hw, y, cz - fz * hw, cx + fx * hw, y, cz + fz * hw);
      const g = (0.05 + t * 0.12) * tone;
      const c = dry ? [g * 1.35, g * 1.2, g * 0.55] : [g * 0.55, g, g * 0.38];
      colors.push(...c, ...c);
      normals.push(-fz * 0.3, 0.95, fx * 0.3, -fz * 0.3, 0.95, fx * 0.3);
      if (s < segs) {
        const i = base + s * 2;
        indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
      }
    }
    base += (segs + 1) * 2;
  }
  const geo = new PlaneGeometry(1, 1);
  geo.setIndex(indices);
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geo.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  geo.deleteAttribute('uv');
  geo.computeBoundingSphere();
  return geo;
}

const GRASS_COUNT: Record<QualityLevel, number> = { low: 2200, medium: 5000, high: 9000, ultra: 14000 };

export class Grass {
  readonly group = new Group();
  private readonly meshes: InstancedMesh[] = [];
  private readonly material: MeshStandardMaterial;

  constructor() {
    const rng = createRng(555);
    this.material = new MeshStandardMaterial({ name: 'Grass', vertexColors: true, side: DoubleSide, roughness: 0.55, metalness: 0, envMapIntensity: 0.5 });
    applyWind(this.material, { sway: 0.32 }, 'grass');
    const tall = grassClump(rng, 16, 0.7, 1.5, 0.35);
    const short = grassClump(rng, 18, 0.25, 0.6, 0.3);
    const max = GRASS_COUNT.ultra;
    const geos = [tall, short];
    const m = new Matrix4();
    const q = new Quaternion();
    const s = new Vector3();
    const p = new Vector3();
    for (let g = 0; g < geos.length; g++) {
      const mesh = new InstancedMesh(geos[g]!, this.material, max);
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      let i = 0;
      let guard = 0;
      while (i < max && guard < max * 6) {
        guard++;
        const z = randRange(rng, -230, 70);
        const side = rng() > 0.5 ? 1 : -1;
        // Concentrated along the shoulders/ditch, thinning out into the forest.
        const d = 5.75 + Math.pow(rng(), 2.2) * (g === 0 ? 14 : 22);
        const x = roadCenterX(z) + side * d;
        const lat = Math.abs(lateralOffset(x, z));
        if (lat < 5.75) continue;
        p.set(x, terrainHeight(x, z) - 0.05, z);
        q.setFromAxisAngle(UP, rng() * Math.PI * 2);
        const sc = randRange(rng, 0.7, 1.3) * (lat < 9 ? 1.15 : 0.9);
        s.set(sc, sc * randRange(rng, 0.85, 1.25), sc);
        mesh.setMatrixAt(i, m.compose(p, q, s));
        i++;
      }
      mesh.count = i;
      mesh.instanceMatrix.needsUpdate = true;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }

  setDensity(level: QualityLevel): void {
    const n = GRASS_COUNT[level];
    for (const mesh of this.meshes) mesh.count = Math.min(n, mesh.instanceMatrix.count);
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.geometry.dispose();
    this.material.dispose();
  }
}
