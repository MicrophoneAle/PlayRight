import type { Hand, PlaybackScript } from '../types/index.ts';

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

/** @deprecated Use articulationGapQuarterNotes() for duration-aware gaps. */
export const PLAYBACK_ARTICULATION_GAP_QUARTERS = PLAYBACK_ARTICULATION_GAP_MAX_QUARTERS;

export interface PlaybackDurationOptions {
  /** Play through the full written length (no pre-release gap). */
  isFinalNote?: boolean;
}

/** Gap before the next attack, scaled by note length with min/max clamps. */
export function articulationGapQuarterNotes(writtenQuarterNotes: number): number {
  if (writtenQuarterNotes <= 0) {
    return 0;
  }

  const proportional = writtenQuarterNotes * PLAYBACK_ARTICULATION_GAP_RATIO;
  return Math.min(
    PLAYBACK_ARTICULATION_GAP_MAX_QUARTERS,
    Math.max(PLAYBACK_ARTICULATION_GAP_MIN_QUARTERS, proportional),
  );
}

/** Played length after applying a release gap unless the note ties forward or ends the piece. */
export function playbackDurationQuarterNotes(
  writtenQuarterNotes: number,
  tiedToNext = false,
  options: PlaybackDurationOptions = {},
): number {
  if (tiedToNext || writtenQuarterNotes <= 0) {
    return writtenQuarterNotes;
  }

  if (options.isFinalNote) {
    return writtenQuarterNotes;
  }

  const gap = articulationGapQuarterNotes(writtenQuarterNotes);
  const minPlayDuration = writtenQuarterNotes * 0.25;
  return Math.max(writtenQuarterNotes - gap, minPlayDuration);
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

/** Tone.js duration string for a span of quarter-note beats (scales with Transport BPM). */
export function quarterNotesToToneDuration(quarterNotes: number): string {
  if (quarterNotes <= 0) {
    return '4n';
  }

  return `${4 / quarterNotes}n`;
}

function playbackNoteKey(stepIndex: number, hand: Hand, midi: number): string {
  return `${stepIndex}:${hand}:${midi}`;
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

/** Latest release point in the piece, in quarter-note units from the start. */
export function pieceEndQuarterNotes(
  script: PlaybackScript,
  divisionsPerQuarter: number,
): number {
  const finalNoteKeys = buildFinalNoteKeySet(script, divisionsPerQuarter);
  let endQuarters = 0;

  for (let stepIndex = 0; stepIndex < script.length; stepIndex += 1) {
    const step = script[stepIndex];
    const onsetQuarters = stepOnsetQuarterNotes(step.onset, divisionsPerQuarter);

    for (const note of step.notes) {
      const durationDivisions = note.durationDivisions ?? divisionsPerQuarter;
      const writtenQuarters = noteDurationQuarterNotes(
        durationDivisions,
        divisionsPerQuarter,
      );
      const isFinalNote = finalNoteKeys.has(
        playbackNoteKey(stepIndex, note.hand, note.midi),
      );
      const playedQuarters = playbackDurationQuarterNotes(
        writtenQuarters,
        note.tiedToNext ?? false,
        { isFinalNote },
      );
      endQuarters = Math.max(endQuarters, onsetQuarters + playedQuarters);
    }
  }

  return endQuarters;
}
