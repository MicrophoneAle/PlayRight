import type {
  EngineMode,
  Finger,
  Hand,
  ManualFingeringMap,
  PlaybackScript,
  ScriptNote,
  StepOrder,
} from '../types/index.ts';
import { fingeringKey } from '../types/index.ts';
import { TWO_HAND_KEY_MAP } from './twoHandMapping.ts';

export interface TwoHandStepNoteInfo {
  hand: Hand;
  midi: number;
  finger: Finger | null;
  fingerSource?: ScriptNote['fingerSource'];
}

export function getPracticeNotes(
  step: StepOrder,
  engineMode: EngineMode,
  activeHand: Hand,
): ScriptNote[] {
  if (engineMode !== 'one-hand') {
    return step.notes;
  }

  return step.notes.filter((note) => note.hand === activeHand);
}

/** During play mode, every note in the step is shown; otherwise practice filtering applies. */
export function getDisplayNotesForStep(
  step: StepOrder,
  playMode: boolean,
  engineMode: EngineMode,
  activeHand: Hand,
): ScriptNote[] {
  if (playMode) {
    return step.notes;
  }

  return getPracticeNotes(step, engineMode, activeHand);
}

export function getDisplayEngineMode(
  playMode: boolean,
  engineMode: EngineMode,
): EngineMode {
  return playMode ? 'two-hand' : engineMode;
}

export function stepHasPracticeNotes(
  step: StepOrder,
  engineMode: EngineMode,
  activeHand: Hand,
): boolean {
  return getPracticeNotes(step, engineMode, activeHand).length > 0;
}

export function countPracticeSteps(
  script: PlaybackScript,
  engineMode: EngineMode,
  activeHand: Hand,
): number {
  if (engineMode !== 'one-hand') {
    return script.length;
  }

  return script.filter((step) => stepHasPracticeNotes(step, engineMode, activeHand))
    .length;
}

export function countCompletedPracticeSteps(
  script: PlaybackScript,
  engineMode: EngineMode,
  activeHand: Hand,
  currentStepIndex: number,
): number {
  if (engineMode !== 'one-hand') {
    return currentStepIndex;
  }

  return script
    .slice(0, currentStepIndex)
    .filter((step) => stepHasPracticeNotes(step, engineMode, activeHand)).length;
}

export function getExpectedNoteForFinger(
  step: StepOrder,
  hand: Hand,
  finger: Finger,
): ScriptNote | null {
  return (
    step.notes.find((note) => note.hand === hand && note.finger === finger) ?? null
  );
}

/** Key for tracking which notes in a program step already received a finger press. */
export function programAssignmentKey(hand: Hand, midi: number): string {
  return `${hand}:${midi}`;
}

/** Count notes per hand in a step (all notes, regardless of predicted finger). */
export function countStepNotesByHand(step: StepOrder): Record<Hand, number> {
  const counts: Record<Hand, number> = { L: 0, R: 0 };
  for (const note of step.notes) {
    counts[note.hand] += 1;
  }
  return counts;
}

/** Build assigned keys from manual fingerings recorded for this step. */
export function buildProgramAssignedKeys(
  step: StepOrder,
  manualFingerings: ManualFingeringMap,
): Set<string> {
  const assigned = new Set<string>();
  for (const note of step.notes) {
    if (manualFingerings[fingeringKey(step.onset, note.hand, note.midi)] !== undefined) {
      assigned.add(programAssignmentKey(note.hand, note.midi));
    }
  }
  return assigned;
}

/**
 * Next note to assign within the step, in script/score order (same sequence as practice).
 */
export function programNextUnassignedNote(
  step: StepOrder,
  assigned: ReadonlySet<string>,
): ScriptNote | null {
  for (const note of step.notes) {
    if (!assigned.has(programAssignmentKey(note.hand, note.midi))) {
      return note;
    }
  }

  return null;
}

/**
 * Program-mode chord targeting: the pressed finger binds to the lowest-pitch note on
 * that hand in the step that has not yet been assigned in this pass.
 */
