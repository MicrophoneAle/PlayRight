import type { Hand, PlaybackScript, ScriptNote } from '../types/index.ts';

/** Musical onset of a step in quarter-note units. */
export function stepOnsetQuarterNotes(
  onset: number,
  divisionsPerQuarter: number,
): number {
  return onset / divisionsPerQuarter;
}

/** Note length in quarter-note units. */
export function noteDurationQuarterNotes(
  durationDivisions: number,
  divisionsPerQuarter: number,
): number {
  return durationDivisions / divisionsPerQuarter;
}

/** Wall-clock seconds for a quarter-note span at the given BPM. */
export function quarterNotesToSeconds(quarterNotes: number, bpm: number): number {
  return quarterNotes * (60 / bpm);
}

/** Smallest release gap (sixteenth-note feel at 4/4). */
export const PLAYBACK_ARTICULATION_GAP_MIN_QUARTERS = 0.02;

/** Largest release gap before the next attack. */
export const PLAYBACK_ARTICULATION_GAP_MAX_QUARTERS = 0.05;

/** Release gap scales with written note length. */
export const PLAYBACK_ARTICULATION_GAP_RATIO = 0.035;

/** Extra release gap when the same pitch is struck again later. Just enough to re-trigger. */
export const PLAYBACK_CONSECUTIVE_SAME_NOTE_GAP_EXTRA_QUARTERS = 0.02;

/** A consecutive re-strike gap never exceeds this fraction of the written note length. */
export const PLAYBACK_CONSECUTIVE_SAME_NOTE_GAP_MAX_RATIO = 0.2;

/** @deprecated Use articulationGapQuarterNotes() for duration-aware gaps. */
export const PLAYBACK_ARTICULATION_GAP_QUARTERS = PLAYBACK_ARTICULATION_GAP_MAX_QUARTERS;

/** Play-mode multiplier applied to a fermata note's held duration. */
export const PLAYBACK_FERMATA_HOLD_FACTOR = 2;

export interface PlaybackDurationOptions {
  /** Play through the full written length (no pre-release gap). */
  isFinalNote?: boolean;
  /** Play mode only: extend held duration for fermata-marked notes. */
  hasFermata?: boolean;
  /** Same hand+pitch re-attacks immediately at this note's written end. */
  followedByConsecutiveSameNote?: boolean;
}

function basePlaybackDurationQuarterNotes(
  writtenQuarterNotes: number,
  tiedToNext: boolean,
  options: Pick<
    PlaybackDurationOptions,
    'isFinalNote' | 'followedByConsecutiveSameNote'
  >,
): number {
  if (tiedToNext || writtenQuarterNotes <= 0) {
    return writtenQuarterNotes;
  }

  if (options.isFinalNote) {
    return writtenQuarterNotes;
  }

  const gap = articulationGapQuarterNotes(writtenQuarterNotes, options);
  const minPlayDuration = writtenQuarterNotes * 0.25;
  return Math.max(writtenQuarterNotes - gap, minPlayDuration);
}

export interface FermataPlaybackContext {
  /** Fermata hold applies to every note in these steps (prior step had fermata + abuts). */
  carryForwardSteps: Set<number>;
  /** Score fermata on this step is expressed on the abutting next step instead. */
  delegateToNextStep: Set<number>;
}

const FERMATA_ONSET_EPSILON_DIVISIONS = 1e-3;

function stepWrittenEndOnsetDivisions(
  step: PlaybackScript[number],
  divisionsPerQuarter: number,
): number {
  let endOnset = step.onset;

  for (const note of step.notes) {
    const durationDivisions = note.durationDivisions ?? divisionsPerQuarter;
    endOnset = Math.max(endOnset, step.onset + durationDivisions);
  }

  return endOnset;
}

/**
 * When a fermata marks a pickup into an immediately following sustained sonority
 * (common in engraved scores), carry the hold onto the abutting next step.
 */
