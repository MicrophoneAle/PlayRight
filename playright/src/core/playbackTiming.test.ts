import { describe, expect, it } from 'vitest';
import {
  noteDurationQuarterNotes,
  playbackDurationQuarterNotes,
  playbackReleaseOnsetQuarterNotes,
  playbackSilenceBeforeNextAttackQuarters,
  pieceEndQuarterNotes,
  PLAYBACK_ARTICULATION_GAP_QUARTERS,
  quarterNotesToSeconds,
  quarterNotesToToneDuration,
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

  it('converts quarter notes to wall-clock seconds at a given BPM', () => {
    expect(quarterNotesToSeconds(1, 120)).toBe(0.5);
    expect(quarterNotesToSeconds(2, 60)).toBe(2);
  });

  it('converts quarter notes to Tone duration strings', () => {
    expect(quarterNotesToToneDuration(1)).toBe('4n');
    expect(quarterNotesToToneDuration(2)).toBe('2n');
    expect(quarterNotesToToneDuration(0.5)).toBe('8n');
    expect(quarterNotesToToneDuration(4)).toBe('1n');
  });

  it('shortens non-tied playback durations by a small articulation gap', () => {
    expect(playbackDurationQuarterNotes(1)).toBeCloseTo(0.88, 5);
    expect(playbackDurationQuarterNotes(2)).toBeCloseTo(1.88, 5);
    expect(playbackDurationQuarterNotes(0.5)).toBeCloseTo(0.38, 5);
  });

  it('keeps tied playback durations at the written length', () => {
    expect(playbackDurationQuarterNotes(1, true)).toBe(1);
    expect(playbackDurationQuarterNotes(2, true)).toBe(2);
  });

  it('leaves the same silence before the next attack for repeated and changing pitches', () => {
    for (const written of [1, 0.5, 2]) {
      const release = playbackReleaseOnsetQuarterNotes(0, written);
      const nextAttack = written;
      const silenceGap = nextAttack - release;

      expect(silenceGap).toBeCloseTo(
        playbackSilenceBeforeNextAttackQuarters(written),
        5,
      );
      expect(silenceGap).toBeCloseTo(PLAYBACK_ARTICULATION_GAP_QUARTERS, 5);
    }
  });

  it('finds the latest note release across a script', () => {
    const end = pieceEndQuarterNotes(
      [
        {
          onset: 0,
          notes: [{ durationDivisions: 480 }],
        },
        {
          onset: 480,
          notes: [{ durationDivisions: 240 }, { durationDivisions: 480 }],
        },
      ],
      480,
    );

    expect(end).toBeCloseTo(1.88, 5);
  });
});
