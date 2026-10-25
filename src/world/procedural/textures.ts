/**
 * Procedural texture generation (no external images). Every texture is generated deterministically
 * on a canvas at load time, so the scene never depends on remote assets or unlicensed content.
 */
import {
  CanvasTexture,
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RedFormat,
  RepeatWrapping,
  SRGBColorSpace,
  UnsignedByteType,
  type Texture,
} from 'three';
import { clamp, createRng, smoothstep } from '../../core/math';
import { hash2, type NoiseField } from './noise';

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D indisponível');
  return ctx;
}

interface TexOptions {
  srgb?: boolean;
  repeat?: boolean;
  anisotropy?: number;
}

export function toTexture(canvas: HTMLCanvasElement, { srgb = true, repeat = true, anisotropy = 4 }: TexOptions = {}): CanvasTexture {
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  tex.wrapS = tex.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  tex.anisotropy = anisotropy;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Builds a tangent-space normal map from a height array (wrapping on both axes). */
export function heightToNormal(height: Float32Array, w: number, h: number, strength: number, wrapX = true): ImageData {
  const img = new ImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const yu = (y - 1 + h) % h;
    const yd = (y + 1) % h;
    for (let x = 0; x < w; x++) {
      const xl = wrapX ? (x - 1 + w) % w : Math.max(0, x - 1);
      const xr = wrapX ? (x + 1) % w : Math.min(w - 1, x + 1);
      const dx = (height[y * w + xl]! - height[y * w + xr]!) * strength;
      const dy = (height[yd * w + x]! - height[yu * w + x]!) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      d[i] = ((dx / len) * 0.5 + 0.5) * 255;
      d[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      d[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  return img;
}

// ---------------------------------------------------------------------------------------------
// Road
// ---------------------------------------------------------------------------------------------

/** Physical size covered by one tile of the road texture (meters). */
export const ROAD_TEX = { width: 11.2, length: 24, roadStart: 2.0, roadEnd: 9.2 } as const;

export interface RoadTextures {
  map: Texture;
  /** R = puddle mask, G = roughness. */
  orm: Texture;
  normal: Texture;
}

function strokeCrack(ctx: CanvasRenderingContext2D, rng: () => number, x: number, y: number, len: number, angle: number, width: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y);
  let a = angle;
  let px = x;
  let py = y;
  const steps = Math.max(4, Math.floor(len / 6));
  for (let i = 0; i < steps; i++) {
    a += (rng() - 0.5) * 0.9;
    px += Math.cos(a) * (len / steps);
    py += Math.sin(a) * (len / steps);
    ctx.lineTo(px, py);
    if (rng() < 0.12 && width > 0.8) {
      ctx.stroke();
      strokeCrack(ctx, rng, px, py, len * 0.4, a + (rng() > 0.5 ? 1 : -1) * (0.6 + rng()), width * 0.6);
      ctx.beginPath();
      ctx.moveTo(px, py);
    }
  }
  ctx.lineWidth = width;
  ctx.stroke();
}

export function createRoadTextures(W: number, noise: NoiseField, detail: NoiseField, anisotropy: number): RoadTextures {
  const H = W * 2;
  const pxPerM = W / ROAD_TEX.width;
  const rng = createRng(1337);

  // Markings and cracks are rasterized with the 2D API, then combined per texel.
  const marks = makeCanvas(W, H);
  const mctx = ctx2d(marks);
  const toPx = (m: number): number => m * pxPerM;
  mctx.fillStyle = '#000';
  mctx.fillRect(0, 0, W, H);
  // Edge lines (white): R channel. Center double line (yellow): G channel.
  mctx.fillStyle = 'rgb(255,0,0)';
  mctx.fillRect(toPx(2.12), 0, toPx(0.15), H);
  mctx.fillRect(toPx(8.93), 0, toPx(0.15), H);
  mctx.fillStyle = 'rgb(0,255,0)';
  mctx.fillRect(toPx(5.44), 0, toPx(0.11), H);
  mctx.fillRect(toPx(5.65), 0, toPx(0.11), H);
  // Cracks: B channel.
  mctx.strokeStyle = 'rgb(0,0,255)';
  mctx.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const x = toPx(ROAD_TEX.roadStart + rng() * (ROAD_TEX.roadEnd - ROAD_TEX.roadStart));
    const y = rng() * H;
    strokeCrack(mctx, rng, x, y, toPx(0.6 + rng() * 2.4), rng() * Math.PI * 2, Math.max(1, W / 700) * (0.8 + rng()));
  }
  // Longitudinal cracks near the road edges (typical on worn rural highways).
  for (let i = 0; i < 6; i++) {
    const side = rng() > 0.5 ? toPx(2.3 + rng() * 0.5) : toPx(8.4 + rng() * 0.5);
    strokeCrack(mctx, rng, side, rng() * H, toPx(3 + rng() * 4), Math.PI / 2 + (rng() - 0.5) * 0.3, Math.max(1, W / 600));
  }
  const markData = mctx.getImageData(0, 0, W, H).data;

  // Asphalt repair patches and potholes.
  const patches = Array.from({ length: 7 }, () => {
    const pw = 0.8 + rng() * 2.2;
    const ph = 1 + rng() * 3.5;
    const px = ROAD_TEX.roadStart + 0.2 + rng() * (ROAD_TEX.roadEnd - ROAD_TEX.roadStart - pw - 0.4);
    return { x0: px, x1: px + pw, y0: rng() * ROAD_TEX.length, h: ph, tone: rng() > 0.4 ? -9 : 7 };
  });
  const potholes = Array.from({ length: 5 }, () => ({
    x: rng() > 0.5 ? 2.4 + rng() * 1.2 : 7.6 + rng() * 1.2,
    y: rng() * ROAD_TEX.length,
    r: 0.18 + rng() * 0.35,
  }));

  const color = new ImageData(W, H);
  const orm = new ImageData(W, H);
  const height = new Float32Array(W * H);
  const cd = color.data;
  const od = orm.data;
  const ruts = [3.0, 4.6, 6.6, 8.2];

  for (let y = 0; y < H; y++) {
    const vm = (y / H) * ROAD_TEX.length;
    const nv = y / H;
    for (let x = 0; x < W; x++) {
      const um = x / pxPerM;
      const i = y * W + x;
      const p = i * 4;
      const nu = um / ROAD_TEX.width;
      const big = noise.sample(nu * 2, nv * 4);
      const mid = noise.sample(nu * 7 + 0.37, nv * 14);
      const fine = detail.sample(nu * 40, nv * 80);
      const grain = hash2(x, y, 7);

      // Irregular, eroded transition between asphalt and the gravel shoulders.
      const edgeNoise = (mid - 0.5) * 0.35 + (fine - 0.5) * 0.08;
      const inRoad = smoothstep(ROAD_TEX.roadStart - 0.05, ROAD_TEX.roadStart + 0.1, um + edgeNoise) * (1 - smoothstep(ROAD_TEX.roadEnd - 0.1, ROAD_TEX.roadEnd + 0.05, um - edgeNoise));

      // --- Asphalt ---
      let tone = 54 + (big - 0.5) * 18 + (mid - 0.5) * 10 + (grain - 0.5) * 16;
      if (grain > 0.986) tone += 22; // light aggregate stones
      let rough = 0.5 + (fine - 0.5) * 0.25;
      let h = grain * 0.35 + fine * 0.4;

      for (const patch of patches) {
        let dy = vm - patch.y0;
        if (dy < 0) dy += ROAD_TEX.length;
        if (um > patch.x0 && um < patch.x1 && dy < patch.h) {
          tone += patch.tone;
          h += 0.15;
          rough -= 0.06;
        }
      }

      // Wheel ruts: slightly darker and polished, they collect water.
      let rut = 0;
      for (const r of ruts) rut = Math.max(rut, 1 - smoothstep(0.12, 0.42, Math.abs(um - r)));
      tone -= rut * 6;
      rough -= rut * 0.12;

      // Markings (faded and worn).
      const mr = markData[p]! / 255;
      const mg = markData[p + 1]! / 255;
      const crack = markData[p + 2]! / 255;
      const wear = smoothstep(0.25, 0.65, noise.sample(nu * 3 + 0.5, nv * 10) * 0.7 + fine * 0.5);
      const white = mr * wear;
      const yellow = mg * smoothstep(0.2, 0.55, noise.sample(nu * 5, nv * 12 + 0.2) * 0.6 + fine * 0.6);

      let r = tone;
      let g = tone;
      let b = tone + 2;
      r = r + (178 - r) * white;
      g = g + (176 - g) * white;
      b = b + (168 - b) * white;
      r = r + (176 - r) * yellow;
      g = g + (132 - g) * yellow;
      b = b + (40 - b) * yellow;
      rough = rough + (0.42 - rough) * Math.max(white, yellow);
      h += Math.max(white, yellow) * 0.25;

      // Cracks: dark, rough grooves.
      r *= 1 - crack * 0.55;
      g *= 1 - crack * 0.55;
      b *= 1 - crack * 0.55;
      rough += crack * 0.06;
      h -= crack * 0.5;

      // Puddles: ruts + low-frequency noise + potholes.
      let puddle = smoothstep(0.62, 0.75, big * 0.7 + rut * 0.35 + (mid - 0.5) * 0.25);
      for (const hole of potholes) {
        let dy = Math.abs(vm - hole.y);
        dy = Math.min(dy, ROAD_TEX.length - dy);
        const dist = Math.hypot(um - hole.x, dy * 1.2) / hole.r;
        if (dist < 1.25) {
          const rim = 1 - smoothstep(0.75, 1.25, dist);
          puddle = Math.max(puddle, 1 - smoothstep(0.7, 1.0, dist));
          h -= rim * 0.6;
          r -= rim * 8;
          g -= rim * 8;
          b -= rim * 8;
        }
      }

      // --- Gravel shoulder ---
      const gravelTone = 74 + (big - 0.5) * 30 + (grain - 0.5) * 40;
      const pebble = grain > 0.93 ? 30 * (grain - 0.93) * 14 : 0;
      const mud = smoothstep(0.45, 0.8, noise.sample(nu * 3 + 0.2, nv * 6 + 0.7));
      const gr = gravelTone + pebble - mud * 18;
      const gg = gravelTone * 0.93 + pebble - mud * 22;
      const gb = gravelTone * 0.82 + pebble - mud * 26;
      const gh = grain * 0.8 + fine * 0.6;
      const gRough = 0.78 - mud * 0.25;
      const gPuddle = smoothstep(0.7, 0.82, mud * 0.8 + big * 0.35);

      r = gr + (r - gr) * inRoad;
      g = gg + (g - gg) * inRoad;
      b = gb + (b - gb) * inRoad;
      rough = gRough + (rough - gRough) * inRoad;
      h = gh + (h - gh) * inRoad;
      puddle = gPuddle + (puddle - gPuddle) * inRoad;

      // Water flattens the surface and removes micro detail.
      h = h * (1 - puddle) + 0.1 * puddle;
      rough = rough * (1 - puddle) + 0.03 * puddle;
      const wetDarken = 1 - puddle * 0.25;

      cd[p] = clamp(r * wetDarken, 0, 255);
      cd[p + 1] = clamp(g * wetDarken, 0, 255);
      cd[p + 2] = clamp(b * wetDarken, 0, 255);
      cd[p + 3] = 255;
      od[p] = clamp(puddle * 255, 0, 255);
      od[p + 1] = clamp(rough * 255, 0, 255);
      od[p + 2] = 0;
      od[p + 3] = 255;
      height[i] = h;
    }
  }

  const colorCanvas = makeCanvas(W, H);
  ctx2d(colorCanvas).putImageData(color, 0, 0);
  const ormCanvas = makeCanvas(W, H);
  ctx2d(ormCanvas).putImageData(orm, 0, 0);
  const normalCanvas = makeCanvas(W, H);
  ctx2d(normalCanvas).putImageData(heightToNormal(height, W, H, W / 700, false), 0, 0);

  const map = toTexture(colorCanvas, { anisotropy });
  const ormTex = toTexture(ormCanvas, { srgb: false, anisotropy });
  const normal = toTexture(normalCanvas, { srgb: false, anisotropy });
  for (const t of [map, ormTex, normal]) t.wrapS = ClampToEdgeWrapping;
  return { map, orm: ormTex, normal };
}

// ---------------------------------------------------------------------------------------------
// Ground (grass / mud), bark
// ---------------------------------------------------------------------------------------------

export interface SurfaceTextures {
  map: Texture;
  normal: Texture;
  rough?: Texture;
}

export function createGroundTextures(size: number, noise: NoiseField, detail: NoiseField, anisotropy: number): SurfaceTextures {
  const color = new ImageData(size, size);
  const rough = new ImageData(size, size);
  const height = new Float32Array(size * size);
  const cd = color.data;
  const rd = rough.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const i = y * size + x;
      const p = i * 4;
      const big = noise.sample(u * 2, v * 2);
      const mid = noise.sample(u * 6 + 0.3, v * 6 + 0.1);
      const fine = detail.sample(u * 16, v * 16);
      const grain = hash2(x, y, 3);
      // Grass blade streaks: high frequency stretched noise.
      const blades = detail.sample(u * 64, v * 18 + fine * 0.3);
      const grass = smoothstep(0.35, 0.65, big * 0.7 + mid * 0.4 - 0.05);
      const leaves = grain > 0.995 ? 1 : 0;
      // Dark wet mud and decaying leaves vs. dense dark green grass.
      const mr = 46 + (mid - 0.5) * 20 + (grain - 0.5) * 14;
      const mg = 38 + (mid - 0.5) * 16 + (grain - 0.5) * 12;
      const mb = 30 + (mid - 0.5) * 12 + (grain - 0.5) * 10;
      const gr = 34 + blades * 26 + (fine - 0.5) * 12;
      const gg = 50 + blades * 40 + (fine - 0.5) * 16;
      const gb = 26 + blades * 14;
      cd[p] = clamp(mr + (gr - mr) * grass + leaves * 40, 0, 255);
      cd[p + 1] = clamp(mg + (gg - mg) * grass + leaves * 22, 0, 255);
      cd[p + 2] = clamp(mb + (gb - mb) * grass, 0, 255);
      cd[p + 3] = 255;
      const r = 0.55 + grass * 0.25 - (1 - grass) * smoothstep(0.55, 0.8, big) * 0.35;
      rd[p] = 0;
      rd[p + 1] = clamp(r * 255, 0, 255);
      rd[p + 2] = 0;
      rd[p + 3] = 255;
      height[i] = grass * (blades * 0.8 + fine * 0.3) + (1 - grass) * (fine * 0.5 + grain * 0.2);
    }
  }
  const c = makeCanvas(size, size);
  ctx2d(c).putImageData(color, 0, 0);
  const r = makeCanvas(size, size);
  ctx2d(r).putImageData(rough, 0, 0);
  const n = makeCanvas(size, size);
  ctx2d(n).putImageData(heightToNormal(height, size, size, size / 240), 0, 0);
  return {
    map: toTexture(c, { anisotropy }),
    rough: toTexture(r, { srgb: false, anisotropy }),
    normal: toTexture(n, { srgb: false, anisotropy }),
  };
}

