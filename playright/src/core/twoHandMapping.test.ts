import { describe, expect, it } from 'vitest';
import { getFingerMapping, TWO_HAND_KEY_MAP } from './twoHandMapping.ts';

describe('twoHandMapping', () => {
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
