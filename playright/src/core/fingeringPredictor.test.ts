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
    expect([1, 3, 4, 5, 6, 8, 9, 10].map((i) => fingerGapForInterval(i, 'close'))).toEqual([
      1, 1, 2, 2, 3, 3, 4, 4,
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