export function buildFermataPlaybackContext(
  script: PlaybackScript,
  divisionsPerQuarter: number,
): FermataPlaybackContext {
  const carryForwardSteps = new Set<number>();
  const delegateToNextStep = new Set<number>();

  for (let stepIndex = 0; stepIndex < script.length - 1; stepIndex += 1) {
    const step = script[stepIndex];
    if (!step.notes.some((note) => note.hasFermata)) {
      continue;
    }

    const nextStep = script[stepIndex + 1];
    const stepEndOnset = stepWrittenEndOnsetDivisions(step, divisionsPerQuarter);

    if (Math.abs(nextStep.onset - stepEndOnset) > FERMATA_ONSET_EPSILON_DIVISIONS) {
      continue;
    }

    carryForwardSteps.add(stepIndex + 1);
    delegateToNextStep.add(stepIndex);
  }

  return { carryForwardSteps, delegateToNextStep };
}

export function effectiveNoteHasFermata(
  stepIndex: number,
  note: ScriptNote,
  context: FermataPlaybackContext,
): boolean {
  if (context.delegateToNextStep.has(stepIndex) && note.hasFermata) {
    return false;
  }

  return (note.hasFermata ?? false) || context.carryForwardSteps.has(stepIndex);
}

export function stepHasPlaybackFermataHold(
  script: PlaybackScript,
  stepIndex: number,
  divisionsPerQuarter: number,
): boolean {
  const context = buildFermataPlaybackContext(script, divisionsPerQuarter);
  const step = script[stepIndex];

  return step.notes.some((note) => effectiveNoteHasFermata(stepIndex, note, context));
}

function maxFermataExtensionForNotes(
  script: PlaybackScript,
  stepIndex: number,
  divisionsPerQuarter: number,
  finalNoteKeys: Set<string>,
  treatAllNotesAsFermata: boolean,
): number {
  const step = script[stepIndex];
  let stepExtension = 0;

  for (const note of step.notes) {
    if (!treatAllNotesAsFermata && !note.hasFermata) {
      continue;
    }

    const durationDivisions = note.durationDivisions ?? divisionsPerQuarter;
    const writtenQuarters = noteDurationQuarterNotes(
      durationDivisions,
      divisionsPerQuarter,
    );
    const isFinalNote = finalNoteKeys.has(
      playbackNoteKey(stepIndex, note.hand, note.midi),
    );
    stepExtension = Math.max(
      stepExtension,
      fermataExtensionDeltaQuarterNotes(
        writtenQuarters,
        note.tiedToNext ?? false,
        { isFinalNote },
      ),
    );
  }

  return stepExtension;
}

/** Extra play-mode hold added by a fermata over the non-fermata playback duration. */
export function fermataExtensionDeltaQuarterNotes(
  writtenQuarterNotes: number,
  tiedToNext = false,
  options: Pick<PlaybackDurationOptions, 'isFinalNote'> = {},
): number {
  const withoutFermata = playbackDurationQuarterNotes(
    writtenQuarterNotes,
    tiedToNext,
    options,
  );
  const withFermata = playbackDurationQuarterNotes(writtenQuarterNotes, tiedToNext, {
    ...options,
    hasFermata: true,
  });

  return withFermata - withoutFermata;
}

