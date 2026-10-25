import { describe, expect, it } from 'vitest';
import {
  QUALITY_PRESETS,
  applyPreset,
  defaultSettings,
  resolveReducedMotion,
  sanitizeSettings,
  withGraphicsDetail,
} from '../src/features/settings/settings';
import { SettingsStore } from '../src/features/settings/SettingsStore';
import { MemoryStore, SafeStorage } from '../src/core/storage';

describe('sanitizeSettings', () => {
  it('returns defaults for garbage input', () => {
    expect(sanitizeSettings(null)).toEqual(defaultSettings());
    expect(sanitizeSettings('oops')).toEqual(defaultSettings());
    expect(sanitizeSettings([1, 2])).toEqual(defaultSettings());
  });

  it('clamps numbers and rejects unknown enum values', () => {
    const s = sanitizeSettings({
      graphics: { preset: 'insane', resolutionScale: 9, particles: 'mega', fpsLimit: 144 },
      audio: { master: -3, music: 2, enabled: 'yes' },
      accessibility: { textScale: 5, reducedMotion: 'maybe' },
      display: { fov: 10 },
    });
    expect(s.graphics.preset).toBe('auto');
    expect(s.graphics.resolutionScale).toBe(1);
    expect(s.graphics.particles).toBe(defaultSettings().graphics.particles);
    expect(s.graphics.fpsLimit).toBe(0);
    expect(s.audio.master).toBe(0);
    expect(s.audio.music).toBe(1);
    expect(s.audio.enabled).toBe(true);
    expect(s.accessibility.textScale).toBe(1.3);
    expect(s.accessibility.reducedMotion).toBe('system');
    expect(s.display.fov).toBe(55);
  });

  it('keeps valid values', () => {
    const input = defaultSettings();
    input.graphics = { ...input.graphics, preset: 'custom', shadows: 'off', fpsLimit: 30 };
    input.audio.sfx = 0.25;
    expect(sanitizeSettings(JSON.parse(JSON.stringify(input)))).toEqual(input);
  });
});

describe('presets', () => {
  it('applies a preset while keeping the frame-rate limit', () => {
    const g = { ...defaultSettings().graphics, fpsLimit: 30 as const };
    const low = applyPreset(g, 'low', 'high');
    expect(low).toMatchObject({ ...QUALITY_PRESETS.low, preset: 'low', fpsLimit: 30 });
    const auto = applyPreset(g, 'auto', 'medium');
    expect(auto).toMatchObject({ ...QUALITY_PRESETS.medium, preset: 'auto' });
  });

  it('switches to custom when a single detail changes', () => {
    const g = applyPreset(defaultSettings().graphics, 'high', 'high');
    const changed = withGraphicsDetail(g, 'shadows', 'off');
    expect(changed.preset).toBe('custom');
    expect(changed.shadows).toBe('off');
    expect(changed.particles).toBe(QUALITY_PRESETS.high.particles);
  });

  it('presets get strictly heavier', () => {
    const order = ['low', 'medium', 'high', 'ultra'] as const;
    for (let i = 1; i < order.length; i++) {
      expect(QUALITY_PRESETS[order[i]!].resolutionScale).toBeGreaterThanOrEqual(QUALITY_PRESETS[order[i - 1]!].resolutionScale);
    }
  });
});

describe('reduced motion', () => {
  it('honours explicit choice over the system preference', () => {
    expect(resolveReducedMotion('on', false)).toBe(true);
    expect(resolveReducedMotion('off', true)).toBe(false);
    expect(resolveReducedMotion('system', true)).toBe(true);
    expect(resolveReducedMotion('system', false)).toBe(false);
  });
});

describe('SettingsStore', () => {
  it('persists and restores settings', () => {
    const backing = new MemoryStore();
    const a = new SettingsStore(new SafeStorage(backing));
    a.update((s) => {
      s.audio.music = 0.1;
      s.graphics.preset = 'low';
      return s;
    });
    const b = new SettingsStore(new SafeStorage(backing));
    expect(b.value.audio.music).toBe(0.1);
    expect(b.value.graphics.preset).toBe('low');
  });

  it('resolves auto graphics to the detected level and notifies on change', () => {
    const store = new SettingsStore(new SafeStorage(new MemoryStore()));
    store.setAutoLevel('low');
    expect(store.graphics).toMatchObject(QUALITY_PRESETS.low);
    let notified = 0;
    store.on('change', () => notified++);
    store.setAutoLevel('medium');
    expect(notified).toBe(1);
    expect(store.graphics).toMatchObject(QUALITY_PRESETS.medium);
  });

  it('keeps working without storage', () => {
    const store = new SettingsStore(new SafeStorage(null));
    expect(store.persistent).toBe(false);
    store.update((s) => {
      s.audio.master = 0.3;
      return s;
    });
    expect(store.value.audio.master).toBe(0.3);
  });
});
