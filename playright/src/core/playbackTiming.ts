import type { Hand, PlaybackScript, ScriptNote, TempoMapEntry } from '../types/index.ts';

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

/**
 * BPM active at a document-order onset (canonical divisions). Entries must be
 * sorted by onset ascending; the last marking with onset <= target wins.
 */
export function tempoBpmAtOnset(
  tempoMap: TempoMapEntry[],
  onset: number,
  fallbackBpm: number,
): number {
  if (tempoMap.length === 0) {
    return fallbackBpm;
  }

  let active = tempoMap[0].bpm;
  for (const entry of tempoMap) {
    if (entry.onset > onset) {
      break;
    }
    active = entry.bpm;
  }
  return active;
}

/**
 * Per-playback-entry BPM from the document-onset tempo map. Does not assume
 * monotonically increasing document onsets — repeat/jump orders may revisit
 * earlier onsets, and the map lookup stays keyed on score position.
 */
export function tempoBpmsAlongPlaybackOrder(
  script: PlaybackScript,
  playbackOrder: Array<{ stepIndex: number }>,
  tempoMap: TempoMapEntry[],
  fallbackBpm: number,
): number[] {
  return playbackOrder.map((entry) =>
    tempoBpmAtOnset(tempoMap, script[entry.stepIndex].onset, fallbackBpm),
  );
}

/**
 * Playback-order entry indices where Transport BPM should change relative to
 * the previous entry (the schedule condition used by PlaybackEngine).
 */
export function tempoChangePlaybackEntryIndices(bpmsAlongOrder: number[]): number[] {
  const indices: number[] = [];
  for (let entryIndex = 1; entryIndex < bpmsAlongOrder.length; entryIndex += 1) {
    if (bpmsAlongOrder[entryIndex] !== bpmsAlongOrder[entryIndex - 1]) {
      indices.push(entryIndex);
    }
  }
  return indices;
}

/**
 * Wall-clock seconds from musical quarter 0 through `endQuarterNotes`, walking
 * tempo-map segments. Used for library duration; play transport uses Tone BPM
 * changes on the tick timeline instead.
 */
export function quarterNotesToSecondsWithTempoMap(
  endQuarterNotes: number,
  tempoMap: TempoMapEntry[],
  divisionsPerQuarter: number,
  fallbackBpm: number,
): number {
  if (endQuarterNotes <= 0) {
    return 0;
  }

  const map =
    tempoMap.length > 0
      ? tempoMap
      : [{ onset: 0, bpm: fallbackBpm }];
  let seconds = 0;
  let cursorQuarters = 0;

  for (let i = 0; i < map.length; i += 1) {
    const segmentStartQuarters = map[i].onset / divisionsPerQuarter;
    const segmentEndQuarters =
      i + 1 < map.length
        ? map[i + 1].onset / divisionsPerQuarter
        : endQuarterNotes;
    const from = Math.max(cursorQuarters, segmentStartQuarters);
    const to = Math.min(endQuarterNotes, segmentEndQuarters);
    if (to > from) {
      seconds += quarterNotesToSeconds(to - from, map[i].bpm);
      cursorQuarters = to;
    }
    if (cursorQuarters >= endQuarterNotes) {
      break;
    }
  }

  if (cursorQuarters < endQuarterNotes) {
    seconds += quarterNotesToSeconds(
      endQuarterNotes - cursorQuarters,
      map[map.length - 1]?.bpm ?? fallbackBpm,
    );
  }

  return seconds;
}

/** Pre-schedule this many quarter-note beats ahead of the transport. */
export const PLAYBACK_SCHEDULE_AHEAD_QUARTERS = 24;

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

/**
 * Play-mode fraction of a staccato note's written length used as the sounded
 * base, before the normal articulation gap is subtracted on top (the two
 * effects compound, matching the fermata-hold-factor pattern of only
 * touching duration - the attack/onset time never moves).
 */
export const PLAYBACK_STACCATO_DURATION_RATIO = 0.5;

/**
 * Play-mode fraction of a staccatissimo note's written length - more clipped
 * than plain staccato but kept above the universal 0.25 floor below (see
 * `basePlaybackDurationQuarterNotes`) so the articulation gap still has room
 * to compound on top, the same way it does for staccato, instead of being
 * swallowed by the floor at every note length.
 */
