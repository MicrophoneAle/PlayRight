import { describe, expect, it } from 'vitest';
import type { Finger, Hand, PlaybackScript, ScriptNote } from '../types/index.ts';
import { fingeringKey } from '../types/index.ts';
import {
  assignChordFingers,
  fingerGapForInterval,
  fingerTimeline,
  type NoteEvent,
  predictFingering,
  prepareScriptWithFingering,
} from './fingeringPredictor.ts';

function eventsFromMidis(midis: number[], onsetStep = 120): NoteEvent[] {
  return midis.map((midi, stepIndex) => ({
    stepIndex,
    midi,
    onset: stepIndex * onsetStep,
    authoredFinger: null,
  }));
}

function noConsecutiveRepeats(fingers: (Finger | null)[]): boolean {
  for (let index = 1; index < fingers.length; index += 1) {
    if (fingers[index] !== null && fingers[index] === fingers[index - 1]) {
      return false;
    }
  }
  return true;
}

function scriptNote(
  midi: number,
  hand: Hand,
  finger: Finger | null = null,
  fingerSource?: ScriptNote['fingerSource'],
): ScriptNote {
  const pitch = `M${midi}`;
  return fingerSource ? { pitch, midi, hand, finger, fingerSource } : { pitch, midi, hand, finger };
}

function step(order: number, onset: number, notes: ScriptNote[], measureNumber = 1): PlaybackScript[number] {
  return { order, onset, measureNumber, notes };
}

describe('gap table', () => {
  it('keeps the documented comfort gaps', () => {
    expect([1, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => fingerGapForInterval(i, 'close'))).toEqual([
      1, 1, 2, 2, 4, 4, 3, 4, 4,
    ]);
  });

  it('uses the extended table for wide scopes and returning pitches', () => {
    expect([1, 4, 5, 8, 9, 11, 12].map((i) => fingerGapForInterval(i, 'wide'))).toEqual([
      1, 1, 2, 2, 3, 3, 4,
    ]);
  });
});

describe('no consecutive repeated fingers', () => {
  it('never repeats across a scale', () => {
    expect(noConsecutiveRepeats(fingerTimeline(eventsFromMidis([60, 62, 64, 65, 67, 69, 71, 72]), 'R'))).toBe(true);
  });
  it('only repeats when the pitch repeats', () => {
    const fingers = fingerTimeline(eventsFromMidis([64, 64, 67]), 'R');
    expect(fingers[0]).toBe(fingers[1]);
    expect(fingers[2]).not.toBe(fingers[1]);
  });
  it('small oscillations stay put and never curl the thumb, top note on the pinky', () => {
    expect(fingerTimeline(eventsFromMidis([60, 62, 60, 62, 60]), 'R')).toEqual([4, 5, 4, 5, 4]);
  });
});

describe('static scope pins the extreme to the pinky', () => {
  it('right-hand cluster puts the highest note on 5', () => {
    const fingers = fingerTimeline(eventsFromMidis([60, 64, 67]), 'R');
    expect(fingers[fingers.length - 1]).toBe(5);
  });
  it('left-hand cluster puts the lowest note on 5', () => {
    const fingers = fingerTimeline(eventsFromMidis([60, 56, 53]), 'L');
    expect(fingers[fingers.length - 1]).toBe(5);
  });
});

