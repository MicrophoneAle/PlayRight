import type {
  Finger,
  Hand,
  ManualFingeringMap,
  ManualHandOverrideMap,
  PlaybackScript,
  ScriptNote,
} from '../types/index.ts';
import {
  fingeringKey,
  manualHandOverrideKey,
  resolveManualAssignment,
} from '../types/index.ts';
import { getMLFingerCosts } from './aiFingeringInference.ts';

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

/** Maximum hand-frame span before starting a new fingering phrase (major 10th). */
export const PHRASE_MAX_FRAME_SPAN = 17;

/** @deprecated Use PHRASE_MAX_FRAME_SPAN bounding-box segmentation instead. */
export const PHRASE_LARGE_LEAP_SEMITONES = 12;

/** Break a phrase after this many consecutive monophonic steps in one direction. */
export const PHRASE_MAX_DIRECTIONAL_RUN = 5;

/**
 * Split when consecutive onsets for this hand are separated by at least this many
 * MusicXML divisions (one quarter note when divisions=480).
 */
export const PHRASE_MIN_ONSET_GAP_DIVISIONS = 480;

function groupTimelineOnsets(timeline: NoteEvent[]): NoteEvent[][] {
  if (timeline.length === 0) {
    return [];
  }

  const onsetGroups: NoteEvent[][] = [[timeline[0]]];

  for (let index = 1; index < timeline.length; index += 1) {
    const event = timeline[index];
    const current = onsetGroups[onsetGroups.length - 1];

    if (event.stepIndex === current[0].stepIndex) {
      current.push(event);
    } else {
      onsetGroups.push([event]);
    }
  }

  return onsetGroups;
}

function onsetGroupSpan(
  minMidi: number,
  maxMidi: number,
  group: NoteEvent[],
): number {
  let groupMin = minMidi;
  let groupMax = maxMidi;

  for (const event of group) {
    groupMin = Math.min(groupMin, event.midi);
    groupMax = Math.max(groupMax, event.midi);
  }

  return groupMax - groupMin;
}

function monophonicContourMidi(group: NoteEvent[]): number | null {
  return group.length === 1 ? group[0].midi : null;
}

export function segmentIntoPhrases(timeline: NoteEvent[]): NoteEvent[][] {
  if (timeline.length === 0) {
    return [];
  }

  const onsetGroups = groupTimelineOnsets(timeline);
  if (onsetGroups.length === 1) {
    return [timeline];
  }

  const phrases: NoteEvent[][] = [];
  let phraseGroups: NoteEvent[][] = [onsetGroups[0]];
  let minMidi = Math.min(...onsetGroups[0].map((event) => event.midi));
  let maxMidi = Math.max(...onsetGroups[0].map((event) => event.midi));

  let contourDirection: 'up' | 'down' | null = null;
  let directionalRun = 0;
  let lastContourMidi: number | null = monophonicContourMidi(onsetGroups[0]);

  const startNewPhrase = (fromIndex: number): void => {
    phrases.push(phraseGroups.flat());
    phraseGroups = [onsetGroups[fromIndex]];
    minMidi = Math.min(...onsetGroups[fromIndex].map((event) => event.midi));
    maxMidi = Math.max(...onsetGroups[fromIndex].map((event) => event.midi));
    contourDirection = null;
    directionalRun = 0;
    lastContourMidi = monophonicContourMidi(onsetGroups[fromIndex]);
  };

  for (let index = 1; index < onsetGroups.length; index += 1) {
    const next = onsetGroups[index];
    const previous = onsetGroups[index - 1];
    const onsetGap = next[0].onset - previous[0].onset;
    const expandedSpan = onsetGroupSpan(minMidi, maxMidi, next);
    const exceedsFrame = expandedSpan > PHRASE_MAX_FRAME_SPAN;
    const exceedsRestGap = onsetGap >= PHRASE_MIN_ONSET_GAP_DIVISIONS;

    const nextContourMidi = monophonicContourMidi(next);
    let exceedsDirectionalRun = false;

    if (nextContourMidi !== null && lastContourMidi !== null) {
      const stepDirection: 'up' | 'down' =
        nextContourMidi > lastContourMidi ? 'up' : 'down';

      if (nextContourMidi === lastContourMidi) {
        // Repeated pitch does not advance the directional run.
      } else if (stepDirection !== contourDirection) {
        contourDirection = stepDirection;
        directionalRun = 1;
      } else {
        directionalRun += 1;
        if (directionalRun > PHRASE_MAX_DIRECTIONAL_RUN) {
          exceedsDirectionalRun = true;
        }
      }
    }

    if (next.length > 1) {
      contourDirection = null;
      directionalRun = 0;
    }

    if (exceedsFrame || exceedsRestGap || exceedsDirectionalRun) {
      startNewPhrase(index);
      continue;
    }

    phraseGroups.push(next);
    for (const event of next) {
      minMidi = Math.min(minMidi, event.midi);
      maxMidi = Math.max(maxMidi, event.midi);
    }

    if (nextContourMidi !== null) {
      lastContourMidi = nextContourMidi;
    }
  }

  phrases.push(phraseGroups.flat());
  return phrases;
}