/** Play-mode cumulative shift applied before each step's written onset after prior fermatas. */
export function buildPlaybackFermataOffsetsByStep(
  script: PlaybackScript,
  divisionsPerQuarter: number,
  finalNoteKeys: Set<string> = buildFinalNoteKeySet(script, divisionsPerQuarter),
  fermataContext: FermataPlaybackContext = buildFermataPlaybackContext(
    script,
    divisionsPerQuarter,
  ),
  stepDurations: number[] = buildStepPlaybackDurationQuarterNotesByStep(
    script,
    divisionsPerQuarter,
    finalNoteKeys,
    buildConsecutiveSameNoteKeySet(script, divisionsPerQuarter),
    fermataContext,
  ),
): number[] {
  const offsets: number[] = [];
  let runningOffset = 0;

  for (let stepIndex = 0; stepIndex < script.length; stepIndex += 1) {
    offsets.push(runningOffset);

    let stepExtension = 0;

    if (fermataContext.delegateToNextStep.has(stepIndex)) {
      stepExtension = maxFermataExtensionForNotes(
        script,
        stepIndex + 1,
        divisionsPerQuarter,
        finalNoteKeys,
        true,
      );
    } else {
      for (const note of script[stepIndex].notes) {
        if (!note.hasFermata) {
          continue;
        }

        const durationDivisions = note.durationDivisions ?? divisionsPerQuarter;
        const writtenQuarters = noteDurationQuarterNotes(
          durationDivisions,
          divisionsPerQuarter,
        );
        const isFinalNote = finalNoteKeys.has(
          playbackNoteKey(stepIndex, note.hand, note.midi),
        );
        stepExtension = Math.max(
          stepExtension,
          fermataExtensionDeltaQuarterNotes(
            writtenQuarters,
            note.tiedToNext ?? false,
            { isFinalNote },
          ),
        );
      }
    }

    runningOffset += stepExtension;

    const stepHasFermataHold = script[stepIndex].notes.some((note) =>
      effectiveNoteHasFermata(stepIndex, note, fermataContext),
    );
    if (stepHasFermataHold && stepIndex + 1 < script.length) {
      const attackQuarters =
        stepOnsetQuarterNotes(script[stepIndex].onset, divisionsPerQuarter) +
        runningOffset -
        stepExtension;
      const releaseQuarters = attackQuarters + stepDurations[stepIndex];
      const nextWrittenAttack = stepOnsetQuarterNotes(
        script[stepIndex + 1].onset,
        divisionsPerQuarter,
      );
      runningOffset = Math.max(
        runningOffset,
        releaseQuarters - nextWrittenAttack,
      );
    }
  }

  return offsets;
}

/** Play-mode attack time in quarter notes, including fermata timeline shifts. */
export function scheduledPlaybackAttackQuarterNotes(
  writtenOnsetDivisions: number,
  divisionsPerQuarter: number,
  fermataOffsetQuarterNotes: number,
): number {
  return (
    stepOnsetQuarterNotes(writtenOnsetDivisions, divisionsPerQuarter) +
    fermataOffsetQuarterNotes
  );
}

/** Gap before the next attack, scaled by note length with min/max clamps. */
export function articulationGapQuarterNotes(
  writtenQuarterNotes: number,
  options: Pick<PlaybackDurationOptions, 'followedByConsecutiveSameNote'> = {},
): number {
  if (writtenQuarterNotes <= 0) {
    return 0;
  }

  const proportional = writtenQuarterNotes * PLAYBACK_ARTICULATION_GAP_RATIO;
  let gap = Math.min(
    PLAYBACK_ARTICULATION_GAP_MAX_QUARTERS,
    Math.max(PLAYBACK_ARTICULATION_GAP_MIN_QUARTERS, proportional),
  );

  if (options.followedByConsecutiveSameNote) {
    gap = Math.min(
      writtenQuarterNotes * PLAYBACK_CONSECUTIVE_SAME_NOTE_GAP_MAX_RATIO,
      gap + PLAYBACK_CONSECUTIVE_SAME_NOTE_GAP_EXTRA_QUARTERS,
    );
  }

  return gap;
}

/** Played length after applying a release gap unless the note ties forward or ends the piece. */
export function playbackDurationQuarterNotes(
  writtenQuarterNotes: number,
  tiedToNext = false,
  options: PlaybackDurationOptions = {},
): number {
  const baseDuration = basePlaybackDurationQuarterNotes(
    writtenQuarterNotes,
    tiedToNext,
    options,
  );

  if (!options.hasFermata || baseDuration <= 0) {
    return baseDuration;
  }

  return baseDuration * PLAYBACK_FERMATA_HOLD_FACTOR;
}

/** Release onset for a note, leaving a short gap before the next attack at the written duration. */
export function playbackReleaseOnsetQuarterNotes(
  attackOnsetQuarters: number,
  writtenQuarterNotes: number,
  tiedToNext = false,
  options: PlaybackDurationOptions = {},
): number {
  return (
    attackOnsetQuarters +
    playbackDurationQuarterNotes(writtenQuarterNotes, tiedToNext, options)
  );
}

