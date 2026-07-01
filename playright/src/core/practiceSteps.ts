import type {
  EngineMode,
  Finger,
  Hand,
  ManualFingeringMap,
  PlaybackScript,
  ScriptNote,
  StepOrder,
} from '../types/index.ts';
import { fingeringKey, resolveManualAssignment } from '../types/index.ts';
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
    step.notes.find(
      (note) =>
        (note.playingHand ?? note.hand) === hand && note.finger === finger,
    ) ?? null
  );
}

/** @deprecated Use fingeringKey(onset, notatedHand, midi) for program assignment tracking. */
export function programAssignmentKey(hand: Hand, midi: number): string {
  return `${hand}:${midi}`;
}

/** Step notes sorted ascending by MIDI (stable tie-break: L before R). */
export function programStepNotesAscendingMidi(step: StepOrder): ScriptNote[] {
  return [...step.notes].sort((left, right) => {
    if (left.midi !== right.midi) {
      return left.midi - right.midi;
    }

    if (left.hand === right.hand) {
      return 0;
    }

    return left.hand === 'L' ? -1 : 1;
  });
}

/** Build assigned note-identity keys from manual fingerings recorded for this step. */
export function buildProgramAssignedKeys(
  step: StepOrder,
  manualFingerings: ManualFingeringMap,
): Set<string> {
  const assigned = new Set<string>();
  for (const note of step.notes) {
    const key = fingeringKey(step.onset, note.hand, note.midi);
    if (manualFingerings[key] !== undefined) {
      assigned.add(key);
    }
  }
  return assigned;
}

/** Lowest unassigned note in the step by ascending MIDI. */
export function programCurrentNote(
  step: StepOrder,
  manualFingerings: ManualFingeringMap,
): ScriptNote | null {
  const assigned = buildProgramAssignedKeys(step, manualFingerings);

  for (const note of programStepNotesAscendingMidi(step)) {
    const key = fingeringKey(step.onset, note.hand, note.midi);
    if (!assigned.has(key)) {
      return note;
    }
  }

  return null;
}

/**
 * @deprecated Use programCurrentNote for MIDI-walk program mode.
 */
export function programNextUnassignedNote(
  step: StepOrder,
  assigned: ReadonlySet<string>,
): ScriptNote | null {
  for (const note of programStepNotesAscendingMidi(step)) {
    if (!assigned.has(fingeringKey(step.onset, note.hand, note.midi))) {
      return note;
    }
  }

  return null;
}

/**
 * @deprecated Per-hand chord targeting; use programCurrentNote for MIDI-walk program mode.
 */
export function programTargetNote(
  step: StepOrder,
  hand: Hand,
  assigned: ReadonlySet<string>,
): ScriptNote | null {
  const candidates = step.notes
    .filter(
      (note) =>
        note.hand === hand &&
        !assigned.has(fingeringKey(step.onset, note.hand, note.midi)),
    )
    .sort((left, right) => left.midi - right.midi);

  return candidates[0] ?? null;
}

/** Next note to assign, or the first note when reprogramming a complete step. */
export function programActiveTargetNote(
  step: StepOrder,
  manualFingerings: ManualFingeringMap,
  reprogramNoteIndex: number | null,
): ScriptNote | null {
  if (reprogramNoteIndex !== null) {
    const ascending = programStepNotesAscendingMidi(step);
    return ascending[reprogramNoteIndex] ?? null;
  }

  const unassigned = programCurrentNote(step, manualFingerings);
  if (unassigned !== null) {
    return unassigned;
  }

  if (isProgramStepComplete(step, manualFingerings)) {
    return programStepNotesAscendingMidi(step)[0] ?? null;
  }

  return null;
}

/** Step is complete when every note in the step has a manual fingering assignment. */
export function isProgramStepComplete(
  step: StepOrder,
  manualFingerings: ManualFingeringMap,
): boolean {
  return step.notes.every(
    (note) =>
      manualFingerings[fingeringKey(step.onset, note.hand, note.midi)] !== undefined,
  );
}

/** Per-hand assignment progress by physical playing hand. */
export function programAssignmentProgress(
  step: StepOrder,
  manualFingerings: ManualFingeringMap,
): {
  needed: Record<Hand, number>;
  assignedCounts: Record<Hand, number>;
} {
  const assignedCounts: Record<Hand, number> = { L: 0, R: 0 };
  let unassignedNotatedL = 0;
  let unassignedNotatedR = 0;

  for (const note of step.notes) {
    const assignment = resolveManualAssignment(
      step.onset,
      note.hand,
      note.midi,
      manualFingerings,
    );
    if (assignment) {
      assignedCounts[assignment.physicalHand] += 1;
    } else if (note.hand === 'L') {
      unassignedNotatedL += 1;
    } else {
      unassignedNotatedR += 1;
    }
  }

  return {
    needed: {
      L: assignedCounts.L + unassignedNotatedL,
      R: assignedCounts.R + unassignedNotatedR,
    },
    assignedCounts,
  };
}

/** Every MIDI in the current step, for program-mode highlighting (all notes to assign). */
export function programStepExpectedMidis(step: StepOrder): number[] {
  const midis: number[] = [];
  const seen = new Set<number>();

  for (const note of step.notes) {
    if (!seen.has(note.midi)) {
      seen.add(note.midi);
      midis.push(note.midi);
    }
  }

  return midis;
}

/** Midis of the next note to assign by ascending MIDI (at most one). */
export function programTargetMidis(
  step: StepOrder,
  manualFingerings: ManualFingeringMap,
): Set<number> {
  const next = programCurrentNote(step, manualFingerings);
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

    const physicalKey = fingerToKey.get(
      `${note.playingHand ?? note.hand}:${note.finger}`,
    );
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
