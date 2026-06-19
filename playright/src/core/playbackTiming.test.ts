import { describe, expect, it } from 'vitest';
import {
  noteDurationQuarterNotes,
  quarterNotesToSeconds,
  stepOnsetQuarterNotes,
} from './playbackTiming.ts';

describe('playbackTiming', () => {
  it('converts step onset from divisions to quarter notes', () => {
    expect(stepOnsetQuarterNotes(0, 480)).toBe(0);
    expect(stepOnsetQuarterNotes(480, 480)).toBe(1);
    expect(stepOnsetQuarterNotes(960, 480)).toBe(2);
  });

  it('converts note duration from divisions to quarter notes', () => {
    expect(noteDurationQuarterNotes(480, 480)).toBe(1);
    expect(noteDurationQuarterNotes(240, 480)).toBe(0.5);
  });

  it('converts quarter notes to seconds at a given BPM', () => {
    expect(quarterNotesToSeconds(1, 120)).toBe(0.5);
    expect(quarterNotesToSeconds(2, 100)).toBe(1.2);
  });
});
