import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareScriptWithFingering } from './fingeringPredictor.ts';
import {
  MANUAL_HAND_OVERRIDES_PREFIX,
  clearLegacyHandOverrides,
  migrateLegacyHandOverrides,
  migrateLegacyHandOverridesOnLoad,
  readLegacyHandOverrides,
} from './manualHandOverrideMigration.ts';
import { fingeringKey, type Finger, type PlaybackScript } from '../types/index.ts';

const crossoverScript: PlaybackScript = [
  {
    order: 0,
    onset: 0,
    measureNumber: 1,
    notes: [{ pitch: 'C3', midi: 48, hand: 'L', finger: null }],
  },
  {
    order: 1,
    onset: 480,
    measureNumber: 1,
    notes: [
      {
        pitch: 'E4',
        midi: 64,
        hand: 'R',
        finger: 3,
        fingerSource: 'score',
      },
    ],
    graceBefore: [
      {
        midi: 62,
        pitch: 'D4',
        hand: 'R',
        kind: 'acciaccatura',
      },
    ],
  },
];

describe('manualHandOverrideMigration', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    const localStorageMock = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
    };
    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubGlobal('window', { localStorage: localStorageMock });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('converts legacy onset:midi overrides to crossover manual fingerings', () => {
    const { manualFingerings, migratedCount } = migrateLegacyHandOverrides(
      crossoverScript,
      { [fingeringKey(0, 'R', 48)]: 2 as Finger },
      { '0:48': 'R' },
    );

    expect(migratedCount).toBe(1);
    expect(manualFingerings[fingeringKey(0, 'L', 48)]).toEqual({
      finger: 2,
      physicalHand: 'R',
    });
    expect(manualFingerings[fingeringKey(0, 'R', 48)]).toBeUndefined();
  });

  it('preserves an existing finger on the notated-hand key', () => {
    const { manualFingerings } = migrateLegacyHandOverrides(
      crossoverScript,
      { [fingeringKey(0, 'L', 48)]: 4 as Finger },
      { '0:48': 'R' },
    );

    expect(manualFingerings[fingeringKey(0, 'L', 48)]).toEqual({
      finger: 4,
      physicalHand: 'R',
    });
  });

  it('does not add manual_fingerings keys for grace notes', () => {
    const { manualFingerings } = migrateLegacyHandOverrides(
      crossoverScript,
      {},
      { '480:62': 'L' },
    );

    expect(Object.keys(manualFingerings)).toHaveLength(0);
  });

  it('migrates on load, clears localStorage, and keeps notated staff hand', async () => {
    storage.set(
      `${MANUAL_HAND_OVERRIDES_PREFIX}score-1`,
      JSON.stringify({ '0:48': 'R' }),
    );

    const { manualFingerings, didMigrate } = migrateLegacyHandOverridesOnLoad(
      crossoverScript,
      { [fingeringKey(0, 'R', 48)]: 2 as Finger },
      'score-1',
    );

    expect(didMigrate).toBe(true);
    expect(manualFingerings[fingeringKey(0, 'L', 48)]).toEqual({
      finger: 2,
      physicalHand: 'R',
    });
    expect(readLegacyHandOverrides('score-1')).toEqual({});

    const prepared = await prepareScriptWithFingering(crossoverScript, manualFingerings, false, 1);
    const note = prepared[0].notes[0];
    expect(note.hand).toBe('L');
    expect(note.finger).toBe(2);
    expect(note.playingHand).toBe('R');
    expect(note.fingerSource).toBe('manual');
  });

  it('clearLegacyHandOverrides removes only the targeted score key', () => {
    storage.set(`${MANUAL_HAND_OVERRIDES_PREFIX}a`, JSON.stringify({ '0:48': 'R' }));
    storage.set(`${MANUAL_HAND_OVERRIDES_PREFIX}b`, JSON.stringify({ '0:48': 'L' }));

    clearLegacyHandOverrides('a');

    expect(readLegacyHandOverrides('a')).toEqual({});
    expect(readLegacyHandOverrides('b')).toEqual({ '0:48': 'L' });
  });
});