export function programTargetNote(
  step: StepOrder,
  hand: Hand,
  assigned: ReadonlySet<string>,
): ScriptNote | null {
  const candidates = step.notes
    .filter((note) => note.hand === hand && !assigned.has(programAssignmentKey(hand, note.midi)))
    .sort((left, right) => left.midi - right.midi);

  return candidates[0] ?? null;
}

/**
 * Step is complete when each hand has received as many finger presses as it has notes.
 * Equivalent to every note assigned when each press maps to a distinct note.
 */
export function isProgramStepComplete(
  step: StepOrder,
  assigned: ReadonlySet<string>,
): boolean {
  const needed = countStepNotesByHand(step);
  const assignedCounts: Record<Hand, number> = { L: 0, R: 0 };

  for (const note of step.notes) {
    if (assigned.has(programAssignmentKey(note.hand, note.midi))) {
      assignedCounts[note.hand] += 1;
    }
  }

  return assignedCounts.L >= needed.L && assignedCounts.R >= needed.R;
}

/** Per-hand assignment progress for the current program step. */
export function programAssignmentProgress(
  step: StepOrder,
  assigned: ReadonlySet<string>,
): {
  needed: Record<Hand, number>;
  assignedCounts: Record<Hand, number>;
} {
  const needed = countStepNotesByHand(step);
  const assignedCounts: Record<Hand, number> = { L: 0, R: 0 };

  for (const note of step.notes) {
    if (assigned.has(programAssignmentKey(note.hand, note.midi))) {
      assignedCounts[note.hand] += 1;
    }
  }

  return { needed, assignedCounts };
}

/** Midis of the next note to assign in score order (at most one). */
export function programTargetMidis(
  step: StepOrder,
  assigned: ReadonlySet<string>,
): Set<number> {
  const next = programNextUnassignedNote(step, assigned);
  return next ? new Set([next.midi]) : new Set();
}

function buildTwoHandFingerToPhysicalKeyMap(): Map<string, string> {
  const map = new Map<string, string>();

  for (const [physicalKey, mapping] of Object.entries(TWO_HAND_KEY_MAP)) {
    map.set(`${mapping.hand}:${mapping.finger}`, physicalKey);
  }

  return map;
}

/** Every MIDI in the current step, for two-hand expected-key highlighting. */
export function buildTwoHandExpectedMidis(
  script: PlaybackScript | null,
  stepIndex: number,
): Set<number> {
  const midis = new Set<number>();

  if (!script || stepIndex < 0 || stepIndex >= script.length) {
    return midis;
  }

  for (const note of script[stepIndex].notes) {
    midis.add(note.midi);
  }

  return midis;
}

/** Step notes grouped by MIDI (cross-hand unisons keep every entry). */
export function buildTwoHandStepNotesByMidi(
  script: PlaybackScript | null,
  stepIndex: number,
): Map<number, TwoHandStepNoteInfo[]> {
  const byMidi = new Map<number, TwoHandStepNoteInfo[]>();

  if (!script || stepIndex < 0 || stepIndex >= script.length) {
    return byMidi;
  }

  for (const note of script[stepIndex].notes) {
    const existing = byMidi.get(note.midi) ?? [];
    existing.push({
      hand: note.hand,
      midi: note.midi,
      finger: note.finger,
      fingerSource: note.fingerSource,
    });
    byMidi.set(note.midi, existing);
  }

  return byMidi;
}

/** Physical key labels per MIDI; multiple keys when several fingers share a unison. */
export function buildTwoHandPhysicalKeysByMidi(
  script: PlaybackScript | null,
  stepIndex: number,
): Map<number, string[]> {
  const keysByMidi = new Map<number, string[]>();

  if (!script || stepIndex < 0 || stepIndex >= script.length) {
    return keysByMidi;
  }

  const fingerToKey = buildTwoHandFingerToPhysicalKeyMap();

  for (const note of script[stepIndex].notes) {
    if (note.finger === null) {
      continue;
    }

    const physicalKey = fingerToKey.get(`${note.hand}:${note.finger}`);
    if (physicalKey === undefined) {
      continue;
    }

    const existing = keysByMidi.get(note.midi) ?? [];
    if (!existing.includes(physicalKey)) {
      existing.push(physicalKey);
    }
    keysByMidi.set(note.midi, existing);
  }

  return keysByMidi;
}
