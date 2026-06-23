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

/** Maximum comfortable hand frame span (major 10th = 16 semitones; allow 17). */
export const PHRASE_MAX_FRAME_SPAN = 17;

/** Phrase spans at or below this use relaxed gap tiers for returning pitches. */
export const PHRASE_MAJOR_TENTH = 17;

/** @deprecated Use PHRASE_MAX_FRAME_SPAN bounding-box segmentation instead. */
export const PHRASE_LARGE_LEAP_SEMITONES = 12;

/**
 * @deprecated Directional exhaustion splits are disabled; scopes stay as long as the
 * hand frame and rest gaps allow so repeated pitches keep the same finger.
 */
export const PHRASE_MAX_DIRECTIONAL_RUN = 5;

/**
 * Split when consecutive onsets for this hand are separated by at least this many
 * MusicXML divisions (one quarter note when divisions=480).
 */
export const PHRASE_MIN_ONSET_GAP_DIVISIONS = 480;

export const IMPOSSIBLE = Infinity;

export const SAME_FINGER_REPEATED_COST = 0;
export const LEGAL_CROSSING_COST = 1.0;
export const THUMB_ON_BLACK_PENALTY = 1.5;
export const PHRASE_START_BIAS = 1.5;
export const REGISTER_BIAS_WEIGHT = 1.1;
export const HIGH_REGISTER_MIDI_RH = 76;
export const LOW_REGISTER_MIDI_LH = 48;
export const HIGH_REGISTER_THUMB_PENALTY = 9;
export const REPEAT_PITCH_FINGER_MISMATCH = 6;
export const FRAME_ANCHOR_MISMATCH = 100;
export const GAP_DEVIATION_PENALTY_SCALE = 50;
export const SCALE_THUMB_UNDER_BONUS = 1.25;
export const DIRECTIONAL_FRAME_WEIGHT = 1.8;
export const LH_TOP_THUMB_BONUS = 2.0;
export const LH_TOP_THUMB_PENALTY = 3.0;
export const LH_OPEN_HAND_INTERVAL_BONUS = 2.5;
export const LH_CRAMPED_INNER_INTERVAL_PENALTY = 3.0;
export const PHRASE_TOP_THUMB_PENALTY = 14;
export const PHRASE_UPPER_INNER_PENALTY = 5;

export interface FingerGapTier {
  ideal: number;
  min: number;
  max: number;
}

export const HOME_POSITION: Record<Hand, Record<Finger, number>> = {
  R: { 1: 60, 2: 62, 3: 64, 4: 65, 5: 67 },
  L: { 1: 60, 2: 59, 3: 57, 4: 55, 5: 53 },
};

export const HOME_START_WEIGHT = 0.4;

const FINGERS: Finger[] = [1, 2, 3, 4, 5];

const BLACK_KEY_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

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

/**
 * Comfort mapping for first-time / forward motion within a major-10th phrase.
 * 1–3 sem → neighbors | 4–5 → one between | 6–8 → two between | 9–10 → 1↔5 span
 */
export function preferredFingerGapStandard(absInterval: number): FingerGapTier {
  if (absInterval <= 0) {
    return { ideal: 0, min: 0, max: 0 };
  }

  if (absInterval <= 3) {
    return { ideal: 1, min: 1, max: 1 };
  }

  if (absInterval <= 5) {
    return { ideal: 2, min: 2, max: 2 };
  }

  if (absInterval <= 8) {
    return { ideal: 3, min: 3, max: 3 };
  }

  return { ideal: 4, min: 4, max: 4 };
}

/**
 * Relaxed comfort mapping when either pitch was already anchored in the phrase.
 * 1–4 sem → neighbors | 5–8 → one between | 9–11 → two between | 12+ → 1↔5 span
 */
export function preferredFingerGapReturning(absInterval: number): FingerGapTier {
  if (absInterval <= 0) {
    return { ideal: 0, min: 0, max: 0 };
  }

  if (absInterval <= 4) {
    return { ideal: 1, min: 1, max: 1 };
  }

  if (absInterval <= 8) {
    return { ideal: 2, min: 2, max: 2 };
  }

  if (absInterval <= 11) {
    return { ideal: 3, min: 3, max: 3 };
  }

  return { ideal: 4, min: 4, max: 4 };
}

