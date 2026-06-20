import { describe, expect, it } from 'vitest';
import {
  countMatchedPracticeNotes,
  findCursorOffsetForStep,
  measureIndexMatchesStep,
  practiceNotesFullyMatched,
  type CursorKeySnapshot,
} from './sheetMusicPracticeSync.ts';
import type { ScriptNote } from '../types/index.ts';

function snapshot(
  keys: Array<[number, 'L' | 'R']>,
): CursorKeySnapshot {
  return {
    attackKeys: new Set(keys.map(([midi, hand]) => `${midi}:${hand}`)),
  };
}

describe('findCursorOffsetForStep', () => {
  it('finds the first matching cursor snapshot from searchStart', () => {
    const snapshots = [
      snapshot([[60, 'R']]),
      snapshot([[62, 'R']]),
      snapshot([[64, 'R']]),
    ];

    expect(
      findCursorOffsetForStep(snapshots, 0, new Set(['60:R'])),
    ).toBe(0);
    expect(
      findCursorOffsetForStep(snapshots, 1, new Set(['64:R'])),
    ).toBe(2);
  });

  it('returns -1 when no later snapshot contains every expected key', () => {
    const snapshots = [
      snapshot([[60, 'R']]),
      snapshot([[62, 'R']]),
    ];

    expect(
      findCursorOffsetForStep(snapshots, 0, new Set(['72:R'])),
    ).toBe(-1);
  });

  it('does not exhaust later steps when an intermediate step has no match', () => {
    const snapshots = [
      snapshot([[60, 'R']]),
      snapshot([[62, 'R']]),
      snapshot([[64, 'R']]),
      snapshot([[65, 'R']]),
    ];

    let searchStart = 0;

    const step0 = findCursorOffsetForStep(
      snapshots,
      searchStart,
      new Set(['60:R']),
    );
    expect(step0).toBe(0);
    searchStart = step0 + 1;

    const step1 = findCursorOffsetForStep(
      snapshots,
      searchStart,
      new Set(['72:R']),
    );
    expect(step1).toBe(-1);

    const step2 = findCursorOffsetForStep(
      snapshots,
      searchStart,
      new Set(['64:R']),
    );
    expect(step2).toBe(2);
  });

  it('returns the next sequential match even when duplicate keys appear later', () => {
    const snapshots = [
      snapshot([[63, 'L'], [70, 'R']]),
      snapshot([[63, 'L'], [70, 'R']]),
      snapshot([[63, 'L'], [70, 'R']]),
    ];

    expect(
      findCursorOffsetForStep(
        snapshots,
        0,
        new Set(['63:L', '70:R']),
      ),
    ).toBe(0);

    expect(
      findCursorOffsetForStep(
        snapshots,
        1,
        new Set(['63:L', '70:R']),
      ),
    ).toBe(1);
  });
});

describe('measureIndexMatchesStep', () => {
  it('maps MusicXML measure numbers to OSMD measure indices', () => {
    expect(measureIndexMatchesStep(0, 1)).toBe(true);
    expect(measureIndexMatchesStep(9, 10)).toBe(true);
    expect(measureIndexMatchesStep(10, 11)).toBe(true);
    expect(measureIndexMatchesStep(10, 30)).toBe(false);
  });
});

describe('practiceNotesFullyMatched', () => {
  const tiedScriptNote: ScriptNote = {
    pitch: 'C4',
    midi: 60,
    hand: 'R',
    finger: null,
  };

  function mockGraphicalNote(midi: number, staffId: number) {
    return {
      sourceNote: {
        isRest: () => false,
        Pitch: { getHalfTone: () => midi - 12 },
        ParentStaff: { Id: staffId },
      },
    } as import('opensheetmusicdisplay').GraphicalNote;
  }

  it('accepts multiple graphical tie segments for one merged script note', () => {
    const collected = [mockGraphicalNote(60, 1), mockGraphicalNote(60, 1)];

    expect(collected.length).not.toBe(1);
    expect(practiceNotesFullyMatched([tiedScriptNote], collected)).toBe(true);
  });

  it('rejects when a script note is missing from the collected engraving', () => {
    const collected = [mockGraphicalNote(60, 1)];

    expect(
      practiceNotesFullyMatched(
        [
          tiedScriptNote,
          { pitch: 'E4', midi: 64, hand: 'R', finger: null },
        ],
        collected,
      ),
    ).toBe(false);
  });
});

describe('partial highlight selection', () => {
  const c4: ScriptNote = { pitch: 'C4', midi: 60, hand: 'R', finger: null };
  const e4: ScriptNote = { pitch: 'E4', midi: 64, hand: 'R', finger: null };

  function mockGraphicalNote(midi: number, staffId: number) {
    return {
      sourceNote: {
        isRest: () => false,
        Pitch: { getHalfTone: () => midi - 12 },
        ParentStaff: { Id: staffId },
      },
    } as import('opensheetmusicdisplay').GraphicalNote;
  }

  it('counts matched notes without requiring a full step match', () => {
    const collected = [mockGraphicalNote(60, 1)];

    expect(countMatchedPracticeNotes([c4, e4], collected)).toBe(1);
    expect(practiceNotesFullyMatched([c4, e4], collected)).toBe(false);
  });

  it('keeps a partial engraving highlightable instead of blanking the whole step', () => {
    const collected = [mockGraphicalNote(60, 1), mockGraphicalNote(60, 1)];

    expect(countMatchedPracticeNotes([c4, e4], collected)).toBe(1);
    expect(collected.length).toBeGreaterThan(0);
    expect(practiceNotesFullyMatched([c4, e4], collected)).toBe(false);
  });
});
