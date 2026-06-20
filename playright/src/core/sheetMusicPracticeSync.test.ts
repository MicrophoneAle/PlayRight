import { describe, expect, it } from 'vitest';
import { findCursorOffsetForStep } from './sheetMusicPracticeSync.ts';

interface TestSnapshot {
  cursorIndex: number;
  attackKeys: Set<string>;
}

function snapshot(
  cursorIndex: number,
  keys: Array<[number, 'L' | 'R']>,
): TestSnapshot {
  return {
    cursorIndex,
    attackKeys: new Set(keys.map(([midi, hand]) => `${midi}:${hand}`)),
  };
}

describe('findCursorOffsetForStep', () => {
  it('finds the first matching cursor snapshot from searchStart', () => {
    const snapshots = [
      snapshot(0, [[60, 'R']]),
      snapshot(1, [[62, 'R']]),
      snapshot(2, [[64, 'R']]),
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
      snapshot(1, [[62, 'R']]),
    ];

    expect(
      findCursorOffsetForStep(snapshots, 0, new Set(['72:R'])),
    ).toBe(-1);
  });

  it('does not exhaust later steps when an intermediate step has no match', () => {
    const snapshots = [
      snapshot(0, [[60, 'R']]),
      snapshot(1, [[62, 'R']]),
      snapshot(2, [[64, 'R']]),
      snapshot(3, [[65, 'R']]),
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
});