export const PLAYBACK_STACCATISSIMO_DURATION_RATIO = 0.3;

/**
 * Play-mode fraction of a tenuto note's written length: the full value.
 * Tenuto suppresses the normal articulation gap entirely (see
 * `basePlaybackDurationQuarterNotes`) rather than compounding with it -
 * the opposite of staccato's shortening.
 */
export const PLAYBACK_TENUTO_DURATION_RATIO = 1;

/**
 * Play-mode fraction of a detached-legato (portato) note's written length -
 * between tenuto's full hold and staccato's ~half, giving a "connected but
 * gently separated" character distinct from both.
 */
export const PLAYBACK_DETACHED_LEGATO_DURATION_RATIO = 0.75;

/**
 * Play-mode fraction of a marcato note's written length - detached like
 * staccato but usually less extreme, so it sits between plain staccato and
 * detached-legato. Marcato's loudness/emphasis component is a v1 no-op (see
 * PlaybackEngine's scheduleAttackRelease comment); only duration shortening
 * is applied here.
 */
export const PLAYBACK_MARCATO_DURATION_RATIO = 0.7;

/**
 * Safety cap on the EXTRA hold time a fermata can add, in quarter notes
 * (tempo-independent, matching this module's other units). Backstops the
 * unify-reference fix above in case a fermata ever lands on an unusually
 * long note some other way - a fermata should never be able to produce an
 * unboundedly long dead hold.
 */
export const PLAYBACK_FERMATA_MAX_EXTENSION_QUARTERS = 8;

export interface PlaybackDurationOptions {
  /** Play through the full written length (no pre-release gap). */
  isFinalNote?: boolean;
  /** Play mode only: extend held duration for fermata-marked notes. */
  hasFermata?: boolean;
  /** Same hand+pitch re-attacks immediately at this note's written end. */
  followedByConsecutiveSameNote?: boolean;
  /** Play mode only: shorten held duration for staccato-marked notes. */
  hasStaccato?: boolean;
  /** Play mode only: shorten held duration further for staccatissimo-marked notes. */
  hasStaccatissimo?: boolean;
  /** Play mode only: hold the full written duration, suppressing the articulation gap. */
  hasTenuto?: boolean;
  /** Play mode only: light separation for detached-legato (portato) notes. */
  hasDetachedLegato?: boolean;
  /** Play mode only: shorten held duration for marcato-marked notes (loudness is a v1 no-op). */
  hasMarcato?: boolean;
  /**
   * Play mode only: hold the full written length so this note connects legato
   * into the next note of its voice (S1 consumer of ScriptNote.slurLegatoNext;
   * set on every slur member except the last). Yields to duration-shortening
   * articulations (dots under a slur = portato: the note-level mark is the
   * more specific instruction). Callers must clear this flag when the same
   * hand+pitch re-attacks at this note's release (suppressing the gap there
   * would merge two attacks into one continuous tone) -
   * notePlaybackDurationOptions does so from script adjacency via
   * slurLegatoBlockedByImmediateReattack. Only that IMMEDIATE case is a merge
   * risk; the any-spacing followedByConsecutiveSameNote set (a pitch
   * recurring anywhere later, i.e. most notes in tonal music) must NOT gate
   * slur legato or the feature would be silently inert on real scores.
   */
  hasSlurLegatoNext?: boolean;
}

type ArticulationDurationOptions = Pick<
  PlaybackDurationOptions,
  'hasStaccato' | 'hasStaccatissimo' | 'hasTenuto' | 'hasDetachedLegato' | 'hasMarcato'
>;

interface ArticulationDurationEffect {
  ratio: number;
  suppressGap: boolean;
}

/**
 * Resolves which single articulation drives the duration when a note somehow
 * carries more than one (rare, but not forbidden by MusicXML). Precedence,
 * most-authoritative first:
 *  1. Tenuto always wins, gap suppressed - real scores pair a staccato dot
 *     with a tenuto line to notate "mezzo staccato"/portato, which reads
 *     closer to a full-value tenuto hold than a plain staccato clip, so
 *     tenuto overriding staccato matches that convention rather than
 *     fighting it.
 *  2. Staccatissimo, then staccato, then marcato, then detached-legato -
 *     ordered from most to least clipped, so an accidental double-marking
 *     among the shortening articulations resolves to the more specific one.
 */
