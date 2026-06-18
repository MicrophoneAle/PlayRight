import type { Finger, Hand, PlaybackScript, ScriptNote } from '../types/index.ts';

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
  spanScale = 1,
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

  const ideal = idealDistance(fPrev, fCur) * spanScale;
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

export function fingerPhrase(
  notes: NoteEvent[],
  hand: Hand,
  spanScale = 1,
): Finger[] {
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
          transitionCost(
            hand,
            fPrev,
            notes[index - 1].midi,
            finger,
            note.midi,
            spanScale,
          ) +
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

function chordPairDeviation(
  fLower: Finger,
  fHigher: Finger,
  midiSpan: number,
  spanScale = 1,
): number {
  const lo = Math.min(fLower, fHigher);
  const hi = Math.max(fLower, fHigher);
  const ideal = IDEAL[`${lo}-${hi}`] * spanScale;
  return Math.abs(midiSpan - ideal);
}

function scoreChordFingerAssignment(
  chord: NoteEvent[],
  fingers: Finger[],
  spanScale = 1,
): number {
  let cost = 0;

  for (let index = 0; index < fingers.length - 1; index += 1) {
    const midiSpan = chord[index + 1].midi - chord[index].midi;
    cost += chordPairDeviation(
      fingers[index],
      fingers[index + 1],
      midiSpan,
      spanScale,
    );
  }

  return cost;
}

function chordFingerSpread(fingers: Finger[]): number {
  return Math.max(...fingers) - Math.min(...fingers);
}

function chordAssignmentBeats(
  left: Finger[],
  leftCost: number,
  right: Finger[],
  rightCost: number,
): boolean {
  if (leftCost !== rightCost) {
    return leftCost < rightCost;
  }

  const leftSpread = chordFingerSpread(left);
  const rightSpread = chordFingerSpread(right);
  if (leftSpread !== rightSpread) {
    return leftSpread < rightSpread;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] < right[index];
    }
  }

  return false;
}

function satisfiesChordAnchors(
  chord: NoteEvent[],
  fingers: Finger[],
): boolean {
  for (let index = 0; index < chord.length; index += 1) {
    const anchor = chord[index].authoredFinger;
    if (anchor !== null && fingers[index] !== anchor) {
      return false;
    }
  }

  return true;
}

function* monotonicChordFingerAssignments(
  hand: Hand,
  count: number,
): Generator<Finger[]> {
  if (count <= 0 || count > 5) {
    return;
  }

  function* build(
    nextFinger: number,
    remaining: number,
    assignment: Finger[],
  ): Generator<Finger[]> {
    if (remaining === 0) {
      yield [...assignment] as Finger[];
      return;
    }

    if (hand === 'R') {
      for (let finger = nextFinger; finger <= 5 - remaining + 1; finger += 1) {
        assignment.push(finger as Finger);
        yield* build(finger + 1, remaining - 1, assignment);
        assignment.pop();
      }
      return;
    }

    for (let finger = nextFinger; finger >= remaining; finger -= 1) {
      assignment.push(finger as Finger);
      yield* build(finger - 1, remaining - 1, assignment);
      assignment.pop();
    }
  }

  yield* build(hand === 'R' ? 1 : 5, count, []);
}

function selectBestFiveChordIndices(chord: NoteEvent[]): number[] {
  const noteCount = chord.length;
  let bestIndices: number[] = [];
  let bestSpan = -1;

  const choose = (start: number, picked: number[]): void => {
    if (picked.length === 5) {
      const span = chord[picked[4]].midi - chord[picked[0]].midi;
      const isBetter =
        span > bestSpan ||
        (span === bestSpan &&
          picked.join(',') < bestIndices.join(','));

      if (isBetter) {
        bestSpan = span;
        bestIndices = [...picked];
      }
      return;
    }

    for (
      let index = start;
      index <= noteCount - (5 - picked.length);
      index += 1
    ) {
      picked.push(index);
      choose(index + 1, picked);
      picked.pop();
    }
  };

  choose(0, []);
  return bestIndices;
}

function assignChordFingersToPlayableNotes(
  chord: NoteEvent[],
  hand: Hand,
  spanScale = 1,
): Finger[] {
  let bestAssignment: Finger[] | null = null;
  let bestCost = Infinity;

  for (const assignment of monotonicChordFingerAssignments(hand, chord.length)) {
    if (!satisfiesChordAnchors(chord, assignment)) {
      continue;
    }

    const cost = scoreChordFingerAssignment(chord, assignment, spanScale);
    if (
      bestAssignment === null ||
      chordAssignmentBeats(assignment, cost, bestAssignment, bestCost)
    ) {
      bestAssignment = assignment;
      bestCost = cost;
    }
  }

  if (bestAssignment === null) {
    for (const assignment of monotonicChordFingerAssignments(hand, chord.length)) {
      const cost = scoreChordFingerAssignment(chord, assignment, spanScale);
      if (
        bestAssignment === null ||
        chordAssignmentBeats(assignment, cost, bestAssignment, bestCost)
      ) {
        bestAssignment = assignment;
        bestCost = cost;
      }
    }
  }

  if (bestAssignment === null) {
    return chord.map((_, index) => (index + 1) as Finger);
  }

  return bestAssignment;
}

