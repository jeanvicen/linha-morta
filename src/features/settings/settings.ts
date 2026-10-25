/**
 * Settings schema, presets and validation. Everything here is pure so it can be unit tested;
 * the persistent store lives in `SettingsStore.ts`.
 */

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';
export type QualityPreset = 'auto' | QualityLevel | 'custom';
export type ShadowQuality = 'off' | 'low' | 'high' | 'ultra';
export type PostProcessing = 'off' | 'low' | 'high';
export type ReflectionQuality = 'off' | 'low' | 'high';
export type FpsLimit = 0 | 30 | 60;
export type ReducedMotion = 'system' | 'on' | 'off';

export interface GraphicsSettings {
  preset: QualityPreset;
  /** Multiplier applied on top of the device pixel ratio cap (0.5 – 1). */
  resolutionScale: number;
  particles: QualityLevel;
  shadows: ShadowQuality;
  postProcessing: PostProcessing;
  reflections: ReflectionQuality;
  density: QualityLevel;
  /** 0 means synced to the display refresh rate. */
  fpsLimit: FpsLimit;
}

export interface AudioSettings {
  enabled: boolean;
  master: number;
  music: number;
  ambience: number;
  sfx: number;
}

export interface DisplaySettings {
  showFps: boolean;
  /** Vertical field of view used in first person (degrees). */
  fov: number;
}

export interface AccessibilitySettings {
  reducedMotion: ReducedMotion;
  /** Disables lightning flashes and fast light flicker. */
  reduceFlashes: boolean;
  highContrast: boolean;
  textScale: number;
  subtitles: boolean;
}

export interface ControlSettings {
  mouseSensitivity: number;
  invertY: boolean;
}

export interface Settings {
  version: 1;
  graphics: GraphicsSettings;
  audio: AudioSettings;
  display: DisplaySettings;
  accessibility: AccessibilitySettings;
  controls: ControlSettings;
}

export type GraphicsDetail = Omit<GraphicsSettings, 'preset' | 'fpsLimit'>;

/** Concrete values used by each quality level. "auto" resolves to one of these at runtime. */
export const QUALITY_PRESETS: Readonly<Record<QualityLevel, GraphicsDetail>> = {
  low: {
    resolutionScale: 0.75,
    particles: 'low',
    shadows: 'off',
    postProcessing: 'low',
    reflections: 'off',
    density: 'low',
  },
  medium: {
    resolutionScale: 0.9,
    particles: 'medium',
    shadows: 'low',
    postProcessing: 'low',
    reflections: 'low',
    density: 'medium',
  },
  high: {
    resolutionScale: 1,
    particles: 'high',
    shadows: 'high',
    postProcessing: 'high',
    reflections: 'high',
    density: 'high',
  },
  ultra: {
    resolutionScale: 1,
    particles: 'ultra',
    shadows: 'ultra',
    postProcessing: 'high',
    reflections: 'high',
    density: 'ultra',
  },
};

export const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
const PRESETS: readonly QualityPreset[] = ['auto', 'low', 'medium', 'high', 'ultra', 'custom'];
const SHADOWS: readonly ShadowQuality[] = ['off', 'low', 'high', 'ultra'];
const POST: readonly PostProcessing[] = ['off', 'low', 'high'];
const REFLECTIONS: readonly ReflectionQuality[] = ['off', 'low', 'high'];
const FPS: readonly FpsLimit[] = [0, 30, 60];
const MOTION: readonly ReducedMotion[] = ['system', 'on', 'off'];

export const LIMITS = {
  resolutionScale: { min: 0.5, max: 1 },
  volume: { min: 0, max: 1 },
  textScale: { min: 1, max: 1.3 },
  fov: { min: 55, max: 90 },
  mouseSensitivity: { min: 0.2, max: 3 },
} as const;

