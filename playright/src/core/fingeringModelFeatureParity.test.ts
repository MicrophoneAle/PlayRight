import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildModelFeatureRow, FINGERING_FEATURE_COUNT } from './fingeringModelFeatures.ts';
import type { NoteEvent } from './fingeringPredictor.ts';

/**
 * Cross-language parity test: playright-ml/gen_feature_parity_fixture.py
 * computes the canonical feature vector for two fixed note contexts using
 * feature_spec.py and dumps them to feature_parity_fixture.json. This test
 * builds the identical NoteEvent contexts via buildModelFeatureRow and
 * asserts every value matches, so drift between the Python trainer's feature
 * definition and the TS inference path is caught before training rather than
 * discovered as a silent accuracy regression after.
 *
 * If this test fails after an intentional change to the canonical feature
 * definition, update fingeringModelFeatures.ts and feature_spec.py together,
 * then re-run playright-ml/gen_feature_parity_fixture.py and commit the
 * regenerated fixture.
 */

interface ParityFixture {
  r_hand_phrase: { midi: number[]; vectors: number[][] };
  l_hand_phrase: { midi: number[]; vectors: number[][] };
}

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, '../../../playright-ml/feature_parity_fixture.json');
const fixture: ParityFixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

// Must exactly mirror the context gen_feature_parity_fixture.py encodes.
const R_HAND_PHRASE: NoteEvent[] = [
  { stepIndex: 0, midi: 60, authoredFinger: 1, onset: 0 },
  { stepIndex: 1, midi: 64, authoredFinger: 3, onset: 480 },
  { stepIndex: 2, midi: 67, authoredFinger: 3, onset: 960 },
  { stepIndex: 2, midi: 72, authoredFinger: null, onset: 960 },
];

const L_HAND_PHRASE: NoteEvent[] = [
  { stepIndex: 0, midi: 48, authoredFinger: null, onset: 0 },
];

function expectRowMatches(actual: Float32Array, expected: number[]): void {
  expect(actual.length).toBe(FINGERING_FEATURE_COUNT);
  expect(expected.length).toBe(FINGERING_FEATURE_COUNT);
  for (let i = 0; i < expected.length; i += 1) {
    expect(actual[i]).toBeCloseTo(expected[i], 6);
  }
}

describe('fingeringModelFeatures TS/Python parity', () => {
  it('matches feature_spec.py for the R-hand phrase, note by note', () => {
    expect(fixture.r_hand_phrase.midi).toEqual(
      R_HAND_PHRASE.map((note) => note.midi),
    );

    R_HAND_PHRASE.forEach((_note, index) => {
      const row = buildModelFeatureRow({
        hand: 'R',
        index,
        phraseNotes: R_HAND_PHRASE,
      });
      expectRowMatches(row, fixture.r_hand_phrase.vectors[index]);
    });
  });

  it('matches feature_spec.py for the L-hand single-note phrase', () => {
    const row = buildModelFeatureRow({
      hand: 'L',
      index: 0,
      phraseNotes: L_HAND_PHRASE,
    });
    expectRowMatches(row, fixture.l_hand_phrase.vectors[0]);
  });
});
