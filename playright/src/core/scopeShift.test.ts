import { describe, expect, it } from 'vitest';
import {
  FULL_SCOPE_SIZE,
  getDisplayScopeMidiBounds,
  PIANO_START_MIDI,
} from './InputManager.ts';
import { shiftScopeStart } from './scopeShift.ts';

describe('shiftScopeStart', () => {
  it('shifts by one semitone in semitone mode', () => {
    expect(shiftScopeStart(60, 'up', 'semitone')).toBe(61);
    expect(shiftScopeStart(60, 'down', 'semitone')).toBe(59);
  });

  it('shifts by twelve semitones in octave mode', () => {
    expect(shiftScopeStart(60, 'up', 'octave')).toBe(72);
    expect(shiftScopeStart(72, 'down', 'octave')).toBe(60);
  });

  it('shifts the full visible display window in full-range mode', () => {
    const before = getDisplayScopeMidiBounds(60);
    const afterStart = shiftScopeStart(60, 'up', 'full-range');
    const after = getDisplayScopeMidiBounds(afterStart);

    expect(afterStart - 60).toBe(FULL_SCOPE_SIZE);
    expect(after.min).toBe(before.max + 1);
    expect(after.max - after.min + 1).toBe(FULL_SCOPE_SIZE);
  });

  it('clamps full-range shifts at the piano bounds', () => {
    expect(shiftScopeStart(PIANO_START_MIDI, 'down', 'full-range')).toBe(
      PIANO_START_MIDI,
    );
  });

  it('does not shift by the 17-semitone core size in full-range mode', () => {
    const scopeSize = 17;
    const afterStart = shiftScopeStart(60, 'up', 'full-range');

    expect(afterStart - 60).not.toBe(scopeSize);
    expect(afterStart - 60).toBe(FULL_SCOPE_SIZE);
  });
});