export function defaultSettings(): Settings {
  return {
    version: 1,
    graphics: { preset: 'auto', ...QUALITY_PRESETS.high, fpsLimit: 0 },
    audio: { enabled: true, master: 0.8, music: 0.55, ambience: 0.8, sfx: 0.7 },
    display: { showFps: false, fov: 70 },
    accessibility: {
      reducedMotion: 'system',
      reduceFlashes: false,
      highContrast: false,
      textScale: 1,
      subtitles: true,
    },
    controls: { mouseSensitivity: 1, invertY: false },
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function pick<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function num(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Validates untrusted data (e.g. from localStorage) and returns a complete, safe Settings object.
 * Unknown or malformed fields fall back to defaults instead of throwing.
 */
export function sanitizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!isRecord(raw)) return d;
  const g = isRecord(raw.graphics) ? raw.graphics : {};
  const a = isRecord(raw.audio) ? raw.audio : {};
  const disp = isRecord(raw.display) ? raw.display : {};
  const acc = isRecord(raw.accessibility) ? raw.accessibility : {};
  const c = isRecord(raw.controls) ? raw.controls : {};
  return {
    version: 1,
    graphics: {
      preset: pick(g.preset, PRESETS, d.graphics.preset),
      resolutionScale: num(g.resolutionScale, LIMITS.resolutionScale.min, LIMITS.resolutionScale.max, d.graphics.resolutionScale),
      particles: pick(g.particles, QUALITY_LEVELS, d.graphics.particles),
      shadows: pick(g.shadows, SHADOWS, d.graphics.shadows),
      postProcessing: pick(g.postProcessing, POST, d.graphics.postProcessing),
      reflections: pick(g.reflections, REFLECTIONS, d.graphics.reflections),
      density: pick(g.density, QUALITY_LEVELS, d.graphics.density),
      fpsLimit: pick(g.fpsLimit, FPS, d.graphics.fpsLimit),
    },
    audio: {
      enabled: bool(a.enabled, d.audio.enabled),
      master: num(a.master, 0, 1, d.audio.master),
      music: num(a.music, 0, 1, d.audio.music),
      ambience: num(a.ambience, 0, 1, d.audio.ambience),
      sfx: num(a.sfx, 0, 1, d.audio.sfx),
    },
    display: {
      showFps: bool(disp.showFps, d.display.showFps),
      fov: num(disp.fov, LIMITS.fov.min, LIMITS.fov.max, d.display.fov),
    },
    accessibility: {
      reducedMotion: pick(acc.reducedMotion, MOTION, d.accessibility.reducedMotion),
      reduceFlashes: bool(acc.reduceFlashes, d.accessibility.reduceFlashes),
      highContrast: bool(acc.highContrast, d.accessibility.highContrast),
      textScale: num(acc.textScale, LIMITS.textScale.min, LIMITS.textScale.max, d.accessibility.textScale),
      subtitles: bool(acc.subtitles, d.accessibility.subtitles),
    },
    controls: {
      mouseSensitivity: num(c.mouseSensitivity, LIMITS.mouseSensitivity.min, LIMITS.mouseSensitivity.max, d.controls.mouseSensitivity),
      invertY: bool(c.invertY, d.controls.invertY),
    },
  };
}

/** Returns graphics settings with a preset's detail values applied (keeps the frame-rate limit). */
export function applyPreset(graphics: GraphicsSettings, preset: QualityPreset, autoLevel: QualityLevel): GraphicsSettings {
  if (preset === 'custom') return { ...graphics, preset };
  const level = preset === 'auto' ? autoLevel : preset;
  return { ...graphics, ...QUALITY_PRESETS[level], preset };
}

/** Marks the graphics as "custom" when a single detail value is changed by the player. */
export function withGraphicsDetail<K extends keyof GraphicsDetail>(
  graphics: GraphicsSettings,
  key: K,
  value: GraphicsDetail[K],
): GraphicsSettings {
  return { ...graphics, [key]: value, preset: 'custom' };
}

/** Resolves the effective reduced-motion flag from the setting and the OS preference. */
export function resolveReducedMotion(setting: ReducedMotion, systemPrefersReduced: boolean): boolean {
  if (setting === 'on') return true;
  if (setting === 'off') return false;
  return systemPrefersReduced;
}
