/**
 * Offline generation of audio buffers (noise beds, rain drop textures, radio crackle, reverb
 * impulse responses). Everything is synthesized procedurally, so no audio files are required.
 */
import { createRng } from '../core/math';

export function whiteNoise(ctx: BaseAudioContext, seconds: number, seed = 1): AudioBuffer {
  const rng = createRng(seed);
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buffer.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = rng() * 2 - 1;
  return buffer;
}

/** Pink noise (Paul Kellet's refined method). */
export function pinkNoise(ctx: BaseAudioContext, seconds: number, seed = 2): AudioBuffer {
  const rng = createRng(seed);
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buffer.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < d.length; i++) {
    const w = rng() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  smoothLoop(d, ctx.sampleRate);
  return buffer;
}

export function brownNoise(ctx: BaseAudioContext, seconds: number, seed = 3): AudioBuffer {
  const rng = createRng(seed);
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    last = (last + 0.02 * (rng() * 2 - 1)) / 1.02;
    d[i] = last * 3.5;
  }
  smoothLoop(d, ctx.sampleRate);
  return buffer;
}

/** Crossfades the end of a buffer into its start so it loops without a click. */
function smoothLoop(d: Float32Array, rate: number): void {
  const n = Math.min(Math.floor(rate * 0.05), Math.floor(d.length / 4));
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const end = d.length - n + i;
    d[end] = d[end]! * (1 - t) + d[i]! * t;
  }
}

/**
 * Rain drop texture: thousands of tiny filtered impacts. `metallic` adds resonant pings, like
 * drops on a car roof.
 */
export function rainDrops(ctx: BaseAudioContext, seconds: number, density: number, metallic: boolean, seed = 4): AudioBuffer {
  const rng = createRng(seed);
  const rate = ctx.sampleRate;
  const buffer = ctx.createBuffer(2, Math.floor(rate * seconds), rate);
  const L = buffer.getChannelData(0);
  const R = buffer.getChannelData(1);
  const count = Math.floor(seconds * density);
  for (let k = 0; k < count; k++) {
    const start = Math.floor(rng() * (L.length - rate * 0.06));
    const pan = rng();
    const amp = Math.pow(rng(), 3) * (metallic ? 0.5 : 0.35);
    if (metallic) {
      const f = 1400 + rng() * 2600;
      const decay = 0.012 + rng() * 0.03;
      const len = Math.floor(rate * decay * 5);
      for (let i = 0; i < len && start + i < L.length; i++) {
        const t = i / rate;
        const v = Math.sin(2 * Math.PI * f * t) * Math.exp(-t / decay) * amp;
        L[start + i]! += v * (1 - pan);
        R[start + i]! += v * pan;
      }
    } else {
      const len = Math.floor(rate * (0.002 + rng() * 0.006));
      let lp = 0;
      const k1 = 0.3 + rng() * 0.6;
      for (let i = 0; i < len && start + i < L.length; i++) {
        const env = Math.exp((-i / len) * 5);
        lp += ((rng() * 2 - 1) - lp) * k1;
        const v = lp * env * amp;
        L[start + i]! += v * (1 - pan * 0.8);
        R[start + i]! += v * (0.2 + pan * 0.8);
      }
    }
  }
  return buffer;
}

/** Radio crackle: pops and clicks of varying size. */
export function crackle(ctx: BaseAudioContext, seconds: number, seed = 5): AudioBuffer {
  const rng = createRng(seed);
  const rate = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, Math.floor(rate * seconds), rate);
  const d = buffer.getChannelData(0);
  const count = Math.floor(seconds * 38);
  for (let k = 0; k < count; k++) {
    const start = Math.floor(rng() * (d.length - 2000));
    const len = 20 + Math.floor(rng() * (rng() < 0.1 ? 900 : 120));
    const amp = Math.pow(rng(), 2) * 0.9;
    for (let i = 0; i < len; i++) d[start + i]! += (rng() * 2 - 1) * amp * Math.exp((-i / len) * 4);
  }
  return buffer;
}

/** Stereo reverb impulse response (exponentially decaying filtered noise). */
export function impulseResponse(ctx: BaseAudioContext, seconds: number, decay: number, seed = 6): AudioBuffer {
  const rng = createRng(seed);
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const d = buffer.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      lp += ((rng() * 2 - 1) - lp) * (0.6 - t * 0.45);
      d[i] = lp * Math.pow(1 - t, decay);
    }
  }
  return buffer;
}

/** Soft-clipping curve used for radio distortion. */
export function distortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return curve;
}
