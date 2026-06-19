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

/** Tone.js duration string for a span of quarter-note beats (scales with Transport BPM). */
export function quarterNotesToToneDuration(quarterNotes: number): string {
  if (quarterNotes <= 0) {
    return '4n';
  }

  return `${4 / quarterNotes}n`;
}
