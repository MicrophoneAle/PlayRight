import { describe, expect, it } from 'vitest';
import { fingerPhrase, phraseStartCost } from './fingeringPredictor.ts';
import type { NoteEvent } from './fingeringPredictor.ts';

/**
 * LH phrase-start direction bias regression gate.
 *
 * Fills a real gap: every other fingering benchmark in this project (chase,
 * repeat-pitch, graced-fixtures snapshot) exercises the RIGHT hand only.
 * There was no LH-specific fingering test before this one.
 *
 * Bug fixed: phraseStartCost's LH branch was inverted relative to the
 * already-correct RH branch. signedInterval() normalizes direction so that a
 * positive interval always means "the direction in which finger number
 * naturally increases for this hand" (thumb->pinky = high->low pitch for LH,
 * per HOME_POSITION.L). The LH branch re-inverted that already-normalized
 * sign, so an ascending LH phrase start preferred finger 1 (thumb) instead of
 * finger 5 (pinky), and vice versa for descending - a double inversion.
 *
 * The stepwise-run fixtures are deliberately small (2-semitone steps) so
 * phraseStartCost is the sole differentiator - they fail on the sign
 * inversion alone. The river-flows broken-chord arpeggio (F#3-C#4-F#4) that
 * Fable's investigation cited was originally OUT of this fix's reach: its
 * fifth with finger pair {1,5} triggered OPEN_FRAME_PAIR_BONUS on a
 * crossing, which dominated phraseStartCost by two orders of magnitude and
 * kept the pattern at 1-5-3. The 2026-07-18 cost-tuning pass gated that
 * bonus on in-sequence transitions, which flipped the arpeggio to 5-3-1 -
 * pinned below as the closing acceptance test for that flagged caveat.
 */

function ev(midi: number, onset: number): NoteEvent {
  return { stepIndex: onset / 480, midi, authoredFinger: null, onset };
}

describe('LH phrase-start direction bias (phraseStartCost)', () => {
  it('raw cost: an ascending LH phrase start prefers finger 5, not finger 1', () => {
    const notes = [ev(54, 0), ev(61, 480), ev(66, 960)]; // F#3 -> C#4 -> F#4 (ascending)
    const costs = ([1, 2, 3, 4, 5] as const).map((finger) =>
      phraseStartCost('L', finger, notes[0], notes),
    );
    // Ascending: cost must decrease monotonically from finger 1 to finger 5,
    // i.e. finger 5 is cheapest. The pre-fix code produced the opposite
    // monotonic order (finger 1 cheapest) - this assertion fails under that
    // inversion.
    expect(costs[4]).toBeLessThan(costs[0]);
    expect(costs).toEqual([...costs].sort((a, b) => b - a));
  });

  it('raw cost: a descending LH phrase start prefers finger 1, not finger 5', () => {
    const notes = [ev(66, 0), ev(61, 480), ev(54, 960)]; // F#4 -> C#4 -> F#3 (descending)
    const costs = ([1, 2, 3, 4, 5] as const).map((finger) =>
      phraseStartCost('L', finger, notes[0], notes),
    );
    expect(costs[0]).toBeLessThan(costs[4]);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
  });

  it('pure DP: LH ascending stepwise run starts on the pinky (5-4-3-2-1)', async () => {
    // C4-D4-E4-F4-G4: five notes, five fingers, no crossing/open-frame
    // interval involved - phraseStartCost is the only thing that decides
    // which end of the hand position the DP anchors the first note to.
    const notes = [ev(60, 0), ev(62, 480), ev(64, 960), ev(65, 1440), ev(67, 1920)];
    const fingers = await fingerPhrase(notes, 'L', 1, undefined, undefined, undefined, 0);
    expect(fingers).toEqual([5, 4, 3, 2, 1]);
  });

  it('pure DP: LH descending stepwise run starts on the thumb (1-2-3-4-5)', async () => {
    const notes = [ev(67, 0), ev(65, 480), ev(64, 960), ev(62, 1440), ev(60, 1920)];
    const fingers = await fingerPhrase(notes, 'L', 1, undefined, undefined, undefined, 0);
    expect(fingers).toEqual([1, 2, 3, 4, 5]);
  });

  it('pure DP: river-flows LH broken-chord arpeggio F#3-C#4-F#4 fingers 5-3-1 (open-frame bonus no longer subsidizes the 1-5 crossing)', async () => {
    // Named regression target from the LH phrase-start investigation: before
    // the 2026-07-18 open-frame gating, 1-5-3 (thumb-bottom, pinky crossing
    // UP a fifth - not a real technique) totalled -241.5 vs the correct
    // 5-3-1 at 1.5, decided entirely by OPEN_FRAME_PAIR_BONUS riding the
    // crossing branch. If the bonus ever applies to direction-fighting
    // finger pairs again, this reverts to 1-5-3 and FAILS.
    const notes = [ev(54, 0), ev(61, 480), ev(66, 960)]; // F#3 C#4 F#4
    const fingers = await fingerPhrase(notes, 'L', 1, undefined, undefined, undefined, 0);
    expect(fingers).toEqual([5, 3, 1]);
  });

  it('RH branch is untouched: ascending/descending preference unchanged', () => {
    const ascending = [ev(60, 0), ev(62, 480), ev(64, 960)];
    const descending = [ev(64, 0), ev(62, 480), ev(60, 960)];

    // RH ascending start: low note, ascending next -> prefers low finger (1).
    const ascCosts = ([1, 2, 3, 4, 5] as const).map((finger) =>
      phraseStartCost('R', finger, ascending[0], ascending),
    );
    expect(ascCosts).toEqual([...ascCosts].sort((a, b) => a - b));

    // RH descending start -> prefers high finger (5).
    const descCosts = ([1, 2, 3, 4, 5] as const).map((finger) =>
      phraseStartCost('R', finger, descending[0], descending),
    );
    expect(descCosts).toEqual([...descCosts].sort((a, b) => b - a));
  });
});