/** Default gap tier (standard comfort mapping). */
export function preferredFingerGap(absInterval: number): FingerGapTier {
  return preferredFingerGapStandard(absInterval);
}

function selectFingerGapTier(
  absInterval: number,
  useReturningMapping: boolean,
): FingerGapTier {
  return useReturningMapping
    ? preferredFingerGapReturning(absInterval)
    : preferredFingerGapStandard(absInterval);
}

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

export type PhraseContour = 'up' | 'down' | 'flat';

export interface PhraseRegisterContext {
  minMidi: number;
  maxMidi: number;
  contour: PhraseContour;
}

export interface ScopeContext {
  minMidi: number;
  maxMidi: number;
  contour: PhraseContour;
}

/**
 * Pillar 3: bounding-box framing and rest gaps only — keep scopes as long as possible.
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

  const startNewPhrase = (fromIndex: number): void => {
    phrases.push(phraseGroups.flat());
    phraseGroups = [onsetGroups[fromIndex]];
    minMidi = Math.min(...onsetGroups[fromIndex].map((event) => event.midi));
    maxMidi = Math.max(...onsetGroups[fromIndex].map((event) => event.midi));
  };

  for (let index = 1; index < onsetGroups.length; index += 1) {
    const next = onsetGroups[index];
    const previous = onsetGroups[index - 1];
    const onsetGap = next[0].onset - previous[0].onset;
    const expandedSpan = onsetGroupSpan(minMidi, maxMidi, next);
    const exceedsFrame = expandedSpan > PHRASE_MAX_FRAME_SPAN;
    const exceedsRestGap = onsetGap >= PHRASE_MIN_ONSET_GAP_DIVISIONS;

    if (exceedsFrame || exceedsRestGap) {
      startNewPhrase(index);
      continue;
    }

    phraseGroups.push(next);
    for (const event of next) {
      minMidi = Math.min(minMidi, event.midi);
      maxMidi = Math.max(maxMidi, event.midi);
    }
  }

  phrases.push(phraseGroups.flat());
  return mergeAdjacentPhrases(phrases);
}

function mergeAdjacentPhrases(phrases: NoteEvent[][]): NoteEvent[][] {
  if (phrases.length <= 1) {
    return phrases;
  }

  const merged: NoteEvent[][] = [phrases[0]];

  for (let index = 1; index < phrases.length; index += 1) {
    const previous = merged[merged.length - 1];
    const current = phrases[index];
    const onsetGap = current[0].onset - previous[previous.length - 1].onset;

    if (onsetGap >= PHRASE_MIN_ONSET_GAP_DIVISIONS) {
      merged.push(current);
      continue;
    }

    let minMidi = previous[0].midi;
    let maxMidi = previous[0].midi;

    for (const event of previous) {
      minMidi = Math.min(minMidi, event.midi);
      maxMidi = Math.max(maxMidi, event.midi);
    }

    for (const event of current) {
      minMidi = Math.min(minMidi, event.midi);
      maxMidi = Math.max(maxMidi, event.midi);
    }

    if (maxMidi - minMidi <= PHRASE_MAX_FRAME_SPAN) {
      merged[merged.length - 1] = [...previous, ...current];
      continue;
    }

    merged.push(current);
  }

  return merged;
}

export function computePhraseRegisterContext(
  notes: NoteEvent[],
): PhraseRegisterContext {
  let minMidi = notes[0].midi;
  let maxMidi = notes[0].midi;

  for (const note of notes) {
    minMidi = Math.min(minMidi, note.midi);
    maxMidi = Math.max(maxMidi, note.midi);
  }

  const firstMidi = notes[0].midi;
  const lastMidi = notes[notes.length - 1].midi;
  let contour: PhraseContour = 'flat';

  if (lastMidi > firstMidi) {
    contour = 'up';
  } else if (lastMidi < firstMidi) {
    contour = 'down';
  }

  return { minMidi, maxMidi, contour };
}

function precomputeScopeContexts(notes: NoteEvent[]): ScopeContext[] {
  if (notes.length === 0) {
    return [];
  }

  const scopes: ScopeContext[] = new Array(notes.length);
  let scopeStart = 0;
  let scopeContour: PhraseContour = 'flat';

  for (let index = 0; index < notes.length; index += 1) {
    if (index > 0) {
      const prevMidi = notes[index - 1].midi;
      const curMidi = notes[index].midi;

      if (curMidi !== prevMidi) {
        const stepContour: PhraseContour = curMidi > prevMidi ? 'up' : 'down';

        if (scopeContour === 'flat') {
          scopeContour = stepContour;
        } else if (stepContour !== scopeContour) {
          scopeStart = index;
          scopeContour = stepContour;
        }
      }
    }

    let minMidi = notes[scopeStart].midi;
    let maxMidi = notes[scopeStart].midi;

    for (let scopeIndex = scopeStart; scopeIndex <= index; scopeIndex += 1) {
      minMidi = Math.min(minMidi, notes[scopeIndex].midi);
      maxMidi = Math.max(maxMidi, notes[scopeIndex].midi);
    }

    for (let scopeIndex = index + 1; scopeIndex < notes.length; scopeIndex += 1) {
      const prevMidi = notes[scopeIndex - 1].midi;
      const curMidi = notes[scopeIndex].midi;

      if (curMidi === prevMidi) {
        minMidi = Math.min(minMidi, curMidi);
        maxMidi = Math.max(maxMidi, curMidi);
        continue;
      }

      const stepContour: PhraseContour = curMidi > prevMidi ? 'up' : 'down';
      if (scopeContour !== 'flat' && stepContour !== scopeContour) {
        break;
      }

      minMidi = Math.min(minMidi, curMidi);
      maxMidi = Math.max(maxMidi, curMidi);
    }

    scopes[index] = {
      minMidi,
      maxMidi,
      contour: scopeContour,
    };
  }

  return scopes;
}

function isScopeRescopePoint(
  index: number,
  scopeContexts: ScopeContext[],
): boolean {
  if (index === 0) {
    return true;
  }

  const previousScope = scopeContexts[index - 1];
  const currentScope = scopeContexts[index];
  return previousScope.contour !== currentScope.contour;
}

/**
 * RH ascending scope: pinky at the top. RH descending: thumb at the bottom.
 * LH: reversed (thumb on top when ascending, pinky on bottom when descending).
 */
