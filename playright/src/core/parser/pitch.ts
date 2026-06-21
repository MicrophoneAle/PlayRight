export const NATURAL_PITCH_STEPS = new Set(['C', 'D', 'E', 'F', 'G', 'A', 'B']);

/** Returned by {@link getMidiNumber} when the pitch step cannot be mapped. */
export const INVALID_MIDI = -1;

export const PIANO_MIDI_MIN = 21;
export const PIANO_MIDI_MAX = 108;

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

/** True when a MusicXML pitch step can map to a playable MIDI note. */
export function isPlayablePitchStep(step: string): boolean {
  const letter = step.trim().charAt(0).toUpperCase();
  return NATURAL_PITCH_STEPS.has(letter);
}

/** Maps MusicXML `<accidental>` text to semitone alteration; unknown names yield null. */
export function accidentalAlterFromText(text: string): number | null {
  const normalized = text.trim().toLowerCase().replace(/_/g, '-');

  switch (normalized) {
    case 'sharp':
      return 1;
    case 'flat':
      return -1;
    case 'natural':
      return 0;
    case 'double-sharp':
    case 'sharp-sharp':
      return 2;
    case 'flat-flat':
    case 'double-flat':
      return -2;
    default:
      return null;
  }
}

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

export function isValidPianoMidi(midi: number): boolean {
  return midi >= PIANO_MIDI_MIN && midi <= PIANO_MIDI_MAX;
}

export function getMidiNumber(step: string, octave: number, alter = 0): number {
  const baseLetter = step.trim().charAt(0).toUpperCase();
  const naturalSemitone = NATURAL_SEMITONES[baseLetter];

  if (naturalSemitone === undefined) {
    return INVALID_MIDI;
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