/** Ideal right-hand pitch distance in semitones (lower finger ΓåÆ higher finger). */
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
export const CONSECUTIVE_SAME_FINGER_PENALTY = 50_000;
export const LEGAL_CROSSING_COST = 1.0;
export const CONTRACTION_BASE = 5.0;
export const CONTRACTION_PER_SEMITONE = 0.5;
export const INNER_FINGER_RETREAT_PENALTY = 150;
export const WEAK_FINGER_PENALTY = 0.5;
export const THUMB_ON_BLACK_PENALTY = 1.5;
export const PHRASE_START_BIAS = 1.5;
export const REGISTER_BIAS_WEIGHT = 0.9;
export const HIGH_REGISTER_MIDI_RH = 76;
export const LOW_REGISTER_MIDI_LH = 48;
export const REPEAT_PITCH_FINGER_MISMATCH = 5;
export const RETURNING_PITCH_FINGER_MISMATCH = 2000;
export const OCTAVE_PAIR_BONUS = 2.5;
export const OPEN_FRAME_PAIR_BONUS = 250;
export const GAP_DEVIATION_PENALTY_SCALE = 100;

/** Resting midi per finger with thumb on middle C (C4). */
export const HOME_POSITION: Record<Hand, Record<Finger, number>> = {
  R: { 1: 60, 2: 62, 3: 64, 4: 65, 5: 67 },
  L: { 1: 60, 2: 59, 3: 57, 4: 55, 5: 53 },
};

/** Cost per semitone between a finger's home key and the phrase-opening note. */
export const HOME_START_WEIGHT = 0.4;

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

/** Tiered ideal finger gap from semitone distance (1ΓÇô4ΓåÆ1, 5ΓÇô8ΓåÆ2, 9ΓÇô11ΓåÆ3, 12+ΓåÆ4). */
export function preferredIdealFingerGap(absInterval: number): number {
  if (absInterval <= 0) {
    return 0;
  }

  if (absInterval <= 4) {
    return 1;
  }

  if (absInterval <= 8) {
    return 2;
  }

  if (absInterval <= 11) {
    return 3;
  }

  return 4;
}

function gapDeviationPenalty(fingerGap: number, idealGap: number): number {
  if (idealGap === 0) {
    return 0;
  }

  return Math.pow(Math.abs(fingerGap - idealGap), 3) * GAP_DEVIATION_PENALTY_SCALE;
}

function isLegalCrossing(
  hand: Hand,
  fPrev: Finger,
  fCur: Finger,
  actuallyAscending: boolean,
): boolean {
  const thumbUnder =
    hand === 'R'
      ? fCur === 1 && actuallyAscending && fPrev >= 3
      : fPrev === 1 && !actuallyAscending && fCur >= 3;
  const fingerOver =
    hand === 'R'
      ? fPrev === 1 && !actuallyAscending && fCur >= 3
      : fCur === 1 && actuallyAscending && fPrev >= 3;
  return thumbUnder || fingerOver;
}

function openFramePairBonus(
  fPrev: Finger,
  fCur: Finger,
  absInterval: number,
): number {
  if (absInterval !== 7 && absInterval !== 12) {
    return 0;
  }

  const lo = Math.min(fPrev, fCur);
  const hi = Math.max(fPrev, fCur);
  if (lo === 1 && hi === 5) {
    return OPEN_FRAME_PAIR_BONUS;
  }

  return 0;
}

