import { describe, expect, it } from 'vitest';
import { SaveStore, describeSave, validateSave } from '../src/features/save/save';
import { MemoryStore, SafeStorage } from '../src/core/storage';

const valid = {
  version: 1,
  chapter: 'prologue',
  checkpoint: 'radio',
  inventory: ['flashlight'],
  discovered: ['radio-broadcast'],
  position: [1, 0, -10],
  yaw: 0.5,
  playTimeSec: 130,
  savedAt: '2026-10-24T22:00:00.000Z',
};

describe('validateSave', () => {
  it('accepts a well formed save', () => {
    expect(validateSave(valid)).toMatchObject({ checkpoint: 'radio', inventory: ['flashlight'] });
  });

  it.each([
    ['null', null],
    ['wrong version', { ...valid, version: 2 }],
    ['unknown checkpoint', { ...valid, checkpoint: 'boss' }],
    ['bad position', { ...valid, position: [1, 2] }],
    ['NaN position', { ...valid, position: [1, Number.NaN, 2] }],
    ['far away position', { ...valid, position: [99999, 0, 0] }],
    ['negative time', { ...valid, playTimeSec: -1 }],
    ['bad date', { ...valid, savedAt: 'yesterday' }],
    ['non string inventory', { ...valid, inventory: [1] }],
  ])('rejects %s', (_label, raw) => {
    expect(validateSave(raw)).toBeNull();
  });
});

describe('SaveStore', () => {
  it('has no save by default and never fabricates progress', () => {
    const store = new SaveStore(new SafeStorage(new MemoryStore()));
    expect(store.load()).toBeNull();
    expect(store.hasValidSave()).toBe(false);
  });

  it('writes, loads and clears saves', () => {
    const store = new SaveStore(new SafeStorage(new MemoryStore()));
    expect(
      store.write({ chapter: 'prologue', checkpoint: 'flashlight', inventory: ['flashlight'], discovered: [], position: [0, 0, 3], yaw: 0, playTimeSec: 42 }),
    ).toBe(true);
    expect(store.hasValidSave()).toBe(true);
    expect(store.load()?.checkpoint).toBe('flashlight');
    store.clear();
    expect(store.hasValidSave()).toBe(false);
  });

  it('a finished prologue cannot be continued', () => {
    const store = new SaveStore(new SafeStorage(new MemoryStore()));
    store.write({ chapter: 'prologue', checkpoint: 'ending', inventory: [], discovered: [], position: [0, 0, -120], yaw: 0, playTimeSec: 300 });
    expect(store.load()).not.toBeNull();
    expect(store.hasValidSave()).toBe(false);
  });

  it('ignores corrupted storage', () => {
    const backing = new MemoryStore();
    backing.setItem('linha-morta:save:v1', '{not json');
    expect(new SaveStore(new SafeStorage(backing)).load()).toBeNull();
  });

  it('describes saves in Portuguese', () => {
    expect(describeSave(validateSave(valid)!)).toBe('Prólogo — O rádio · 2 min');
  });
});
