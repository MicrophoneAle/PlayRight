import type {
  Finger,
  Hand,
  ManualFingeringMap,
  PlaybackScript,
  ScriptNote,
} from '../types/index.ts';
import { fingeringKey } from '../types/index.ts';

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

/** Maximum comfortable hand frame span (9th = 14 semitones). */
export const PHRASE_MAX_FRAME_SPAN = 14;

/** @deprecated Use PHRASE_MAX_FRAME_SPAN bounding-box segmentation instead. */
export const PHRASE_LARGE_LEAP_SEMITONES = 12;

/**
 * Split when consecutive onsets for this hand are separated by at least this many
 * MusicXML divisions. Divisions-per-beat is not stored on PlaybackScript; 480 is one
 * quarter note in scores that use the common divisions=480 default.
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

/**
 * Pillar 1: bounding-box phrase segmentation. Break before a note would expand the
 * hand frame beyond PHRASE_MAX_FRAME_SPAN semitones.
 */
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

  for (let index = 1; index < onsetGroups.length; index += 1) {
    const next = onsetGroups[index];
    const previous = onsetGroups[index - 1];
    const onsetGap = next[0].onset - previous[0].onset;
    const expandedSpan = onsetGroupSpan(minMidi, maxMidi, next);

    const exceedsFrame = expandedSpan > PHRASE_MAX_FRAME_SPAN;
    const exceedsRestGap = onsetGap >= PHRASE_MIN_ONSET_GAP_DIVISIONS;

    if (exceedsFrame || exceedsRestGap) {
      phrases.push(phraseGroups.flat());
      phraseGroups = [next];
      minMidi = Math.min(...next.map((event) => event.midi));
      maxMidi = Math.max(...next.map((event) => event.midi));
      continue;
    }

    phraseGroups.push(next);
    for (const event of next) {
      minMidi = Math.min(minMidi, event.midi);
      maxMidi = Math.max(maxMidi, event.midi);
    }
  }

  phrases.push(phraseGroups.flat());
  return phrases;
}

export const IMPOSSIBLE = Infinity;

export const SAME_FINGER_REPEATED_COST = 0;
export const SAME_FINGER_LIFT_BASE = 2;
export const SAME_FINGER_LIFT_PER_SEMITONE = 0.4;
export const DEVIATION_COEFFICIENT = 0.55;
export const LEGAL_CROSSING_COST = 1.0;
export const WEAK_FINGER_PENALTY = 0.5;
export const THUMB_ON_BLACK_PENALTY = 1.5;
export const PHRASE_START_BIAS = 1.5;
export const REGISTER_BIAS_WEIGHT = 1.1;
export const HIGH_REGISTER_MIDI_RH = 76;
export const LOW_REGISTER_MIDI_LH = 48;
export const HIGH_REGISTER_THUMB_PENALTY = 9;
export const REPEAT_PITCH_FINGER_MISMATCH = 6;
export const FRAME_ANCHOR_MISMATCH = 22;
export const MAJOR_SIXTH_GAP2_PENALTY = 2.5;
export const CHORD_MAX_PAIR_SPAN = 4;
export const SCALE_THUMB_UNDER_BONUS = 1.25;
export const MAX_NEIGHBOR_STRETCH_SEMITONES = 5;

/** Resting midi per finger with thumb on middle C (C4). */
export const HOME_POSITION: Record<Hand, Record<Finger, number>> = {
  R: { 1: 60, 2: 62, 3: 64, 4: 65, 5: 67 },
  L: { 1: 60, 2: 59, 3: 57, 4: 55, 5: 53 },
};

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

function isWhiteKey(midi: number): boolean {
  return !isBlackKey(midi);
}

