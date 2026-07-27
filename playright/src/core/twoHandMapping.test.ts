import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_TWO_HAND_KEY_BINDINGS,
  TWO_HAND_KEY_BINDINGS_STORAGE_KEY,
  TWO_HAND_KEY_MAP,
  cloneTwoHandKeyBindings,
  getFingerMapping,
  getFingerMappingFromKeyboard,
  normalizeTwoHandKeyBindings,
  physicalKeyFromKeyboardEvent,
  readTwoHandKeyBindingsFromStorage,
  rebindFingerSlot,
  writeTwoHandKeyBindingsToStorage,
} from './twoHandMapping.ts';

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe('twoHandMapping defaults', () => {
  it.each([
    ['q', 'L', 5],
    ['w', 'L', 4],
    ['e', 'L', 3],
    ['r', 'L', 2],
    ['v', 'L', 1],
    ['n', 'R', 1],
    ['i', 'R', 2],
    ['o', 'R', 3],
    ['p', 'R', 4],
    ['[', 'R', 5],
  ] as const)('maps %s to %s finger %i', (key, hand, finger) => {
    expect(getFingerMapping(key)).toEqual({ hand, finger });
    expect(TWO_HAND_KEY_MAP[key]).toEqual({ hand, finger });
  });

  it('resolves uppercase keys like lowercase', () => {
    expect(getFingerMapping('Q')).toEqual({ hand: 'L', finger: 5 });
    expect(getFingerMapping('N')).toEqual({ hand: 'R', finger: 1 });
    expect(getFingerMapping('P')).toEqual({ hand: 'R', finger: 4 });
  });

  it.each(['a', 'z', '1', ' ', 'Enter'])(
    'returns null for unmapped key %s',
    (key) => {
      expect(getFingerMapping(key)).toBeNull();
    },
  );
});

describe('twoHandMapping rebind', () => {
  it('assigns a free key to a slot', () => {
    const result = rebindFingerSlot(
      DEFAULT_TWO_HAND_KEY_BINDINGS,
      'L:5',
      { key: 'a', code: 'KeyA' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.swappedWith).toBeNull();
    expect(result.bindings['L:5']).toEqual({ key: 'a', code: 'KeyA' });
    expect(getFingerMapping('a', result.bindings)).toEqual({
      hand: 'L',
      finger: 5,
    });
    expect(getFingerMapping('q', result.bindings)).toBeNull();
  });

  it('swaps when the key is already bound to another slot', () => {
    const result = rebindFingerSlot(
      DEFAULT_TWO_HAND_KEY_BINDINGS,
      'L:5',
      { key: 'n', code: 'KeyN' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.swappedWith).toBe('R:1');
    expect(result.bindings['L:5']).toEqual({ key: 'n', code: 'KeyN' });
    expect(result.bindings['R:1']).toEqual({ key: 'q', code: 'KeyQ' });
  });

  it('resolves keyboard events through custom bindings', () => {
    const remapped = rebindFingerSlot(
      DEFAULT_TWO_HAND_KEY_BINDINGS,
      'R:1',
      { key: 'm', code: 'KeyM' },
    );
    expect(remapped.ok).toBe(true);
    if (!remapped.ok) {
      return;
    }

    const event = {
      key: 'm',
      code: 'KeyM',
    } as KeyboardEvent;

    expect(getFingerMappingFromKeyboard(event, remapped.bindings)).toEqual({
      hand: 'R',
      finger: 1,
    });
    expect(
      getFingerMappingFromKeyboard(
        { key: 'n', code: 'KeyN' } as KeyboardEvent,
        remapped.bindings,
      ),
    ).toBeNull();
  });

  it('rejects blocked keys for rebinding', () => {
    expect(
      physicalKeyFromKeyboardEvent({
        key: 'Escape',
        code: 'Escape',
      } as KeyboardEvent),
    ).toBeNull();
    expect(
      physicalKeyFromKeyboardEvent({
        key: ' ',
        code: 'Space',
      } as KeyboardEvent),
    ).toBeNull();
  });
});

describe('twoHandMapping persistence', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createMemoryStorage();
  });

  afterEach(() => {
    storage.clear();
  });

  it('round-trips bindings through localStorage', () => {
    const remapped = cloneTwoHandKeyBindings(DEFAULT_TWO_HAND_KEY_BINDINGS);
    remapped['L:1'] = { key: 'z', code: 'KeyZ' };
    writeTwoHandKeyBindingsToStorage(remapped, storage);

    expect(storage.getItem(TWO_HAND_KEY_BINDINGS_STORAGE_KEY)).toBeTruthy();
    expect(readTwoHandKeyBindingsFromStorage(storage)['L:1']).toEqual({
      key: 'z',
      code: 'KeyZ',
    });
  });

  it('falls back to defaults for corrupt payloads', () => {
    expect(normalizeTwoHandKeyBindings(null)).toEqual(
      DEFAULT_TWO_HAND_KEY_BINDINGS,
    );
    expect(normalizeTwoHandKeyBindings({ 'L:5': { key: 1 } })).toEqual(
      DEFAULT_TWO_HAND_KEY_BINDINGS,
    );
  });
});
