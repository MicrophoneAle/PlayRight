import { describe, expect, it } from 'vitest';
import {
  articulationGapQuarterNotes,
  buildFinalNoteKeySet,
  latestWrittenEndQuarterNotes,
  noteDurationQuarterNotes,
  playbackDurationQuarterNotes,
  playbackReleaseOnsetQuarterNotes,
  playbackSilenceBeforeNextAttackQuarters,
  pieceEndQuarterNotes,
  PLAYBACK_ARTICULATION_GAP_MAX_QUARTERS,
  PLAYBACK_ARTICULATION_GAP_MIN_QUARTERS,
  PLAYBACK_FERMATA_HOLD_FACTOR,
  quarterNotesToSeconds,
  quarterNotesToTickDuration,
  quartersToTicks,
  quartersToTransportTickTime,
  stepOnsetQuarterNotes,
} from './playbackTiming.ts';
import type { PlaybackScript } from '../types/index.ts';

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

  it('converts dotted-quarter position and duration to exact ticks', () => {
    const ppq = 192;
    const dottedQuarter = 1.5;

    expect(quartersToTicks(dottedQuarter, ppq)).toBe(288);
    expect(quartersToTicks(2.5, ppq)).toBe(480);
    expect(quartersToTransportTickTime(2.5, ppq)).toBe('480i');
    expect(quarterNotesToTickDuration(dottedQuarter, ppq)).toBe('288i');
  });

  it('converts eighth-triplet position and duration to exact ticks', () => {
    const ppq = 192;
    const tripletEighth = 1 / 3;

    expect(quartersToTicks(tripletEighth, ppq)).toBe(64);
    expect(quartersToTicks(4 / 3, ppq)).toBe(256);
    expect(quartersToTransportTickTime(4 / 3, ppq)).toBe('256i');
    expect(quarterNotesToTickDuration(tripletEighth, ppq)).toBe('64i');
  });

  it('scales articulation gaps by note length with min and max clamps', () => {
    expect(articulationGapQuarterNotes(0.25)).toBe(
      PLAYBACK_ARTICULATION_GAP_MIN_QUARTERS,
    );
    expect(articulationGapQuarterNotes(1)).toBeCloseTo(0.035, 5);
    expect(articulationGapQuarterNotes(4)).toBe(
      PLAYBACK_ARTICULATION_GAP_MAX_QUARTERS,
    );
  });

  it('shortens non-tied playback durations by a duration-aware articulation gap', () => {
    expect(playbackDurationQuarterNotes(1)).toBeCloseTo(0.965, 5);
    expect(playbackDurationQuarterNotes(2)).toBeCloseTo(1.95, 5);
    expect(playbackDurationQuarterNotes(0.5)).toBeCloseTo(0.48, 5);
  });

  it('keeps tied and final playback durations at the written length', () => {
    expect(playbackDurationQuarterNotes(1, true)).toBe(1);
    expect(playbackDurationQuarterNotes(2, true)).toBe(2);
    expect(playbackDurationQuarterNotes(4, false, { isFinalNote: true })).toBe(4);
  });

  it('leaves proportional silence before the next attack for common note lengths', () => {
    for (const written of [0.25, 0.5, 1, 2, 4]) {
      const release = playbackReleaseOnsetQuarterNotes(0, written);
      const nextAttack = written;
      const silenceGap = nextAttack - release;

      expect(silenceGap).toBeCloseTo(
        playbackSilenceBeforeNextAttackQuarters(written),
        5,
      );
      expect(silenceGap).toBeCloseTo(articulationGapQuarterNotes(written), 5);
    }
  });

  it('identifies notes that end the written timeline', () => {
    const script: PlaybackScript = [
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: null, durationDivisions: 480 }],
      },
      {
        order: 1,
        onset: 480,
        measureNumber: 1,
        notes: [{ pitch: 'D4', midi: 62, hand: 'R', finger: null, durationDivisions: 1920 }],
      },
    ];

    expect(latestWrittenEndQuarterNotes(script, 480)).toBeCloseTo(5, 5);
    expect(buildFinalNoteKeySet(script, 480)).toEqual(new Set(['1:R:62']));
  });

  it('finds the latest note release across a script', () => {
    const end = pieceEndQuarterNotes(
      [
        {
          order: 0,
          onset: 0,
        measureNumber: 1,
          notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: null, durationDivisions: 480 }],
        },
        {
          order: 1,
          onset: 480,
        measureNumber: 1,
          notes: [
            { pitch: 'E4', midi: 64, hand: 'R', finger: null, durationDivisions: 240 },
            { pitch: 'G4', midi: 67, hand: 'R', finger: null, durationDivisions: 480 },
          ],
        },
      ],
      480,
    );

    expect(end).toBeCloseTo(2, 5);
  });

  it('holds the final note through its full written duration', () => {
    const end = pieceEndQuarterNotes(
      [
        {
          order: 0,
          onset: 0,
        measureNumber: 1,
          notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: null, durationDivisions: 480 }],
        },
        {
          order: 1,
          onset: 480,
        measureNumber: 1,
          notes: [{ pitch: 'E4', midi: 64, hand: 'R', finger: null, durationDivisions: 7680 }],
        },
      ],
      480,
    );

    expect(end).toBeCloseTo(17, 5);
  });

  it('extends fermata playback duration in play mode without changing practice timing', () => {
    const writtenQuarters = 4;
    const divisionsPerQuarter = 480;

    const practiceDuration = noteDurationQuarterNotes(
      writtenQuarters * divisionsPerQuarter,
      divisionsPerQuarter,
    );
    expect(practiceDuration).toBe(writtenQuarters);

    const normalPlayback = playbackDurationQuarterNotes(writtenQuarters);
    const fermataPlayback = playbackDurationQuarterNotes(writtenQuarters, false, {
      hasFermata: true,
    });

    expect(normalPlayback).toBeCloseTo(3.95, 2);
    expect(fermataPlayback).toBeCloseTo(
      normalPlayback * PLAYBACK_FERMATA_HOLD_FACTOR,
      5,
    );
    expect(playbackReleaseOnsetQuarterNotes(0, writtenQuarters, false, {
      hasFermata: true,
    })).toBeCloseTo(fermataPlayback, 5);
  });
});
