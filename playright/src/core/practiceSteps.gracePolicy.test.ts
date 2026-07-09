import { describe, expect, it } from 'vitest';
import type { StepOrder } from '../types/index.ts';
import {
  getExpectedNoteForFingerAtPosition,
  getPlayablePracticeNotesForPosition,
  getPracticeNotes,
  getPracticeNotesForPosition,
  isProgramStepComplete,
  positionHasRequiredPracticeNotes,
  programStepExpectedMidis,
  stepHasAnyPracticeContent,
} from './practiceSteps.ts';
import { fingeringKey } from '../types/index.ts';

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

const script = [graceStep];

/**
 * v2 policy (Phase 1): grace notes are practice-mode walk positions, gated
 * through getPracticeNotesForPosition / buildPracticePositions rather than
 * getPracticeNotes (which stays main-step-only, unchanged - see below).
 * Program mode (isProgramStepComplete, programStepExpectedMidis) still
 * excludes graceBefore: capturing a grace's fingering needs a disambiguating
 * persistence key (a grace shares its main step's onset, and today's
 * onset:hand:midi key would collide with the main note) that hasn't been
 * built yet. That's Phase 3, deliberately deferred - flipping these two
 * functions now would silently corrupt persisted fingerings on any piece
 * with a grace sharing its main note's pitch, so this is a scope boundary,
 * not an oversight.
 */
describe('practice mode grace policy (v2 - Phase 1)', () => {
  it('getPracticeNotes stays main-step-only; grace notes are separate walk positions', () => {
    expect(getPracticeNotes(graceStep, 'two-hand', 'R')).toEqual(graceStep.notes);
    expect(getPracticeNotes(graceStep, 'one-hand', 'R')).toEqual(graceStep.notes);
  });

  it('getPracticeNotesForPosition resolves a grace position to just that grace note', () => {
    expect(
      getPracticeNotesForPosition(script, { kind: 'grace', stepIndex: 0, graceIndex: 0 }, 'two-hand', 'R'),
    ).toEqual([{ pitch: 'E5', midi: 76, hand: 'R', finger: null }]);

    expect(
      getPracticeNotesForPosition(script, { kind: 'main', stepIndex: 0 }, 'two-hand', 'R'),
    ).toEqual(graceStep.notes);
  });

  it('one-hand mode excludes a grace whose hand differs from the active hand', () => {
    const lhGraceStep: StepOrder = { ...graceStep, graceBefore: [{ ...graceStep.graceBefore![0], hand: 'L' }] };
    expect(
      getPracticeNotesForPosition([lhGraceStep], { kind: 'grace', stepIndex: 0, graceIndex: 0 }, 'one-hand', 'R'),
    ).toEqual([]);
  });

  it('two-hand mode excludes an unfingered grace from playable notes (degrades gracefully pre-Phase-2)', () => {
    expect(
      getPlayablePracticeNotesForPosition(
        script,
        { kind: 'grace', stepIndex: 0, graceIndex: 0 },
        'two-hand',
        'R',
      ),
    ).toEqual([]);
    expect(
      positionHasRequiredPracticeNotes(
        script,
        { kind: 'grace', stepIndex: 0, graceIndex: 0 },
        'two-hand',
        'R',
      ),
    ).toBe(false);
  });

  it('two-hand mode includes a fingered grace as a real playable/required position', () => {
    const fingeredStep: StepOrder = {
      ...graceStep,
      graceBefore: [{ ...graceStep.graceBefore![0], finger: 2 }],
    };
    const position = { kind: 'grace' as const, stepIndex: 0, graceIndex: 0 };

    expect(
      getPlayablePracticeNotesForPosition([fingeredStep], position, 'two-hand', 'R'),
    ).toEqual([{ pitch: 'E5', midi: 76, hand: 'R', finger: 2 }]);
    expect(positionHasRequiredPracticeNotes([fingeredStep], position, 'two-hand', 'R')).toBe(true);

    const expected = getExpectedNoteForFingerAtPosition([fingeredStep], position, 'R', 2);
    expect(expected?.midi).toBe(76);
    expect(getExpectedNoteForFingerAtPosition([fingeredStep], position, 'R', 3)).toBeNull();
  });

  it('stepHasAnyPracticeContent is a strict superset of stepHasPracticeNotes (includes grace-only content)', () => {
    const oneHandLh: StepOrder = {
      order: 0,
      onset: 0,
      measureNumber: 1,
      notes: [{ pitch: 'C3', midi: 48, hand: 'L', finger: null }],
      graceBefore: [{ midi: 76, pitch: 'E5', hand: 'R', kind: 'acciaccatura' }],
    };
    // Main notes are LH-only; the grace is RH. One-hand R mode has no main
    // practice notes here, but the step still has practicable content.
    expect(stepHasAnyPracticeContent([oneHandLh], 0, 'one-hand', 'R')).toBe(true);
  });

  it('isProgramStepComplete ignores graceBefore metadata (Phase 3, deferred)', () => {
    const manualFingerings = Object.fromEntries(
      graceStep.notes.map((note) => [
        fingeringKey(graceStep.onset, note.hand, note.midi),
        1 as const,
      ]),
    );

    expect(isProgramStepComplete(graceStep, manualFingerings)).toBe(true);
  });

  it('programStepExpectedMidis lists only main-note midis (Phase 3, deferred)', () => {
    expect(programStepExpectedMidis(graceStep).sort((a, b) => a - b)).toEqual([
      71, 78,
    ]);
  });
});
