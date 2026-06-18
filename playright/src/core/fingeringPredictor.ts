import type { Finger, Hand, PlaybackScript } from '../types/index.ts';

export interface NoteEvent {
  stepIndex: number;
  midi: number;
  authoredFinger: Finger | null;
  /** MusicXML division onset of this note's step (from StepOrder.onset). */
  onset: number;
}

export function extractHandTimelines(
  script: PlaybackScript,
): Record<Hand, NoteEvent[]> {
  const timelines: Record<Hand, NoteEvent[]> = { L: [], R: [] };

  script.forEach((step, stepIndex) => {
    for (const note of step.notes) {
      const authoredFinger =
        note.fingerSource === 'score' || note.fingerSource === 'manual'
          ? note.finger
          : null;

      timelines[note.hand].push({
        stepIndex,
        midi: note.midi,
        authoredFinger,
        onset: step.onset,
      });
    }
  });

  const compareEvents = (left: NoteEvent, right: NoteEvent): number =>
    left.stepIndex - right.stepIndex || left.midi - right.midi;

  timelines.L.sort(compareEvents);
  timelines.R.sort(compareEvents);

  return timelines;
}

/**
 * Split between consecutive onsets when the hand must reposition across a wide leap.
 * Conservative default — wide melodic motion within a phrase is left to the cost model.
 */
export const PHRASE_LARGE_LEAP_SEMITONES = 12;

/**
 * Split when consecutive onsets for this hand are separated by at least this many
 * MusicXML divisions. Divisions-per-beat is not stored on PlaybackScript; 480 is one
 * quarter note in scores that use the common divisions=480 default.
 * Rest-based segmentation is deferred: rests advance parse time but are not represented
 * on PlaybackScript, so only inter-onset gap is used here.
 */
export const PHRASE_MIN_ONSET_GAP_DIVISIONS = 480;

export function segmentIntoPhrases(timeline: NoteEvent[]): NoteEvent[][] {
  if (timeline.length === 0) {
    return [];
  }

  const onsetGroups: NoteEvent[][] = [];
  let currentGroup: NoteEvent[] = [timeline[0]];

  for (let index = 1; index < timeline.length; index += 1) {
    const event = timeline[index];
    if (event.stepIndex === currentGroup[0].stepIndex) {
      currentGroup.push(event);
      continue;
    }

    onsetGroups.push(currentGroup);
    currentGroup = [event];
  }

  onsetGroups.push(currentGroup);

  if (onsetGroups.length === 1) {
    return [timeline];
  }

  const phrases: NoteEvent[][] = [];
  let phraseGroups: NoteEvent[][] = [onsetGroups[0]];

  for (let index = 1; index < onsetGroups.length; index += 1) {
    const previous = onsetGroups[index - 1];
    const next = onsetGroups[index];
    const previousLastMidi = previous[previous.length - 1].midi;
    const nextFirstMidi = next[0].midi;
    const leap = Math.abs(nextFirstMidi - previousLastMidi);
    const onsetGap = next[0].onset - previous[0].onset;

    const shouldSplit =
      leap >= PHRASE_LARGE_LEAP_SEMITONES ||
      onsetGap >= PHRASE_MIN_ONSET_GAP_DIVISIONS;

    if (shouldSplit) {
      phrases.push(phraseGroups.flat());
      phraseGroups = [next];
    } else {
      phraseGroups.push(next);
    }
  }

  phrases.push(phraseGroups.flat());

  return phrases;
}

/** Ideal right-hand pitch distance in semitones (lower finger → higher finger). */
export const IDEAL: Record<string, number> = {
  '1-2': 4,
  '1-3': 7,
  '1-4': 9,
  '1-5': 12,
  '2-3': 2,
  '2-4': 4,
  '2-5': 7,
  '3-4': 2,
  '3-5': 4,
  '4-5': 2,
};

export const SAME_FINGER_REPEATED_COST = 0;
export const SAME_FINGER_LIFT_BASE = 2;
export const SAME_FINGER_LIFT_PER_SEMITONE = 0.4;
export const DEVIATION_COEFFICIENT = 0.6;
export const LEGAL_CROSSING_COST = 1.0;
export const CONTRACTION_BASE = 5.0;
export const CONTRACTION_PER_SEMITONE = 0.5;
export const WEAK_FINGER_PENALTY = 0.5;
export const THUMB_ON_BLACK_PENALTY = 1.5;

const FINGERS: Finger[] = [1, 2, 3, 4, 5];

const BLACK_KEY_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

function signedInterval(hand: Hand, pPrev: number, pCur: number): number {
  return hand === 'L' ? pPrev - pCur : pCur - pPrev;
}