export function directionalFrameCost(
  hand: Hand,
  finger: Finger,
  midi: number,
  context: PhraseRegisterContext | ScopeContext,
): number {
  const { minMidi, maxMidi, contour } = context;

  if (maxMidi === minMidi || contour === 'flat') {
    return 0;
  }

  const registerPosition = (midi - minMidi) / (maxMidi - minMidi);

  if (hand === 'R') {
    if (contour === 'up') {
      return registerPosition * (5 - finger) * DIRECTIONAL_FRAME_WEIGHT;
    }

    return (1 - registerPosition) * (finger - 1) * DIRECTIONAL_FRAME_WEIGHT;
  }

  if (contour === 'up') {
    return registerPosition * (finger - 1) * DIRECTIONAL_FRAME_WEIGHT;
  }

  return (1 - registerPosition) * (5 - finger) * DIRECTIONAL_FRAME_WEIGHT;
}

function isOuterFingerPair(fPrev: Finger, fCur: Finger): boolean {
  return (fPrev === 1 && fCur === 5) || (fPrev === 5 && fCur === 1);
}

function isInnerFinger(f: Finger): boolean {
  return f >= 2 && f <= 5;
}

/** Fingers 2–5 must not cross over each other. */
function isInnerFingerCrossing(
  hand: Hand,
  fPrev: Finger,
  fCur: Finger,
  pitchAscending: boolean,
): boolean {
  if (!isInnerFinger(fPrev) || !isInnerFinger(fCur)) {
    return false;
  }

  if (hand === 'R') {
    if (pitchAscending && fCur < fPrev) {
      return true;
    }

    if (!pitchAscending && fCur > fPrev) {
      return true;
    }

    return false;
  }

  if (pitchAscending && fCur > fPrev) {
    return true;
  }

  if (!pitchAscending && fCur < fPrev) {
    return true;
  }

  return false;
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

function gapDeviationPenalty(fingerGap: number, idealGap: number): number {
  return Math.pow(fingerGap - idealGap, 2) * GAP_DEVIATION_PENALTY_SCALE;
}

function isPhysicallyPossibleGap(
  absInterval: number,
  fingerGap: number,
  useReturningMapping = false,
): boolean {
  const { min, max } = selectFingerGapTier(absInterval, useReturningMapping);
  return fingerGap >= min && fingerGap <= max;
}

/**
 * Shared distance-to-gap evaluator for melodic transitions and chord pairs.
 */
export function evaluateFingerPairCost(
  hand: Hand,
  fPrev: Finger,
  pPrev: number,
  fCur: Finger,
  pCur: number,
  useReturningMapping = false,
): number {
  const absInterval = Math.abs(pCur - pPrev);
  const pitchAscending = pCur > pPrev;
  const fingerGap = Math.abs(fCur - fPrev);

  // Pillar 1: consecutive different notes cannot reuse the same finger.
  if (fCur === fPrev) {
    return absInterval === 0 ? SAME_FINGER_REPEATED_COST : IMPOSSIBLE;
  }

  if (isInnerFingerCrossing(hand, fPrev, fCur, pitchAscending)) {
    return IMPOSSIBLE;
  }

  if (absInterval >= 12) {
    return isOuterFingerPair(fPrev, fCur) ? 0 : IMPOSSIBLE;
  }

  if (isLegalCrossing(hand, fPrev, fCur, pitchAscending)) {
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

  const { ideal: idealGap } = selectFingerGapTier(absInterval, useReturningMapping);

  if (!isPhysicallyPossibleGap(absInterval, fingerGap, useReturningMapping)) {
    return IMPOSSIBLE;
  }

  return gapDeviationPenalty(fingerGap, idealGap);
}

export function transitionCost(
  hand: Hand,
  fPrev: Finger,
  pPrev: number,
  fCur: Finger,
  pCur: number,
  _spanScale = 1,
  useReturningMapping = false,
): number {
  return evaluateFingerPairCost(
    hand,
    fPrev,
    pPrev,
    fCur,
    pCur,
    useReturningMapping,
  );
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

function phraseRegisterFingerCost(
  hand: Hand,
  finger: Finger,
  midi: number,
  phraseContext: PhraseRegisterContext,
): number {
  const span = phraseContext.maxMidi - phraseContext.minMidi;
  if (span === 0) {
    return 0;
  }

  const registerT = (midi - phraseContext.minMidi) / span;

  if (hand === 'R') {
    if (registerT >= 0.7) {
      if (finger === 1) {
        return PHRASE_TOP_THUMB_PENALTY;
      }

      if (finger === 2) {
        return PHRASE_UPPER_INNER_PENALTY;
      }

      return (5 - finger) * REGISTER_BIAS_WEIGHT;
    }

    if (registerT >= 0.5 && finger === 1) {
      return HIGH_REGISTER_THUMB_PENALTY;
    }
  }

  if (hand === 'L' && registerT <= 0.3 && finger === 5 && span > 8) {
    return (finger - 3) * REGISTER_BIAS_WEIGHT;
  }

  return 0;
}

export function phraseStartCost(
  hand: Hand,
  finger: Finger,
  note: NoteEvent,
  phraseNotes: NoteEvent[],
  phraseContext?: PhraseRegisterContext,
): number {
  if (note.authoredFinger !== null) {
    return 0;
  }

  const context = phraseContext ?? computePhraseRegisterContext(phraseNotes);
  const span = context.maxMidi - context.minMidi;

  if (span <= PHRASE_MAJOR_TENTH) {
    if (phraseNotes.length === 1 && hand === 'R' && note.midi >= HIGH_REGISTER_MIDI_RH) {
      return (5 - finger) * PHRASE_START_BIAS;
    }

    return Math.abs(finger - 3) * PHRASE_START_BIAS * 0.65;
  }

  return directionalFrameCost(hand, finger, note.midi, context);
}

function phraseHasRepeatedPitch(notes: NoteEvent[]): boolean {
  const seen = new Set<number>();

  for (const note of notes) {
    if (seen.has(note.midi)) {
      return true;
    }

    seen.add(note.midi);
  }

  return false;
}

function repeatedPitchPhraseBias(
  hand: Hand,
  finger: Finger,
  notes: NoteEvent[],
): number {
  if (!phraseHasRepeatedPitch(notes)) {
    return 0;
  }

  if (hand === 'R' && finger === 1) {
    return PHRASE_TOP_THUMB_PENALTY;
  }

  return Math.abs(finger - 3) * PHRASE_START_BIAS * 0.25;
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

/** Pillar 4: Viterbi DP with frame anchors for returning pitches. */
export function fingerPhrase(
  notes: NoteEvent[],
  hand: Hand,
  spanScale = 1,
  startHome?: Record<Finger, number>,
  priorFingerByMidi?: Map<number, Finger>,
): Finger[] {
  if (notes.length === 0) {
    return [];
  }

  const phraseContext = computePhraseRegisterContext(notes);
  const phraseSpan = phraseContext.maxMidi - phraseContext.minMidi;
  const scopeContexts = precomputeScopeContexts(notes);
  const dp: Partial<Record<Finger, DpCell>>[] = [];

  for (let index = 0; index < notes.length; index += 1) {
    const note = notes[index];
    const allowed = allowedFingers(note);
    const row: Partial<Record<Finger, DpCell>> = {};
    const scopeContext = scopeContexts[index];

    for (const finger of allowed) {
      const rescopeCost = isScopeRescopePoint(index, scopeContexts)
        ? directionalFrameCost(hand, finger, note.midi, scopeContext)
        : 0;
      const local =
        noteFingerCost(hand, finger, note.midi) +
        phraseRegisterFingerCost(hand, finger, note.midi, phraseContext) +
        rescopeCost;

      if (index === 0) {
        let cost =
          local +
          phraseStartCost(hand, finger, note, notes, phraseContext) +
          repeatedPitchPhraseBias(hand, finger, notes);

        if (startHome !== undefined) {
          cost +=
            HOME_START_WEIGHT * Math.abs(startHome[finger] - notes[0].midi);
        }

        const priorFinger = priorFingerByMidi?.get(note.midi);
        if (
          priorFinger !== undefined &&
          note.authoredFinger === null &&
          finger !== priorFinger
        ) {
          cost += FRAME_ANCHOR_MISMATCH;
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

        const useReturningMapping =
          phraseSpan <= PHRASE_MAJOR_TENTH &&
          (prevCell.anchors.has(note.midi) ||
            prevCell.anchors.has(notes[index - 1].midi));

        const transition = transitionCost(
          hand,
          fPrev,
          notes[index - 1].midi,
          finger,
          note.midi,
          spanScale,
          useReturningMapping,
        );

        if (!Number.isFinite(transition)) {
          continue;
        }

        if (note.authoredFinger === null) {
          if (prevCell.anchors.has(note.midi)) {
            if (prevCell.anchors.get(note.midi) !== finger) {
              continue;
            }
          } else {
            const priorFinger = priorFingerByMidi?.get(note.midi);
            if (priorFinger !== undefined && finger !== priorFinger) {
              continue;
            }
          }
        }

        const total = prevCell.cost + transition + local;
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
  hand: Hand,
  fLower: Finger,
  fHigher: Finger,
  lowerMidi: number,
  higherMidi: number,
): number {
  return evaluateFingerPairCost(
    hand,
    fLower,
    lowerMidi,
    fHigher,
    higherMidi,
  );
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

function scoreChordFingerAssignment(
  chord: NoteEvent[],
  fingers: Finger[],
  hand: Hand,
): number {
  let cost = 0;

  for (let index = 0; index < fingers.length - 1; index += 1) {
    const pairCost = chordPairCost(
      hand,
      fingers[index],
      fingers[index + 1],
      chord[index].midi,
      chord[index + 1].midi,
    );

    if (!Number.isFinite(pairCost)) {
      return IMPOSSIBLE;
    }

    cost += pairCost;
  }

  if (hand === 'L' && chord.length >= 2) {
    const topIndex = chord.length - 1;
    if (fingers[topIndex] === 1) {
      cost -= LH_TOP_THUMB_BONUS;

      if (chord.length === 2) {
        const span = chord[topIndex].midi - chord[0].midi;
        if (span >= 5 && span <= 11) {
          if (fingers[0] === 5) {
            cost -= LH_OPEN_HAND_INTERVAL_BONUS;
          } else if (fingers[0] === 2) {
            cost += LH_CRAMPED_INNER_INTERVAL_PENALTY;
          }
        }
      }
    } else {
      cost += LH_TOP_THUMB_PENALTY;
    }
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

function octavePairForHand(hand: Hand): [Finger, Finger] {
  return hand === 'R' ? [1, 5] : [5, 1];
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

  if (noteCount === 2) {
    const span = chord[1].midi - chord[0].midi;
    if (span >= 12) {
      const [lowerFinger, upperFinger] = octavePairForHand(hand);
      yield [lowerFinger, upperFinger];
    }
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
  hand: Hand,
  chordSpan: number,
): boolean {
  if (leftCost !== rightCost) {
    return leftCost < rightCost;
  }

  if (hand === 'L' && left.length === 2 && left[0] !== right[0]) {
    return left[0] > right[0];
  }

  const { ideal: idealSpread } = preferredFingerGapStandard(chordSpan);
  const leftSpread = Math.max(...left) - Math.min(...left);
  const rightSpread = Math.max(...right) - Math.min(...right);
  const leftSpreadDeviation = Math.abs(leftSpread - idealSpread);
  const rightSpreadDeviation = Math.abs(rightSpread - idealSpread);

  if (leftSpreadDeviation !== rightSpreadDeviation) {
    return leftSpreadDeviation < rightSpreadDeviation;
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
  const chordSpan =
    chord.length >= 2 ? chord[chord.length - 1].midi - chord[0].midi : 0;

  for (const assignment of generateStrictChordAssignments(chord, hand)) {
    if (!satisfiesChordAnchors(chord, assignment)) {
      continue;
    }

    const cost = scoreChordFingerAssignment(chord, assignment, hand);
    if (
      Number.isFinite(cost) &&
      (bestAssignment === null ||
        chordAssignmentBeats(
          assignment,
          cost,
          bestAssignment,
          bestCost,
          hand,
          chordSpan,
        ))
    ) {
      bestAssignment = assignment;
      bestCost = cost;
    }
  }

  if (bestAssignment === null) {
    for (const assignment of generateStrictChordAssignments(chord, hand)) {
      const cost = scoreChordFingerAssignment(chord, assignment, hand);
      if (
        Number.isFinite(cost) &&
        (bestAssignment === null ||
          chordAssignmentBeats(
            assignment,
            cost,
            bestAssignment,
            bestCost,
            hand,
            chordSpan,
          ))
      ) {
        bestAssignment = assignment;
        bestCost = cost;
      }
    }
  }

  if (bestAssignment === null) {
    return (
      monotonicChordFingerAssignments(hand, chord.length).next().value ?? (
        [1, 2, 3, 4, 5].slice(0, chord.length) as Finger[]
      )
    );
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
      const cost = scoreChordFingerAssignment(playableNotes, assignment, hand);
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
  return bestIndices.length > 0 ? bestIndices : selectWidestFiveIndices(chord);
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
    const playableFingers = assignChordFingersToPlayableNotes(
      playableNotes,
      hand,
    );
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
  priorFingerByMidi?: Map<number, Finger>,
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
    priorFingerByMidi,
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

function computePhraseHomeAnchor(
  hand: Hand,
  anchorMidi: number,
): Record<Finger, number> {
  const defaultHome = HOME_POSITION[hand];
  const shift = anchorMidi - defaultHome[3];

  return {
    1: defaultHome[1] + shift,
    2: defaultHome[2] + shift,
    3: defaultHome[3] + shift,
    4: defaultHome[4] + shift,
    5: defaultHome[5] + shift,
  };
}

function buildPhraseCrossPrior(
  phrase: NoteEvent[],
  previousPhrase: NoteEvent[] | undefined,
  lastFingerByMidi: Map<number, Finger>,
): Map<number, Finger> | undefined {
  if (previousPhrase === undefined || previousPhrase.length === 0) {
    return undefined;
  }

  const phraseMidis = new Set(phrase.map((event) => event.midi));
  const prior = new Map<number, Finger>();

  for (const event of previousPhrase) {
    if (!phraseMidis.has(event.midi)) {
      continue;
    }

    const finger = lastFingerByMidi.get(event.midi);
    if (finger !== undefined) {
      prior.set(event.midi, finger);
    }
  }

  return prior.size > 0 ? prior : undefined;
}

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
    const previousPhrase = phraseIndex > 0 ? phrases[phraseIndex - 1] : undefined;
    const crossPhrasePrior = buildPhraseCrossPrior(
      phrase,
      previousPhrase,
      lastFingerByMidi,
    );
    const startHome = computePhraseHomeAnchor(hand, phrase[0].midi);
    const phraseFingers = fingerPhraseWithChords(
      phrase,
      hand,
      spanScale,
      startHome,
      crossPhrasePrior,
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

export interface FingeringPhraseNote {
  stepIndex: number;
  midi: number;
  finger: Finger | null;
  pitch: string;
}

export interface FingeringPhraseInfo {
  phraseIndex: number;
  hand: Hand;
  minMidi: number;
  maxMidi: number;
  span: number;
  notes: FingeringPhraseNote[];
}

export function buildFingeringPhraseInfos(
  script: PlaybackScript,
): Record<Hand, FingeringPhraseInfo[]> {
  const result: Record<Hand, FingeringPhraseInfo[]> = { L: [], R: [] };

  for (const hand of HANDS) {
    const timeline = extractHandTimelines(script)[hand];
    const phrases = segmentIntoPhrases(timeline);

    phrases.forEach((phrase, index) => {
      const notes: FingeringPhraseNote[] = phrase.map((event) => {
        const step = script[event.stepIndex];
        const scriptNote = step?.notes.find(
          (note) => note.hand === hand && note.midi === event.midi,
        );

        return {
          stepIndex: event.stepIndex,
          midi: event.midi,
          finger: scriptNote?.finger ?? null,
          pitch: scriptNote?.pitch ?? `M${event.midi}`,
        };
      });

      const midis = phrase.map((event) => event.midi);
      const minMidi = Math.min(...midis);
      const maxMidi = Math.max(...midis);

      result[hand].push({
        phraseIndex: index + 1,
        hand,
        minMidi,
        maxMidi,
        span: maxMidi - minMidi,
        notes,
      });
    });
  }

  return result;
}

export function findFingeringPhraseForStep(
  phrases: FingeringPhraseInfo[],
  stepIndex: number,
): FingeringPhraseInfo | null {
  return (
    phrases.find((phrase) =>
      phrase.notes.some((note) => note.stepIndex === stepIndex),
    ) ?? null
  );
}

const FINGER_KEY_BY_HAND: Record<Hand, Record<Finger, string>> = {
  L: { 5: 'q', 4: 'w', 3: 'e', 2: 'r', 1: 'v' },
  R: { 1: 'n', 2: 'i', 3: 'o', 4: 'p', 5: '[' },
};

export function formatFingeringPhraseNote(
  note: FingeringPhraseNote,
  hand: Hand,
): string {
  if (note.finger === null) {
    return `${note.pitch}(?)`;
  }

  const key = FINGER_KEY_BY_HAND[hand][note.finger];
  return `${note.pitch} ${note.finger}${key}`;
}

export function formatFingeringPhraseSummary(phrase: FingeringPhraseInfo): string {
  return phrase.notes
    .map((note) => formatFingeringPhraseNote(note, phrase.hand))
    .join(' · ');
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

/** @deprecated Use evaluateFingerPairCost / chordPairCost instead. */
export function chordPairDeviation(
  fLower: Finger,
  fHigher: Finger,
  midiSpan: number,
  hand: Hand = 'R',
): number {
  const lowerMidi = 60;
  return chordPairCost(
    hand,
    fLower,
    fHigher,
    lowerMidi,
    lowerMidi + midiSpan,
  );
}
