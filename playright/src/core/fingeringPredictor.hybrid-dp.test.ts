import { describe, expect, it } from 'vitest';
import type { Finger, Hand } from '../types/index.ts';
import {
  choosePhraseSolveMode,
  countRecurringPitches,
  fingerPhrase,
  noteFingerCost,
  phraseStartCost,
  PHRASE_EXACT_HISTORY_MAX_R,
  REPEAT_PITCH_FINGER_MISMATCH,
  REPEAT_PITCH_MAX_ONSET_GAP_DIVISIONS,
  REPEAT_PITCH_RUN_MAX_LENGTH,
  RETURNING_PITCH_FINGER_MISMATCH,
  solvePhraseWithMode,
  transitionCost,
  type NoteEvent,
} from './fingeringPredictor.ts';

function events(midis: number[]): NoteEvent[] {
  return midis.map((midi, i) => ({
    stepIndex: i,
    midi,
    authoredFinger: null,
    onset: i,
  }));
}

function shortSamePitchFollow(
  notes: NoteEvent[],
  index: number,
  repeatGapDivisions: number,
): { active: boolean; anchorIndex: number | null } {
  if (index === 0) {
    return { active: false, anchorIndex: null };
  }

  const current = notes[index];
  for (let i = index - 1; i >= 0; i -= 1) {
    const previous = notes[i];
    if (previous.midi !== current.midi) {
      continue;
    }

    const onsetGap = current.onset - previous.onset;
    if (onsetGap > 0 && onsetGap <= repeatGapDivisions) {
      let contiguous = true;
      for (let j = i + 1; j < index; j += 1) {
        if (notes[j].midi !== current.midi) {
          contiguous = false;
          break;
        }
      }
      if (contiguous) {
        return { active: true, anchorIndex: i };
      }
    }
    break;
  }

  return { active: false, anchorIndex: null };
}

function samePitchRunLength(
  notes: NoteEvent[],
  index: number,
  repeatGapDivisions: number,
): number {
  let run = 1;
  let cursor = index;
  while (cursor > 0) {
    const follow = shortSamePitchFollow(notes, cursor, repeatGapDivisions);
    if (!follow.active || follow.anchorIndex === null) {
      break;
    }
    run += 1;
    cursor = follow.anchorIndex;
  }
  return run;
}

/** Path cost under the same terms the hybrid solvers use (mlCostWeight 0). */
function pathCost(notes: NoteEvent[], hand: Hand, fingers: Finger[]): number {
  const gap = REPEAT_PITCH_MAX_ONSET_GAP_DIVISIONS;
  let cost = 0;
  const firstFingerByMidi = new Map<number, Finger>();

  for (let index = 0; index < notes.length; index += 1) {
    const note = notes[index];
    const finger = fingers[index];
    const local = noteFingerCost(hand, finger, note.midi);
    const repeatFollow = shortSamePitchFollow(notes, index, gap);
    const inShortRepeatRun =
      repeatFollow.active &&
      repeatFollow.anchorIndex !== null &&
      note.authoredFinger === null &&
      samePitchRunLength(notes, index, gap) <= REPEAT_PITCH_RUN_MAX_LENGTH;

    if (index === 0) {
      cost += local + phraseStartCost(hand, finger, note, notes);
    } else {
      cost +=
        local +
        transitionCost(
          hand,
          fingers[index - 1],
          notes[index - 1].midi,
          finger,
          note.midi,
        );

      if (
        inShortRepeatRun &&
        fingers[repeatFollow.anchorIndex!] !== finger
      ) {
        cost += REPEAT_PITCH_FINGER_MISMATCH;
      }

      if (
        note.authoredFinger === null &&
        firstFingerByMidi.has(note.midi) &&
        firstFingerByMidi.get(note.midi) !== finger &&
        !repeatFollow.active
      ) {
        cost += RETURNING_PITCH_FINGER_MISMATCH;
      }
    }

    if (!firstFingerByMidi.has(note.midi)) {
      firstFingerByMidi.set(note.midi, finger);
    }
  }

  return cost;
}

