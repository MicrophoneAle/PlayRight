import { describe, expect, it } from 'vitest';
import {
  findCursorOffsetForStep,
  type CursorKeySnapshot,
} from './sheetMusicPracticeSync.ts';

function snapshot(
  sourceTimestamp: number,
  keys: Array<[number, 'L' | 'R']>,
): CursorKeySnapshot {
  return {
    sourceTimestamp,
    attackKeys: new Set(keys.map(([midi, hand]) => `${midi}:${hand}`)),
  };
}

describe('findCursorOffsetForStep', () => {
  it('finds the first matching cursor snapshot from searchStart', () => {
    const snapshots = [
      snapshot(0, [[60, 'R']]),
      snapshot(0.5, [[62, 'R']]),
      snapshot(1, [[64, 'R']]),
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
      snapshot(0, [[60, 'R']]),
      snapshot(0.5, [[62, 'R']]),
    ];

    expect(
      findCursorOffsetForStep(snapshots, 0, new Set(['72:R'])),
    ).toBe(-1);
  });

  it('does not exhaust later steps when an intermediate step has no match', () => {
    const snapshots = [
      snapshot(0, [[60, 'R']]),
      snapshot(0.5, [[62, 'R']]),
      snapshot(1, [[64, 'R']]),
      snapshot(1.5, [[65, 'R']]),
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

  it('prefers the match closest to the step onset when duplicate keys repeat later', () => {
    const snapshots = [
      snapshot(1, [[63, 'L'], [70, 'R']]),
      snapshot(2, [[63, 'L'], [70, 'R']]),
      snapshot(40, [[63, 'L'], [70, 'R']]),
    ];

    const expected = new Set(['63:L', '70:R']);
    const timing = {
      targetOnsetQuarterNotes: 2,
      lastMatchedOnsetQuarterNotes: 1,
      onsetToleranceQuarterNotes: 0.02,
    };

    expect(
      findCursorOffsetForStep(snapshots, 0, expected, timing),
    ).toBe(1);
  });
});
