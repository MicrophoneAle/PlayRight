import { describe, expect, it } from 'vitest';
import {
  buildModelFeatureRow,
  FINGERING_FEATURE_COUNT,
} from './fingeringModelFeatures.ts';
import type { NoteEvent } from './fingeringPredictor.ts';

describe('fingeringModelFeatures', () => {
  it('builds 52-dimensional rows matching the ONNX model', () => {
    const phraseNotes: NoteEvent[] = [
      { stepIndex: 0, midi: 60, authoredFinger: null, onset: 0 },
      { stepIndex: 1, midi: 64, authoredFinger: 2, onset: 480, durationDivisions: 480 },
    ];

    const row = buildModelFeatureRow({
      hand: 'R',
      index: 1,
      phraseNotes,
      divisionsPerQuarter: 480,
    });

    expect(row.length).toBe(FINGERING_FEATURE_COUNT);
    expect(FINGERING_FEATURE_COUNT).toBe(52);
    expect(row.reduce((sum, value) => sum + value, 0)).not.toBe(0);
  });
});
