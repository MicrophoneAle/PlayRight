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

/** Gap before the next attack for non-tied notes, in quarter-note units. */
export const PLAYBACK_ARTICULATION_GAP_QUARTERS = 0.06;

/** Played length after applying a release gap unless the note ties forward. */
export function playbackDurationQuarterNotes(
  writtenQuarterNotes: number,
  tiedToNext = false,
): number {
  if (tiedToNext || writtenQuarterNotes <= 0) {
    return writtenQuarterNotes;
  }

  const minPlayDuration = writtenQuarterNotes * 0.25;
  return Math.max(writtenQuarterNotes - PLAYBACK_ARTICULATION_GAP_QUARTERS, minPlayDuration);
}

/** Tone.js duration string for a span of quarter-note beats (scales with Transport BPM). */
export function quarterNotesToToneDuration(quarterNotes: number): string {
  if (quarterNotes <= 0) {
    return '4n';
  }

  return `${4 / quarterNotes}n`;
}