/** Silence before the next attack when it lands one written duration later. */
export function playbackSilenceBeforeNextAttackQuarters(
  writtenQuarterNotes: number,
  tiedToNext = false,
  options: PlaybackDurationOptions = {},
): number {
  if (tiedToNext || writtenQuarterNotes <= 0 || options.isFinalNote) {
    return 0;
  }

  return (
    writtenQuarterNotes -
    playbackDurationQuarterNotes(writtenQuarterNotes, tiedToNext, options)
  );
}

/** Ticks from quarter-note musical time at the given Transport PPQ. */
export function quartersToTicks(quarterNotes: number, ppq: number): number {
  return quarterNotes * ppq;
}

/** Absolute Transport tick time for scheduling (scales with tempo via PPQ). */
export function quartersToTransportTickTime(
  quarterNotes: number,
  ppq: number,
): string {
  return `${quartersToTicks(quarterNotes, ppq)}i`;
}

/** Relative Transport tick offset for scheduling after the current timeline position. */
export function quarterNotesToRelativeTickTime(
  quarterNotes: number,
  ppq: number,
): string {
  if (quarterNotes <= 0) {
    return '+0i';
  }

  return `+${quartersToTicks(quarterNotes, ppq)}i`;
}

/** Tick duration for note scheduling (scales with Transport BPM). */
export function quarterNotesToTickDuration(
  quarterNotes: number,
  ppq: number,
): string {
  if (quarterNotes <= 0) {
    return '0i';
  }

  return `${quartersToTicks(quarterNotes, ppq)}i`;
}

function playbackNoteKey(stepIndex: number, hand: Hand, midi: number): string {
  return `${stepIndex}:${hand}:${midi}`;
}

export function isPlaybackTieContinuation(
  script: PlaybackScript,
  stepIndex: number,
  note: Pick<ScriptNote, 'midi' | 'hand'>,
): boolean {
  if (stepIndex === 0) {
    return false;
  }

  const previousStep = script[stepIndex - 1];
  return previousStep.notes.some(
    (previous) =>
      previous.midi === note.midi &&
      previous.hand === note.hand &&
      previous.tiedToNext,
  );
}

/** True when this attack immediately repeats the same hand+pitch on the prior step (not a tie). */
export function isRepeatedPlaybackAttack(
  script: PlaybackScript,
  stepIndex: number,
  note: Pick<ScriptNote, 'midi' | 'hand'>,
): boolean {
  if (stepIndex === 0 || isPlaybackTieContinuation(script, stepIndex, note)) {
    return false;
  }

  const previousStep = script[stepIndex - 1];
  return previousStep.notes.some(
    (previous) =>
      previous.midi === note.midi &&
      previous.hand === note.hand &&
      !isPlaybackTieContinuation(script, stepIndex - 1, previous),
  );
}

function findNextReattackStepIndex(
  script: PlaybackScript,
  fromStepIndex: number,
  hand: Hand,
  midi: number,
): number | null {
  for (let stepIndex = fromStepIndex + 1; stepIndex < script.length; stepIndex += 1) {
    const step = script[stepIndex];

    for (const candidate of step.notes) {
      if (candidate.hand !== hand || candidate.midi !== midi) {
        continue;
      }

      if (isPlaybackTieContinuation(script, stepIndex, candidate)) {
        continue;
      }

      return stepIndex;
    }
  }

  return null;
}

function findPreviousReattackStepIndex(
  script: PlaybackScript,
  fromStepIndex: number,
  hand: Hand,
  midi: number,
): number | null {
  for (let stepIndex = fromStepIndex - 1; stepIndex >= 0; stepIndex -= 1) {
    const step = script[stepIndex];

    for (const candidate of step.notes) {
      if (candidate.hand !== hand || candidate.midi !== midi) {
        continue;
      }

      if (isPlaybackTieContinuation(script, stepIndex, candidate)) {
        continue;
      }

      return stepIndex;
    }
  }

  return null;
}

