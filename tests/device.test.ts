import { describe, expect, it } from 'vitest';
import { estimateQuality, pixelRatioCap } from '../src/core/device';

const base: {
  mobile: boolean;
  ios: boolean;
  cores: number;
  memoryGB: number | null;
  screenW: number;
  screenH: number;
  dpr: number;
  gpu: { webgl2: boolean; renderer: string; vendor: string; maxTextureSize: number };
} = {
  mobile: false,
  ios: false,
  cores: 8,
  memoryGB: 8,
  screenW: 1920,
  screenH: 1080,
  dpr: 1,
  gpu: { webgl2: true, renderer: '', vendor: '', maxTextureSize: 16384 },
};

const withGpu = (renderer: string, extra: Partial<typeof base> = {}) => ({ ...base, ...extra, gpu: { ...base.gpu, renderer } });

describe('estimateQuality', () => {
  it('falls back to low without WebGL 2 or with software rendering', () => {
    expect(estimateQuality({ ...base, gpu: { ...base.gpu, webgl2: false } })).toBe('low');
    expect(estimateQuality(withGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))'))).toBe('low');
    expect(estimateQuality(withGpu('llvmpipe (LLVM 15.0.7, 256 bits)'))).toBe('low');
  });

  it('uses ultra for modern discrete desktop GPUs', () => {
    expect(estimateQuality(withGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)'))).toBe('ultra');
    expect(estimateQuality(withGpu('ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11)'))).toBe('ultra');
  });

  it('is conservative with integrated GPUs and huge screens', () => {
    expect(estimateQuality(withGpu('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)', { cores: 4 }))).toBe('low');
    expect(estimateQuality(withGpu('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)'))).toBe('medium');
    expect(estimateQuality(withGpu('NVIDIA GeForce GTX 1060', { screenW: 3840, screenH: 2160, dpr: 1 }))).toBe('high');
  });

  it('handles Apple silicon', () => {
    expect(estimateQuality(withGpu('Apple M1'))).toBe('high');
    expect(estimateQuality(withGpu('Apple M3 Max'))).toBe('ultra');
  });

  it('keeps phones at low/medium', () => {
    expect(estimateQuality(withGpu('Apple GPU', { mobile: true, ios: true, memoryGB: null }))).toBe('medium');
    expect(estimateQuality(withGpu('Adreno (TM) 740', { mobile: true, memoryGB: 8 }))).toBe('medium');
    expect(estimateQuality(withGpu('Mali-G52', { mobile: true, memoryGB: 3 }))).toBe('low');
    expect(estimateQuality(withGpu('Adreno (TM) 740', { mobile: true, memoryGB: 2 }))).toBe('low');
  });

  it('caps the pixel ratio per level', () => {
    expect(pixelRatioCap('low', false)).toBe(1);
    expect(pixelRatioCap('ultra', false)).toBe(2);
    expect(pixelRatioCap('high', true)).toBeGreaterThan(pixelRatioCap('medium', true));
  });
});
