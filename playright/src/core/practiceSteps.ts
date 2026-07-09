import type {
  EngineMode,
  Finger,
  GraceNoteInfo,
  Hand,
  ManualFingeringMap,
  PlaybackScript,
  PlayingPlaybackNote,
  PracticePosition,
  ScriptNote,
  StepOrder,
} from '../types/index.ts';
import {
  fingeringKey,
  graceFingeringKey,
  resolveGraceManualAssignment,
  resolveManualAssignment,
} from '../types/index.ts';
import { TWO_HAND_KEY_MAP } from './twoHandMapping.ts';

/**
 * Derived practice-facing sequence: grace positions for step i precede
 * { kind: 'main', stepIndex: i } in graceBefore array (engraved) order.
 * PlaybackScript is unchanged; consumers opt in per Phase 1+.
 */
export function buildPracticePositions(script: PlaybackScript): PracticePosition[] {
  const positions: PracticePosition[] = [];

  for (let stepIndex = 0; stepIndex < script.length; stepIndex += 1) {
    const graceBefore = script[stepIndex].graceBefore;
    if (graceBefore !== undefined) {
      for (let graceIndex = 0; graceIndex < graceBefore.length; graceIndex += 1) {
        positions.push({ kind: 'grace', stepIndex, graceIndex });
      }
    }

    positions.push({ kind: 'main', stepIndex });
  }

  return positions;
}

export interface TwoHandStepNoteInfo {
  hand: Hand;
  midi: number;
  finger: Finger | null;
  fingerSource?: ScriptNote['fingerSource'];
  /** Position in graceBefore when this entry is a grace note; undefined for a main note. */
  graceIndex?: number;
}

/**
 * Notes the user must hit to advance a MAIN step position in practice mode.
 * Grace notes are separate positions in the practice walk (see
 * buildPracticePositions / getPracticeNotesForPosition) — this function
 * intentionally covers step.notes only, main-step behavior unchanged.
 */
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

/** Adapt a grace note into ScriptNote shape for practice-note matching (no cross-hand support yet). */
function graceNoteAsScriptNote(grace: GraceNoteInfo): ScriptNote {
  return {
    pitch: grace.pitch,
    midi: grace.midi,
    hand: grace.hand,
    finger: grace.finger ?? null,
    ...(grace.fingerSource ? { fingerSource: grace.fingerSource } : {}),
  };
}

/** Practice notes for one walk position (a main step or a single grace note). */
export function getPracticeNotesForPosition(
  script: PlaybackScript,
  position: PracticePosition,
  engineMode: EngineMode,
  activeHand: Hand,
): ScriptNote[] {
  if (position.kind === 'main') {
    return getPracticeNotes(script[position.stepIndex], engineMode, activeHand);
  }

  const grace = script[position.stepIndex]?.graceBefore?.[position.graceIndex];
  if (!grace) {
    return [];
  }

  if (engineMode === 'one-hand' && grace.hand !== activeHand) {
    return [];
  }

  return [graceNoteAsScriptNote(grace)];
}

/**
 * Playable practice notes for a position: two-hand mode matches by finger, so
 * a note without one (chord overflow on a main step, or an unfingered grace
 * before Phase 2 auto-fingering lands) cannot be pressed and must not block
 * completion.
 */
export function getPlayablePracticeNotesForPosition(
  script: PlaybackScript,
  position: PracticePosition,
  engineMode: EngineMode,
  activeHand: Hand,
): ScriptNote[] {
  const notes = getPracticeNotesForPosition(script, position, engineMode, activeHand);
  return engineMode === 'two-hand' ? notes.filter((note) => note.finger !== null) : notes;
}

/**
 * True when a position has content the user must play. Main positions use
 * the pre-filter practice-note presence (unchanged from pre-Phase-1
 * behavior: a step search stops on ANY practice note, even one that later
 * turns out unplayable post chord-overflow filtering — existing behavior,
 * not something this phase changes). Grace positions use the playable-note
 * count directly, since an unfingered grace must never become a stuck,
 * un-completable position in the walk.
 */