describe('hybrid Viterbi fingering solver', () => {
  it('canonical RH returning-pitch phrase reaches exact optimum', async () => {
    const notes = events([64, 66, 71, 69, 61, 64]);
    expect(choosePhraseSolveMode(notes)).toBe('exact');
    const fingers = await fingerPhrase(
      notes,
      'R',
      undefined,
      undefined,
      undefined,
      undefined,
      0,
    );
    expect(fingers).toEqual([2, 3, 4, 3, 1, 2]);
    expect(pathCost(notes, 'R', fingers)).toBeCloseTo(101.5, 5);
  });

  it('constant-moderato style LH ostinato matches exact optimum', async () => {
    const notes = events([54, 56, 58, 53, 54, 56, 58]);
    expect(choosePhraseSolveMode(notes)).toBe('exact');
    const fingers = await fingerPhrase(
      notes,
      'L',
      undefined,
      undefined,
      undefined,
      undefined,
      0,
    );
    // Known brute/exact optimum from DP-optimality investigation (cost ~102).
    // Collapsed DP previously returned the suboptimal [5,4,3,5,4,3,2].
    expect(fingers).toEqual([4, 3, 2, 5, 4, 3, 2]);
    expect(pathCost(notes, 'L', fingers)).toBeCloseTo(102, 0);
    expect(fingers).not.toEqual([5, 4, 3, 5, 4, 3, 2]);
  });

  it('R=0 phrases use collapsed mode and match collapsed solver output', async () => {
    const notes = events([60, 62, 64, 65, 67]);
    expect(countRecurringPitches(notes)).toBe(0);
    expect(choosePhraseSolveMode(notes)).toBe('collapsed');
    const viaRouter = await fingerPhrase(
      notes,
      'R',
      undefined,
      undefined,
      undefined,
      undefined,
      0,
    );
    const viaCollapsed = solvePhraseWithMode('collapsed', notes, 'R');
    expect(viaRouter).toEqual(viaCollapsed);
  });

  it('beam k=8 matches exact on short R∈1..3 phrases', () => {
    const phrases: number[][] = [
      [64, 66, 71, 69, 61, 64], // R=1
      [54, 56, 58, 53, 54, 56, 58], // R=3
      [60, 62, 60, 64], // R=1 len 4
      [48, 50, 52, 48, 50], // R=2
      [55, 57, 59, 60, 55, 57, 59], // R=3
      [62, 64, 65, 67, 64, 62], // R=2
    ];

    let matched = 0;
    for (const midis of phrases) {
      const notes = events(midis);
      const r = countRecurringPitches(notes);
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(3);
      expect(notes.length).toBeGreaterThanOrEqual(4);
      expect(notes.length).toBeLessThanOrEqual(7);
      expect(choosePhraseSolveMode(notes)).toBe('exact');

      const hand: Hand = midis[0] < 60 ? 'L' : 'R';
      const exact = solvePhraseWithMode('exact', notes, hand);
      const beam = solvePhraseWithMode('beam', notes, hand);

      const sameFingers = exact.every((f, i) => f === beam[i]);
      const sameCost =
        pathCost(notes, hand, exact) === pathCost(notes, hand, beam);
      expect(sameFingers || sameCost).toBe(true);
      if (sameFingers || sameCost) {
        matched += 1;
      }
    }

    expect(matched).toBe(phrases.length);
  });

  it('beam-routed fingerPhrase takes the cheaper of beam and collapsed', async () => {
    // Long high-R phrase forces beam (R>3 or len>10).
    const midis = [
      60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60, 62, 64, 65, 67,
      69, 60, 64, 67, 72, 67, 64, 60, 62, 65, 69, 65, 62,
    ];
    const notes = events(midis);
    expect(countRecurringPitches(notes)).toBeGreaterThan(PHRASE_EXACT_HISTORY_MAX_R);
    expect(choosePhraseSolveMode(notes)).toBe('beam');

    const routed = await fingerPhrase(
      notes,
      'R',
      undefined,
      undefined,
      undefined,
      undefined,
      0,
    );
    const beam = solvePhraseWithMode('beam', notes, 'R', undefined, 0);
    const collapsed = solvePhraseWithMode('collapsed', notes, 'R', undefined, 0);
    const routedCost = pathCost(notes, 'R', routed);
    const bestSolo = Math.min(
      pathCost(notes, 'R', beam),
      pathCost(notes, 'R', collapsed),
    );
    expect(routedCost).toBeLessThanOrEqual(bestSolo + 1e-6);
  });
});
