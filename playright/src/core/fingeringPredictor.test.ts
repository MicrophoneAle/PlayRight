import { describe, expect, it } from 'vitest';
import type { Finger, Hand, PlaybackScript, ScriptNote } from '../types/index.ts';
import { fingeringKey } from '../types/index.ts';
import {
  assignChordFingers,
  comfortFingerGap,
  extendedFingerGap,
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

describe('comfort table', () => {
  it('returns monotonic close-position gaps for distances 1–10', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(comfortFingerGap)).toEqual([
      1, 1, 1, 2, 2, 3, 3, 3, 4, 4,
    ]);
  });

  it('uses the stretch table for wide scopes', () => {
    expect([1, 4, 5, 8, 9, 11, 12].map(extendedFingerGap)).toEqual([
      1, 1, 2, 2, 3, 3, 4,
    ]);
  });
});

describe('centered static scopes', () => {
  it('fingers an ascending C-major five-finger run 1–5 with no repeats', () => {
    const fingers = fingerTimeline(eventsFromMidis([60, 62, 64, 65, 67]), 'R');
    expect(fingers).toEqual([1, 2, 3, 4, 5]);
    expect(noConsecutiveRepeats(fingers)).toBe(true);
  });

  it('opens a narrow new scope near the thumb, not glued to it', () => {
    // 84 86 88 is the new scope's range; its lowest note (84, the first note)
    // sits at or near the thumb (centering keeps a true bottom note low), and
    // the others use the middle fingers rather than only 1-2-3.
    const midis = [60, 62, 84, 86, 88];
    const fingers = fingerTimeline(eventsFromMidis(midis), 'R');
    // eslint-disable-next-line no-console
    console.log('two-octave-jump actual:', fingers);
    const newScopeStart = midis.indexOf(84);
    expect(fingers[newScopeStart]).toBeLessThanOrEqual(2);
  });

  it('places a middle-start run with the first note on a middle finger', () => {
    const midis = [64, 62, 60, 62, 64, 67];
    const fingers = fingerTimeline(eventsFromMidis(midis), 'R');
    // eslint-disable-next-line no-console
    console.log('middle-start actual:', fingers);
    expect(fingers[0]).toBeGreaterThan(1);
    expect(fingers[0]).toBeLessThan(5);
    expect(noConsecutiveRepeats(fingers)).toBe(true);
  });

  it('keeps a true bottom-note start on or near the left-hand thumb', () => {
    const midis = [60, 58, 56, 53];
    const fingers = fingerTimeline(eventsFromMidis(midis), 'L');
    const highestMidi = Math.max(...midis);
    expect(fingers[midis.indexOf(highestMidi)]).toBeLessThanOrEqual(2);
  });
});

describe('traverse runs', () => {
  it('fingers an ascending C-major octave with index-preferred brief crossings', () => {
    const midis = [60, 62, 64, 65, 67, 69, 71, 72];
    const fingers = fingerTimeline(eventsFromMidis(midis), 'R');
    // eslint-disable-next-line no-console
    console.log('octave actual:', fingers);
    expect(noConsecutiveRepeats(fingers)).toBe(true);
    expect(fingers[0]).toBe(1);
    expect(fingers[fingers.length - 1]).not.toBe(fingers[0]);
  });

  it('uses the stretch table for a spread arpeggio', () => {
    const midis = [60, 64, 67, 72];
    const fingers = fingerTimeline(eventsFromMidis(midis), 'R');
    // eslint-disable-next-line no-console
    console.log('arpeggio actual:', fingers);
    expect(fingers[0]).toBe(1);
    expect(noConsecutiveRepeats(fingers)).toBe(true);
    expect(new Set(fingers).size).toBeGreaterThan(2);
  });

  it('ascending left-hand C major mirrors with the top note on the thumb', () => {
    const midis = [48, 50, 52, 53, 55, 57, 59, 60];
    const fingers = fingerTimeline(eventsFromMidis(midis), 'L');
    expect(fingers[fingers.length - 1]).toBe(1);
    expect(noConsecutiveRepeats(fingers)).toBe(true);
  });
});

