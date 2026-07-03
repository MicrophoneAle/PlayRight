import { describe, expect, it } from 'vitest';
import {
  buildModelFeatureRow,
  FINGERING_FEATURE_COUNT,
} from './fingeringModelFeatures.ts';
import type { NoteEvent } from './fingeringPredictor.ts';

describe('fingeringModelFeatures', () => {
  it('builds 24-dimensional rows matching the canonical feature contract', () => {
    const phraseNotes: NoteEvent[] = [
      { stepIndex: 0, midi: 60, authoredFinger: null, onset: 0 },
      { stepIndex: 1, midi: 64, authoredFinger: 2, onset: 480, durationDivisions: 480 },
    ];

    const row = buildModelFeatureRow({
      hand: 'R',
      index: 1,
      phraseNotes,
    });

    expect(row.length).toBe(FINGERING_FEATURE_COUNT);
    expect(FINGERING_FEATURE_COUNT).toBe(24);
    expect(row.reduce((sum, value) => sum + value, 0)).not.toBe(0);
  });

  it('encodes midi, pitch class, is_black, intervals, is_chord, prev_finger, and hand', () => {
    const phraseNotes: NoteEvent[] = [
      { stepIndex: 0, midi: 60, authoredFinger: 1, onset: 0 },
      { stepIndex: 1, midi: 64, authoredFinger: 3, onset: 480 },
      { stepIndex: 2, midi: 67, authoredFinger: null, onset: 960 },
      { stepIndex: 2, midi: 72, authoredFinger: null, onset: 960 },
    ];

    const row = buildModelFeatureRow({ hand: 'R', index: 1, phraseNotes });

    expect(row[0]).toBeCloseTo((64 - 60) / 24);
    expect(row[1 + (64 % 12)]).toBe(1);
    expect(row[13]).toBe(0);
    expect(row[14]).toBe(64 - 60);
    expect(row[15]).toBe(67 - 64);
    expect(row[16]).toBe(0);
    expect(row[17 + 1]).toBe(1);
    expect(row[23]).toBe(1);

    const chordRow = buildModelFeatureRow({ hand: 'L', index: 2, phraseNotes });
    expect(chordRow[16]).toBe(1);
    expect(chordRow[23]).toBe(0);
  });
});
