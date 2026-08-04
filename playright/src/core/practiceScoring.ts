import type { EngineMode, Hand, PlaybackScript, ScriptNote } from '../types/index.ts';
import {
  buildPracticePositions,
  positionHasRequiredPracticeNotes,
} from './practiceSteps.ts';
import type { FingerMapping } from './twoHandMapping.ts';

// Duplicated rather than imported from InputManager.ts: that module imports the
// PracticeEngine singleton, and this module is imported by it. Keeping this a
// leaf avoids the import cycle.
const LOWEST_PIANO_MIDI = 21;
const HIGHEST_PIANO_MIDI = 108;

/**
 * One entry per practice walk position, indexed identically to
 * buildPracticePositions(script). Position-indexed (not string-keyed) so a
 * later timing/rhythm layer can join on the same index and add its own optional
 * fields without reshaping or re-keying anything here.
 */
export interface PracticePositionRecord {
  /** True once any press (correct or wrong) was attributed to this position. */
  attempted: boolean;
  wrongAttempts: number;
  /** True once every required note at this position has been hit. */
  correct: boolean;
}

/** Raw counts only. The right-to-wrong ratio is SC1's to compute and display. */
export interface PracticeScoringSummary {
  correctNotes: number;
  wrongNotes: number;
  /** Mode/hand-filtered scoreable positions in the piece. */
  scoreablePositions: number;
  completedPositions: number;
  navigated: boolean;
}

export type PracticeAttemptOutcome = 'correct' | 'wrong';

export function createPracticePositionRecords(count: number): PracticePositionRecord[] {
  return Array.from({ length: count }, () => ({
    attempted: false,
    wrongAttempts: 0,
    correct: false,
  }));
}

/**
 * Index of each step's FIRST walk position, plus a trailing total. Lets
 * (stepIndex, graceCursor) resolve to a record index in O(1) without rebuilding
 * the position list on every keypress.
 */
export function buildPracticePositionOffsets(script: PlaybackScript): number[] {
  const offsets: number[] = new Array(script.length + 1);
  let index = 0;

  for (let stepIndex = 0; stepIndex < script.length; stepIndex += 1) {
    offsets[stepIndex] = index;
    index += (script[stepIndex].graceBefore?.length ?? 0) + 1;
  }

  offsets[script.length] = index;
  return offsets;
}

export function countPracticePositions(script: PlaybackScript): number {
  return buildPracticePositionOffsets(script)[script.length];
}

/** Record index for the engine's (stepIndex, graceCursor) pair, or null when out of range. */
export function practicePositionIndexFromCursor(
  offsets: readonly number[],
  script: PlaybackScript,
  stepIndex: number,
  graceCursor: number | null,
): number | null {
  if (stepIndex < 0 || stepIndex >= script.length) {
    return null;
  }

  const base = offsets[stepIndex];
  if (base === undefined) {
    return null;
  }

  const graceCount = script[stepIndex].graceBefore?.length ?? 0;
  if (graceCursor === null) {
    return base + graceCount;
  }

  if (graceCursor < 0 || graceCursor >= graceCount) {
    return null;
  }

  return base + graceCursor;
}

/**
 * Scoreable positions for the active mode/hand. Deliberately NOT
 * buildPracticePositions(script).length: in one-hand mode most positions belong
 * to the other hand and can never be scored, and an unfingered grace is not a
 * required position either.
 */
export function countScoreablePracticePositions(
  script: PlaybackScript,
  engineMode: EngineMode,
  activeHand: Hand,
): number {
  return buildPracticePositions(script).filter((position) =>
    positionHasRequiredPracticeNotes(script, position, engineMode, activeHand),
  ).length;
}

export function summarizePracticeScoring(
  records: readonly PracticePositionRecord[],
  correctNotes: number,
  wrongNotes: number,
  scoreablePositions: number,
  navigated: boolean,
): PracticeScoringSummary {
  return {
    correctNotes,
    wrongNotes,
    scoreablePositions,
    completedPositions: records.filter((record) => record.correct).length,
    navigated,
  };
}

/** Smallest and largest semitone offset used for wrong-note feedback. */
export const WRONG_NOTE_MIN_SEMITONES = 1;
export const WRONG_NOTE_MAX_SEMITONES = 2;

/** Physical hand that plays a note (crossovers), never the notated staff hand. */
function physicalHandOf(note: ScriptNote): Hand {
  return note.playingHand ?? note.hand;
}

/**
 * Feedback pitch for a wrong two-hand finger press.
 *
 * The pressed finger has no note at this position, so there is no literal
 * "pitch it would have produced" to read off the script - it is estimated. The
 * anchor is the required note whose finger number is nearest the pressed
 * finger (same physical hand preferred, and lowest MIDI as a deterministic
 * tie-break). The offset direction is where that finger physically sits
 * relative to the anchor finger: for the right hand higher finger numbers run
 * up the keyboard, and for the left hand they run down. The magnitude is the
 * finger-number distance clamped to 1-2 semitones, so an adjacent finger sounds
 * a semitone off and any wider miss sounds a whole tone off.
 *
 * The result is therefore both an estimate of where the pressed finger would
 * have landed and a deliberate 1-2 semitone clash against the note actually
 * required - audibly wrong, and fully deterministic (never random).
 */
export function wrongNoteFeedbackMidi(
  mapping: FingerMapping,
  requiredNotes: readonly ScriptNote[],
): number | null {
  const fingered = requiredNotes.filter((note) => note.finger !== null);
  if (fingered.length === 0) {
    return null;
  }

  const sameHand = fingered.filter((note) => physicalHandOf(note) === mapping.hand);
  const candidates = sameHand.length > 0 ? sameHand : fingered;

  let anchor = candidates[0];
  for (const note of candidates) {
    const currentDistance = Math.abs((anchor.finger as number) - mapping.finger);
    const distance = Math.abs((note.finger as number) - mapping.finger);
    if (distance < currentDistance || (distance === currentDistance && note.midi < anchor.midi)) {
      anchor = note;
    }
  }

  const fingerDelta = mapping.finger - (anchor.finger as number);
  // A zero delta only happens on the cross-hand fallback (same finger number,
  // other hand). Bias upward so the offset stays deterministic and non-zero.
  const towardHigherFinger = fingerDelta === 0 ? 1 : Math.sign(fingerDelta);
  const direction = physicalHandOf(anchor) === 'L' ? -towardHigherFinger : towardHigherFinger;
  const magnitude = Math.min(
    WRONG_NOTE_MAX_SEMITONES,
    Math.max(WRONG_NOTE_MIN_SEMITONES, Math.abs(fingerDelta)),
  );

  const target = anchor.midi + direction * magnitude;
  if (target >= LOWEST_PIANO_MIDI && target <= HIGHEST_PIANO_MIDI) {
    return target;
  }

  // Off the keyboard at the extremes - reflect the same offset inward rather
  // than going silent.
  const reflected = anchor.midi - direction * magnitude;
  return reflected >= LOWEST_PIANO_MIDI && reflected <= HIGHEST_PIANO_MIDI
    ? reflected
    : null;
}
