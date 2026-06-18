const NATURAL_SEMITONES: Readonly<Record<string, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'] as const;
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'] as const;

/** Key-signature accidental when MusicXML omits `<alter>`. */
export function keyAlterForStep(step: string, fifths: number): number {
  const letter = step.trim().charAt(0).toUpperCase();
  if (!letter) {
    return 0;
  }

  if (fifths > 0) {
    return SHARP_ORDER.slice(0, fifths).includes(letter as (typeof SHARP_ORDER)[number])
      ? 1
      : 0;
  }

  if (fifths < 0) {
    return FLAT_ORDER.slice(0, -fifths).includes(letter as (typeof FLAT_ORDER)[number])
      ? -1
      : 0;
  }

  return 0;
}

export function getMidiNumber(step: string, octave: number, alter = 0): number {
  const baseLetter = step.trim().charAt(0).toUpperCase();
  const naturalSemitone = NATURAL_SEMITONES[baseLetter];

  if (naturalSemitone === undefined) {
    return 0;
  }

  return (octave + 1) * 12 + naturalSemitone + alter;
}

export function formatPitch(step: string, octave: number, alter = 0): string {
  const letter = step.trim().charAt(0).toUpperCase();
  if (!letter) {
    return String(octave);
  }

  const accidental =
    alter === 2 ? '##' : alter === 1 ? '#' : alter === -1 ? 'b' : alter === -2 ? 'bb' : '';

  return `${letter}${accidental}${octave}`;
}
