import { describe, expect, it } from 'vitest';
import type { Finger, Hand, PlaybackScript, ScriptNote } from '../types/index.ts';
import { fingeringKey } from '../types/index.ts';
import {
  applyManualFingerings,
  assignChordFingers,
  fingerPhrase,
  HOME_POSITION,
  LEGAL_CROSSING_COST,
  type NoteEvent,
  PHRASE_MIN_ONSET_GAP_DIVISIONS,
  predictFingering,
  prepareScriptWithFingering,
  segmentIntoPhrases,
  transitionCost,
} from './fingeringPredictor.ts';

function noteEvent(
  stepIndex: number,
  midi: number,
  onset: number,
  authoredFinger: Finger | null = null,
): NoteEvent {
  return { stepIndex, midi, onset, authoredFinger };
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

function isMonotonicFingers(hand: Hand, fingers: Finger[]): boolean {
  for (let index = 1; index < fingers.length; index += 1) {
    if (hand === 'R' && fingers[index] <= fingers[index - 1]) {
      return false;
    }
    if (hand === 'L' && fingers[index] >= fingers[index - 1]) {
      return false;
    }
  }
  return true;
}

function usesThumbUnderAt(
  hand: Hand,
  notes: NoteEvent[],
  fingers: Finger[],
  index: number,
): boolean {
  if (index <= 0) {
    return false;
  }

  const prevFinger = fingers[index - 1];
  const curFinger = fingers[index];
  const interval = notes[index].midi - notes[index - 1].midi;

  if (hand === 'R') {
    return curFinger === 1 && interval > 0 && prevFinger > curFinger;
  }

  return curFinger === 1 && interval < 0 && prevFinger < curFinger;
}

function usesFingerOverAt(
  hand: Hand,
  notes: NoteEvent[],
  fingers: Finger[],
  index: number,
): boolean {
  if (index <= 0) {
    return false;
  }

  const prevFinger = fingers[index - 1];
  const curFinger = fingers[index];
  const interval = notes[index].midi - notes[index - 1].midi;

  if (hand === 'R') {
    return prevFinger === 1 && interval < 0 && curFinger > prevFinger;
  }

  return prevFinger === 1 && interval > 0 && curFinger < prevFinger;
}

describe('fingerPhrase', () => {
  const cMajorAscRhMidis = [60, 62, 64, 65, 67, 69, 71, 72];
  const cMajorAscRh = cMajorAscRhMidis.map((midi, stepIndex) =>
    noteEvent(stepIndex, midi, stepIndex),
  );

  it('fingerPhrase on an ascending C major scale in the right hand returns standard fingering or close equivalent with thumb-unders', () => {
    const fingers = fingerPhrase(cMajorAscRh, 'R');

    const standard = [1, 2, 3, 1, 2, 3, 4, 5] as Finger[];
    const thumbOnOctave = [1, 2, 3, 1, 2, 3, 4, 1] as Finger[];

    expect([standard, thumbOnOctave]).toContainEqual(fingers);
    expect(usesThumbUnderAt('R', cMajorAscRh, fingers, 3)).toBe(true);

    const awkwardStretch = transitionCost('R', 3, 71, 5, 72);
    const thumbUnder = transitionCost('R', 4, 71, 1, 72);
    expect(thumbUnder).toBeLessThan(awkwardStretch);
    expect(thumbUnder).toBeLessThan(LEGAL_CROSSING_COST);
  });

  it('matches standard fingering when seeded from the default home position', () => {
    const fingers = fingerPhrase(cMajorAscRh, 'R', 1, HOME_POSITION.R);
    expect(fingers).toEqual([1, 2, 3, 1, 2, 3, 4, 1]);
  });

  it('fingerPhrase on a descending right-hand C major scale mirrors ascending logic', () => {
    const cMajorDescRh = [...cMajorAscRhMidis].reverse().map((midi, stepIndex) =>
      noteEvent(stepIndex, midi, stepIndex),
    );
    const fingers = fingerPhrase(cMajorDescRh, 'R');

    expect(fingers.slice(0, 5)).toEqual([5, 4, 3, 2, 1]);
    expect(transitionCost('R', 1, 65, 4, 64)).toBeLessThan(LEGAL_CROSSING_COST);
  });

  it('fingerPhrase on an ascending left-hand C major scale uses scale rotations', () => {
    const cMajorAscLhMidis = [48, 50, 52, 53, 55, 57, 59, 60];
    const cMajorAscLh = cMajorAscLhMidis.map((midi, stepIndex) =>
      noteEvent(stepIndex, midi, stepIndex),
    );
    const fingers = fingerPhrase(cMajorAscLh, 'L');

    expect(fingers).toHaveLength(8);
    expect(new Set(fingers).size).toBeGreaterThan(1);
  });

  it('honors an authored anchor and fingers the surrounding notes', () => {
    const phrase: NoteEvent[] = [
      noteEvent(0, 60, 0),
      noteEvent(1, 62, 1, 3),
      noteEvent(2, 64, 2),
      noteEvent(3, 65, 3),
      noteEvent(4, 67, 4),
    ];

    const fingers = fingerPhrase(phrase, 'R');
    expect(fingers[1]).toBe(3);
    expect(fingers[0]).toBeLessThan(fingers[1]);
    expect(fingers[2]).toBeGreaterThan(fingers[1]);
  });
});

describe('assignChordFingers', () => {
  it('never assigns the same finger to two different consecutive notes', () => {
    expect(transitionCost('R', 2, 65, 2, 67)).toBe(Infinity);

    const phrase: NoteEvent[] = [
      noteEvent(0, 65, 0),
      noteEvent(1, 67, 480),
    ];
    const fingers = fingerPhrase(phrase, 'R');
    expect(fingers[0]).not.toBe(fingers[1]);
    expect(Math.abs(fingers[1] - fingers[0])).toBe(1);
  });

  it('assigns LH octave bass pairs to pinky and thumb by distance', () => {
    const octave: NoteEvent[] = [
      noteEvent(0, 47, 0),
      noteEvent(0, 59, 0),
    ];

    expect(assignChordFingers(octave, 'L')).toEqual([5, 1]);
  });

  it('assigns distinct monotonic fingers for a simple C major triad in each hand', () => {
    const triad: NoteEvent[] = [
      noteEvent(0, 60, 0),
      noteEvent(0, 64, 0),
      noteEvent(0, 67, 0),
    ];

    const right = assignChordFingers(triad, 'R').filter(
      (finger): finger is Finger => finger !== null,
    );
    const left = assignChordFingers(triad, 'L').filter(
      (finger): finger is Finger => finger !== null,
    );

    expect(right).toEqual([1, 2, 3]);
    expect(left).toEqual([4, 3, 2]);
    expect(new Set(right).size).toBe(3);
    expect(new Set(left).size).toBe(3);
    expect(isMonotonicFingers('R', right)).toBe(true);
    expect(isMonotonicFingers('L', left)).toBe(true);
  });
});

describe('segmentIntoPhrases', () => {
  it('splits when the hand frame would exceed 14 semitones or on a large onset gap', () => {
    const frameTimeline: NoteEvent[] = [
      noteEvent(0, 60, 0),
      noteEvent(1, 67, 1),
      noteEvent(2, 76, 2),
    ];
    const leapTimeline: NoteEvent[] = [
      noteEvent(0, 60, 0),
      noteEvent(1, 75, 1),
    ];
    const gapTimeline: NoteEvent[] = [
      noteEvent(0, 60, 0),
      noteEvent(1, 62, PHRASE_MIN_ONSET_GAP_DIVISIONS),
    ];

    const framePhrases = segmentIntoPhrases(frameTimeline);
    const leapPhrases = segmentIntoPhrases(leapTimeline);
    const gapPhrases = segmentIntoPhrases(gapTimeline);

    expect(framePhrases).toHaveLength(2);
    expect(framePhrases[0].map((event) => event.midi)).toEqual([60, 67]);
    expect(framePhrases[1].map((event) => event.midi)).toEqual([76]);

    expect(leapPhrases).toHaveLength(2);
    expect(gapPhrases).toHaveLength(2);
    expect(leapPhrases[0]).toHaveLength(1);
    expect(gapPhrases[0]).toHaveLength(1);
  });

  it('keeps chord members in the same segment', () => {
    const timeline: NoteEvent[] = [
      noteEvent(0, 60, 0),
      noteEvent(0, 64, 0),
      noteEvent(1, 67, 1),
    ];

    const phrases = segmentIntoPhrases(timeline);

    expect(phrases).toHaveLength(1);
    expect(phrases[0]).toHaveLength(3);
    expect(phrases[0].map((event) => event.stepIndex)).toEqual([0, 0, 1]);
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
      step(1, 480, [
        scriptNote(62, 'R', null),
        scriptNote(50, 'L', null),
      ]),
    ];

    const predicted = predictFingering(script);

    const rightScore = predicted[0].notes.find(
      (note) => note.hand === 'R' && note.midi === 60,
    );
    const rightFilled = predicted[0].notes.find(
      (note) => note.hand === 'R' && note.midi === 64,
    );
    const leftManual = predicted[0].notes.find(
      (note) => note.hand === 'L' && note.midi === 48,
    );
    const leftFilled = predicted[0].notes.find(
      (note) => note.hand === 'L' && note.midi === 52,
    );
    const rightLater = predicted[1].notes.find(
      (note) => note.hand === 'R' && note.midi === 62,
    );

    expect(rightScore?.finger).toBe(2);
    expect(rightScore?.fingerSource).toBe('score');
    expect(leftManual?.finger).toBe(4);
    expect(leftManual?.fingerSource).toBe('manual');
    expect(rightFilled?.finger).not.toBeNull();
    expect(rightFilled?.fingerSource).toBe('predicted');
    expect(leftFilled?.finger).not.toBeNull();
    expect(leftFilled?.fingerSource).toBe('predicted');
    expect(rightLater?.finger).not.toBeNull();
    expect(rightLater?.fingerSource).toBe('predicted');
  });

  it('prefers the home-aligned opening finger through predictFingering', () => {
    const script: PlaybackScript = [
      step(0, 0, [scriptNote(64, 'R', null), scriptNote(62, 'R', null)]),
      step(1, 960, [scriptNote(48, 'R', null), scriptNote(47, 'R', null)]),
    ];

    const predicted = predictFingering(script);
    const firstPhraseFinger = predicted[0].notes.find(
      (note) => note.midi === 64,
    )?.finger;

    expect(firstPhraseFinger).toBe(2);
    expect(firstPhraseFinger).not.toBe(1);
  });

  it('assigns high right-hand E to pinky (BracketLeft key)', () => {
    const script: PlaybackScript = [
      step(0, 0, [scriptNote(76, 'R', null)]),
    ];

    const predicted = predictFingering(script);
    expect(predicted[0].notes[0].finger).toBe(5);
  });

  it('keeps the same finger for repeated pitches across phrase gaps', () => {
    const script: PlaybackScript = [
      step(0, 0, [scriptNote(76, 'R', null)]),
      step(1, PHRASE_MIN_ONSET_GAP_DIVISIONS, [scriptNote(76, 'R', null)]),
    ];

    const predicted = predictFingering(script);
    const first = predicted[0].notes[0].finger;
    const second = predicted[1].notes[0].finger;

    expect(first).toBe(5);
    expect(second).toBe(first);
  });

  it('prefers thumb and pinky for right-hand octaves', () => {
    const phrase: NoteEvent[] = [
      noteEvent(0, 64, 0),
      noteEvent(1, 76, 480),
    ];

    expect(fingerPhrase(phrase, 'R')).toEqual([1, 5]);
  });

  it('prefers pinky and thumb for left-hand octaves', () => {
    const phrase: NoteEvent[] = [
      noteEvent(0, 48, 0),
      noteEvent(1, 36, 480),
    ];

    expect(fingerPhrase(phrase, 'L')).toEqual([5, 1]);
  });

  it('uses neighboring fingers for semitone steps on inner fingers', () => {
    const phrase: NoteEvent[] = [
      noteEvent(0, 66, 0),
      noteEvent(1, 67, 480),
    ];

    const fingers = fingerPhrase(phrase, 'R');
    expect(Math.abs(fingers[1] - fingers[0])).toBe(1);
  });

  it('maps high E approached from below to pinky, not thumb', () => {
    const phrase: NoteEvent[] = [
      noteEvent(0, 64, 0),
      noteEvent(1, 67, 480),
      noteEvent(2, 71, 960),
      noteEvent(3, 76, 1440),
    ];

    expect(fingerPhrase(phrase, 'R')).toEqual([1, 2, 3, 5]);
  });

  it('starts descending high E major run on pinky', () => {
    const midis = [76, 75, 73, 71, 69, 68, 66];
    const phrase = midis.map((midi, stepIndex) =>
      noteEvent(stepIndex, midi, stepIndex * 240),
    );

    const fingers = fingerPhrase(phrase, 'R');
    expect(fingers[0]).toBe(5);
    expect(fingers.slice(0, 5)).toEqual([5, 4, 3, 2, 1]);
  });

  it('unifies finger choice for returning pitches within a phrase', () => {
    const phrase: NoteEvent[] = [
      noteEvent(0, 62, 0),
      noteEvent(1, 64, 480),
      noteEvent(2, 64, 960),
      noteEvent(3, 62, 1440),
    ];

    const fingers = fingerPhrase(phrase, 'R');
    expect(fingers[0]).toBe(fingers[3]);
    expect(fingers[1]).toBe(fingers[2]);
  });

  it('uses thumb and pinky for leaps of an octave or more', () => {
    expect(
      fingerPhrase(
        [noteEvent(0, 64, 0), noteEvent(1, 76, 480)],
        'R',
      ),
    ).toEqual([1, 5]);

    expect(
      fingerPhrase(
        [noteEvent(0, 48, 0), noteEvent(1, 36, 480)],
        'L',
      ),
    ).toEqual([5, 1]);
  });
});

describe('manual fingering identity', () => {
  it('applies saved fingerings by onset after the script is rebuilt with a different step count', () => {
    const targetOnset = 480;
    const overrides = {
      [fingeringKey(targetOnset, 'R', 64)]: 2 as Finger,
    };

    const rebuiltScript: PlaybackScript = [
      step(0, 0, [scriptNote(60, 'R', null)]),
      step(1, 240, [scriptNote(62, 'R', null)]),
      step(2, targetOnset, [scriptNote(64, 'R', null)]),
    ];

    const withManual = applyManualFingerings(rebuiltScript, overrides);
    expect(withManual[2].notes[0]).toMatchObject({
      midi: 64,
      hand: 'R',
      finger: 2,
      fingerSource: 'manual',
    });

    const withPrediction = prepareScriptWithFingering(
      rebuiltScript,
      overrides,
      true,
      1,
    );
    expect(withPrediction[2].notes[0]).toMatchObject({
      midi: 64,
      hand: 'R',
      finger: 2,
      fingerSource: 'manual',
    });
  });
});
