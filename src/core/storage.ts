/**
 * Safe wrapper around localStorage. Every access is guarded because storage can be unavailable
 * (private browsing, blocked cookies, quota exceeded) and the game must keep working without it.
 */
const PREFIX = 'linha-morta:';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStore(): KeyValueStore | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = `${PREFIX}__probe__`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

export class SafeStorage {
  private readonly store: KeyValueStore | null;

  constructor(store: KeyValueStore | null = defaultStore()) {
    this.store = store;
  }

  get available(): boolean {
    return this.store !== null;
  }

  readJSON(key: string): unknown {
    if (!this.store) return null;
    try {
      const raw = this.store.getItem(PREFIX + key);
      return raw === null ? null : (JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  }

  writeJSON(key: string, value: unknown): boolean {
    if (!this.store) return false;
    try {
      this.store.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  remove(key: string): void {
    if (!this.store) return;
    try {
      this.store.removeItem(PREFIX + key);
    } catch {
      /* storage unavailable: nothing to remove */
    }
  }
}

/** In-memory store, used by tests and as a fallback. */
export class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}
