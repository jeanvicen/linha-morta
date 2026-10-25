/**
 * Save-game persistence. Only real progress written by the playable prologue is ever stored;
 * nothing here fabricates progress. Data read from storage is validated before use.
 */
import { SafeStorage } from '../../core/storage';

export const SAVE_KEY = 'save:v1';

export type ChapterId = 'prologue';

/** Checkpoints of the prologue, in story order. */
export const PROLOGUE_CHECKPOINTS = ['start', 'flashlight', 'radio', 'road', 'ending'] as const;
export type CheckpointId = (typeof PROLOGUE_CHECKPOINTS)[number];

export interface SaveData {
  version: 1;
  chapter: ChapterId;
  checkpoint: CheckpointId;
  inventory: string[];
  /** Notes/documents the player has read. */
  discovered: string[];
  position: [number, number, number];
  yaw: number;
  playTimeSec: number;
  savedAt: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const stringList = (v: unknown, max: number): string[] | null => {
  if (!Array.isArray(v) || v.length > max) return null;
  if (!v.every((s) => typeof s === 'string' && s.length > 0 && s.length <= 48)) return null;
  return [...new Set(v as string[])];
};

/** Returns a valid SaveData or null when the stored value is missing, corrupt or incompatible. */
export function validateSave(raw: unknown): SaveData | null {
  if (!isRecord(raw)) return null;
  if (raw.version !== 1 || raw.chapter !== 'prologue') return null;
  if (!PROLOGUE_CHECKPOINTS.includes(raw.checkpoint as CheckpointId)) return null;
  const inventory = stringList(raw.inventory, 32);
  const discovered = stringList(raw.discovered, 64);
  if (!inventory || !discovered) return null;
  const pos = raw.position;
  if (!Array.isArray(pos) || pos.length !== 3 || !pos.every(isFiniteNum)) return null;
  if (pos.some((n) => Math.abs(n as number) > 5000)) return null;
  if (!isFiniteNum(raw.yaw) || !isFiniteNum(raw.playTimeSec) || raw.playTimeSec < 0) return null;
  if (typeof raw.savedAt !== 'string' || Number.isNaN(Date.parse(raw.savedAt))) return null;
  return {
    version: 1,
    chapter: 'prologue',
    checkpoint: raw.checkpoint as CheckpointId,
    inventory,
    discovered,
    position: [pos[0] as number, pos[1] as number, pos[2] as number],
    yaw: raw.yaw,
    playTimeSec: raw.playTimeSec,
    savedAt: raw.savedAt,
  };
}

export class SaveStore {
  private readonly storage: SafeStorage;

  constructor(storage = new SafeStorage()) {
    this.storage = storage;
  }

  get available(): boolean {
    return this.storage.available;
  }

  load(): SaveData | null {
    return validateSave(this.storage.readJSON(SAVE_KEY));
  }

  hasValidSave(): boolean {
    const save = this.load();
    // A finished prologue is kept as a record but there is nothing left to continue.
    return save !== null && save.checkpoint !== 'ending';
  }

  write(data: Omit<SaveData, 'version' | 'savedAt'>): boolean {
    const record: SaveData = { ...data, version: 1, savedAt: new Date().toISOString() };
    return validateSave(record) !== null && this.storage.writeJSON(SAVE_KEY, record);
  }

  clear(): void {
    this.storage.remove(SAVE_KEY);
  }
}

export function describeSave(save: SaveData): string {
  const labels: Record<CheckpointId, string> = {
    start: 'Prólogo — Acordando na estrada',
    flashlight: 'Prólogo — A lanterna',
    radio: 'Prólogo — O rádio',
    road: 'Prólogo — A estrada',
    ending: 'Prólogo — Concluído',
  };
  const minutes = Math.max(1, Math.round(save.playTimeSec / 60));
  return `${labels[save.checkpoint]} · ${minutes} min`;
}