/** True when this attack re-strikes the same hand+pitch after an earlier strike (not a tie). */
export function isSamePitchReattack(
  script: PlaybackScript,
  stepIndex: number,
  note: Pick<ScriptNote, 'midi' | 'hand'>,
): boolean {
  if (stepIndex === 0 || isPlaybackTieContinuation(script, stepIndex, note)) {
    return false;
  }

  return (
    findPreviousReattackStepIndex(script, stepIndex, note.hand, note.midi) !== null
  );
}

/** Notes whose same hand+pitch is re-attacked later (any spacing, excluding ties). */
export function buildConsecutiveSameNoteKeySet(
  script: PlaybackScript,
  _divisionsPerQuarter: number,
  _fermataOffsets?: number[],
): Set<string> {
  const keys = new Set<string>();

  for (let stepIndex = 0; stepIndex < script.length; stepIndex += 1) {
    const step = script[stepIndex];

    for (const note of step.notes) {
      if (note.tiedToNext) {
        continue;
      }

      const nextReattackStepIndex = findNextReattackStepIndex(
        script,
        stepIndex,
        note.hand,
        note.midi,
      );
      if (nextReattackStepIndex === null) {
        continue;
      }

      keys.add(playbackNoteKey(stepIndex, note.hand, note.midi));
    }
  }

  return keys;
}

/** Latest written end time in quarter-note units from the start of the piece. */
export function latestWrittenEndQuarterNotes(
  script: PlaybackScript,
  divisionsPerQuarter: number,
): number {
  let latestEnd = 0;

  for (const step of script) {
    const onsetQuarters = stepOnsetQuarterNotes(step.onset, divisionsPerQuarter);

    for (const note of step.notes) {
      const durationDivisions = note.durationDivisions ?? divisionsPerQuarter;
      const writtenQuarters = noteDurationQuarterNotes(
        durationDivisions,
        divisionsPerQuarter,
      );
      latestEnd = Math.max(latestEnd, onsetQuarters + writtenQuarters);
    }
  }

  return latestEnd;
}

/** Notes whose written duration extends to the end of the piece (hold through the final release). */
export function buildFinalNoteKeySet(
  script: PlaybackScript,
  divisionsPerQuarter: number,
): Set<string> {
  const latestEnd = latestWrittenEndQuarterNotes(script, divisionsPerQuarter);
  const keys = new Set<string>();
  const epsilon = 1e-6;

  for (let stepIndex = 0; stepIndex < script.length; stepIndex += 1) {
    const step = script[stepIndex];
    const onsetQuarters = stepOnsetQuarterNotes(step.onset, divisionsPerQuarter);

    for (const note of step.notes) {
      const durationDivisions = note.durationDivisions ?? divisionsPerQuarter;
      const writtenQuarters = noteDurationQuarterNotes(
        durationDivisions,
        divisionsPerQuarter,
      );
      const writtenEnd = onsetQuarters + writtenQuarters;

      if (Math.abs(writtenEnd - latestEnd) < epsilon) {
        keys.add(playbackNoteKey(stepIndex, note.hand, note.midi));
      }
    }
  }

  return keys;
}

export function notePlaybackDurationOptions(
  stepIndex: number,
  note: ScriptNote,
  finalNoteKeys: Set<string>,
  consecutiveSameNoteKeys: Set<string>,
  fermataContext: FermataPlaybackContext,
): PlaybackDurationOptions {
  return {
    isFinalNote: finalNoteKeys.has(playbackNoteKey(stepIndex, note.hand, note.midi)),
    hasFermata: effectiveNoteHasFermata(stepIndex, note, fermataContext),
    followedByConsecutiveSameNote: consecutiveSameNoteKeys.has(
      playbackNoteKey(stepIndex, note.hand, note.midi),
    ),
  };
}

export function notePlaybackDurationQuarterNotes(
  note: ScriptNote,
  divisionsPerQuarter: number,
  options: PlaybackDurationOptions,
): number {
  const writtenQuarters = noteDurationQuarterNotes(
    note.durationDivisions ?? divisionsPerQuarter,
    divisionsPerQuarter,
  );

  return playbackDurationQuarterNotes(
    writtenQuarters,
    note.tiedToNext ?? false,
    options,
  );
}

