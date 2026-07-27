import { describe, expect, it, vi } from 'vitest';
import type { Finger, Hand } from '../types/index.ts';

/**
 * Synthetic emission model: finger FAVOURED is free, every other finger costs
 * ML_FAVOUR_MARGIN. At ML_COST_WEIGHT=150 that is 450 weighted units - enough
 * to move a choice the DP is close to indifferent about, and far below the
 * hard structural penalties (50_000), exactly like the real model's range.
 */
const FAVOURED: Finger = 3;
const ML_FAVOUR_MARGIN = 3;

vi.mock('./aiFingeringInference.ts', () => ({
  getMLFingerCosts: async (notes: unknown[]) =>
    notes.map(() =>
      [1, 2, 3, 4, 5].map((finger) =>
        finger === FAVOURED ? 0 : ML_FAVOUR_MARGIN,
      ),
    ),
  initFingeringModel: async () => {},
  disposeFingeringModel: async () => {},
}));

const { fingerPhrase, isInShortRepeatRunContext, REPEAT_PITCH_MAX_ONSET_GAP_QUARTERS } =
  await import('./fingeringPredictor.ts');
const { ML_COST_WEIGHT } = await import('./fingeringMlConfig.ts');

type NoteEvent = Parameters<typeof fingerPhrase>[0][number];

const DIVISIONS_PER_QUARTER = 2;
const REPEAT_GAP = REPEAT_PITCH_MAX_ONSET_GAP_QUARTERS * DIVISIONS_PER_QUARTER;

function note(stepIndex: number, midi: number, onset: number): NoteEvent {
  return { stepIndex, midi, onset, authoredFinger: null };
}

/** Four attacks on one pitch, one division apart - a short repeated-note run. */
const REPEAT_RUN: NoteEvent[] = [
  note(0, 64, 0),
  note(1, 64, 1),
  note(2, 64, 2),
  note(3, 64, 3),
];

/** Plain stepwise ascent - no pitch ever repeats, so no run is ever detected. */
const PLAIN_RUN: NoteEvent[] = [
  note(0, 60, 0),
  note(1, 62, 2),
  note(2, 64, 4),
  note(3, 65, 6),
];

function plan(notes: NoteEvent[], mlCostWeight: number, hand: Hand = 'R') {
  return fingerPhrase(
    notes,
    hand,
    1,
    undefined,
    undefined,
    DIVISIONS_PER_QUARTER,
    mlCostWeight,
  );
}

/**
 * Pins the class-conditional ML blend (2026-07-27). The PIG emission model
 * helps on repeated-note runs and hurts on ordinary hand-position choices, so
 * the blend is gated on repeat-run context rather than applied uniformly. If
 * someone later reverts to a uniform blend - or drops the gate's head-
 * inclusive half - these tests fail rather than the regression landing
 * silently in a benchmark nobody re-ran.
 */
describe('ML context gate', () => {
  describe('isInShortRepeatRunContext', () => {
    it('flags every note of a short repeated-note run, head included', () => {
      const flags = REPEAT_RUN.map((_, index) =>
        isInShortRepeatRunContext(REPEAT_RUN, index, REPEAT_GAP),
      );
      expect(flags).toEqual([true, true, true, true]);
    });

    it('flags nothing in a phrase with no repeated pitches', () => {
      const flags = PLAIN_RUN.map((_, index) =>
        isInShortRepeatRunContext(PLAIN_RUN, index, REPEAT_GAP),
      );
      expect(flags).toEqual([false, false, false, false]);
    });

    it('does not flag a same-pitch pair separated by more than the onset window', () => {
      const farApart = [note(0, 64, 0), note(1, 64, REPEAT_GAP + 1)];
      expect(isInShortRepeatRunContext(farApart, 0, REPEAT_GAP)).toBe(false);
      expect(isInShortRepeatRunContext(farApart, 1, REPEAT_GAP)).toBe(false);
    });

    it('does not flag a note whose finger is authored (the DP has no choice)', () => {
      const authored: NoteEvent[] = [
        { ...REPEAT_RUN[0], authoredFinger: 2 as Finger },
        REPEAT_RUN[1],
      ];
      expect(isInShortRepeatRunContext(authored, 0, REPEAT_GAP)).toBe(false);
    });
  });

  describe('blend application', () => {
    it('lets ML decide inside a repeated-note run', async () => {
      const dpOnly = await plan(REPEAT_RUN, 0);
      const withMl = await plan(REPEAT_RUN, ML_COST_WEIGHT);

      // The DP alone is indifferent here (repeating one finger is free), so it
      // takes the lowest finger; the emission model is what supplies the
      // pedagogical repeated-note choice.
      expect(dpOnly).toEqual([1, 1, 1, 1]);
      expect(withMl).toEqual([FAVOURED, FAVOURED, FAVOURED, FAVOURED]);
      expect(withMl).not.toEqual(dpOnly);
    });

    it('leaves a plain in-sequence phrase bit-identical to pure DP', async () => {
      const dpOnly = await plan(PLAIN_RUN, 0);
      const withMl = await plan(PLAIN_RUN, ML_COST_WEIGHT);

      // Same mocked model, same favoured finger, zero influence: outside a
      // repeat run the local term is noteFingerCost alone.
      expect(withMl).toEqual(dpOnly);
    });

    it('leaves the LH plain case bit-identical too', async () => {
      const descending: NoteEvent[] = [
        note(0, 60, 0),
        note(1, 58, 2),
        note(2, 56, 4),
        note(3, 55, 6),
      ];
      const dpOnly = await plan(descending, 0, 'L');
      const withMl = await plan(descending, ML_COST_WEIGHT, 'L');
      expect(withMl).toEqual(dpOnly);
    });
  });
});