describe('scope extreme always lands on pinky or ring', () => {
  const topFinger = (midis: number[]) => {
    const fingers = fingerTimeline(eventsFromMidis(midis), 'R');
    const peak = Math.max(...midis);
    return fingers[midis.indexOf(peak)];
  };
  const bottomFinger = (midis: number[]) => {
    const fingers = fingerTimeline(eventsFromMidis(midis), 'L');
    const trough = Math.min(...midis);
    return fingers[midis.indexOf(trough)];
  };

  it('right-hand static scope up: the highest note is finger 5 or 4', () => {
    for (const midis of [
      [60, 62, 64],
      [60, 64, 67],
      [60, 62, 60, 62],
    ]) {
      expect([4, 5]).toContain(topFinger(midis));
    }
  });

  it('left-hand static scope down: the lowest note is finger 5 or 4', () => {
    for (const midis of [
      [60, 58, 56],
      [60, 56, 53],
      [60, 58, 60, 58],
    ]) {
      expect([4, 5]).toContain(bottomFinger(midis));
    }
  });

  it('a hand-moving run crosses the thumb instead of stranding the pinky', () => {
    expect(noConsecutiveRepeats(fingerTimeline(eventsFromMidis([55, 57, 59, 60, 62, 64]), 'R'))).toBe(true);
    expect(noConsecutiveRepeats(fingerTimeline(eventsFromMidis([65, 63, 61, 60, 58, 56]), 'L'))).toBe(true);
  });
});

describe('traverse uses thumb crossings (canonical, tune if needed)', () => {
  it('ascending right-hand C major', () => {
    expect(fingerTimeline(eventsFromMidis([60, 62, 64, 65, 67, 69, 71, 72]), 'R')).toEqual([1, 2, 3, 1, 2, 3, 4, 5]);
  });
  it('descending right-hand C major', () => {
    expect(fingerTimeline(eventsFromMidis([72, 71, 69, 67, 65, 64, 62, 60]), 'R')).toEqual([5, 4, 3, 2, 1, 3, 2, 1]);
  });
  it('ascending left-hand C major mirrors the descending right hand', () => {
    expect(fingerTimeline(eventsFromMidis([48, 50, 52, 53, 55, 57, 59, 60]), 'L')).toEqual([5, 4, 3, 2, 1, 3, 2, 1]);
  });
});

describe('scope shift after a leap', () => {
  it('pins the new scope top note to the pinky or ring', () => {
    const fingers = fingerTimeline(eventsFromMidis([60, 62, 84, 86, 88]), 'R');
    const peak = 88;
    expect([4, 5]).toContain(fingers[midisIndexOf([60, 62, 84, 86, 88], peak)]);
  });

  it('derives the first note in the new scope from the pinned top (G on ], F on p)', () => {
    // G5=79, F5=77 — 2 semitones, neighbouring fingers with top on pinky
    const fingers = fingerTimeline(eventsFromMidis([60, 79, 77]), 'R');
    expect(fingers[1]).toBe(5);
    expect(fingers[2]).toBe(4);
  });

  it('opens an upward-shifted traverse on the pinky, never the thumb', () => {
    // Leap up to the top of a long descending run that overflows five fingers.
    const fingers = fingerTimeline(eventsFromMidis([60, 88, 86, 84, 83, 81, 79, 77]), 'R');
    expect(fingers[1]).toBe(5);
    expect(fingers[1]).not.toBe(1);
  });

  it('left-hand upward leap opens its new scope on the pinky too', () => {
    const fingers = fingerTimeline(eventsFromMidis([60, 36, 38, 40, 41, 43, 45, 47]), 'L');
    expect(fingers[1]).toBe(5);
  });
});

describe('a scope holds while notes stay within a major tenth', () => {
  it('keeps one scope (repeated pitches reuse fingers) inside 17 semitones', () => {
    // Spans 12 semitones, so no shift — same pitch keeps the same finger.
    const fingers = fingerTimeline(eventsFromMidis([60, 64, 67, 72, 67, 64, 60]), 'R');
    expect(fingers[0]).toBe(fingers[6]);
    expect(fingers[1]).toBe(fingers[5]);
    expect(fingers[2]).toBe(fingers[4]);
    expect(fingers[3]).toBe(5);
  });

  it('keeps a long climb varied with the peak on a strong finger', () => {
    // A climb wider than a major tenth splits into clean greedy scopes (no
    // front-peeled one-note scopes that used to collapse the run onto finger 5).
    const events: NoteEvent[] = [];
    const midis = [40, 50, 55, 60, 64, 67, 72, 76, 72, 67, 64];
    for (let index = 0; index < midis.length; index += 1) {
      events.push({
        stepIndex: index,
        midi: midis[index],
        onset: index * 120,
        authoredFinger: null,
      });
    }
    const fingers = fingerTimeline(events, 'R');
    // The peak lands on a strong finger.
    expect([4, 5]).toContain(fingers[midis.indexOf(76)]);
    // The run never collapses onto a single finger and never repeats a finger.
    expect(noConsecutiveRepeats(fingers)).toBe(true);
    expect(new Set(fingers).size).toBeGreaterThan(2);
  });
});

