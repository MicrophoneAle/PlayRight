import { describe, expect, it } from 'vitest';
import {
  getDynamicKeyMap,
  getEffectiveKeyMap,
  isBlackRowCode,
  isWhiteRowCode,
  normalizeScopePosition,
  SCOPE_SIZE,
} from './InputManager.ts';

const CORE_WHITE_CODES = [
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyF',
  'KeyG',
  'KeyH',
  'KeyJ',
  'KeyK',
  'KeyL',
  'Semicolon',
] as const;

const CORE_BLACK_CODES = [
  'KeyQ',
  'KeyW',
  'KeyE',
  'KeyR',
  'KeyT',
  'KeyY',
  'KeyU',
  'KeyI',
  'KeyO',
  'KeyP',
  'BracketLeft',
] as const;

describe('getDynamicKeyMap fixed keyboard rows', () => {
  it('uses a 17-semitone core scope window', () => {
    expect(SCOPE_SIZE).toBe(17);
  });

  it('maps in-scope whites to A through ; only', () => {
    const map = getDynamicKeyMap(60);

    expect(map.KeyA).toBe(60);
    expect(map.KeyS).toBe(62);
    expect(map.Semicolon).toBe(76);

    for (const code of CORE_WHITE_CODES) {
      expect(map[code]).toBeDefined();
    }
  });

  it('maps in-scope blacks to Q through [ in order', () => {
    const map = getDynamicKeyMap(60);

    expect(map.KeyQ).toBe(61);
    expect(map.KeyW).toBe(63);
    expect(map.KeyE).toBe(66);
    expect(map.KeyR).toBe(68);
    expect(map.KeyT).toBe(70);
    expect(map.KeyU).toBe(75);
    expect(map.BracketLeft).toBeUndefined();
  });

  it('always includes extension keys when adjacent notes exist', () => {
    const map = getDynamicKeyMap(60);

    expect(map.CapsLock).toBe(59);
    expect(map.Tab).toBe(58);
    expect(map.Quote).toBe(77);
    expect(map.BracketRight).toBe(78);
  });

  it('never assigns black notes to the home row', () => {
    const map = getDynamicKeyMap(60);

    for (const code of [...CORE_WHITE_CODES, 'CapsLock', 'Quote'] as const) {
      const midi = map[code];
      expect(midi).toBeDefined();
      expect([1, 3, 6, 8, 10].includes(midi! % 12)).toBe(false);
    }
  });

  it('never assigns white notes to the top row', () => {
    const map = getDynamicKeyMap(60);

    for (const code of [...CORE_BLACK_CODES, 'Tab', 'BracketRight'] as const) {
      const midi = map[code];
      if (midi === undefined) {
        continue;
      }

      expect([1, 3, 6, 8, 10].includes(midi % 12)).toBe(true);
    }
  });

  it('keeps row codes on the correct keyboard row', () => {
    for (const code of CORE_WHITE_CODES) {
      expect(isWhiteRowCode(code)).toBe(true);
      expect(isBlackRowCode(code)).toBe(false);
    }

    for (const code of CORE_BLACK_CODES) {
      expect(isBlackRowCode(code)).toBe(true);
      expect(isWhiteRowCode(code)).toBe(false);
    }
  });
});

describe('getEffectiveKeyMap transpose', () => {
  it('preserves white/black row colors when transposing', () => {
    const before = getDynamicKeyMap(60);
    const after = getEffectiveKeyMap(60, 1);

    for (const [code] of Object.entries(before)) {
      const shifted = after[code];
      expect(shifted).toBeDefined();

      if (isWhiteRowCode(code)) {
        expect([1, 3, 6, 8, 10].includes(shifted! % 12)).toBe(false);
      } else {
        expect([1, 3, 6, 8, 10].includes(shifted! % 12)).toBe(true);
      }
    }
  });

  it('shifts each mapped note by one semitone along its row', () => {
    const before = getDynamicKeyMap(60);
    const shifted = normalizeScopePosition(60, 1);
    const after = getEffectiveKeyMap(
      shifted.scopeStartMidi,
      shifted.scopeTranspose,
    );

    for (const [code] of Object.entries(before)) {
      expect(after[code]).toBeDefined();
      expect(after[code]).not.toBe(before[code]);
    }
  });
});
