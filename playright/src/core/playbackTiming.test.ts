import { describe, expect, it } from 'vitest';
import {
  articulationGapQuarterNotes,
  buildConsecutiveSameNoteKeySet,
  buildFinalNoteKeySet,
  buildPlaybackFermataOffsetsByStep,
  buildFermataPlaybackContext,
  buildStepPlaybackDurationQuarterNotesByStep,
  isPlaybackTieContinuation,
  isRepeatedPlaybackAttack,
  isSamePitchReattack,
  latestWrittenEndQuarterNotes,
  noteDurationQuarterNotes,
  playbackDurationQuarterNotes,
  playbackReleaseOnsetQuarterNotes,
  playbackSilenceBeforeNextAttackQuarters,
  pieceEndQuarterNotes,
  resolveNotePlaybackDurationQuarterNotes,
  shouldUnifyStepPlaybackDuration,
  PLAYBACK_ARTICULATION_GAP_MAX_QUARTERS,
  PLAYBACK_ARTICULATION_GAP_MIN_QUARTERS,
  PLAYBACK_CONSECUTIVE_SAME_NOTE_GAP_EXTRA_QUARTERS,
  PLAYBACK_CONSECUTIVE_SAME_NOTE_GAP_MAX_RATIO,
  PLAYBACK_FERMATA_HOLD_FACTOR,
  quarterNotesToSeconds,
  quarterNotesToTickDuration,
  quartersToTicks,
  quartersToTransportTickTime,
  scheduledPlaybackAttackQuarterNotes,
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

  it('uses a slightly shorter release when the same pitch re-attacks on the next step', () => {
    const written = 0.5;
    const normal = playbackDurationQuarterNotes(written);
    const consecutive = playbackDurationQuarterNotes(written, false, {
      followedByConsecutiveSameNote: true,
    });

    expect(consecutive).toBeLessThan(normal);
    expect(normal - consecutive).toBeCloseTo(
      PLAYBACK_CONSECUTIVE_SAME_NOTE_GAP_EXTRA_QUARTERS,
      5,
    );
    expect(articulationGapQuarterNotes(written, { followedByConsecutiveSameNote: true })).toBeCloseTo(
      articulationGapQuarterNotes(written) +
        PLAYBACK_CONSECUTIVE_SAME_NOTE_GAP_EXTRA_QUARTERS,
      5,
    );
  });

  it('flags any note whose same hand+pitch is re-attacked later', () => {
    const contiguousScript: PlaybackScript = [
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [{ pitch: 'E5', midi: 76, hand: 'R', finger: 1, durationDivisions: 240 }],
      },
      {
        order: 1,
        onset: 240,
        measureNumber: 1,
        notes: [{ pitch: 'E5', midi: 76, hand: 'R', finger: 1, durationDivisions: 240 }],
      },
    ];
    const separatedScript: PlaybackScript = [
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [{ pitch: 'E5', midi: 76, hand: 'R', finger: 1, durationDivisions: 240 }],
      },
      {
        order: 1,
        onset: 240,
        measureNumber: 1,
        notes: [{ pitch: 'G5', midi: 79, hand: 'R', finger: 1, durationDivisions: 240 }],
      },
      {
        order: 2,
        onset: 480,
        measureNumber: 1,
        notes: [{ pitch: 'E5', midi: 76, hand: 'R', finger: 1, durationDivisions: 240 }],
      },
    ];
    const restGappedScript: PlaybackScript = [
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [{ pitch: 'E5', midi: 76, hand: 'R', finger: 1, durationDivisions: 240 }],
      },
      {
        order: 1,
        onset: 480,
        measureNumber: 1,
        notes: [{ pitch: 'E5', midi: 76, hand: 'R', finger: 1, durationDivisions: 240 }],
      },
    ];
    const noRepeatScript: PlaybackScript = [
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [{ pitch: 'E5', midi: 76, hand: 'R', finger: 1, durationDivisions: 480 }],
      },
      {
        order: 1,
        onset: 480,
        measureNumber: 1,
        notes: [{ pitch: 'G5', midi: 79, hand: 'R', finger: 1, durationDivisions: 480 }],
      },
    ];

    expect(buildConsecutiveSameNoteKeySet(contiguousScript, 480)).toEqual(
      new Set(['0:R:76']),
    );
    expect(buildConsecutiveSameNoteKeySet(separatedScript, 480)).toEqual(
      new Set(['0:R:76']),
    );
    expect(buildConsecutiveSameNoteKeySet(restGappedScript, 480)).toEqual(
      new Set(['0:R:76']),
    );
    expect(buildConsecutiveSameNoteKeySet(noRepeatScript, 480)).toEqual(new Set());
  });

  it('caps the consecutive re-strike gap as a fraction of the written note length', () => {
    const shortWritten = 0.05;
    const gap = articulationGapQuarterNotes(shortWritten, {
      followedByConsecutiveSameNote: true,
    });

    expect(gap).toBeLessThanOrEqual(
      shortWritten * PLAYBACK_CONSECUTIVE_SAME_NOTE_GAP_MAX_RATIO,
    );
  });

  it('detects same-pitch re-attacks regardless of intervening notes', () => {
    const consecutiveScript: PlaybackScript = [
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [{ pitch: 'E5', midi: 76, hand: 'R', finger: 1, durationDivisions: 480 }],
      },
      {
        order: 1,
        onset: 480,
        measureNumber: 1,
        notes: [{ pitch: 'E5', midi: 76, hand: 'R', finger: 1, durationDivisions: 480 }],
      },
    ];
    const separatedScript: PlaybackScript = [
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [{ pitch: 'E5', midi: 76, hand: 'R', finger: 1, durationDivisions: 240 }],
      },
      {
        order: 1,
        onset: 240,
        measureNumber: 1,
        notes: [{ pitch: 'G5', midi: 79, hand: 'R', finger: 1, durationDivisions: 240 }],
      },
      {
        order: 2,
        onset: 480,
        measureNumber: 1,
        notes: [{ pitch: 'E5', midi: 76, hand: 'R', finger: 1, durationDivisions: 240 }],
      },
    ];
    const tiedScript: PlaybackScript = [
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [
          {
            pitch: 'E5',
            midi: 76,
            hand: 'R',
            finger: 1,
            durationDivisions: 480,
            tiedToNext: true,
          },
        ],
      },
      {
        order: 1,
        onset: 480,
        measureNumber: 1,
        notes: [{ pitch: 'E5', midi: 76, hand: 'R', finger: 1, durationDivisions: 480 }],
      },
    ];
    const nonConsecutiveScript: PlaybackScript = [
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [{ pitch: 'E5', midi: 76, hand: 'R', finger: 1, durationDivisions: 240 }],
      },
      {
        order: 1,
        onset: 240,
        measureNumber: 1,
        notes: [{ pitch: 'G5', midi: 79, hand: 'R', finger: 1, durationDivisions: 240 }],
      },
      {
        order: 2,
        onset: 480,
        measureNumber: 1,
        notes: [{ pitch: 'E5', midi: 76, hand: 'R', finger: 1, durationDivisions: 240 }],
      },
    ];

    expect(
      isRepeatedPlaybackAttack(consecutiveScript, 1, consecutiveScript[1].notes[0]),
    ).toBe(true);
    expect(
      isRepeatedPlaybackAttack(tiedScript, 1, tiedScript[1].notes[0]),
    ).toBe(false);
    expect(
      isRepeatedPlaybackAttack(nonConsecutiveScript, 2, nonConsecutiveScript[2].notes[0]),
    ).toBe(false);
    expect(
      isSamePitchReattack(consecutiveScript, 1, consecutiveScript[1].notes[0]),
    ).toBe(true);
    expect(
      isSamePitchReattack(separatedScript, 2, separatedScript[2].notes[0]),
    ).toBe(true);
    expect(
      isSamePitchReattack(separatedScript, 0, separatedScript[0].notes[0]),
    ).toBe(false);
    expect(isSamePitchReattack(tiedScript, 1, tiedScript[1].notes[0])).toBe(false);
    expect(isPlaybackTieContinuation(tiedScript, 1, tiedScript[1].notes[0])).toBe(true);
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

  it('extends fermata playback duration to exactly 2x the regular played length', () => {
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
    expect(fermataPlayback).toBeCloseTo(normalPlayback * 2, 5);
    expect(playbackReleaseOnsetQuarterNotes(0, writtenQuarters, false, {
      hasFermata: true,
    })).toBeCloseTo(fermataPlayback, 5);
  });

  it('keeps all notes in a fermata chord step held through the fermata release', () => {
    const script: PlaybackScript = [
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [
          {
            pitch: 'B4',
            midi: 71,
            hand: 'R',
            finger: null,
            durationDivisions: 1920,
            hasFermata: true,
          },
          {
            pitch: 'D#5',
            midi: 75,
            hand: 'R',
            finger: null,
            durationDivisions: 1920,
          },
          {
            pitch: 'B2',
            midi: 47,
            hand: 'L',
            finger: null,
            durationDivisions: 1920,
            hasFermata: true,
          },
        ],
      },
    ];
    const divisionsPerQuarter = 480;
    const finalNoteKeys = buildFinalNoteKeySet(script, divisionsPerQuarter);
    const fermataContext = buildFermataPlaybackContext(script, divisionsPerQuarter);
    const fermataOffsets = buildPlaybackFermataOffsetsByStep(
      script,
      divisionsPerQuarter,
      finalNoteKeys,
      fermataContext,
    );
    const consecutiveSameNoteKeys = buildConsecutiveSameNoteKeySet(
      script,
      divisionsPerQuarter,
      fermataOffsets,
    );
    const stepDurations = buildStepPlaybackDurationQuarterNotesByStep(
      script,
      divisionsPerQuarter,
      finalNoteKeys,
      consecutiveSameNoteKeys,
      fermataContext,
    );

    const fermataHold = playbackDurationQuarterNotes(4, false, {
      hasFermata: true,
      isFinalNote: true,
    });
    const chordToneHold = playbackDurationQuarterNotes(4, false, { isFinalNote: true });

    expect(stepDurations[0]).toBeCloseTo(fermataHold, 5);
    expect(stepDurations[0]).toBeGreaterThan(chordToneHold);
  });

  it('does not lengthen shorter notes in non-fermata steps', () => {
    const script: PlaybackScript = [
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [
          {
            pitch: 'C4',
            midi: 60,
            hand: 'R',
            finger: null,
            durationDivisions: 240,
          },
          {
            pitch: 'E4',
            midi: 64,
            hand: 'R',
            finger: null,
            durationDivisions: 480,
          },
        ],
      },
    ];
    const divisionsPerQuarter = 480;
    const finalNoteKeys = buildFinalNoteKeySet(script, divisionsPerQuarter);
    const fermataContext = buildFermataPlaybackContext(script, divisionsPerQuarter);
    const consecutiveSameNoteKeys = buildConsecutiveSameNoteKeySet(
      script,
      divisionsPerQuarter,
    );
    const stepDurations = buildStepPlaybackDurationQuarterNotesByStep(
      script,
      divisionsPerQuarter,
      finalNoteKeys,
      consecutiveSameNoteKeys,
      fermataContext,
    );

    const shortHold = playbackDurationQuarterNotes(0.5);

    expect(shouldUnifyStepPlaybackDuration(script[0], 0, fermataContext)).toBe(false);
    expect(stepDurations[0]).toBeCloseTo(1, 5);
    expect(
      resolveNotePlaybackDurationQuarterNotes(
        0,
        script[0].notes[0],
        script,
        stepDurations,
        divisionsPerQuarter,
        finalNoteKeys,
        consecutiveSameNoteKeys,
        fermataContext,
      ),
    ).toBeCloseTo(shortHold, 5);
  });

  it('keeps a bass half note length when shorter left-hand notes follow in the same measure', () => {
    const script: PlaybackScript = [
      {
        order: 0,
        onset: 0,
        measureNumber: 20,
        notes: [
          {
            pitch: 'E2',
            midi: 40,
            hand: 'L',
            finger: null,
            durationDivisions: 960,
          },
        ],
      },
      {
        order: 1,
        onset: 240,
        measureNumber: 20,
        notes: [{ pitch: 'F#2', midi: 42, hand: 'L', finger: null, durationDivisions: 240 }],
      },
      {
        order: 2,
        onset: 960,
        measureNumber: 20,
        notes: [{ pitch: 'E2', midi: 40, hand: 'L', finger: null, durationDivisions: 240 }],
      },
    ];
    const divisionsPerQuarter = 480;
    const finalNoteKeys = buildFinalNoteKeySet(script, divisionsPerQuarter);
    const consecutiveSameNoteKeys = buildConsecutiveSameNoteKeySet(
      script,
      divisionsPerQuarter,
    );
    const stepDurations = buildStepPlaybackDurationQuarterNotesByStep(
      script,
      divisionsPerQuarter,
      finalNoteKeys,
      consecutiveSameNoteKeys,
    );
    const halfNoteHold = resolveNotePlaybackDurationQuarterNotes(
      0,
      script[0].notes[0],
      script,
      stepDurations,
      divisionsPerQuarter,
      finalNoteKeys,
      consecutiveSameNoteKeys,
    );

    expect(halfNoteHold).toBeGreaterThan(1);
    expect(halfNoteHold).not.toBeCloseTo(0.5, 1);
  });

  it('schedules attacks from each step written onset', () => {
    const script: PlaybackScript = [
      {
        order: 0,
        onset: 0,
        measureNumber: 10,
        notes: [{ pitch: 'E2', midi: 40, hand: 'L', finger: null, durationDivisions: 240 }],
      },
      {
        order: 1,
        onset: 240,
        measureNumber: 10,
        notes: [{ pitch: 'F#2', midi: 42, hand: 'L', finger: null, durationDivisions: 240 }],
      },
      {
        order: 2,
        onset: 480,
        measureNumber: 10,
        notes: [{ pitch: 'C5', midi: 72, hand: 'R', finger: null, durationDivisions: 240 }],
      },
    ];

    expect(
      scheduledPlaybackAttackQuarterNotes(script[0].onset, 480, 0),
    ).toBe(0);
    expect(
      scheduledPlaybackAttackQuarterNotes(script[1].onset, 480, 0),
    ).toBe(0.5);
    expect(
      scheduledPlaybackAttackQuarterNotes(script[2].onset, 480, 0),
    ).toBe(1);
  });

  it('shifts subsequent attacks after a fermata so they do not overlap the extended release', () => {
    const script: PlaybackScript = [
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [
          {
            pitch: 'C4',
            midi: 60,
            hand: 'R',
            finger: null,
            durationDivisions: 480,
            hasFermata: true,
          },
        ],
      },
      {
        order: 1,
        onset: 480,
        measureNumber: 1,
        notes: [
          {
            pitch: 'D4',
            midi: 62,
            hand: 'R',
            finger: null,
            durationDivisions: 480,
          },
        ],
      },
    ];
    const divisionsPerQuarter = 480;
    const finalNoteKeys = buildFinalNoteKeySet(script, divisionsPerQuarter);
    const fermataOffsets = buildPlaybackFermataOffsetsByStep(
      script,
      divisionsPerQuarter,
      finalNoteKeys,
    );
    const writtenQuarters = 1;

    const fermataAttack = scheduledPlaybackAttackQuarterNotes(
      script[0].onset,
      divisionsPerQuarter,
      fermataOffsets[0],
    );
    const fermataRelease =
      fermataAttack +
      playbackDurationQuarterNotes(writtenQuarters, false, { hasFermata: true });
    const nextAttack = scheduledPlaybackAttackQuarterNotes(
      script[1].onset,
      divisionsPerQuarter,
      fermataOffsets[1],
    );
    const writtenNextAttack = stepOnsetQuarterNotes(script[1].onset, divisionsPerQuarter);

    expect(fermataOffsets[1]).toBeGreaterThan(0);
    expect(nextAttack).toBeGreaterThan(writtenNextAttack);
    expect(nextAttack).toBeGreaterThanOrEqual(fermataRelease - 1e-9);
  });
});