/** Keyboard-adjacent white keys (E–F, B–C at 1 semitone; others at 2). */
export function areAdjacentWhiteKeys(lowerMidi: number, higherMidi: number): boolean {
  if (lowerMidi >= higherMidi) {
    return areAdjacentWhiteKeys(higherMidi, lowerMidi);
  }

  if (!isWhiteKey(lowerMidi) || !isWhiteKey(higherMidi)) {
    return false;
  }

  const span = higherMidi - lowerMidi;
  return span === 1 || span === 2;
}

function isOuterFingerPair(fPrev: Finger, fCur: Finger): boolean {
  return (fPrev === 1 && fCur === 5) || (fPrev === 5 && fCur === 1);
}

function isAwkwardThumbCrossing(
  hand: Hand,
  fPrev: Finger,
  pPrev: number,
  fCur: Finger,
  pCur: number,
  pitchAscending: boolean,
): boolean {
  if (hand === 'R') {
    if (fCur === 1 && pitchAscending && isWhiteKey(pPrev) && isBlackKey(pCur)) {
      return true;
    }

    if (
      fPrev === 1 &&
      !pitchAscending &&
      isWhiteKey(pCur) &&
      isBlackKey(pPrev)
    ) {
      return true;
    }

    return false;
  }

  if (fCur === 1 && !pitchAscending && isWhiteKey(pPrev) && isBlackKey(pCur)) {
    return true;
  }

  if (
    fPrev === 1 &&
    pitchAscending &&
    isWhiteKey(pCur) &&
    isBlackKey(pPrev)
  ) {
    return true;
  }

  return false;
}

function isLegalCrossing(
  hand: Hand,
  fPrev: Finger,
  fCur: Finger,
  pitchAscending: boolean,
): boolean {
  const thumbUnder =
    hand === 'R'
      ? fCur === 1 && pitchAscending
      : fPrev === 1 && !pitchAscending;
  const fingerOver =
    hand === 'R'
      ? fPrev === 1 && !pitchAscending
      : fCur === 1 && pitchAscending;
  return thumbUnder || fingerOver;
}

function motionAligned(
  hand: Hand,
  pitchAscending: boolean,
  fPrev: Finger,
  fCur: Finger,
): boolean {
  const fingerAscending = fCur > fPrev;
  return hand === 'R'
    ? pitchAscending === fingerAscending
    : pitchAscending === !fingerAscending;
}

function gapDeviationCost(fingerGap: number, idealGap: number): number {
  return DEVIATION_COEFFICIENT * Math.abs(fingerGap - idealGap);
}

/**
 * Pillar 3: hard constraints return IMPOSSIBLE; soft preferences return finite cost.
 */
