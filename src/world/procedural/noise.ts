/**
 * Tileable noise fields for procedural textures. A field is computed once and then sampled
 * bilinearly at several scales, which is much faster than evaluating fBm for every texel.
 */
import { createRng } from '../../core/math';

export class NoiseField {
  readonly size: number;
  private readonly data: Float32Array;

  /** Builds a tileable fBm field in [0, 1]. */
  constructor(size: number, seed: number, octaves = 5, baseFreq = 4) {
    this.size = size;
    this.data = new Float32Array(size * size);
    const rng = createRng(seed);
    const lattices: Float32Array[] = [];
    const freqs: number[] = [];
    for (let o = 0; o < octaves; o++) {
      const f = baseFreq << o;
      freqs.push(f);
      const lat = new Float32Array(f * f);
      for (let i = 0; i < lat.length; i++) lat[i] = rng();
      lattices.push(lat);
    }
    let min = Infinity;
    let max = -Infinity;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let v = 0;
        let amp = 1;
        let norm = 0;
        for (let o = 0; o < octaves; o++) {
          const f = freqs[o]!;
          const lat = lattices[o]!;
          const fx = (x / size) * f;
          const fy = (y / size) * f;
          const x0 = Math.floor(fx);
          const y0 = Math.floor(fy);
          const tx = fx - x0;
          const ty = fy - y0;
          const sx = tx * tx * (3 - 2 * tx);
          const sy = ty * ty * (3 - 2 * ty);
          const x1 = (x0 + 1) % f;
          const y1 = (y0 + 1) % f;
          const a = lat[y0 * f + x0]!;
          const b = lat[y0 * f + x1]!;
          const c = lat[y1 * f + x0]!;
          const d = lat[y1 * f + x1]!;
          v += (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * amp;
          norm += amp;
          amp *= 0.5;
        }
        v /= norm;
        this.data[y * size + x] = v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    const range = max - min || 1;
    for (let i = 0; i < this.data.length; i++) this.data[i] = (this.data[i]! - min) / range;
  }

  /** Bilinear, wrapping sample. u and v are in "tiles" (1 = one full period). */
  sample(u: number, v: number): number {
    const s = this.size;
    const fx = (u - Math.floor(u)) * s;
    const fy = (v - Math.floor(v)) * s;
    const x0 = Math.floor(fx) % s;
    const y0 = Math.floor(fy) % s;
    const x1 = (x0 + 1) % s;
    const y1 = (y0 + 1) % s;
    const tx = fx - Math.floor(fx);
    const ty = fy - Math.floor(fy);
    const d = this.data;
    const a = d[y0 * s + x0]!;
    const b = d[y0 * s + x1]!;
    const c = d[y1 * s + x0]!;
    const e = d[y1 * s + x1]!;
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + e) * tx * ty;
  }
}

/** Fast integer hash in [0, 1) for per-texel grain. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