export function positionHasRequiredPracticeNotes(
  script: PlaybackScript,
  position: PracticePosition,
  engineMode: EngineMode,
  activeHand: Hand,
): boolean {
  if (position.kind === 'main') {
    return stepHasPracticeNotes(script[position.stepIndex], engineMode, activeHand);
  }

  return (
    getPlayablePracticeNotesForPosition(script, position, engineMode, activeHand).length > 0
  );
}

/**
 * True when a step, taken as a whole (its main notes OR any of its graces),
 * has something to practice. Strict superset of stepHasPracticeNotes: when a
 * step has no graces this reduces to exactly that call, so step-boundary
 * search/skip logic is unchanged for every non-graced fixture.
 */
export function stepHasAnyPracticeContent(
  script: PlaybackScript,
  stepIndex: number,
  engineMode: EngineMode,
  activeHand: Hand,
): boolean {
  const step = script[stepIndex];
  if (!step) {
    return false;
  }

  if (stepHasPracticeNotes(step, engineMode, activeHand)) {
    return true;
  }

  const graceCount = step.graceBefore?.length ?? 0;
  for (let graceIndex = 0; graceIndex < graceCount; graceIndex += 1) {
    if (
      positionHasRequiredPracticeNotes(
        script,
        { kind: 'grace', stepIndex, graceIndex },
        engineMode,
        activeHand,
      )
    ) {
      return true;
    }
  }

  return false;
}

/**
 * First within-step position (a grace, by ascending index, or the main note
 * when no grace qualifies) that has practice content for this hand/mode.
 * Returns the graceCursor to land on: a grace index, or null for the main
 * position.
 */
export function firstPositionWithinStep(
  script: PlaybackScript,
  stepIndex: number,
  engineMode: EngineMode,
  activeHand: Hand,
): number | null {
  const graceCount = script[stepIndex]?.graceBefore?.length ?? 0;

  for (let graceIndex = 0; graceIndex < graceCount; graceIndex += 1) {
    if (
      positionHasRequiredPracticeNotes(
        script,
        { kind: 'grace', stepIndex, graceIndex },
        engineMode,
        activeHand,
      )
    ) {
      return graceIndex;
    }
  }

  return null;
}