function resolveArticulationDurationEffect(
  options: ArticulationDurationOptions,
): ArticulationDurationEffect {
  if (options.hasTenuto) {
    return { ratio: PLAYBACK_TENUTO_DURATION_RATIO, suppressGap: true };
  }
  if (options.hasStaccatissimo) {
    return { ratio: PLAYBACK_STACCATISSIMO_DURATION_RATIO, suppressGap: false };
  }
  if (options.hasStaccato) {
    return { ratio: PLAYBACK_STACCATO_DURATION_RATIO, suppressGap: false };
  }
  if (options.hasMarcato) {
    return { ratio: PLAYBACK_MARCATO_DURATION_RATIO, suppressGap: false };
  }
  if (options.hasDetachedLegato) {
    return { ratio: PLAYBACK_DETACHED_LEGATO_DURATION_RATIO, suppressGap: false };
  }
  return { ratio: 1, suppressGap: false };
}

/** True for any articulation that clips duration below the written length (tenuto never does). */
function hasDurationShorteningArticulation(options: ArticulationDurationOptions): boolean {
  return Boolean(
    options.hasStaccatissimo ||
      options.hasStaccato ||
      options.hasMarcato ||
      options.hasDetachedLegato,
  );
}

function basePlaybackDurationQuarterNotes(
  writtenQuarterNotes: number,
  tiedToNext: boolean,
  options: Pick<
    PlaybackDurationOptions,
    | 'isFinalNote'
    | 'followedByConsecutiveSameNote'
    | 'hasStaccato'
    | 'hasStaccatissimo'
    | 'hasTenuto'
    | 'hasDetachedLegato'
    | 'hasMarcato'
    | 'hasSlurLegatoNext'
  >,
): number {
  if (tiedToNext || writtenQuarterNotes <= 0) {
    return writtenQuarterNotes;
  }

  // A final note marked with a duration-shortening articulation is meant to
  // sound clipped, not ring out - the only exception to "final note plays
  // its full written length" is one of those articulations explicitly
  // asking for less. Tenuto never shortens, so it never trips this branch.
  if (options.isFinalNote && !hasDurationShorteningArticulation(options)) {
    return writtenQuarterNotes;
  }

  const { ratio, suppressGap } = resolveArticulationDurationEffect(options);
  const articulatedBaseQuarterNotes = writtenQuarterNotes * ratio;

  if (suppressGap) {
    return articulatedBaseQuarterNotes;
  }

  // Slur legato: one alternative base-duration path (full written length, no
  // gap), never a multiplier on top of another effect. Ordering is what
  // enforces the precedence table: tenuto already returned above (idempotent
  // - both resolve to the written length exactly once); a duration-shortening
  // articulation (staccato/staccatissimo/marcato/detached-legato) is the more
  // specific per-note instruction and wins by skipping this branch.
  // Deliberately NOT gated on followedByConsecutiveSameNote: that set is
  // any-spacing (see hasSlurLegatoNext's doc) - the immediate re-strike merge
  // risk is handled upstream by notePlaybackDurationOptions clearing the flag.
  if (options.hasSlurLegatoNext && !hasDurationShorteningArticulation(options)) {
    return writtenQuarterNotes;
  }

  const gap = articulationGapQuarterNotes(writtenQuarterNotes, options);
  const minPlayDuration = writtenQuarterNotes * 0.25;
  return Math.max(articulatedBaseQuarterNotes - gap, minPlayDuration);
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

    // Delegating steps (a fermata pickup abutting the next sonority) must not
    // pre-push the carried step's attack time. The carried step's own
    // stepHasFermataHold block below derives the correct post-hold push from
    // its actual (on-time) attack and extended release, so pushing here too
    // would double-count the extension as bogus silence before the attack.
    if (!fermataContext.delegateToNextStep.has(stepIndex)) {
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

  const uncappedExtension = baseDuration * (PLAYBACK_FERMATA_HOLD_FACTOR - 1);
  return baseDuration + Math.min(uncappedExtension, PLAYBACK_FERMATA_MAX_EXTENSION_QUARTERS);
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

/**
 * True when this note's slur-legato release (the full written length) would
 * land on an immediate re-attack of the same hand+pitch: the very next step
 * attacks the same key at or before this note's written end. Only this
 * immediate case can merge two attacks into one continuous tone - a later
 * recurrence of the pitch (buildConsecutiveSameNoteKeySet's any-spacing set)
 * lies beyond the suppressed release and is irrelevant to the slur.
 */
export function slurLegatoBlockedByImmediateReattack(
  script: PlaybackScript,
  stepIndex: number,
  note: ScriptNote,
  divisionsPerQuarter: number,
): boolean {
  const nextStep = script[stepIndex + 1];
  if (nextStep === undefined) {
    return false;
  }

  const writtenEnd =
    script[stepIndex].onset + (note.durationDivisions ?? divisionsPerQuarter);
  if (nextStep.onset > writtenEnd + FERMATA_ONSET_EPSILON_DIVISIONS) {
    return false;
  }

  return nextStep.notes.some(
    (candidate) =>
      candidate.midi === note.midi &&
      candidate.hand === note.hand &&
      !isPlaybackTieContinuation(script, stepIndex + 1, candidate),
  );
}

export function notePlaybackDurationOptions(
  stepIndex: number,
  note: ScriptNote,
  finalNoteKeys: Set<string>,
  consecutiveSameNoteKeys: Set<string>,
  fermataContext: FermataPlaybackContext,
  /** Document script for immediate-reattack masking; omitted = flag passes through unmasked. */
  script?: PlaybackScript,
  divisionsPerQuarter?: number,
): PlaybackDurationOptions {
  const slurLegatoNext =
    (note.slurLegatoNext ?? false) &&
    (script === undefined ||
      !slurLegatoBlockedByImmediateReattack(
        script,
        stepIndex,
        note,
        divisionsPerQuarter ?? 1,
      ));

  return {
    isFinalNote: finalNoteKeys.has(playbackNoteKey(stepIndex, note.hand, note.midi)),
    hasFermata: effectiveNoteHasFermata(stepIndex, note, fermataContext),
    followedByConsecutiveSameNote: consecutiveSameNoteKeys.has(
      playbackNoteKey(stepIndex, note.hand, note.midi),
    ),
    hasStaccato: note.hasStaccato ?? false,
    hasStaccatissimo: note.hasStaccatissimo ?? false,
    hasTenuto: note.hasTenuto ?? false,
    hasDetachedLegato: note.hasDetachedLegato ?? false,
    hasMarcato: note.hasMarcato ?? false,
    hasSlurLegatoNext: slurLegatoNext,
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
    const unify = shouldUnifyStepPlaybackDuration(step, stepIndex, fermataContext);

    // When unifying a fermata step's release, only let notes that actually
    // carry the fermata weight drive the extended duration: notes with
    // their own written hasFermata mark, or - for a pure carry-forward step
    // where nothing is directly marked - the step's shortest written
    // note(s). A carry-forward step marks EVERY note as effectively
    // fermata'd (see effectiveNoteHasFermata), including notes that are
    // independently long for unrelated reasons (e.g. a bass note whose
    // written length already spans multiple tied-together measures);
    // letting that already-extended length drive the unify max would
    // multiply an already-long duration by the fermata factor again.
    let referenceNotes = step.notes;
    if (unify && !step.notes.some((note) => note.hasFermata)) {
      const writtenQuartersOf = (note: ScriptNote): number =>
        noteDurationQuarterNotes(
          note.durationDivisions ?? divisionsPerQuarter,
          divisionsPerQuarter,
        );
      const minWritten = Math.min(...step.notes.map(writtenQuartersOf));
      referenceNotes = step.notes.filter(
        (note) => writtenQuartersOf(note) === minWritten,
      );
    }

    let maxDuration = 0;

    for (const note of referenceNotes) {
      const noteDuration = notePlaybackDurationQuarterNotes(
        note,
        divisionsPerQuarter,
        notePlaybackDurationOptions(
          stepIndex,
          note,
          finalNoteKeys,
          consecutiveSameNoteKeys,
          fermataContext,
          script,
          divisionsPerQuarter,
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
      script,
      divisionsPerQuarter,
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