describe('spread scopes use the stretch table, not traverse', () => {
  const lowFingerShare = (fingers: (Finger | null)[]): number => {
    const low = fingers.filter((finger) => finger === 1 || finger === 2).length;
    return low / fingers.length;
  };

  it('fingers a spread right-hand scope within 17 semitones with upper fingers', () => {
    // 60 64 67 72 76 spans 16 semitones across 5 notes. The stretch table fits
    // it under five fingers, so it must NOT enter traverse (which would reset to
    // the thumb mid-scope) and must use the upper fingers for the higher notes.
    const midis = [60, 64, 67, 72, 76];
    const fingers = fingerTimeline(eventsFromMidis(midis), 'R');
    // eslint-disable-next-line no-console
    console.log('spread-5 actual:', fingers);
    // A clean bottom-anchored stretch layout, strictly increasing — a traverse
    // would have reset a higher note back down to 1.
    expect(fingers).toEqual([1, 2, 3, 4, 5]);
    for (let index = 1; index < fingers.length; index += 1) {
      expect(fingers[index]! > fingers[index - 1]!).toBe(true);
    }
    expect(fingers[fingers.length - 1]).toBe(5);
  });

  it('does not pile a four-note arpeggio onto fingers 1 and 2', () => {
    const midis = [60, 65, 69, 74]; // spans 14 semitones (> an octave)
    const fingers = fingerTimeline(eventsFromMidis(midis), 'R');
    // eslint-disable-next-line no-console
    console.log('arpeggio-4 actual:', fingers);
    expect(lowFingerShare(fingers)).toBeLessThanOrEqual(0.5);
    expect(fingers[0]).toBe(1);
    expect(fingers[fingers.length - 1]).toBeGreaterThanOrEqual(4);
  });

  it('does not pile a six-note spread figure onto fingers 1 and 2', () => {
    const midis = [60, 64, 67, 72, 76, 72]; // five distinct, spans 16 semitones
    const fingers = fingerTimeline(eventsFromMidis(midis), 'R');
    // eslint-disable-next-line no-console
    console.log('spread-6 actual:', fingers);
    expect(lowFingerShare(fingers)).toBeLessThanOrEqual(0.5);
    expect(new Set(fingers).size).toBeGreaterThanOrEqual(4);
  });

  it('still traverses an ascending C-major octave (genuinely > five fingers)', () => {
    const midis = [60, 62, 64, 65, 67, 69, 71, 72];
    const fingers = fingerTimeline(eventsFromMidis(midis), 'R');
    // eslint-disable-next-line no-console
    console.log('octave-traverse actual:', fingers);
    expect(noConsecutiveRepeats(fingers)).toBe(true);
    expect(fingers[0]).toBe(1);
    expect(fingers[fingers.length - 1]).toBe(3);
  });

  it('does not split a scope while all notes stay within 17 semitones', () => {
    // A leap up then back down, all inside 17 semitones: one scope, so the bottom
    // anchor (thumb) appears exactly once. A split would re-anchor and yield a
    // second finger-1.
    const midis = [60, 72, 65, 77];
    const fingers = fingerTimeline(eventsFromMidis(midis), 'R');
    // eslint-disable-next-line no-console
    console.log('no-split actual:', fingers);
    expect(fingers.filter((finger) => finger === 1).length).toBe(1);
    expect(new Set(fingers).size).toBe(4);
  });
});

