import { describe, expect, it } from 'vitest';
import type { StepOrder } from '../types/index.ts';
import { getExpectedNoteForFinger } from './practiceSteps.ts';

function step(notes: StepOrder['notes']): StepOrder {
  return { order: 0, onset: 0, notes };
}

describe('getExpectedNoteForFinger', () => {
  const rightThumb: StepOrder = step([
    { pitch: 'C4', midi: 60, hand: 'R', finger: 1 },
  ]);

  it('returns the matching ScriptNote when hand and finger exist in the step', () => {
    const found = getExpectedNoteForFinger(rightThumb, 'R', 1);
    expect(found).toEqual(rightThumb.notes[0]);
  });

  it('returns null when no note matches the requested finger', () => {
    expect(getExpectedNoteForFinger(rightThumb, 'R', 5)).toBeNull();
  });

  it('requires both hand and finger; wrong hand does not match', () => {
    expect(getExpectedNoteForFinger(rightThumb, 'L', 1)).toBeNull();
  });

  it('disambiguates L and R thumb at the same onset', () => {
    const bothThumbs: StepOrder = step([
      { pitch: 'C3', midi: 48, hand: 'L', finger: 1 },
      { pitch: 'C4', midi: 60, hand: 'R', finger: 1 },
    ]);

    expect(getExpectedNoteForFinger(bothThumbs, 'L', 1)?.midi).toBe(48);
    expect(getExpectedNoteForFinger(bothThumbs, 'R', 1)?.midi).toBe(60);
  });
});