describe('interval spread prefers wide fingerings', () => {
  it('fingers a left-hand perfect fifth as q and v (5 and 1)', () => {
    const fingers = assignChordFingers(
      [
        { stepIndex: 0, onset: 0, midi: 40, authoredFinger: null },
        { stepIndex: 0, onset: 0, midi: 47, authoredFinger: null },
      ],
      'L',
    );
    expect(fingers).toEqual([5, 1]);
  });

  it('fingers a right-hand perfect fifth as n and [ (1 and 5)', () => {
    const fingers = assignChordFingers(
      [
        { stepIndex: 0, onset: 0, midi: 60, authoredFinger: null },
        { stepIndex: 0, onset: 0, midi: 67, authoredFinger: null },
      ],
      'R',
    );
    expect(fingers).toEqual([1, 5]);
  });
});

function midisIndexOf(midis: number[], target: number): number {
  return midis.indexOf(target);
}

describe('jumps and octaves', () => {
  it('a leap beyond a tenth starts a new scope', () => {
    const fingers = fingerTimeline(eventsFromMidis([60, 62, 84, 86]), 'R');
    expect(noConsecutiveRepeats(fingers)).toBe(true);
  });
  it('fingers a melodic octave thumb to pinky in each hand', () => {
    expect(fingerTimeline(eventsFromMidis([64, 76]), 'R')).toEqual([1, 5]);
    expect(fingerTimeline(eventsFromMidis([48, 36]), 'L')).toEqual([1, 5]);
  });
});

describe('assignChordFingers', () => {
  it('triads are distinct with the extreme on the pinky', () => {
    const triad: NoteEvent[] = [
      { stepIndex: 0, onset: 0, midi: 60, authoredFinger: null },
      { stepIndex: 0, onset: 0, midi: 64, authoredFinger: null },
      { stepIndex: 0, onset: 0, midi: 67, authoredFinger: null },
    ];
    const right = assignChordFingers(triad, 'R');
    const left = assignChordFingers(triad, 'L');
    expect(new Set(right).size).toBe(3);
    expect(new Set(left).size).toBe(3);
    expect(right[2]).toBe(5);
    expect(left[0]).toBe(5);
  });
});

describe('block-chord progressions do not collapse onto the pinky', () => {
  it('keeps every RH chord distinct without drifting the lead to finger 5', () => {
    // Eight triads walking down then up (Runaway-style RH). Previously the lead
    // finger drifted upward across chords until everything landed on finger 5
    // (`[`) with the upper notes overflowing to null.
    const chords = [
      [71, 76, 79],
      [71, 76, 79],
      [69, 74, 77],
      [67, 72, 76],
      [66, 71, 74],
      [67, 72, 76],
      [69, 74, 77],
      [71, 76, 79],
    ];
    const events: NoteEvent[] = [];
    chords.forEach((chord, stepIndex) => {
      for (const midi of chord) {
        events.push({ stepIndex, onset: stepIndex * 480, midi, authoredFinger: null });
      }
    });

    const fingers = fingerTimeline(events, 'R', 1);

    // No chord collapses: each 3-note chord keeps 3 distinct fingers, no nulls.
    for (let chordIndex = 0; chordIndex < chords.length; chordIndex += 1) {
      const slice = fingers.slice(chordIndex * 3, chordIndex * 3 + 3);
      expect(slice.every((finger) => finger !== null)).toBe(true);
      expect(new Set(slice).size).toBe(3);
    }

    // The leads (lowest note of each chord) never all sit on the pinky.
    const leads = chords.map((_, chordIndex) => fingers[chordIndex * 3]);
    expect(leads.every((finger) => finger === 5)).toBe(false);
    expect(leads.some((finger) => finger !== null && finger! <= 2)).toBe(true);
  });
});