export function transitionCost(
  hand: Hand,
  fPrev: Finger,
  pPrev: number,
  fCur: Finger,
  pCur: number,
  _spanScale = 1,
): number {
  const interval = signedInterval(hand, pPrev, pCur);
  const absInterval = Math.abs(interval);
  const fingerGap = Math.abs(fCur - fPrev);
  const idealGap = preferredIdealFingerGap(absInterval);

  if (fCur === fPrev) {
    return absInterval === 0
      ? SAME_FINGER_REPEATED_COST
      : CONSECUTIVE_SAME_FINGER_PENALTY;
  }

  const expectedAscending = fCur > fPrev;
  const actuallyAscending = interval > 0;
  let cost = gapDeviationPenalty(fingerGap, idealGap);

  if (expectedAscending !== actuallyAscending && interval !== 0) {
    if (isLegalCrossing(hand, fPrev, fCur, actuallyAscending)) {
      cost = LEGAL_CROSSING_COST;
    } else {
      cost += CONTRACTION_BASE + CONTRACTION_PER_SEMITONE * absInterval;
    }
  } else if (
    hand === 'R' &&
    actuallyAscending &&
    fPrev >= 3 &&
    fCur > 1 &&
    fCur < fPrev &&
    absInterval <= 2
  ) {
    cost += INNER_FINGER_RETREAT_PENALTY;
  } else if (
    hand === 'R' &&
    actuallyAscending &&
    fPrev >= 3 &&
    fCur === 4 &&
    absInterval === 1
  ) {
    cost += INNER_FINGER_RETREAT_PENALTY;
  } else if (
    hand === 'L' &&
    !actuallyAscending &&
    fPrev <= 3 &&
    fCur < 5 &&
    fCur > fPrev &&
    absInterval <= 2
  ) {
    cost += INNER_FINGER_RETREAT_PENALTY;
  }

  cost -= openFramePairBonus(fPrev, fCur, absInterval);

  if (absInterval >= 12) {
    const isPreferredOctavePair =
      (hand === 'R' &&
        ((fPrev === 1 && fCur === 5) || (fPrev === 5 && fCur === 1))) ||
      (hand === 'L' &&
        ((fPrev === 5 && fCur === 1) || (fPrev === 1 && fCur === 5)));
    if (isPreferredOctavePair) {
      cost -= OCTAVE_PAIR_BONUS;
    }
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

/** Prefer outer fingers (pinky/thumb) in extreme registers. */
export function registerFingerBias(hand: Hand, finger: Finger, midi: number): number {
  if (hand === 'R' && midi >= HIGH_REGISTER_MIDI_RH) {
    return (5 - finger) * REGISTER_BIAS_WEIGHT;
  }

  if (hand === 'L' && midi <= LOW_REGISTER_MIDI_LH) {
    return (5 - finger) * REGISTER_BIAS_WEIGHT;
  }

  return 0;
}

export function noteFingerCost(hand: Hand, finger: Finger, midi: number): number {
  return localCost(finger, midi) + registerFingerBias(hand, finger, midi);
}

/** Bias the first note of a phrase toward a natural hand position (pinky on high RH, etc.). */
export function phraseStartCost(
  hand: Hand,
  finger: Finger,
  note: NoteEvent,
  phraseNotes: NoteEvent[],
): number {
  if (note.authoredFinger !== null) {
    return 0;
  }

  if (phraseNotes.length === 1) {
    if (hand === 'R') {
      return note.midi >= 72
        ? (5 - finger) * PHRASE_START_BIAS
        : (finger - 1) * PHRASE_START_BIAS;
    }

    return note.midi <= 48
      ? (5 - finger) * PHRASE_START_BIAS
      : (finger - 1) * PHRASE_START_BIAS;
  }

  const nextMidi = phraseNotes[1].midi;
  const interval = signedInterval(hand, note.midi, nextMidi);

  if (hand === 'R') {
    if (interval < 0) {
      return (5 - finger) * PHRASE_START_BIAS;
    }

    if (interval > 0) {
      if (note.midi <= 62) {
        return (finger - 1) * PHRASE_START_BIAS;
      }

      return Math.abs(finger - 2) * PHRASE_START_BIAS;
    }
  } else {
    if (interval > 0) {
      return (5 - finger) * PHRASE_START_BIAS;
    }

    if (interval < 0) {
      return (finger - 1) * PHRASE_START_BIAS;
    }
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

interface DpCell {
  cost: number;
  backFinger: Finger | null;
  firstFingerByMidi: Map<number, Finger>;
}

function copyFirstFingerMap(source: Map<number, Finger>): Map<number, Finger> {
  return new Map(source);
}

export async function fingerPhrase(
  notes: NoteEvent[],
  hand: Hand,
  spanScale = 1,
  startHome?: Record<Finger, number>,
  repeatFinger?: Finger,
): Promise<Finger[]> {
  if (notes.length === 0) {
    return [];
  }

  const mlCosts = await getMLFingerCosts(notes);

  const dp: Partial<Record<Finger, DpCell>>[] = [];

  for (let index = 0; index < notes.length; index += 1) {
    const note = notes[index];
    const allowed = allowedFingers(note);
    const row: Partial<Record<Finger, DpCell>> = {};

    for (const finger of allowed) {
      const aiCost = mlCosts.length > 0 ? mlCosts[index][finger - 1] : 0;

      const local = aiCost + noteFingerCost(hand, finger, note.midi);

      if (index === 0) {
        let cost = local + phraseStartCost(hand, finger, note, notes);
        if (startHome !== undefined) {
          cost +=
            HOME_START_WEIGHT * Math.abs(startHome[finger] - notes[0].midi);
        }
        if (
          repeatFinger !== undefined &&
          note.authoredFinger === null &&
          finger !== repeatFinger
        ) {
          cost += RETURNING_PITCH_FINGER_MISMATCH;
        }
        row[finger] = {
          cost,
          backFinger: null,
          firstFingerByMidi: new Map([[note.midi, finger]]),
        };
        continue;
      }

      const prevAllowed = allowedFingers(notes[index - 1]);
      let bestCell: DpCell | null = null;

      for (const fPrev of prevAllowed) {
        const prevCell = dp[index - 1][fPrev];
        if (prevCell === undefined) {
          continue;
        }

        const transition = transitionCost(
          hand,
          fPrev,
          notes[index - 1].midi,
          finger,
          note.midi,
          spanScale,
        );

        let returningPenalty = 0;
        if (
          note.authoredFinger === null &&
          prevCell.firstFingerByMidi.has(note.midi) &&
          prevCell.firstFingerByMidi.get(note.midi) !== finger
        ) {
          returningPenalty = RETURNING_PITCH_FINGER_MISMATCH;
        }

        const total = prevCell.cost + transition + local + returningPenalty;
        const nextCell: DpCell = {
          cost: total,
          backFinger: fPrev,
          firstFingerByMidi: copyFirstFingerMap(prevCell.firstFingerByMidi),
        };

        if (!nextCell.firstFingerByMidi.has(note.midi)) {
          nextCell.firstFingerByMidi.set(note.midi, finger);
        }

        if (
          bestCell === null ||
          total < bestCell.cost ||
          (total === bestCell.cost && fPrev < (bestCell.backFinger ?? 9))
        ) {
          bestCell = nextCell;
        }
      }

      if (bestCell !== null) {
        row[finger] = bestCell;
      }
    }

    dp.push(row);
  }

  const lastIndex = notes.length - 1;
  const lastCosts: Partial<Record<Finger, number>> = {};
  for (const finger of allowedFingers(notes[lastIndex])) {
    lastCosts[finger] = dp[lastIndex][finger]?.cost ?? Infinity;
  }

  let finger = argminFinger(allowedFingers(notes[lastIndex]), lastCosts);

  const out: Finger[] = new Array(notes.length);
  for (let index = lastIndex; index >= 0; index -= 1) {
    out[index] = finger;
    finger = dp[index][finger]?.backFinger ?? finger;
  }

  return out;
}

function chordIdealFingerGap(midiSpan: number): number {
  const span = Math.abs(midiSpan);
  if (span === 7) {
    return 4;
  }

  if (span <= 2) {
    return 1;
  }

  if (span <= 4) {
    return 2;
  }

  return preferredIdealFingerGap(span);
}

function scoreChordFingerAssignment(
  chord: NoteEvent[],
  fingers: Finger[],
  _spanScale = 1,
): number {
  let cost = 0;

  for (let index = 0; index < fingers.length - 1; index += 1) {
    const midiSpan = chord[index + 1].midi - chord[index].midi;
    const fingerGap = Math.abs(fingers[index + 1] - fingers[index]);
    const idealGap = chordIdealFingerGap(midiSpan);
    cost += gapDeviationPenalty(fingerGap, idealGap);
    cost -= openFramePairBonus(fingers[index], fingers[index + 1], Math.abs(midiSpan));
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

export async function fingerPhraseWithChords(
  phrase: NoteEvent[],
  hand: Hand,
  spanScale = 1,
  startHome?: Record<Finger, number>,
  repeatFinger?: Finger,
): Promise<(Finger | null)[]> {
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
  const solved = await fingerPhrase(
    representatives,
    hand,
    spanScale,
    startHome,
    repeatFinger,
  );

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

function isFingeringAnchor(note: ScriptNote, overrideScore: boolean): boolean {
  if (note.fingerSource === 'manual') {
    return true;
  }

  return !overrideScore && note.fingerSource === 'score';
}

async function predictFingersForHand(
  script: PlaybackScript,
  hand: Hand,
  spanScale: number,
): Promise<(Finger | null)[]> {
  const timeline = extractHandTimelines(script)[hand];
  const phrases = segmentIntoPhrases(timeline);
  const fingers: (Finger | null)[] = [];
  const lastFingerByMidi = new Map<number, Finger>();

  for (let phraseIndex = 0; phraseIndex < phrases.length; phraseIndex += 1) {
    const phrase = phrases[phraseIndex];
    const startHome =
      phraseIndex === 0 ? HOME_POSITION[hand] : undefined;
    const repeatFinger = lastFingerByMidi.get(phrase[0].midi);
    const phraseFingers = await fingerPhraseWithChords(
      phrase,
      hand,
      spanScale,
      startHome,
      repeatFinger,
    );

    phrase.forEach((note, index) => {
      const finger = phraseFingers[index];
      if (finger !== null) {
        lastFingerByMidi.set(note.midi, finger);
      }
    });

    fingers.push(...phraseFingers);
  }

  return fingers;
}

export interface PredictFingeringOptions {
  spanScale?: number;
  /** When true, score-authored fingerings are replaced by prediction; manual always wins. */
  overrideScore?: boolean;
}

export async function predictFingering(
  script: PlaybackScript,
  options: PredictFingeringOptions = {},
): Promise<PlaybackScript> {
  const spanScale = options.spanScale ?? 1;
  const overrideScore = options.overrideScore ?? false;
  const [leftFingers, rightFingers] = await Promise.all([
    predictFingersForHand(script, 'L', spanScale),
    predictFingersForHand(script, 'R', spanScale),
  ]);
  const fingersByHand: Record<Hand, (Finger | null)[]> = {
    L: leftFingers,
    R: rightFingers,
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

        if (isFingeringAnchor(note, overrideScore)) {
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

export function applyManualHandOverrides(
  script: PlaybackScript,
  overrides: ManualHandOverrideMap,
): PlaybackScript {
  if (Object.keys(overrides).length === 0) {
    return script;
  }

  return script.map((step) => ({
    ...step,
    notes: step.notes.map((note) => {
      const overrideHand = overrides[manualHandOverrideKey(step.onset, note.midi)];
      if (overrideHand === undefined) {
        return note;
      }

      return { ...note, hand: overrideHand };
    }),
  }));
}

export function applyManualFingerings(
  script: PlaybackScript,
  overrides: ManualFingeringMap,
): PlaybackScript {
  if (Object.keys(overrides).length === 0) {
    return script;
  }

  return script.map((step) => ({
    ...step,
    notes: step.notes.map((note) => {
      const assignment = resolveManualAssignment(
        step.onset,
        note.hand,
        note.midi,
        overrides,
      );
      if (assignment === null) {
        return note;
      }

      return {
        ...note,
        finger: assignment.finger,
        playingHand: assignment.physicalHand,
        fingerSource: 'manual' as const,
      };
    }),
  }));
}

export function extractManualFingerings(
  script: PlaybackScript,
): ManualFingeringMap {
  const overrides: ManualFingeringMap = {};

  for (const step of script) {
    for (const note of step.notes) {
      if (note.fingerSource === 'manual' && note.finger !== null) {
        const key = fingeringKey(step.onset, note.hand, note.midi);
        const physicalHand = note.playingHand ?? note.hand;
        overrides[key] =
          physicalHand === note.hand
            ? note.finger
            : { finger: note.finger, physicalHand };
      }
    }
  }

  return overrides;
}

export function stripPredictedFingers(script: PlaybackScript): PlaybackScript {
  return script.map((step) => ({
    ...step,
    notes: step.notes.map((note) => {
      if (note.fingerSource !== 'predicted') {
        return note;
      }

      return {
        pitch: note.pitch,
        midi: note.midi,
        hand: note.hand,
        finger: null,
      };
    }),
  }));
}

export async function applyFingeringSettings(
  script: PlaybackScript,
  autoFingering: boolean,
  spanScale: number,
  overrideScore = false,
): Promise<PlaybackScript> {
  return autoFingering
    ? predictFingering(script, { spanScale, overrideScore })
    : stripPredictedFingers(script);
}

export async function prepareScriptWithFingering(
  script: PlaybackScript,
  manualFingerings: ManualFingeringMap,
  autoFingering: boolean,
  spanScale: number,
  overrideScore = false,
  manualHandOverrides: ManualHandOverrideMap = {},
): Promise<PlaybackScript> {
  const withHands = applyManualHandOverrides(script, manualHandOverrides);
  const withManual = applyManualFingerings(withHands, manualFingerings);

  return applyFingeringSettings(withManual, autoFingering, spanScale, overrideScore);
}