export function transitionCost(
  hand: Hand,
  fPrev: Finger,
  pPrev: number,
  fCur: Finger,
  pCur: number,
  _spanScale = 1,
): number {
  const absInterval = Math.abs(pCur - pPrev);
  const pitchAscending = pCur > pPrev;
  const fingerGap = Math.abs(fCur - fPrev);

  if (fCur === fPrev) {
    if (absInterval === 0) {
      return SAME_FINGER_REPEATED_COST;
    }

    return (
      SAME_FINGER_LIFT_BASE + SAME_FINGER_LIFT_PER_SEMITONE * absInterval
    );
  }

  // Constraint A: octaves and larger must use thumb + pinky.
  if (absInterval >= 12) {
    return isOuterFingerPair(fPrev, fCur) ? 0 : IMPOSSIBLE;
  }

  // Constraint B: adjacent fingers cannot stretch more than 5 semitones.
  if (fingerGap === 1 && absInterval > MAX_NEIGHBOR_STRETCH_SEMITONES) {
    return IMPOSSIBLE;
  }

  if (isLegalCrossing(hand, fPrev, fCur, pitchAscending)) {
    // Constraint D: forbid awkward white-to-black thumb rotations.
    if (isAwkwardThumbCrossing(hand, fPrev, pPrev, fCur, pCur, pitchAscending)) {
      return IMPOSSIBLE;
    }

    const isScaleRotation =
      absInterval === 1 &&
      fingerGap >= 2 &&
      ((hand === 'R' &&
        ((fCur === 1 && pitchAscending) || (fPrev === 1 && !pitchAscending))) ||
        (hand === 'L' &&
          ((fCur === 1 && !pitchAscending) || (fPrev === 1 && pitchAscending))));

    if (isScaleRotation) {
      return LEGAL_CROSSING_COST - SCALE_THUMB_UNDER_BONUS - 0.08 * (fingerGap - 2);
    }

    return LEGAL_CROSSING_COST;
  }

  if (!motionAligned(hand, pitchAscending, fPrev, fCur)) {
    return IMPOSSIBLE;
  }

  // Constraint C: major 6th prefers finger gap 3; gap 2 is allowed with penalty.
  if (absInterval === 9) {
    if (fingerGap === 3) {
      return 0;
    }

    if (fingerGap === 2) {
      return MAJOR_SIXTH_GAP2_PENALTY;
    }

    return IMPOSSIBLE;
  }

  let idealGap = 1;
  if (absInterval <= 2) {
    idealGap = 1;
  } else if (absInterval <= 4) {
    idealGap = 1;
  } else if (absInterval <= 7) {
    idealGap = 2;
  } else if (absInterval <= 11) {
    idealGap = 3;
  }

  if (fingerGap < 1 || fingerGap > 4) {
    return IMPOSSIBLE;
  }

  let cost = gapDeviationCost(fingerGap, idealGap);

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

export function registerFingerBias(hand: Hand, finger: Finger, midi: number): number {
  if (hand === 'R' && midi >= HIGH_REGISTER_MIDI_RH) {
    return (5 - finger) * REGISTER_BIAS_WEIGHT;
  }

  return 0;
}

export function noteFingerCost(hand: Hand, finger: Finger, midi: number): number {
  let cost = localCost(finger, midi) + registerFingerBias(hand, finger, midi);

  if (hand === 'R' && midi >= HIGH_REGISTER_MIDI_RH && finger === 1) {
    cost += HIGH_REGISTER_THUMB_PENALTY;
  }

  return cost;
}

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

    return note.midi <= LOW_REGISTER_MIDI_LH
      ? (finger - 1) * PHRASE_START_BIAS
      : (finger - 1) * PHRASE_START_BIAS;
  }

  const nextMidi = phraseNotes[1].midi;
  const interval = signedInterval(hand, note.midi, nextMidi);

  if (hand === 'R') {
    if (interval < 0) {
      return (5 - finger) * PHRASE_START_BIAS;
    }

    if (interval > 0) {
      return (finger - 1) * PHRASE_START_BIAS;
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

function copyAnchorMap(source: Map<number, Finger>): Map<number, Finger> {
  return new Map(source);
}

interface DpCell {
  cost: number;
  backFinger: Finger | null;
  anchors: Map<number, Finger>;
}

function argminFinger(
  candidates: Finger[],
  costs: Partial<Record<Finger, number>>,
): Finger {
  let best = candidates[0];
  let bestCost = costs[best] ?? IMPOSSIBLE;

  for (let index = 1; index < candidates.length; index += 1) {
    const finger = candidates[index];
    const cost = costs[finger] ?? IMPOSSIBLE;

    if (cost < bestCost || (cost === bestCost && finger < best)) {
      best = finger;
      bestCost = cost;
    }
  }

  return best;
}

/**
 * Pillar 4: DP with per-path frame anchors so returning pitches reuse the same finger.
 */
export function fingerPhrase(
  notes: NoteEvent[],
  hand: Hand,
  spanScale = 1,
  startHome?: Record<Finger, number>,
  repeatFinger?: Finger,
): Finger[] {
  if (notes.length === 0) {
    return [];
  }

  const dp: Partial<Record<Finger, DpCell>>[] = [];

  for (let index = 0; index < notes.length; index += 1) {
    const note = notes[index];
    const allowed = allowedFingers(note);
    const row: Partial<Record<Finger, DpCell>> = {};

    for (const finger of allowed) {
      const local = noteFingerCost(hand, finger, note.midi);

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
          cost += REPEAT_PITCH_FINGER_MISMATCH;
        }

        row[finger] = {
          cost,
          backFinger: null,
          anchors: new Map([[note.midi, finger]]),
        };
        continue;
      }

      const prevAllowed = allowedFingers(notes[index - 1]);
      let bestCell: DpCell | null = null;

      for (const fPrev of prevAllowed) {
        const prevCell = dp[index - 1][fPrev];
        if (prevCell === undefined || !Number.isFinite(prevCell.cost)) {
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

        if (!Number.isFinite(transition)) {
          continue;
        }

        let anchorPenalty = 0;
        if (
          note.authoredFinger === null &&
          prevCell.anchors.has(note.midi) &&
          prevCell.anchors.get(note.midi) !== finger
        ) {
          anchorPenalty = FRAME_ANCHOR_MISMATCH;
        }

        const total = prevCell.cost + transition + local + anchorPenalty;
        const nextCell: DpCell = {
          cost: total,
          backFinger: fPrev,
          anchors: copyAnchorMap(prevCell.anchors),
        };
        nextCell.anchors.set(note.midi, finger);

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
    lastCosts[finger] = dp[lastIndex][finger]?.cost ?? IMPOSSIBLE;
  }

  let finger = argminFinger(allowedFingers(notes[lastIndex]), lastCosts);

  const out: Finger[] = new Array(notes.length);
  for (let index = lastIndex; index >= 0; index -= 1) {
    out[index] = finger;
    finger = dp[index][finger]?.backFinger ?? finger;
  }

  return out;
}

function chordPairCost(
  fLower: Finger,
  fHigher: Finger,
  midiSpan: number,
): number {
  if (midiSpan <= 0) {
    return fLower === fHigher ? 0 : IMPOSSIBLE;
  }

  const fingerGap = Math.abs(fHigher - fLower);

  if (midiSpan >= 12) {
    return isOuterFingerPair(fLower, fHigher) ? 0 : IMPOSSIBLE;
  }

  if (fingerGap === 1 && midiSpan > MAX_NEIGHBOR_STRETCH_SEMITONES) {
    return IMPOSSIBLE;
  }

  if (midiSpan > CHORD_MAX_PAIR_SPAN) {
    return IMPOSSIBLE;
  }

  if (midiSpan === 9) {
    if (fingerGap === 3) {
      return 0;
    }

    if (fingerGap === 2) {
      return MAJOR_SIXTH_GAP2_PENALTY;
    }

    return IMPOSSIBLE;
  }

  let idealGap = 1;
  if (midiSpan <= 2) {
    idealGap = 1;
  } else if (midiSpan <= 4) {
    idealGap = 1;
  } else if (midiSpan <= 7) {
    idealGap = 2;
  } else {
    idealGap = 3;
  }

  if (fingerGap < 1 || fingerGap > 4) {
    return IMPOSSIBLE;
  }

  return gapDeviationCost(fingerGap, idealGap);
}

function isValidChordAssignment(
  chord: NoteEvent[],
  fingers: Finger[],
): boolean {
  const innerCounts = new Map<Finger, number>();
  const thumbIndices: number[] = [];

  for (let index = 0; index < fingers.length; index += 1) {
    const finger = fingers[index];
    if (finger === 1) {
      thumbIndices.push(index);
      continue;
    }

    innerCounts.set(finger, (innerCounts.get(finger) ?? 0) + 1);
    if ((innerCounts.get(finger) ?? 0) > 1) {
      return false;
    }
  }

  if (thumbIndices.length <= 1) {
    return true;
  }

  if (thumbIndices.length > 2) {
    return false;
  }

  const [leftIndex, rightIndex] = thumbIndices;
  return areAdjacentWhiteKeys(
    chord[leftIndex].midi,
    chord[rightIndex].midi,
  );
}

function scoreChordFingerAssignment(chord: NoteEvent[], fingers: Finger[]): number {
  let cost = 0;

  for (let index = 0; index < fingers.length - 1; index += 1) {
    const pairCost = chordPairCost(
      fingers[index],
      fingers[index + 1],
      chord[index + 1].midi - chord[index].midi,
    );

    if (!Number.isFinite(pairCost)) {
      return IMPOSSIBLE;
    }

    cost += pairCost;
  }

  return cost;
}

function satisfiesChordAnchors(chord: NoteEvent[], fingers: Finger[]): boolean {
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

function* generateStrictChordAssignments(
  chord: NoteEvent[],
  hand: Hand,
): Generator<Finger[]> {
  const noteCount = chord.length;

  if (noteCount === 0) {
    return;
  }

  if (noteCount === 1) {
    yield [chord[0].authoredFinger ?? 1];
    return;
  }

  for (const assignment of monotonicChordFingerAssignments(hand, noteCount)) {
    if (isValidChordAssignment(chord, assignment)) {
      yield assignment;
    }
  }

  for (let leftIndex = 0; leftIndex < noteCount - 1; leftIndex += 1) {
    const rightIndex = leftIndex + 1;
    if (!areAdjacentWhiteKeys(chord[leftIndex].midi, chord[rightIndex].midi)) {
      continue;
    }

    for (const base of monotonicChordFingerAssignments(hand, noteCount - 1)) {
      const assignment: Finger[] = [];
      let baseIndex = 0;

      for (let noteIndex = 0; noteIndex < noteCount; noteIndex += 1) {
        if (noteIndex === leftIndex || noteIndex === rightIndex) {
          assignment.push(1);
        } else {
          assignment.push(base[baseIndex]);
          baseIndex += 1;
        }
      }

      if (isValidChordAssignment(chord, assignment)) {
        yield assignment;
      }
    }
  }
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

  const leftSpread = Math.max(...left) - Math.min(...left);
  const rightSpread = Math.max(...right) - Math.min(...right);
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

function assignChordFingersToPlayableNotes(
  chord: NoteEvent[],
  hand: Hand,
): Finger[] {
  let bestAssignment: Finger[] | null = null;
  let bestCost = IMPOSSIBLE;

  for (const assignment of generateStrictChordAssignments(chord, hand)) {
    if (!satisfiesChordAnchors(chord, assignment)) {
      continue;
    }

    const cost = scoreChordFingerAssignment(chord, assignment);
    if (
      Number.isFinite(cost) &&
      (bestAssignment === null ||
        chordAssignmentBeats(assignment, cost, bestAssignment, bestCost))
    ) {
      bestAssignment = assignment;
      bestCost = cost;
    }
  }

  if (bestAssignment === null) {
    for (const assignment of generateStrictChordAssignments(chord, hand)) {
      const cost = scoreChordFingerAssignment(chord, assignment);
      if (
        Number.isFinite(cost) &&
        (bestAssignment === null ||
          chordAssignmentBeats(assignment, cost, bestAssignment, bestCost))
      ) {
        bestAssignment = assignment;
        bestCost = cost;
      }
    }
  }

  if (bestAssignment === null) {
    return monotonicChordFingerAssignments(hand, chord.length).next().value ?? [
      1, 2, 3, 4, 5,
    ].slice(0, chord.length) as Finger[];
  }

  return bestAssignment;
}

function selectPlayableChordIndices(
  chord: NoteEvent[],
  hand: Hand,
): number[] {
  const noteCount = chord.length;
  if (noteCount <= 5) {
    return chord.map((_, index) => index);
  }

  let bestIndices: number[] = [];
  let bestCost = IMPOSSIBLE;

  const choose = (start: number, picked: number[]): void => {
    if (picked.length === 5) {
      const playableNotes = picked.map((index) => chord[index]);
      const assignment = assignChordFingersToPlayableNotes(playableNotes, hand);
      const cost = scoreChordFingerAssignment(playableNotes, assignment);
      const isBetter =
        Number.isFinite(cost) &&
        (cost < bestCost ||
          (cost === bestCost && picked.join(',') < bestIndices.join(',')) ||
          (!Number.isFinite(bestCost) && picked.length > bestIndices.length));

      if (isBetter) {
        bestCost = cost;
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
  return bestIndices.length > 0
    ? bestIndices
    : selectWidestFiveIndices(chord);
}

function selectWidestFiveIndices(chord: NoteEvent[]): number[] {
  const noteCount = chord.length;
  let bestIndices: number[] = [];
  let bestSpan = -1;

  const choose = (start: number, picked: number[]): void => {
    if (picked.length === 5) {
      const span = chord[picked[4]].midi - chord[picked[0]].midi;
      if (span > bestSpan) {
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

function applyThumbOverflowSharing(
  chord: NoteEvent[],
  fingers: (Finger | null)[],
): (Finger | null)[] {
  const result = [...fingers];

  for (let index = 0; index < chord.length; index += 1) {
    if (result[index] !== null) {
      continue;
    }

    for (const partnerIndex of [index - 1, index + 1]) {
      if (partnerIndex < 0 || partnerIndex >= chord.length) {
        continue;
      }

      const partnerFinger = result[partnerIndex];
      if (partnerFinger !== 1) {
        continue;
      }

      if (areAdjacentWhiteKeys(chord[index].midi, chord[partnerIndex].midi)) {
        result[index] = 1;
        break;
      }
    }
  }

  return result;
}

/** Pillar 2: strict chord deduplication with thumb-adjacent-white exception. */
export function assignChordFingers(
  chord: NoteEvent[],
  hand: Hand,
  _spanScale = 1,
): (Finger | null)[] {
  if (chord.length === 0) {
    return [];
  }

  if (chord.length === 1) {
    return [chord[0].authoredFinger];
  }

  if (chord.length > 5) {
    const playableIndices = selectPlayableChordIndices(chord, hand);
    const playableNotes = playableIndices.map((index) => chord[index]);
    const playableFingers = assignChordFingersToPlayableNotes(playableNotes, hand);
    const result: (Finger | null)[] = chord.map(() => null);

    playableIndices.forEach((chordIndex, playableIndex) => {
      result[chordIndex] = playableFingers[playableIndex];
    });

    return applyThumbOverflowSharing(chord, result);
  }

  return assignChordFingersToPlayableNotes(chord, hand);
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
  startHome?: Record<Finger, number>,
  repeatFinger?: Finger,
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
  const solved = fingerPhrase(
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
  const lastFingerByMidi = new Map<number, Finger>();

  for (let phraseIndex = 0; phraseIndex < phrases.length; phraseIndex += 1) {
    const phrase = phrases[phraseIndex];
    const startHome = phraseIndex === 0 ? HOME_POSITION[hand] : undefined;
    const repeatFinger = lastFingerByMidi.get(phrase[0].midi);
    const phraseFingers = fingerPhraseWithChords(
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
      const finger = overrides[fingeringKey(step.onset, note.hand, note.midi)];
      if (finger === undefined) {
        return note;
      }

      return {
        ...note,
        finger,
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
        overrides[fingeringKey(step.onset, note.hand, note.midi)] = note.finger;
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

export function applyFingeringSettings(
  script: PlaybackScript,
  autoFingering: boolean,
  spanScale: number,
): PlaybackScript {
  return autoFingering
    ? predictFingering(script, { spanScale })
    : stripPredictedFingers(script);
}

export function prepareScriptWithFingering(
  script: PlaybackScript,
  manualFingerings: ManualFingeringMap,
  autoFingering: boolean,
  spanScale: number,
): PlaybackScript {
  const withManual = applyManualFingerings(script, manualFingerings);

  return applyFingeringSettings(withManual, autoFingering, spanScale);
}
