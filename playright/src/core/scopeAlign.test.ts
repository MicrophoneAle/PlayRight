import { beforeEach, describe, expect, it } from 'vitest';
import {
  alignScopeToMidis,
  alignScopeToPracticeNotes,
  centerScopeOnMidis,
  centerScopeOnPracticeNotes,
  fingerReachSemitones,
  idealScopeStartForFinger,
  midiInFingerReach,
  notesCoveredByFingerReach,
} from './scopeAlign.ts';
import {
  getEffectiveKeyMap,
  getExtensionMidis,
  getScopeKeyMap,
  midisFitScopeKeyMap,
  SCOPE_SIZE,
} from './InputManager.ts';
import { useEngineStore } from '../store/useEngineStore.ts';
import type { ScriptNote } from '../types/index.ts';

function noteUsesExtensionKey(scopeStart: number, midi: number): boolean {
  return getExtensionMidis(getEffectiveKeyMap(scopeStart, 0)).has(midi);
}

function note(
  midi: number,
  hand: 'L' | 'R',
  finger: 1 | 2 | 3 | 4 | 5 | null,
): ScriptNote {
  return { pitch: '', midi, hand, finger };
}

describe('fingerReachSemitones', () => {
  it('maps each right-hand finger to the requested asymmetric window', () => {
    expect(fingerReachSemitones('R', 5)).toEqual({ down: 16, up: 0 });
    expect(fingerReachSemitones('R', 4)).toEqual({ down: 11, up: 5 });
    expect(fingerReachSemitones('R', 3)).toEqual({ down: 8, up: 8 });
    expect(fingerReachSemitones('R', 2)).toEqual({ down: 5, up: 11 });
    expect(fingerReachSemitones('R', 1)).toEqual({ down: 0, up: 16 });
  });

  it('mirrors left-hand fingers onto the right-hand table', () => {
    expect(fingerReachSemitones('L', 1)).toEqual({ down: 16, up: 0 });
    expect(fingerReachSemitones('L', 2)).toEqual({ down: 11, up: 5 });
    expect(fingerReachSemitones('L', 3)).toEqual({ down: 8, up: 8 });
    expect(fingerReachSemitones('L', 4)).toEqual({ down: 5, up: 11 });
    expect(fingerReachSemitones('L', 5)).toEqual({ down: 0, up: 16 });
  });

  it('spans exactly one core scope window', () => {
    for (const hand of ['L', 'R'] as const) {
      for (const finger of [1, 2, 3, 4, 5] as const) {
        const { down, up } = fingerReachSemitones(hand, finger);
        expect(down + up).toBe(SCOPE_SIZE - 1);
      }
    }
  });
});

describe('notesCoveredByFingerReach', () => {
  it('keeps an octave-down RH 5 inside the prior RH 5 reach window', () => {
    expect(
      notesCoveredByFingerReach([note(60, 'R', 5)], [note(72, 'R', 5)]),
    ).toBe(true);
    expect(midiInFingerReach(60, 72, 'R', 5)).toBe(true);
  });

  it('does not cover a leap beyond the finger window', () => {
    expect(
      notesCoveredByFingerReach([note(55, 'R', 5)], [note(72, 'R', 5)]),
    ).toBe(false);
  });
});

describe('alignScopeToMidis', () => {
  beforeEach(() => {
    useEngineStore.setState({ scopeStartMidi: 60, scopeTranspose: 0 });
  });

  it('keeps scope when notes fit the core without using extension keys', () => {
    alignScopeToMidis([60, 64, 76]);

    expect(useEngineStore.getState().scopeStartMidi).toBe(60);
    for (const midi of [60, 64, 76]) {
      expect(noteUsesExtensionKey(60, midi)).toBe(false);
    }
  });

  it('re-centers notes from extension keys into the core when possible', () => {
    alignScopeToMidis([59]);

    expect(useEngineStore.getState().scopeStartMidi).toBe(59);
    expect(noteUsesExtensionKey(59, 59)).toBe(false);
  });

  it('re-centers low notes into the core instead of leaving them on Shift or Tab', () => {
    alignScopeToMidis([58]);

    const scopeStart = useEngineStore.getState().scopeStartMidi;
    expect(noteUsesExtensionKey(scopeStart, 58)).toBe(false);
  });

  it('uses extension keys when the interval is wider than the core', () => {
    alignScopeToMidis([60, 78]);

    expect(useEngineStore.getState().scopeStartMidi).toBe(60);
    expect(midisFitScopeKeyMap([60, 78], 60, 0)).toBe(true);
    expect(noteUsesExtensionKey(60, 78)).toBe(true);
  });

  it('moves the scope when practice notes sit above the current Semicolon anchor', () => {
    alignScopeToMidis([88]);

    const scopeStart = useEngineStore.getState().scopeStartMidi;
    expect(midisFitScopeKeyMap([88], scopeStart, 0)).toBe(true);
    expect(Object.values(getScopeKeyMap(scopeStart, 0))).toContain(88);
  });

  it('aligns scope so every note in an interval maps to a physical key', () => {
    alignScopeToMidis([78, 81]);

    const scopeStart = useEngineStore.getState().scopeStartMidi;
    expect(midisFitScopeKeyMap([78, 81], scopeStart, 0)).toBe(true);
  });

  it('does not rescope RH5 → RH5 an octave down after finger-aware placement', () => {
    centerScopeOnPracticeNotes([note(72, 'R', 5)]);
    const afterFirst = useEngineStore.getState().scopeStartMidi;
    expect(afterFirst).toBe(idealScopeStartForFinger(72, 'R', 5));
    expect(midisFitScopeKeyMap([72], afterFirst, 0)).toBe(true);
    expect(midisFitScopeKeyMap([60], afterFirst, 0)).toBe(true);

    alignScopeToPracticeNotes([note(60, 'R', 5)], [note(72, 'R', 5)]);
    expect(useEngineStore.getState().scopeStartMidi).toBe(afterFirst);
  });
});

describe('centerScopeOnMidis', () => {
  beforeEach(() => {
    useEngineStore.setState({ scopeStartMidi: 60, scopeTranspose: 0 });
  });

  it('centers a single starting note in the core row', () => {
    centerScopeOnMidis([60]);

    expect(useEngineStore.getState().scopeStartMidi).toBe(52);
    expect(noteUsesExtensionKey(52, 60)).toBe(false);
  });

  it('places a fingered RH 5 near the top of the core window', () => {
    centerScopeOnPracticeNotes([note(60, 'R', 5)]);

    expect(useEngineStore.getState().scopeStartMidi).toBe(
      idealScopeStartForFinger(60, 'R', 5),
    );
  });

  it('places a fingered RH 1 near the bottom of the core window', () => {
    centerScopeOnPracticeNotes([note(60, 'R', 1)]);

    expect(useEngineStore.getState().scopeStartMidi).toBe(
      idealScopeStartForFinger(60, 'R', 1),
    );
  });

  it('centers the midpoint of a starting chord', () => {
    centerScopeOnMidis([60, 64]);

    expect(useEngineStore.getState().scopeStartMidi).toBe(54);
    for (const midi of [60, 64]) {
      expect(noteUsesExtensionKey(54, midi)).toBe(false);
    }
  });

  it('falls back when the span is wider than the core row', () => {
    centerScopeOnMidis([60, 78]);

    const scopeStart = useEngineStore.getState().scopeStartMidi;
    expect(midisFitScopeKeyMap([60, 78], scopeStart, 0)).toBe(true);
  });
});