export function assignChordFingers(
  chord: NoteEvent[],
  hand: Hand,
  spanScale = 1,
): (Finger | null)[] {
  if (chord.length === 0) {
    return [];
  }

  if (chord.length === 1) {
    return [chord[0].authoredFinger];
  }

  if (chord.length > 5) {
    const playableIndices = selectBestFiveChordIndices(chord);
    const playableNotes = playableIndices.map((index) => chord[index]);
    const playableFingers = assignChordFingersToPlayableNotes(
      playableNotes,
      hand,
      spanScale,
    );
    const result: (Finger | null)[] = chord.map(() => null);

    playableIndices.forEach((chordIndex, playableIndex) => {
      result[chordIndex] = playableFingers[playableIndex];
    });

    return result;
  }

  return assignChordFingersToPlayableNotes(chord, hand, spanScale);
}

function groupPhraseOnsets(phrase: NoteEvent[]): NoteEvent[][] {
  const onsets: NoteEvent[][] = [];
  let current: NoteEvent[] = [phrase[0]];

  for (let index = 1; index < phrase.length; index += 1) {
    const event = phrase[index];
    if (event.stepIndex === current[0].stepIndex) {
      current.push(event);
      continue;
    }

    onsets.push(current);
    current = [event];
  }

  onsets.push(current);
  return onsets;
}

export function fingerPhraseWithChords(
  phrase: NoteEvent[],
  hand: Hand,
  spanScale = 1,
): (Finger | null)[] {
  if (phrase.length === 0) {
    return [];
  }

  const onsets = groupPhraseOnsets(phrase);
  const chordFingersByStep = new Map<number, (Finger | null)[]>();
  const onsetNotesByStep = new Map<number, NoteEvent[]>();
  const representatives: NoteEvent[] = [];

  for (const onset of onsets) {
    const stepIndex = onset[0].stepIndex;
    onsetNotesByStep.set(stepIndex, onset);

    if (onset.length === 1) {
      representatives.push(onset[0]);
      continue;
    }

    const chordFingers = assignChordFingers(onset, hand, spanScale);
    chordFingersByStep.set(stepIndex, chordFingers);

    const representativeIndex = hand === 'R' ? onset.length - 1 : 0;
    const representative = onset[representativeIndex];

    representatives.push({
      stepIndex: representative.stepIndex,
      midi: representative.midi,
      authoredFinger: chordFingers[representativeIndex],
      onset: representative.onset,
    });
  }

  const solvedByStep = new Map<number, Finger>();
  const solved = fingerPhrase(representatives, hand, spanScale);

  representatives.forEach((representative, index) => {
    solvedByStep.set(representative.stepIndex, solved[index]);
  });

  return phrase.map((note) => {
    const chordFingers = chordFingersByStep.get(note.stepIndex);
    if (chordFingers) {
      const onsetNotes = onsetNotesByStep.get(note.stepIndex) ?? [];
      const noteIndex = onsetNotes.findIndex(
        (onsetNote) => onsetNote.midi === note.midi,
      );
      return noteIndex >= 0 ? chordFingers[noteIndex] : null;
    }

    return solvedByStep.get(note.stepIndex) ?? null;
  });
}

const HANDS: Hand[] = ['L', 'R'];

function isFingeringAnchor(note: ScriptNote): boolean {
  return note.fingerSource === 'score' || note.fingerSource === 'manual';
}

function predictFingersForHand(
  script: PlaybackScript,
  hand: Hand,
  spanScale: number,
): (Finger | null)[] {
  const timeline = extractHandTimelines(script)[hand];
  const phrases = segmentIntoPhrases(timeline);
  const fingers: (Finger | null)[] = [];

  for (const phrase of phrases) {
    fingers.push(...fingerPhraseWithChords(phrase, hand, spanScale));
  }

  return fingers;
}

export interface PredictFingeringOptions {
  spanScale?: number;
}

export function predictFingering(
  script: PlaybackScript,
  options: PredictFingeringOptions = {},
): PlaybackScript {
  const spanScale = options.spanScale ?? 1;
  const fingersByHand: Record<Hand, (Finger | null)[]> = {
    L: predictFingersForHand(script, 'L', spanScale),
    R: predictFingersForHand(script, 'R', spanScale),
  };
  const cursor: Record<Hand, number> = { L: 0, R: 0 };

  return script.map((step) => {
    const noteUpdates = new Map<number, ScriptNote>();

    for (const hand of HANDS) {
      const indexedNotes = step.notes
        .map((note, index) => ({ note, index }))
        .filter(({ note }) => note.hand === hand)
        .sort((left, right) => left.note.midi - right.note.midi);

      for (const { note, index } of indexedNotes) {
        const predicted = fingersByHand[hand][cursor[hand]];
        cursor[hand] += 1;

        if (isFingeringAnchor(note)) {
          noteUpdates.set(index, { ...note });
        } else if (predicted === null) {
          noteUpdates.set(index, {
            pitch: note.pitch,
            midi: note.midi,
            hand: note.hand,
            finger: null,
          });
        } else {
          noteUpdates.set(index, {
            ...note,
            finger: predicted,
            fingerSource: 'predicted',
          });
        }
      }
    }

    return {
      ...step,
      notes: step.notes.map(
        (note, index) => noteUpdates.get(index) ?? { ...note },
      ),
    };
  });
}
