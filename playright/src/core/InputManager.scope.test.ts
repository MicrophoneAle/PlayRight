import { describe, expect, it } from 'vitest';
import {
  FULL_SCOPE_SIZE,
  getDisplayScopeMidiBounds,
  getDynamicKeyMap,
  getEffectiveKeyMap,
  getScopeKeyMap,
  isBlackRowCode,
  isMidiInDisplayScope,
  isWhiteRowCode,
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

function getBlackBetween(leftWhite: number, rightWhite: number): number | null {
  for (let midi = leftWhite + 1; midi < rightWhite; midi += 1) {
    if ([1, 3, 6, 8, 10].includes(midi % 12)) {
      return midi;
    }
  }

  return null;
}

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

  it('uses Tab instead of Q when Caps Lock sits directly left of A', () => {
    const map = getDynamicKeyMap(60);

    expect(map.KeyA).toBe(60);
    expect(map.CapsLock).toBe(59);
    expect(map.Tab).toBe(58);
    expect(map.KeyQ).toBeUndefined();
    expect(map.KeyW).toBe(getBlackBetween(map.KeyA!, map.KeyS!));
  });

  it('places Q on the black note between Caps Lock and A when one exists', () => {
    const map = getDynamicKeyMap(61);

    expect(map.CapsLock).toBe(60);
    expect(map.KeyQ).toBe(61);
    expect(map.KeyA).toBe(62);
    expect(getBlackBetween(map.CapsLock!, map.KeyA!)).toBe(map.KeyQ);
  });

  it('keeps Q between Caps Lock and A when scope shifts up to A4', () => {
    const map = getDynamicKeyMap(69);

    expect(map.KeyQ).toBe(68);
    expect(map.CapsLock).toBe(67);
    expect(map.KeyA).toBe(69);
    expect(getBlackBetween(map.CapsLock!, map.KeyA!)).toBe(map.KeyQ);
    expect(map.Tab).toBe(66);
  });

  it('extends Semicolon and Quote when only nine whites fit in the core scope', () => {
    const map = getDynamicKeyMap(66);

    expect(map.KeyL).toBe(81);
    expect(map.Semicolon).toBe(83);
    expect(map.Quote).toBe(84);
    expect(map.KeyP).toBe(82);
  });

  it('leaves high keys unmapped when there are more whites than physical keys', () => {
    const map = getDynamicKeyMap(60);

    expect(map.Quote).toBe(77);
    expect(map.Tab).toBe(58);
  });

  it('places each core black between its neighboring whites when possible', () => {
    const map = getDynamicKeyMap(60);
    const pairs = [
      ['KeyW', 'KeyA', 'KeyS'],
      ['KeyE', 'KeyS', 'KeyD'],
      ['KeyT', 'KeyF', 'KeyG'],
      ['KeyY', 'KeyG', 'KeyH'],
      ['KeyU', 'KeyH', 'KeyJ'],
      ['KeyI', 'KeyJ', 'KeyK'],
      ['KeyO', 'KeyK', 'KeyL'],
      ['KeyP', 'KeyL', 'Semicolon'],
    ] as const;

    for (const [blackCode, leftCode, rightCode] of pairs) {
      const leftMidi = map[leftCode];
      const rightMidi = map[rightCode];
      const blackMidi = map[blackCode];

      if (
        leftMidi === undefined ||
        rightMidi === undefined ||
        blackMidi === undefined
      ) {
        continue;
      }

      expect(blackMidi).toBe(getBlackBetween(leftMidi, rightMidi));
    }
  });

  it('anchors low extensions from Tab and Caps Lock at default scope', () => {
    const map = getDynamicKeyMap(60);

    expect(map.Tab).toBe(58);
    expect(map.CapsLock).toBe(59);
    expect(map.Quote).toBe(77);
    expect(map.BracketRight).toBe(78);
  });

  it('spans a 21-note display scope from Tab through ]', () => {
    const bounds = getDisplayScopeMidiBounds(60);

    expect(bounds).toEqual({ min: 58, max: 78 });
    expect(bounds.max - bounds.min + 1).toBe(FULL_SCOPE_SIZE);

    for (let midi = bounds.min; midi <= bounds.max; midi += 1) {
      expect(isMidiInDisplayScope(midi, 60)).toBe(true);
    }

    expect(isMidiInDisplayScope(79, 60)).toBe(false);
    expect(isMidiInDisplayScope(57, 60)).toBe(false);
  });

  it('shows Tab and ] only when their mapped notes are inside the display scope', () => {
    const atDefault = getScopeKeyMap(60);
    const shifted = getScopeKeyMap(66);

    expect(atDefault.Tab).toBe(58);
    expect(atDefault.CapsLock).toBe(59);
    expect(atDefault.BracketRight).toBe(78);

    for (const midi of Object.values(shifted)) {
      expect(isMidiInDisplayScope(midi, 66)).toBe(true);
    }

    expect(isMidiInDisplayScope(79, 60)).toBe(false);
    expect(isMidiInDisplayScope(78, 60)).toBe(true);
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

describe('semitone scope shift', () => {
  it('shifts Quote with the scope window', () => {
    const before = getDynamicKeyMap(60);
    const after = getDynamicKeyMap(61);

    expect(before.Quote).toBe(77);
    expect(after.Quote).toBe(79);
  });

  it('shifts the chromatic scope window by one semitone', () => {
    const before = getDynamicKeyMap(60);
    const after = getDynamicKeyMap(61);

    expect(after.KeyW).toBe(getBlackBetween(after.KeyA!, after.KeyS!));
    expect(after.KeyA).toBeGreaterThan(before.KeyA!);
    expect(after.Semicolon).toBeGreaterThan(before.Semicolon!);
  });

  it('preserves white/black row colors after chromatic scope shift', () => {
    const map = getDynamicKeyMap(61);

    for (const code of [...CORE_WHITE_CODES, 'CapsLock', 'Quote'] as const) {
      const midi = map[code];
      if (midi === undefined) {
        continue;
      }

      expect([1, 3, 6, 8, 10].includes(midi % 12)).toBe(false);
    }

    for (const code of [...CORE_BLACK_CODES, 'Tab', 'BracketRight'] as const) {
      const midi = map[code];
      if (midi === undefined) {
        continue;
      }

      expect([1, 3, 6, 8, 10].includes(midi % 12)).toBe(true);
    }
  });

  it('keeps W between A and S after chromatic scope shift', () => {
    const map = getDynamicKeyMap(61);

    expect(map.KeyW).toBe(getBlackBetween(map.KeyA!, map.KeyS!));
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
    const after = getEffectiveKeyMap(60, 1);

    for (const [code, midi] of Object.entries(before)) {
      expect(after[code]).toBeDefined();
      expect(after[code]).not.toBe(midi);
    }
  });
});