/** Keep fermata chord tones held through the extended fermata release. */
export function shouldUnifyStepPlaybackDuration(
  step: PlaybackScript[number],
  stepIndex: number,
  fermataContext: FermataPlaybackContext,
): boolean {
  return step.notes.some((note) =>
    effectiveNoteHasFermata(stepIndex, note, fermataContext),
  );
}

export function buildStepPlaybackDurationQuarterNotesByStep(
  script: PlaybackScript,
  divisionsPerQuarter: number,
  finalNoteKeys: Set<string>,
  consecutiveSameNoteKeys: Set<string>,
  fermataContext: FermataPlaybackContext = buildFermataPlaybackContext(
    script,
    divisionsPerQuarter,
  ),
): number[] {
  return script.map((step, stepIndex) => {
    let maxDuration = 0;

    for (const note of step.notes) {
      const noteDuration = notePlaybackDurationQuarterNotes(
        note,
        divisionsPerQuarter,
        notePlaybackDurationOptions(
          stepIndex,
          note,
          finalNoteKeys,
          consecutiveSameNoteKeys,
          fermataContext,
        ),
      );
      maxDuration = Math.max(maxDuration, noteDuration);
    }

    return maxDuration;
  });
}

export function resolveNotePlaybackDurationQuarterNotes(
  stepIndex: number,
  note: ScriptNote,
  script: PlaybackScript,
  stepDurations: number[],
  divisionsPerQuarter: number,
  finalNoteKeys: Set<string>,
  consecutiveSameNoteKeys: Set<string>,
  fermataContext: FermataPlaybackContext = buildFermataPlaybackContext(
    script,
    divisionsPerQuarter,
  ),
): number {
  const step = script[stepIndex];

  if (shouldUnifyStepPlaybackDuration(step, stepIndex, fermataContext)) {
    return stepDurations[stepIndex];
  }

  return notePlaybackDurationQuarterNotes(
    note,
    divisionsPerQuarter,
    notePlaybackDurationOptions(
      stepIndex,
      note,
      finalNoteKeys,
      consecutiveSameNoteKeys,
      fermataContext,
    ),
  );
}

/** Latest release point in the piece, in quarter-note units from the start. */
export function pieceEndQuarterNotes(
  script: PlaybackScript,
  divisionsPerQuarter: number,
): number {
  const finalNoteKeys = buildFinalNoteKeySet(script, divisionsPerQuarter);
  const fermataContext = buildFermataPlaybackContext(script, divisionsPerQuarter);
  const fermataOffsets = buildPlaybackFermataOffsetsByStep(
    script,
    divisionsPerQuarter,
    finalNoteKeys,
    fermataContext,
  );
  const consecutiveSameNoteKeys = buildConsecutiveSameNoteKeySet(
    script,
    divisionsPerQuarter,
    fermataOffsets,
  );
  const stepDurations = buildStepPlaybackDurationQuarterNotesByStep(
    script,
    divisionsPerQuarter,
    finalNoteKeys,
    consecutiveSameNoteKeys,
    fermataContext,
  );
  let endQuarters = 0;

  for (let stepIndex = 0; stepIndex < script.length; stepIndex += 1) {
    const step = script[stepIndex];
    const attackOnsetQuarters = scheduledPlaybackAttackQuarterNotes(
      step.onset,
      divisionsPerQuarter,
      fermataOffsets[stepIndex],
    );

    for (const note of step.notes) {
      const playedQuarterNotes = resolveNotePlaybackDurationQuarterNotes(
        stepIndex,
        note,
        script,
        stepDurations,
        divisionsPerQuarter,
        finalNoteKeys,
        consecutiveSameNoteKeys,
        fermataContext,
      );
      endQuarters = Math.max(
        endQuarters,
        attackOnsetQuarters + playedQuarterNotes,
      );
    }
  }

  return endQuarters;
}