function allowedFingers(note: NoteEvent): Finger[] {
  return note.authoredFinger !== null ? [note.authoredFinger] : FINGERS;
}

function isBlackKey(midi: number): boolean {
  return BLACK_KEY_PITCH_CLASSES.has(midi % 12);
}

function idealDistance(fPrev: Finger, fCur: Finger): number {
  const lo = Math.min(fPrev, fCur) as Finger;
  const hi = Math.max(fPrev, fCur) as Finger;
  const magnitude = IDEAL[`${lo}-${hi}`];
  return fCur > fPrev ? magnitude : -magnitude;
}

function isLegalCrossing(
  hand: Hand,
  fPrev: Finger,
  fCur: Finger,
  actuallyAscending: boolean,
): boolean {
  const thumbUnder =
    hand === 'R'
      ? fCur === 1 && actuallyAscending
      : fPrev === 1 && !actuallyAscending;
  const fingerOver =
    hand === 'R'
      ? fPrev === 1 && !actuallyAscending
      : fCur === 1 && actuallyAscending;
  return thumbUnder || fingerOver;
}

export function transitionCost(
  hand: Hand,
  fPrev: Finger,
  pPrev: number,
  fCur: Finger,
  pCur: number,
): number {
  const interval = signedInterval(hand, pPrev, pCur);

  if (fCur === fPrev) {
    if (interval === 0) {
      return SAME_FINGER_REPEATED_COST;
    }

    return (
      SAME_FINGER_LIFT_BASE + SAME_FINGER_LIFT_PER_SEMITONE * Math.abs(interval)
    );
  }

  const ideal = idealDistance(fPrev, fCur);
  const expectedAscending = fCur > fPrev;
  const actuallyAscending = interval > 0;

  let cost = 0;

  if (expectedAscending === actuallyAscending || interval === 0) {
    const deviation = Math.abs(interval - ideal);
    cost += DEVIATION_COEFFICIENT * deviation;
  } else if (isLegalCrossing(hand, fPrev, fCur, actuallyAscending)) {
    cost += LEGAL_CROSSING_COST;
  } else {
    cost += CONTRACTION_BASE + CONTRACTION_PER_SEMITONE * Math.abs(interval);
  }

  if ((fPrev === 4 && fCur === 5) || (fPrev === 5 && fCur === 4)) {
    cost += WEAK_FINGER_PENALTY;
  }

  return cost;
}

export function localCost(finger: Finger, midi: number): number {
  if (finger === 1 && isBlackKey(midi)) {
    return THUMB_ON_BLACK_PENALTY;
  }

  return 0;
}

function argminFinger(
  candidates: Finger[],
  costs: Partial<Record<Finger, number>>,
): Finger {
  let best = candidates[0];
  let bestCost = costs[best] ?? Infinity;

  for (let index = 1; index < candidates.length; index += 1) {
    const finger = candidates[index];
    const cost = costs[finger] ?? Infinity;

    if (cost < bestCost || (cost === bestCost && finger < best)) {
      best = finger;
      bestCost = cost;
    }
  }

  return best;
}

export function fingerPhrase(notes: NoteEvent[], hand: Hand): Finger[] {
  if (notes.length === 0) {
    return [];
  }

  const dp: Partial<Record<Finger, number>>[] = [];
  const back: Partial<Record<Finger, Finger | null>>[] = [];

  for (let index = 0; index < notes.length; index += 1) {
    const note = notes[index];
    const allowed = allowedFingers(note);
    const row: Partial<Record<Finger, number>> = {};
    const backRow: Partial<Record<Finger, Finger | null>> = {};

    for (const finger of allowed) {
      const local = localCost(finger, note.midi);

      if (index === 0) {
        row[finger] = local;
        backRow[finger] = null;
        continue;
      }

      const prevAllowed = allowedFingers(notes[index - 1]);
      let best = Infinity;
      let bestPrev: Finger | null = null;

      for (const fPrev of prevAllowed) {
        const total =
          (dp[index - 1][fPrev] ?? Infinity) +
          transitionCost(hand, fPrev, notes[index - 1].midi, finger, note.midi) +
          local;

        if (
          total < best ||
          (total === best && fPrev < (bestPrev ?? Infinity))
        ) {
          best = total;
          bestPrev = fPrev;
        }
      }

      row[finger] = best;
      backRow[finger] = bestPrev;
    }

    dp.push(row);
    back.push(backRow);
  }

  const lastIndex = notes.length - 1;
  let finger = argminFinger(
    allowedFingers(notes[lastIndex]),
    dp[lastIndex],
  );

  const out: Finger[] = new Array(notes.length);
  for (let index = lastIndex; index >= 0; index -= 1) {
    out[index] = finger;
    finger = back[index][finger] ?? finger;
  }

  return out;
}
