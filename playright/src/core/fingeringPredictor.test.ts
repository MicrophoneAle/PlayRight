import { describe, expect, it } from 'vitest';
import type { Finger, Hand, PlaybackScript, ScriptNote } from '../types/index.ts';
import { fingeringKey } from '../types/index.ts';
import {
  applyManualFingerings,
  assignChordFingers,
  fingerGapForInterval,
  fingerTimeline,
  type NoteEvent,
  PHRASE_MIN_ONSET_GAP_DIVISIONS,
  predictFingering,
  prepareScriptWithFingering,
  segmentIntoPhrases,
  spanModeForRange,
} from './fingeringPredictor.ts';

function noteEvent(
  stepIndex: number,
  midi: number,
  onset: number,
  authoredFinger: Finger | null = null,
): NoteEvent {
  return { stepIndex, midi, onset, authoredFinger };
}

function eventsFromMidis(midis: number[], onsetStep = 120): NoteEvent[] {
  return midis.map((midi, stepIndex) =>
    noteEvent(stepIndex, midi, stepIndex * onsetStep),
  );
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
  return fingerSource
    ? { pitch, midi, hand, finger, fingerSource }
    : { pitch, midi, hand, finger };
}

function step(
  order: number,
  onset: number,
  notes: ScriptNote[],
  measureNumber = 1,
): PlaybackScript[number] {
  return { order, onset, measureNumber, notes };
}

describe('fingerGapForInterval', () => {
  it('maps close-table intervals to the documented gaps', () => {
    expect([0, 1, 3, 4, 5, 6, 8, 9, 10].map((i) => fingerGapForInterval(i, 'close')))
      .toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it('maps wide-table intervals to the documented gaps', () => {
    expect([0, 1, 4, 5, 8, 9, 11, 12].map((i) => fingerGapForInterval(i, 'wide')))
      .toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
  });

  it('selects close or wide by range', () => {
    expect(spanModeForRange(10)).toBe('close');
    expect(spanModeForRange(11)).toBe('wide');
  });
});

describe('no consecutive repeated fingers', () => {
  it('never repeats a finger on consecutive distinct pitches in a scale', () => {
    const fingers = fingerTimeline(
      eventsFromMidis([60, 62, 64, 65, 67, 69, 71, 72]),
      'R',
    );
    expect(noConsecutiveRepeats(fingers)).toBe(true);
  });

  it('never repeats on the E F G B E figure and unifies the two E naturals', () => {
    const fingers = fingerTimeline(eventsFromMidis([64, 65, 67, 71, 64]), 'R');
    expect(fingers).toEqual([1, 2, 3, 5, 1]);
    expect(noConsecutiveRepeats(fingers)).toBe(true);
    expect(fingers[0]).toBe(fingers[4]);
  });

  it('keeps the same finger only when the pitch actually repeats', () => {
    const fingers = fingerTimeline(eventsFromMidis([64, 64, 67]), 'R');
    expect(fingers[0]).toBe(fingers[1]);
    expect(fingers[2]).not.toBe(fingers[1]);
  });

  it('mirrors the left hand and never repeats', () => {
    const fingers = fingerTimeline(
      eventsFromMidis([48, 50, 52, 53, 55, 57, 59, 60]),
      'L',
    );
    expect(noConsecutiveRepeats(fingers)).toBe(true);
    expect(fingers[0]).toBe(5);
  });
});

describe('consistent interval fingering', () => {
  it('uses the same finger gap for every instance of an interval', () => {
    const fingers = fingerTimeline(eventsFromMidis([60, 64, 60, 64, 60]), 'R');
    for (let index = 1; index < fingers.length; index += 1) {
      expect(Math.abs((fingers[index] as number) - (fingers[index - 1] as number)))
        .toBe(2);
    }
  });

  it('fingers melodic octaves thumb to pinky in each hand', () => {
    expect(fingerTimeline(eventsFromMidis([64, 76]), 'R')).toEqual([1, 5]);
    expect(fingerTimeline(eventsFromMidis([48, 36]), 'L')).toEqual([1, 5]);
  });
});

describe('segmentIntoPhrases', () => {
  it('splits on a sustained onset gap', () => {
    const phrases = segmentIntoPhrases([
      noteEvent(0, 60, 0),
      noteEvent(1, 62, PHRASE_MIN_ONSET_GAP_DIVISIONS),
    ]);
    expect(phrases).toHaveLength(2);
  });

  it('keeps chord members in one phrase', () => {
    const phrases = segmentIntoPhrases([
      noteEvent(0, 60, 0),
      noteEvent(0, 64, 0),
      noteEvent(1, 67, 1),
    ]);
    expect(phrases).toHaveLength(1);
    expect(phrases[0]).toHaveLength(3);
  });
});

describe('assignChordFingers', () => {
  it('gives a C major triad distinct fingers in each hand', () => {
    const triad: NoteEvent[] = [
      noteEvent(0, 60, 0),
      noteEvent(0, 64, 0),
      noteEvent(0, 67, 0),
    ];
    const right = assignChordFingers(triad, 'R');
    const left = assignChordFingers(triad, 'L');
    expect(new Set(right).size).toBe(3);
    expect(new Set(left).size).toBe(3);
    expect(right).toEqual([1, 3, 4]);
    expect(left).toEqual([4, 2, 1]);
  });

  it('fingers an octave chord thumb to pinky', () => {
    expect(
      assignChordFingers([noteEvent(0, 47, 0), noteEvent(0, 59, 0)], 'L'),
    ).toEqual([5, 1]);
  });
});

describe('predictFingering', () => {
  it('never overwrites score or manual notes and marks filled notes predicted', () => {
    const script: PlaybackScript = [
      step(0, 0, [
        scriptNote(60, 'R', 2, 'score'),
        scriptNote(64, 'R', null),
        scriptNote(48, 'L', 4, 'manual'),
        scriptNote(52, 'L', null),
      ]),
      step(1, 480, [scriptNote(62, 'R', null), scriptNote(50, 'L', null)]),
    ];

    const predicted = predictFingering(script);
    const find = (s: number, hand: Hand, midi: number) =>
      predicted[s].notes.find((note) => note.hand === hand && note.midi === midi);

    expect(find(0, 'R', 60)).toMatchObject({ finger: 2, fingerSource: 'score' });
    expect(find(0, 'L', 48)).toMatchObject({ finger: 4, fingerSource: 'manual' });
    expect(find(0, 'R', 64)?.fingerSource).toBe('predicted');
    expect(find(0, 'R', 64)?.finger).not.toBeNull();
    expect(find(1, 'R', 62)?.fingerSource).toBe('predicted');
  });
});

describe('manual fingering identity', () => {
  it('applies saved fingerings by onset after a rebuild with a different step count', () => {
    const targetOnset = 480;
    const overrides = { [fingeringKey(targetOnset, 'R', 64)]: 2 as Finger };
    const rebuilt: PlaybackScript = [
      step(0, 0, [scriptNote(60, 'R', null)]),
      step(1, 240, [scriptNote(62, 'R', null)]),
      step(2, targetOnset, [scriptNote(64, 'R', null)]),
    ];

    expect(applyManualFingerings(rebuilt, overrides)[2].notes[0]).toMatchObject({
      midi: 64,
      finger: 2,
      fingerSource: 'manual',
    });
    expect(
      prepareScriptWithFingering(rebuilt, overrides, true, 1)[2].notes[0],
    ).toMatchObject({ finger: 2, fingerSource: 'manual' });
  });
});
