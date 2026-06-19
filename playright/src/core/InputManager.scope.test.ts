import { describe, expect, it } from 'vitest';
import {
  getDynamicKeyMap,
  getEffectiveKeyMap,
  normalizeScopePosition,
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
  it('maps in-scope whites to A through ; only', () => {
    const map = getDynamicKeyMap(60);

    expect(map.KeyA).toBe(60);
    expect(map.KeyS).toBe(62);
    expect(map.Semicolon).toBe(76);
    expect(map.Quote).toBeUndefined();

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
    expect(map.KeyI).toBeUndefined();
  });

  it('does not add low extensions at the default scope', () => {
    const map = getDynamicKeyMap(60);

    expect(map.CapsLock).toBeUndefined();
    expect(map.Tab).toBeUndefined();
  });

  it('adds low extensions only when the scope starts below the first white', () => {
    const map = getDynamicKeyMap(58);

    expect(map.KeyA).toBe(59);
    expect(map.Tab).toBe(58);
    expect(map.CapsLock).toBeUndefined();
  });

  it("adds ' only when ; cannot reach the next white in scope", () => {
    const map = getDynamicKeyMap(40);

    expect(map.Semicolon).toBe(55);
    expect(map.Quote).toBeUndefined();
  });

  it('adds ] only when [ cannot reach the next black in scope', () => {
    const map = getDynamicKeyMap(60);

    expect(map.BracketRight).toBe(78);
  });

  it('never assigns black notes to the home row', () => {
    const map = getDynamicKeyMap(60);

    for (const code of CORE_WHITE_CODES) {
      const midi = map[code];
      expect(midi % 12).not.toBe(1);
      expect(midi % 12).not.toBe(3);
      expect(midi % 12).not.toBe(6);
      expect(midi % 12).not.toBe(8);
      expect(midi % 12).not.toBe(10);
    }
  });

  it('never assigns white notes to the top row', () => {
    const map = getDynamicKeyMap(60);

    for (const code of CORE_BLACK_CODES) {
      const midi = map[code];
      if (midi === undefined) {
        continue;
      }

      expect([1, 3, 6, 8, 10].includes(midi % 12)).toBe(true);
    }
  });
});

describe('shiftScopeStart semitone mode', () => {
  it('shifts every mapped note by exactly one semitone', () => {
    const before = getDynamicKeyMap(60);
    const shifted = normalizeScopePosition(60, 1);
    const after = getEffectiveKeyMap(
      shifted.scopeStartMidi,
      shifted.scopeTranspose,
    );

    for (const [key, midi] of Object.entries(before)) {
      expect(after[key]).toBe(midi + 1);
    }
  });
});
