import { describe, expect, it } from 'vitest';
import type { PlaybackScript, StepOrder } from '../types/index.ts';
import {
  buildTwoHandExpectedMidis,
  buildTwoHandExpectedMidisForPosition,
  buildTwoHandPhysicalKeysByMidi,
  buildTwoHandPhysicalKeysByMidiForPosition,
  buildTwoHandStepNotesByMidi,
  buildTwoHandStepNotesByMidiForPosition,
  buildTwoHandStepNotesByMidiFromPlayback,
  getExpectedNoteForFinger,
} from './practiceSteps.ts';

function step(notes: StepOrder['notes']): StepOrder {
  return { order: 0, onset: 0, measureNumber: 1, notes };
}

function scriptFromSteps(steps: StepOrder[]): PlaybackScript {
  return steps;
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

describe('two-hand keyboard indicators', () => {
  it('includes every step note in expected midis, including null-finger notes', () => {
    const score = scriptFromSteps([
      step([
        { pitch: 'C4', midi: 60, hand: 'R', finger: 1 },
        { pitch: 'E4', midi: 64, hand: 'R', finger: null },
      ]),
    ]);

    expect(buildTwoHandExpectedMidis(score, 0)).toEqual(new Set([60, 64]));
  });

  it('keeps both hands on a cross-hand unison at the same midi', () => {
    const score = scriptFromSteps([
      step([
        { pitch: 'C4', midi: 60, hand: 'L', finger: 1 },
        { pitch: 'C4', midi: 60, hand: 'R', finger: 1 },
      ]),
    ]);

    const byMidi = buildTwoHandStepNotesByMidi(score, 0);
    expect(byMidi.get(60)).toHaveLength(2);
    expect(byMidi.get(60)?.map((note) => note.hand).sort()).toEqual(['L', 'R']);
  });

  it('maps both finger assignments on a unison to physical keys', () => {
    const score = scriptFromSteps([
      step([
        { pitch: 'C3', midi: 48, hand: 'L', finger: 1 },
        { pitch: 'C4', midi: 60, hand: 'R', finger: 1 },
      ]),
    ]);

    expect(buildTwoHandPhysicalKeysByMidi(score, 0).get(48)).toEqual(['v']);
    expect(buildTwoHandPhysicalKeysByMidi(score, 0).get(60)).toEqual(['n']);
  });

  it('aggregates multiple physical keys when two fingers share one midi', () => {
    const score = scriptFromSteps([
      step([
        { pitch: 'C4', midi: 60, hand: 'L', finger: 5 },
        { pitch: 'C4', midi: 60, hand: 'R', finger: 1 },
      ]),
    ]);

    expect(buildTwoHandPhysicalKeysByMidi(score, 0).get(60)?.sort()).toEqual([
      'n',
      'q',
    ]);
  });

  it('position-aware builders highlight only the current grace, not the main chord', () => {
    const score = scriptFromSteps([
      {
        order: 0,
        onset: 0,
        measureNumber: 9,
        graceBefore: [{ midi: 69, pitch: 'A4', hand: 'R', kind: 'acciaccatura', finger: 1 }],
        notes: [
          { pitch: 'G4', midi: 67, hand: 'R', finger: 2 },
          { pitch: 'A4', midi: 69, hand: 'R', finger: 1 },
        ],
      },
    ]);

    const gracePosition = { kind: 'grace' as const, stepIndex: 0, graceIndex: 0 };

    expect(buildTwoHandExpectedMidisForPosition(score, gracePosition)).toEqual(
      new Set([69]),
    );
    expect(buildTwoHandStepNotesByMidiForPosition(score, gracePosition).get(69)).toEqual([
      { hand: 'R', midi: 69, finger: 1, fingerSource: undefined },
    ]);
    expect(buildTwoHandPhysicalKeysByMidiForPosition(score, gracePosition).get(69)).toEqual([
      'n',
    ]);
    expect(buildTwoHandExpectedMidis(score, 0)).toEqual(new Set([67, 69]));
  });

  it('keeps sounding playback notes visible after the transport step advances', () => {
    const score = scriptFromSteps([
      step([{ pitch: 'C4', midi: 60, hand: 'R', finger: 1 }]),
      step([{ pitch: 'D4', midi: 62, hand: 'R', finger: 2 }]),
    ]);

    const byMidi = buildTwoHandStepNotesByMidiFromPlayback(
      score,
      [{ pressId: 1, stepIndex: 0, midi: 60, hand: 'R' }],
      1,
    );

    expect(byMidi.get(60)).toEqual([
      { hand: 'R', midi: 60, finger: 1, fingerSource: undefined },
    ]);
    expect(byMidi.get(62)).toEqual([
      { hand: 'R', midi: 62, finger: 2, fingerSource: undefined },
    ]);
  });

  it('resolves grace-note fingerings from playback presses', () => {
    const score = scriptFromSteps([
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        graceBefore: [{ midi: 69, pitch: 'A4', hand: 'R', kind: 'acciaccatura', finger: 1 }],
        notes: [{ pitch: 'G4', midi: 67, hand: 'R', finger: 2 }],
      },
    ]);

    const byMidi = buildTwoHandStepNotesByMidiFromPlayback(
      score,
      [{ pressId: 1, stepIndex: 0, midi: 69, hand: 'R' }],
      0,
    );

    expect(byMidi.get(69)).toEqual([
      { hand: 'R', midi: 69, finger: 1, fingerSource: undefined },
    ]);
  });
});