export function createBarkTextures(kind: 'eucalyptus' | 'dark', w: number, noise: NoiseField, detail: NoiseField): SurfaceTextures {
  const h = w * 2;
  const color = new ImageData(w, h);
  const height = new Float32Array(w * h);
  const cd = color.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / h;
      const i = y * w + x;
      const p = i * 4;
      const grain = hash2(x, y, kind === 'eucalyptus' ? 11 : 12);
      const streak = detail.sample(u * 18, v * 2);
      const blot = noise.sample(u * 3, v * 6);
      let r: number;
      let g: number;
      let b: number;
      let hv: number;
      if (kind === 'eucalyptus') {
        // Smooth pale trunk with peeling darker strips.
        const peel = smoothstep(0.55, 0.62, noise.sample(u * 4 + 0.2, v * 3) * 0.8 + streak * 0.35);
        const base = 150 + (blot - 0.5) * 50 + (grain - 0.5) * 12;
        r = base * (1 - peel) + (92 + streak * 30) * peel;
        g = base * 0.97 * (1 - peel) + (70 + streak * 22) * peel;
        b = base * 0.9 * (1 - peel) + (52 + streak * 14) * peel;
        hv = 0.2 + peel * 0.5 + streak * 0.2 + grain * 0.05;
      } else {
        // Dark furrowed bark with moss.
        const furrow = Math.pow(1 - Math.abs(Math.sin((u * 14 + streak * 1.6) * Math.PI)), 3);
        const moss = smoothstep(0.55, 0.75, blot);
        const base = 58 + streak * 30 + (grain - 0.5) * 16 - furrow * 30;
        r = base * (1 - moss * 0.4);
        g = base * 0.92 + moss * 18;
        b = base * 0.84 - moss * 4;
        hv = 1 - furrow + grain * 0.1;
      }
      cd[p] = clamp(r, 0, 255);
      cd[p + 1] = clamp(g, 0, 255);
      cd[p + 2] = clamp(b, 0, 255);
      cd[p + 3] = 255;
      height[i] = hv;
    }
  }
  const c = makeCanvas(w, h);
  ctx2d(c).putImageData(color, 0, 0);
  const n = makeCanvas(w, h);
  ctx2d(n).putImageData(heightToNormal(height, w, h, w / 60), 0, 0);
  return { map: toTexture(c), normal: toTexture(n, { srgb: false }) };
}

