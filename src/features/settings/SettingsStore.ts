import { Emitter } from '../../core/events';
import { SafeStorage } from '../../core/storage';
import {
  QUALITY_PRESETS,
  sanitizeSettings,
  type GraphicsSettings,
  type QualityLevel,
  type Settings,
} from './settings';

const STORAGE_KEY = 'settings:v1';

interface SettingsEvents {
  change: { settings: Settings; graphics: GraphicsSettings };
}

/**
 * Holds the player's settings, persists them locally and exposes the *effective* graphics
 * settings (with "auto" resolved to the quality level chosen for this device).
 */
export class SettingsStore extends Emitter<SettingsEvents> {
  private current: Settings;
  private autoLevel: QualityLevel = 'high';
  private readonly storage: SafeStorage;

  constructor(storage = new SafeStorage()) {
    super();
    this.storage = storage;
    this.current = sanitizeSettings(storage.readJSON(STORAGE_KEY));
  }

  get value(): Settings {
    return this.current;
  }

  get persistent(): boolean {
    return this.storage.available;
  }

  get resolvedAutoLevel(): QualityLevel {
    return this.autoLevel;
  }

  /** Graphics values actually used by the renderer. */
  get graphics(): GraphicsSettings {
    const g = this.current.graphics;
    if (g.preset !== 'auto') return g;
    return { ...g, ...QUALITY_PRESETS[this.autoLevel] };
  }

  setAutoLevel(level: QualityLevel): void {
    if (level === this.autoLevel) return;
    this.autoLevel = level;
    if (this.current.graphics.preset === 'auto') this.notify();
  }

  update(mutator: (draft: Settings) => Settings): void {
    this.current = sanitizeSettings(mutator(structuredClone(this.current)));
    this.storage.writeJSON(STORAGE_KEY, this.current);
    this.notify();
  }

  reset(): void {
    this.storage.remove(STORAGE_KEY);
    this.current = sanitizeSettings(null);
    this.notify();
  }

  private notify(): void {
    this.emit('change', { settings: this.current, graphics: this.graphics });
  }
}
