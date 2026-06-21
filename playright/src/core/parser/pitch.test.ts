import { describe, expect, it } from 'vitest';
import {
  getMidiNumber,
  INVALID_MIDI,
  isValidPianoMidi,
} from './pitch.ts';

describe('getMidiNumber', () => {
  it('returns INVALID_MIDI for an unrecognized pitch step instead of 0', () => {
    expect(getMidiNumber('X', 4, 0)).toBe(INVALID_MIDI);
    expect(getMidiNumber('X', 4, 0)).not.toBe(0);
  });

  it('maps playable steps to MIDI note numbers', () => {
    expect(getMidiNumber('C', 4, 0)).toBe(60);
    expect(getMidiNumber('C', -1, 0)).toBe(0);
  });
});

describe('isValidPianoMidi', () => {
  it('accepts the standard 88-key piano range', () => {
    expect(isValidPianoMidi(21)).toBe(true);
    expect(isValidPianoMidi(108)).toBe(true);
    expect(isValidPianoMidi(20)).toBe(false);
    expect(isValidPianoMidi(109)).toBe(false);
  });
});
