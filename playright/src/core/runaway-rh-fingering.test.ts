import { describe, expect, it } from 'vitest';
import type { Finger, PlaybackScript, ScriptNote } from '../types/index.ts';
import {
  fingerPhrase,
  type NoteEvent,
  preferredIdealFingerGap,
  predictFingering,
  segmentIntoPhrases,
} from './fingeringPredictor.ts';

/**
 * Runaway-shaped regressions:
 * 1) Abutting whole/half RH octaves were false-split by onset-gap phrase cuts
 *    (b899367) into solo phrases that all locked onto finger 5.
 * 2) Descending open triads preferred 5-3-2 because thirds shared ideal finger
 *    gap 1 with seconds.
 */

function noteEvent(
  stepIndex: number,
  midi: number,
  onset: number,
  durationDivisions?: number,
): NoteEvent {
  return {
    stepIndex,
    midi,
    onset,
    authoredFinger: null,
    durationDivisions,
  };
}

function scriptNote(midi: number, durationDivisions: number): ScriptNote {
  return {
    pitch: `M${midi}`,
    midi,
    hand: 'R',
    finger: null,
    durationDivisions,
  };
}

describe('preferredIdealFingerGap (thirds vs seconds)', () => {
  it('keeps seconds and thirds on ideal gap 1; open 5-3-1 uses OPEN_TRIAD_SKIP_BONUS', () => {
    expect(preferredIdealFingerGap(1)).toBe(1);
    expect(preferredIdealFingerGap(2)).toBe(1);
    expect(preferredIdealFingerGap(3)).toBe(1);
    expect(preferredIdealFingerGap(4)).toBe(1);
    expect(preferredIdealFingerGap(7)).toBe(2);
    expect(preferredIdealFingerGap(12)).toBe(4);
  });
});

describe('Runaway-shaped RH octave phrase segmentation', () => {
  const divisionsPerQuarter = 6;
  /** Tied half+half / whole note length on Runaway (4 quarters). */
  const wholeDuration = 4 * divisionsPerQuarter;

  it('does not rest-split abutting long notes whose onset gap equals duration', () => {
    // Onset spacing == duration → sound gap 0. Pre-fix onset-gap logic
    // treated this as a 4-quarter rest and shredded the line.
    const timeline = [88, 76, 87, 75, 85, 73].map((midi, stepIndex) =>
      noteEvent(stepIndex, midi, stepIndex * wholeDuration, wholeDuration),
    );

    const phrases = segmentIntoPhrases(timeline, divisionsPerQuarter);
    expect(phrases).toHaveLength(1);
    expect(phrases[0]).toHaveLength(6);
  });

  it('still rest-splits after a true multi-beat silence', () => {
    const restQuarters = 4;
    const timeline = [
      noteEvent(0, 88, 0, wholeDuration),
      noteEvent(
        1,
        76,
        wholeDuration + restQuarters * divisionsPerQuarter,
        wholeDuration,
      ),
    ];

    expect(segmentIntoPhrases(timeline, divisionsPerQuarter)).toHaveLength(2);
  });

  it('alternates 5-1 across abutting RH octave leaps', async () => {
    const script: PlaybackScript = [88, 76, 87, 75, 85, 73].map(
      (midi, order) => ({
        order,
        onset: order * wholeDuration,
        measureNumber: 1,
        notes: [scriptNote(midi, wholeDuration)],
      }),
    );

    const predicted = await predictFingering(script, { divisionsPerQuarter });
    const fingers = predicted.map(
      (step) => step.notes.find((note) => note.hand === 'R')?.finger,
    );

    expect(fingers).toEqual([5, 1, 5, 1, 5, 1]);
  });
});

describe('Runaway-shaped RH open triad (5-3-1)', () => {
  it('fingers a descending open triad 5-3-1, not 5-3-2 or 1-3-2', async () => {
    // E5 – B4 – G#4 (P4 + m3), the characteristic Runaway broken-chord shape.
    const phrase: NoteEvent[] = [
      noteEvent(0, 76, 0),
      noteEvent(1, 71, 6),
      noteEvent(2, 68, 12),
    ];

    const fingers = (await fingerPhrase(phrase, 'R')) as Finger[];
    expect(fingers).toEqual([5, 3, 1]);
  });

  it('fingers C5-G4-E4 as 5-3-1', async () => {
    const phrase: NoteEvent[] = [
      noteEvent(0, 72, 0),
      noteEvent(1, 67, 480),
      noteEvent(2, 64, 960),
    ];

    expect(await fingerPhrase(phrase, 'R')).toEqual([5, 3, 1]);
  });
});