describe('centered hand on wandering melodies', () => {
  const lowestThreeShare = (fingers: (Finger | null)[]): number => {
    const low = fingers.filter((finger) => finger === 1 || finger === 2 || finger === 3).length;
    return low / fingers.length;
  };

  it('centers a wandering right-hand melody instead of clustering on 1-2-3', () => {
    // Stepwise wandering around A4, all within a 4-semitone band. Centering should
    // place this on the middle fingers (2-3-4), reaching the thumb only at the
    // true low note, NOT pile everything onto 1-2-3.
    const midis = [69, 71, 72, 71, 69, 68, 69, 71];
    const fingers = fingerTimeline(eventsFromMidis(midis), 'R');
    // eslint-disable-next-line no-console
    console.log('wandering-RH actual:', fingers);
    const onThumb = fingers.filter((finger) => finger === 1).length;
    expect(onThumb).toBeLessThan(fingers.length / 2);
    expect(lowestThreeShare(fingers)).toBeLessThan(1);
    expect(noConsecutiveRepeats(fingers)).toBe(true);
  });

  it('keeps a spread scope (60 64 67 71 72) on the upper fingers', () => {
    const midis = [60, 64, 67, 71, 72];
    const fingers = fingerTimeline(eventsFromMidis(midis), 'R');
    // eslint-disable-next-line no-console
    console.log('spread-71-72 actual:', fingers);
    expect(fingers[0]).toBe(1);
    expect(fingers[fingers.length - 1]).toBeGreaterThanOrEqual(4);
    expect(noConsecutiveRepeats(fingers)).toBe(true);
  });

  it('centers a wandering left-hand bass melody instead of clustering on 1-2-3', () => {
    const midis = [52, 50, 48, 50, 52, 53, 52, 50];
    const fingers = fingerTimeline(eventsFromMidis(midis), 'L');
    // eslint-disable-next-line no-console
    console.log('wandering-LH actual:', fingers);
    const onThumb = fingers.filter((finger) => finger === 1).length;
    expect(onThumb).toBeLessThan(fingers.length / 2);
    expect(lowestThreeShare(fingers)).toBeLessThan(1);
    expect(noConsecutiveRepeats(fingers)).toBe(true);
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
});

describe('interval spread uses bottom anchoring', () => {
  it('fingers a left-hand perfect fifth with the high note on the thumb', () => {
    const fingers = assignChordFingers(
      [
        { stepIndex: 0, onset: 0, midi: 40, authoredFinger: null },
        { stepIndex: 0, onset: 0, midi: 47, authoredFinger: null },
      ],
      'L',
    );
    expect(fingers).toEqual([4, 1]);
  });

  it('fingers a right-hand perfect fifth from the bottom', () => {
    const fingers = assignChordFingers(
      [
        { stepIndex: 0, onset: 0, midi: 60, authoredFinger: null },
        { stepIndex: 0, onset: 0, midi: 67, authoredFinger: null },
      ],
      'R',
    );
    expect(fingers).toEqual([1, 4]);
  });
});

describe('assignChordFingers', () => {
  it('triads are distinct with every note fingered', () => {
    const triad: NoteEvent[] = [
      { stepIndex: 0, onset: 0, midi: 60, authoredFinger: null },
      { stepIndex: 0, onset: 0, midi: 64, authoredFinger: null },
      { stepIndex: 0, onset: 0, midi: 67, authoredFinger: null },
    ];
    const right = assignChordFingers(triad, 'R');
    const left = assignChordFingers(triad, 'L');
    expect(new Set(right).size).toBe(3);
    expect(new Set(left).size).toBe(3);
    expect(right.every((finger) => finger !== null)).toBe(true);
    expect(left.every((finger) => finger !== null)).toBe(true);
  });
});

describe('block-chord progressions stay distinct', () => {
  it('keeps every RH chord distinct without collapsing', () => {
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

    for (let chordIndex = 0; chordIndex < chords.length; chordIndex += 1) {
      const slice = fingers.slice(chordIndex * 3, chordIndex * 3 + 3);
      expect(slice.every((finger) => finger !== null)).toBe(true);
      expect(new Set(slice).size).toBe(3);
    }
  });
});

describe('fingering stays consistent across a whole piece', () => {
  it('a wide ascending melody never collapses onto a single finger', () => {
    const midis = [
      60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84,
    ];
    const fingers = fingerTimeline(eventsFromMidis(midis), 'R', 1);
    expect(fingers.every((finger) => finger === 5)).toBe(false);
    expect(noConsecutiveRepeats(fingers)).toBe(true);
    expect(new Set(fingers.slice(0, 8)).size).toBeGreaterThan(2);
  });

  it('repeats the same perfect-fifth dyad with the same fingers throughout', () => {
    const events: NoteEvent[] = [];
    for (let step = 0; step < 6; step += 1) {
      events.push({ stepIndex: step, onset: step * 480, midi: 48, authoredFinger: null });
      events.push({ stepIndex: step, onset: step * 480, midi: 55, authoredFinger: null });
    }
    const fingers = fingerTimeline(events, 'L', 1);
    const lowFingers = fingers.filter((_, index) => index % 2 === 0);
    const highFingers = fingers.filter((_, index) => index % 2 === 1);
    expect(new Set(lowFingers).size).toBe(1);
    expect(new Set(highFingers).size).toBe(1);
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
