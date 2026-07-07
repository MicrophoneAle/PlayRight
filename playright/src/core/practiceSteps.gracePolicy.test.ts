import { describe, expect, it } from 'vitest';
import type { StepOrder } from '../types/index.ts';
import {
  getPracticeNotes,
  isProgramStepComplete,
  programStepExpectedMidis,
} from './practiceSteps.ts';
import { fingeringKey } from '../types/index.ts';

describe('practice mode grace v1 policy', () => {
  const graceStep: StepOrder = {
    order: 1,
    onset: 4,
    measureNumber: 5,
    notes: [
      { pitch: 'F#5', midi: 78, hand: 'R', finger: null },
      { pitch: 'B4', midi: 71, hand: 'R', finger: null },
    ],
    graceBefore: [{ midi: 76, pitch: 'E5', hand: 'R', kind: 'acciaccatura' }],
  };

  it('getPracticeNotes returns only main step notes, never graceBefore', () => {
    expect(getPracticeNotes(graceStep, 'two-hand', 'R')).toEqual(graceStep.notes);
    expect(getPracticeNotes(graceStep, 'one-hand', 'R')).toEqual(graceStep.notes);
  });

  it('isProgramStepComplete ignores graceBefore metadata', () => {
    const manualFingerings = Object.fromEntries(
      graceStep.notes.map((note) => [
        fingeringKey(graceStep.onset, note.hand, note.midi),
        1 as const,
      ]),
    );

    expect(isProgramStepComplete(graceStep, manualFingerings)).toBe(true);
  });

  it('programStepExpectedMidis lists only main-note midis', () => {
    expect(programStepExpectedMidis(graceStep).sort((a, b) => a - b)).toEqual([
      71, 78,
    ]);
  });
});