describe('fingering stays consistent across a whole piece', () => {
  it('a wide ascending melody never collapses onto the pinky', () => {
    // A run wider than a major tenth used to fragment into one-note scopes,
    // pinning every note to finger 5 (RH `[`) until the final scope.
    const midis = [
      60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84,
    ];
    const fingers = fingerTimeline(eventsFromMidis(midis), 'R', 1);
    expect(fingers.every((finger) => finger === 5)).toBe(false);
    expect(noConsecutiveRepeats(fingers)).toBe(true);
    // The ascending run is meaningfully varied, not pinned to one finger.
    expect(new Set(fingers.slice(0, 8)).size).toBeGreaterThan(2);
  });

  it('repeats the same perfect-fifth dyad with the same fingers throughout', () => {
    // The same harmonic fifth must not switch fingering as the piece goes on.
    const events: NoteEvent[] = [];
    for (let step = 0; step < 6; step += 1) {
      events.push({ stepIndex: step, onset: step * 480, midi: 48, authoredFinger: null });
      events.push({ stepIndex: step, onset: step * 480, midi: 55, authoredFinger: null });
    }
    const fingers = fingerTimeline(events, 'L', 1);
    const lowFingers = fingers.filter((_, index) => index % 2 === 0);
    const highFingers = fingers.filter((_, index) => index % 2 === 1);
    // Every repetition of 48 (and of 55) gets the identical finger.
    expect(new Set(lowFingers).size).toBe(1);
    expect(new Set(highFingers).size).toBe(1);
    // And the fifth is the wide 5–1 (q + v), not a crunched 5–3 / 4–2.
    expect(lowFingers[0]).toBe(5);
    expect(highFingers[0]).toBe(1);
  });
});

describe('predictFingering preserves anchors', () => {
  it('never overwrites score or manual notes and marks filled notes predicted', () => {
    const script: PlaybackScript = [
      step(0, 0, [scriptNote(60, 'R', 2, 'score'), scriptNote(64, 'R', null), scriptNote(48, 'L', 4, 'manual')]),
      step(1, 480, [scriptNote(62, 'R', null), scriptNote(50, 'L', null)]),
    ];
    const predicted = predictFingering(script);
    const find = (s: number, hand: Hand, midi: number) =>
      predicted[s].notes.find((note) => note.hand === hand && note.midi === midi);
    expect(find(0, 'R', 60)).toMatchObject({ finger: 2, fingerSource: 'score' });
    expect(find(0, 'L', 48)).toMatchObject({ finger: 4, fingerSource: 'manual' });
    expect(find(0, 'R', 64)?.fingerSource).toBe('predicted');
    expect(find(1, 'R', 62)?.fingerSource).toBe('predicted');
  });
});

describe('manual fingering identity', () => {
  it('applies saved fingerings by onset after a rebuild with a different step count', () => {
    const overrides = { [fingeringKey(480, 'R', 64)]: 2 as Finger };
    const rebuilt: PlaybackScript = [
      step(0, 0, [scriptNote(60, 'R', null)]),
      step(1, 240, [scriptNote(62, 'R', null)]),
      step(2, 480, [scriptNote(64, 'R', null)]),
    ];
    expect(prepareScriptWithFingering(rebuilt, overrides, true, 1)[2].notes[0]).toMatchObject({
      finger: 2,
      fingerSource: 'manual',
    });
  });
});