// ---------------------------------------------------------------------------------------------
// Foliage atlas (2 x 2): eucalyptus | broadleaf / palm frond | fern
// ---------------------------------------------------------------------------------------------

export const ATLAS = {
  eucalyptus: { u: 0, v: 0.5 },
  broadleaf: { u: 0.5, v: 0.5 },
  palm: { u: 0, v: 0 },
  fern: { u: 0.5, v: 0 },
} as const;
export type AtlasRegion = keyof typeof ATLAS;

function leafShape(ctx: CanvasRenderingContext2D, len: number, width: number): void {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(width, len * 0.25, width * 0.8, len * 0.75, 0, len);
  ctx.bezierCurveTo(-width * 0.8, len * 0.75, -width, len * 0.25, 0, 0);
  ctx.fill();
}

function leafColor(rng: () => number, hue: number, sat: number, light: number): string {
  return `hsl(${hue + (rng() - 0.5) * 16}, ${sat + (rng() - 0.5) * 14}%, ${light + (rng() - 0.5) * 12}%)`;
}

export function createFoliageAtlas(size: number): Texture {
  const c = makeCanvas(size, size);
  const ctx = ctx2d(c);
  ctx.clearRect(0, 0, size, size);
  const q = size / 2;
  const rng = createRng(4242);

  // Eucalyptus: drooping twigs with long, narrow, blue-green leaves (top-left).
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, q, q);
  ctx.clip();
  for (let t = 0; t < 9; t++) {
    const sx = q * (0.1 + rng() * 0.8);
    const sy = q * (0.02 + rng() * 0.15);
    ctx.strokeStyle = 'rgba(70,55,40,1)';
    ctx.lineWidth = size / 600;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    const ex = sx + (rng() - 0.5) * q * 0.3;
    const ey = sy + q * (0.5 + rng() * 0.35);
    ctx.quadraticCurveTo(sx + (rng() - 0.5) * q * 0.2, (sy + ey) / 2, ex, ey);
    ctx.stroke();
    for (let l = 0; l < 26; l++) {
      const k = l / 26;
      const lx = sx + (ex - sx) * k + (rng() - 0.5) * 6;
      const ly = sy + (ey - sy) * k;
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate((rng() > 0.5 ? 1 : -1) * (0.15 + rng() * 0.5));
      ctx.fillStyle = leafColor(rng, 150, 18, 30);
      leafShape(ctx, q * (0.1 + rng() * 0.08), q * 0.016);
      ctx.restore();
    }
  }
  ctx.restore();

  // Broadleaf: dense cluster of ovate leaves (top-right).
  ctx.save();
  ctx.beginPath();
  ctx.rect(q, 0, q, q);
  ctx.clip();
  for (let l = 0; l < 260; l++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * q * 0.42;
    const lx = q + q / 2 + Math.cos(a) * r;
    const ly = q / 2 + Math.sin(a) * r;
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(a + Math.PI / 2 + (rng() - 0.5));
    ctx.fillStyle = leafColor(rng, 105, 35, 22 + (1 - r / (q * 0.42)) * 8);
    leafShape(ctx, q * (0.08 + rng() * 0.05), q * 0.04);
    ctx.restore();
  }
  ctx.restore();

  // Palm frond: rachis with long leaflets on both sides (bottom-left), oriented along +y.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, q, q, q);
  ctx.clip();
  const cx = q / 2;
  ctx.strokeStyle = 'rgb(88,92,52)';
  ctx.lineWidth = size / 300;
  ctx.beginPath();
  ctx.moveTo(cx, q + q * 0.02);
  ctx.lineTo(cx, q + q * 0.98);
  ctx.stroke();
  for (let l = 0; l < 60; l++) {
    const k = l / 60;
    const ly = q + q * (0.05 + k * 0.92);
    const len = q * 0.46 * Math.sin(Math.PI * (0.15 + k * 0.8));
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(cx, ly);
      ctx.rotate(side * (Math.PI / 2 - 0.5 - k * 0.3));
      ctx.fillStyle = leafColor(rng, 85, 32, 24);
      leafShape(ctx, len, q * 0.02);
      ctx.restore();
    }
  }
  ctx.restore();

  // Fern: bipinnate frond (bottom-right).
  ctx.save();
  ctx.beginPath();
  ctx.rect(q, q, q, q);
  ctx.clip();
  const fx = q + q / 2;
  for (let l = 0; l < 34; l++) {
    const k = l / 34;
    const ly = q + q * (0.04 + k * 0.93);
    const len = q * 0.42 * Math.sin(Math.PI * (0.1 + k * 0.85));
    for (const side of [-1, 1]) {
      for (let s = 0; s < 9; s++) {
        const sk = s / 9;
        ctx.save();
        ctx.translate(fx + side * len * sk, ly - len * sk * 0.25);
        ctx.rotate(side * 1.2);
        ctx.fillStyle = leafColor(rng, 110, 30, 22);
        leafShape(ctx, len * 0.18 * (1 - sk * 0.6), q * 0.012);
        ctx.restore();
      }
    }
  }
  ctx.restore();

  const tex = toTexture(c, { repeat: false });
  return tex;
}

// ---------------------------------------------------------------------------------------------
// Small utility textures
// ---------------------------------------------------------------------------------------------

/** Soft radial glow used for light sprites (headlights, hazard lights, distant lights). */
export function createGlowTexture(size = 128): Texture {
  const c = makeCanvas(size, size);
  const ctx = ctx2d(c);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.08, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.25)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.05)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return toTexture(c, { srgb: false, repeat: false });
}

/** Radial falloff used for contact shadows under objects. */
export function createShadowBlobTexture(size = 128): Texture {
  const c = makeCanvas(size, size);
  const ctx = ctx2d(c);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.9)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return toTexture(c, { srgb: false, repeat: false });
}

/** Single-channel tileable noise texture for shaders (fog, clouds, flicker). */
export function createNoiseDataTexture(field: NoiseField): DataTexture {
  const s = field.size;
  const data = new Uint8Array(s * s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) data[y * s + x] = Math.round(field.sample(x / s, y / s) * 255);
  const tex = new DataTexture(data, s, s, RedFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