/** Position-aware variant of getExpectedNoteForFinger, covering a grace's own finger too. */
export function getExpectedNoteForFingerAtPosition(
  script: PlaybackScript,
  position: PracticePosition,
  hand: Hand,
  finger: Finger,
): ScriptNote | null {
  if (position.kind === 'main') {
    return getExpectedNoteForFinger(script[position.stepIndex], hand, finger);
  }

  const grace = script[position.stepIndex]?.graceBefore?.[position.graceIndex];
  if (!grace || grace.finger === undefined) {
    return null;
  }

  return grace.hand === hand && grace.finger === finger
    ? graceNoteAsScriptNote(grace)
    : null;
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

/** Program-mode capture target: a grace note (own graceIndex) or a main step note. */
export type ProgramCaptureTarget =
  | { kind: 'main'; note: ScriptNote }
  | { kind: 'grace'; graceIndex: number; note: GraceNoteInfo };

/**
 * First unassigned position to capture for this step's program-mode walk:
 * graces are captured before mains (graceIndex order), then the lowest
 * unassigned main note by ascending MIDI (programCurrentNote's rule). Null
 * once every grace and every main note has a manual fingering.
 */
export function programCurrentTarget(
  step: StepOrder,
  manualFingerings: ManualFingeringMap,
): ProgramCaptureTarget | null {
  const graceBefore = step.graceBefore ?? [];
  for (let graceIndex = 0; graceIndex < graceBefore.length; graceIndex += 1) {
    const grace = graceBefore[graceIndex];
    const key = graceFingeringKey(step.onset, grace.hand, grace.midi, graceIndex);
    if (manualFingerings[key] === undefined) {
      return { kind: 'grace', graceIndex, note: grace };
    }
  }

  const mainNote = programCurrentNote(step, manualFingerings);
  return mainNote ? { kind: 'main', note: mainNote } : null;
}

/**
 * Full capture-walk order for a step's refinger pass: every grace (graceIndex
 * order), then every main note (ascending MIDI, programStepNotesAscendingMidi's
 * order) — same order programCurrentTarget assigns in, so reprogramming from
 * index 0 revisits the step exactly as it was first captured.
 */
export function programStepAllTargetsOrdered(step: StepOrder): ProgramCaptureTarget[] {
  const graceTargets: ProgramCaptureTarget[] = (step.graceBefore ?? []).map(
    (grace, graceIndex) => ({ kind: 'grace', graceIndex, note: grace }),
  );
  const mainTargets: ProgramCaptureTarget[] = programStepNotesAscendingMidi(step).map(
    (note) => ({ kind: 'main', note }),
  );
  return [...graceTargets, ...mainTargets];
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

/**
 * Next capture target (grace or main note) to assign, or the first target
 * (grace before main, same order as programStepAllTargetsOrdered) when
 * reprogramming a complete step.
 */
export function programActiveTarget(
  step: StepOrder,
  manualFingerings: ManualFingeringMap,
  reprogramNoteIndex: number | null,
): ProgramCaptureTarget | null {
  if (reprogramNoteIndex !== null) {
    return programStepAllTargetsOrdered(step)[reprogramNoteIndex] ?? null;
  }

  const unassigned = programCurrentTarget(step, manualFingerings);
  if (unassigned !== null) {
    return unassigned;
  }

  if (isProgramStepComplete(step, manualFingerings)) {
    return programStepAllTargetsOrdered(step)[0] ?? null;
  }

  return null;
}

/** Step is complete when every grace note AND every main note has a manual fingering assignment. */
export function isProgramStepComplete(
  step: StepOrder,
  manualFingerings: ManualFingeringMap,
): boolean {
  const gracesComplete = (step.graceBefore ?? []).every(
    (grace, graceIndex) =>
      manualFingerings[
        graceFingeringKey(step.onset, grace.hand, grace.midi, graceIndex)
      ] !== undefined,
  );
  if (!gracesComplete) {
    return false;
  }

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

  (step.graceBefore ?? []).forEach((grace, graceIndex) => {
    const assignment = resolveGraceManualAssignment(
      step.onset,
      grace.hand,
      grace.midi,
      graceIndex,
      manualFingerings,
    );
    if (assignment) {
      assignedCounts[assignment.physicalHand] += 1;
    } else if (grace.hand === 'L') {
      unassignedNotatedL += 1;
    } else {
      unassignedNotatedR += 1;
    }
  });

  return {
    needed: {
      L: assignedCounts.L + unassignedNotatedL,
      R: assignedCounts.R + unassignedNotatedR,
    },
    assignedCounts,
  };
}

/** Every MIDI in the current step, for program-mode highlighting (all graces + main notes to assign). */
export function programStepExpectedMidis(step: StepOrder): number[] {
  const midis: number[] = [];
  const seen = new Set<number>();

  for (const grace of step.graceBefore ?? []) {
    if (!seen.has(grace.midi)) {
      seen.add(grace.midi);
      midis.push(grace.midi);
    }
  }

  for (const note of step.notes) {
    if (!seen.has(note.midi)) {
      seen.add(note.midi);
      midis.push(note.midi);
    }
  }

  return midis;
}

/** Midis of the next capture target (grace or main note) to assign (at most one). */
export function programTargetMidis(
  step: StepOrder,
  manualFingerings: ManualFingeringMap,
): Set<number> {
  const next = programCurrentTarget(step, manualFingerings);
  return next ? new Set([next.note.midi]) : new Set();
}

function buildTwoHandFingerToPhysicalKeyMap(): Map<string, string> {
  const map = new Map<string, string>();

  for (const [physicalKey, mapping] of Object.entries(TWO_HAND_KEY_MAP)) {
    map.set(`${mapping.hand}:${mapping.finger}`, physicalKey);
  }

  return map;
}

/** Resolve store (stepIndex, graceCursor) into a practice walk position. */
export function practicePositionFromGraceCursor(
  stepIndex: number,
  graceCursor: number | null,
): PracticePosition {
  return graceCursor === null
    ? { kind: 'main', stepIndex }
    : { kind: 'grace', stepIndex, graceIndex: graceCursor };
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

/** Expected MIDIs for one practice walk position (grace or main). */
export function buildTwoHandExpectedMidisForPosition(
  script: PlaybackScript | null,
  position: PracticePosition,
): Set<number> {
  const midis = new Set<number>();

  if (!script) {
    return midis;
  }

  for (const note of getPlayablePracticeNotesForPosition(
    script,
    position,
    'two-hand',
    'R',
  )) {
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

/**
 * Step notes AND graces grouped by MIDI, for program-mode key/finger-label
 * display: unlike practice mode's single-position walk, program mode shows
 * every target in the step at once (assigned or not). Graces are tagged with
 * graceIndex so a grace sharing onset+hand+midi with its own main note (e.g.
 * river-flows-in-you step 84) renders as a distinct entry, not a merged one.
 */
export function buildTwoHandStepNotesByMidiForProgram(
  script: PlaybackScript | null,
  stepIndex: number,
): Map<number, TwoHandStepNoteInfo[]> {
  const byMidi = new Map<number, TwoHandStepNoteInfo[]>();

  if (!script || stepIndex < 0 || stepIndex >= script.length) {
    return byMidi;
  }

  const step = script[stepIndex];

  step.graceBefore?.forEach((grace, graceIndex) => {
    const existing = byMidi.get(grace.midi) ?? [];
    existing.push({
      hand: grace.hand,
      midi: grace.midi,
      finger: grace.finger ?? null,
      fingerSource: grace.fingerSource,
      graceIndex,
    });
    byMidi.set(grace.midi, existing);
  });

  for (const note of step.notes) {
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

/** Step notes grouped by MIDI for one practice walk position. */
export function buildTwoHandStepNotesByMidiForPosition(
  script: PlaybackScript | null,
  position: PracticePosition,
): Map<number, TwoHandStepNoteInfo[]> {
  const byMidi = new Map<number, TwoHandStepNoteInfo[]>();

  if (!script) {
    return byMidi;
  }

  for (const note of getPlayablePracticeNotesForPosition(
    script,
    position,
    'two-hand',
    'R',
  )) {
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

function appendTwoHandStepNoteInfo(
  byMidi: Map<number, TwoHandStepNoteInfo[]>,
  note: {
    hand: Hand;
    midi: number;
    finger?: Finger | null;
    fingerSource?: ScriptNote['fingerSource'];
  },
): void {
  const existing = byMidi.get(note.midi) ?? [];
  if (existing.some((entry) => entry.hand === note.hand && entry.midi === note.midi)) {
    return;
  }

  existing.push({
    hand: note.hand,
    midi: note.midi,
    finger: note.finger ?? null,
    fingerSource: note.fingerSource,
  });
  byMidi.set(note.midi, existing);
}

function findScriptNoteForPlayback(
  script: PlaybackScript,
  stepIndex: number,
  midi: number,
  hand: Hand,
): ScriptNote | GraceNoteInfo | null {
  const step = script[stepIndex];
  if (!step) {
    return null;
  }

  const mainMatch = step.notes.find((note) => note.midi === midi && note.hand === hand);
  if (mainMatch) {
    return mainMatch;
  }

  return step.graceBefore?.find((grace) => grace.midi === midi && grace.hand === hand) ?? null;
}

/**
 * Two-hand fingering labels for play mode: union of all sounding notes plus the
 * current transport step so labels persist for full note duration.
 */
export function buildTwoHandStepNotesByMidiFromPlayback(
  script: PlaybackScript | null,
  playingPlaybackNotes: readonly PlayingPlaybackNote[],
  currentStepIndex: number,
): Map<number, TwoHandStepNoteInfo[]> {
  const byMidi = new Map<number, TwoHandStepNoteInfo[]>();

  if (!script) {
    return byMidi;
  }

  for (const playing of playingPlaybackNotes) {
    const match = findScriptNoteForPlayback(
      script,
      playing.stepIndex,
      playing.midi,
      playing.hand,
    );
    if (match) {
      appendTwoHandStepNoteInfo(byMidi, match);
    }
  }

  if (currentStepIndex >= 0 && currentStepIndex < script.length) {
    const step = script[currentStepIndex];
    for (const note of step.notes) {
      appendTwoHandStepNoteInfo(byMidi, note);
    }
    for (const grace of step.graceBefore ?? []) {
      appendTwoHandStepNoteInfo(byMidi, grace);
    }
  }

  return byMidi;
}

function appendPhysicalKeyForNote(
  keysByMidi: Map<number, string[]>,
  note: {
    midi: number;
    hand: Hand;
    finger?: Finger | null;
    playingHand?: Hand;
  },
  fingerToKey: Map<string, string>,
): void {
  if (note.finger == null) {
    return;
  }

  const physicalHand = note.playingHand ?? note.hand;
  const physicalKey = fingerToKey.get(`${physicalHand}:${note.finger}`);
  if (physicalKey === undefined) {
    return;
  }

  const existing = keysByMidi.get(note.midi) ?? [];
  if (!existing.includes(physicalKey)) {
    existing.push(physicalKey);
  }
  keysByMidi.set(note.midi, existing);
}

function collectPlaybackFingeringNotes(
  script: PlaybackScript,
  playingPlaybackNotes: readonly PlayingPlaybackNote[],
  currentStepIndex: number,
): Array<ScriptNote | GraceNoteInfo> {
  const notes: Array<ScriptNote | GraceNoteInfo> = [];
  const seen = new Set<string>();

  const addNote = (note: ScriptNote | GraceNoteInfo) => {
    const key = `${note.hand}:${note.midi}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    notes.push(note);
  };

  for (const playing of playingPlaybackNotes) {
    const match = findScriptNoteForPlayback(
      script,
      playing.stepIndex,
      playing.midi,
      playing.hand,
    );
    if (match) {
      addNote(match);
    }
  }

  if (currentStepIndex >= 0 && currentStepIndex < script.length) {
    const step = script[currentStepIndex];
    for (const note of step.notes) {
      addNote(note);
    }
    for (const grace of step.graceBefore ?? []) {
      addNote(grace);
    }
  }

  return notes;
}

/** Physical key labels for play-mode fingering overlay. */
export function buildTwoHandPhysicalKeysByMidiFromPlayback(
  script: PlaybackScript | null,
  playingPlaybackNotes: readonly PlayingPlaybackNote[],
  currentStepIndex: number,
): Map<number, string[]> {
  const keysByMidi = new Map<number, string[]>();

  if (!script) {
    return keysByMidi;
  }

  const fingerToKey = buildTwoHandFingerToPhysicalKeyMap();
  for (const note of collectPlaybackFingeringNotes(
    script,
    playingPlaybackNotes,
    currentStepIndex,
  )) {
    appendPhysicalKeyForNote(keysByMidi, note, fingerToKey);
  }

  return keysByMidi;
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

/** Physical key labels per MIDI for program mode: every step target (graces + mains), not one position. */
export function buildTwoHandPhysicalKeysByMidiForProgram(
  script: PlaybackScript | null,
  stepIndex: number,
): Map<number, string[]> {
  const keysByMidi = new Map<number, string[]>();

  if (!script || stepIndex < 0 || stepIndex >= script.length) {
    return keysByMidi;
  }

  const fingerToKey = buildTwoHandFingerToPhysicalKeyMap();
  const step = script[stepIndex];

  for (const grace of step.graceBefore ?? []) {
    appendPhysicalKeyForNote(keysByMidi, grace, fingerToKey);
  }
  for (const note of step.notes) {
    appendPhysicalKeyForNote(keysByMidi, note, fingerToKey);
  }

  return keysByMidi;
}

/** Physical key labels for one practice walk position. */
export function buildTwoHandPhysicalKeysByMidiForPosition(
  script: PlaybackScript | null,
  position: PracticePosition,
): Map<number, string[]> {
  const keysByMidi = new Map<number, string[]>();

  if (!script) {
    return keysByMidi;
  }

  const fingerToKey = buildTwoHandFingerToPhysicalKeyMap();

  for (const note of getPlayablePracticeNotesForPosition(
    script,
    position,
    'two-hand',
    'R',
  )) {
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
