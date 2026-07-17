import { describe, expect, it } from 'vitest';
import type { PlaybackScript, ScriptNote } from '../types/index.ts';
import {
  buildConsecutiveSameNoteKeySet,
  buildFermataPlaybackContext,
  buildFinalNoteKeySet,
  buildStepPlaybackDurationQuarterNotesByStep,
  notePlaybackDurationOptions,
  playbackDurationQuarterNotes,
  resolveNotePlaybackDurationQuarterNotes,
  slurLegatoBlockedByImmediateReattack,
  type PlaybackDurationOptions,
} from './playbackTiming.ts';

/**
 * S1: slur gap suppression (hasSlurLegatoNext) and its composition with every
 * previously-shipped duration mechanism. Each test is written to FAIL if the
 * interaction were broken, not merely to exercise the code path - expected
 * values are pinned numerically against the constants, never derived by
 * calling the function under test twice.
 *
 * Baseline values at written = 1 quarter: articulation gap = 0.035
 * (proportional, within [0.02, 0.05] clamps), so plain playback = 0.965.
 */

const WRITTEN = 1;
const PLAIN = 0.965; // written - 0.035 gap
const SLUR_FULL = 1; // slur suppresses the gap entirely

function duration(options: PlaybackDurationOptions): number {
  return playbackDurationQuarterNotes(WRITTEN, false, options);
}

describe('slur gap suppression - base behavior', () => {
  it('suppresses the trailing gap on a slurred note (full written length)', () => {
    // Pinned: pre-S1 this returned 0.965. If the branch does not fire, FAIL.
    expect(duration({ hasSlurLegatoNext: true })).toBe(SLUR_FULL);
  });

  it('leaves an unflagged note byte-identical to pre-S1 (gap resumes)', () => {
    expect(duration({})).toBeCloseTo(PLAIN, 10);
  });
});

describe('slur precedence row 1: staccato family wins mid-slur (portato)', () => {
  it('staccato mid-slur clips exactly as staccato alone - slur adds nothing', () => {
    // Staccato at written=1: 0.5 - 0.035 = 0.465. If slur suppression fired
    // on top (returning 1 or 0.5), FAIL.
    expect(duration({ hasStaccato: true, hasSlurLegatoNext: true })).toBeCloseTo(0.465, 10);
    expect(duration({ hasStaccato: true, hasSlurLegatoNext: true })).toBe(
      duration({ hasStaccato: true }),
    );
  });

  it('staccatissimo mid-slur clips exactly as staccatissimo alone', () => {
    // 0.3 - 0.035 = 0.265, floored at 0.25: max(0.265, 0.25) = 0.265.
    expect(duration({ hasStaccatissimo: true, hasSlurLegatoNext: true })).toBeCloseTo(
      0.265,
      10,
    );
    expect(duration({ hasStaccatissimo: true, hasSlurLegatoNext: true })).toBe(
      duration({ hasStaccatissimo: true }),
    );
  });

  it('detached-legato mid-slur keeps its own ratio (already "dots under a slur" semantics)', () => {
    // 0.75 - 0.035 = 0.715. An enclosing real slur must add nothing.
    expect(duration({ hasDetachedLegato: true, hasSlurLegatoNext: true })).toBeCloseTo(
      0.715,
      10,
    );
    expect(duration({ hasDetachedLegato: true, hasSlurLegatoNext: true })).toBe(
      duration({ hasDetachedLegato: true }),
    );
  });

  it('marcato mid-slur: duration component wins like the staccato family (NOT velocity-only in this codebase)', () => {
    // Marcato here has a real duration ratio (0.7): 0.7 - 0.035 = 0.665.
    // The proposal called marcato "orthogonal (velocity domain)" - that does
    // not match the merged code, where marcato is a duration-shortening
    // articulation. It therefore takes the staccato-family precedence row.
    expect(duration({ hasMarcato: true, hasSlurLegatoNext: true })).toBeCloseTo(0.665, 10);
    expect(duration({ hasMarcato: true, hasSlurLegatoNext: true })).toBe(
      duration({ hasMarcato: true }),
    );
  });
});

describe('slur precedence row 2: tenuto idempotence', () => {
  it('tenuto mid-slur returns the written length exactly once (no double application)', () => {
    // Both tenuto and slur resolve to "full written". If they stacked in any
    // way (2x, written + written, written + gap-refund), this exact-equality
    // check FAILS. Also pins which branch actually executed: tenuto's
    // suppressGap return happens BEFORE the slur branch, so this equals the
    // tenuto-alone value bit for bit.
    const both = duration({ hasTenuto: true, hasSlurLegatoNext: true });
    expect(both).toBe(WRITTEN);
    expect(both).toBe(duration({ hasTenuto: true }));
    expect(both).toBe(duration({ hasSlurLegatoNext: true }));
  });
});

describe('slur precedence row 3: tenuto on the LAST note of a slur', () => {
  // Three-note slurred passage: notes 0 and 1 carry slurLegatoNext (S0 marks
  // all members except the last); note 2 is the last member and carries
  // tenuto. Resolved through the real script-level pipeline, not raw options.
  function passage(lastNote: Partial<ScriptNote>): PlaybackScript {
    const note = (midi: number, extra: Partial<ScriptNote> = {}): ScriptNote => ({
      pitch: 'C4',
      midi,
      hand: 'R',
      finger: null,
      durationDivisions: 480,
      ...extra,
    });
    return [
      { order: 0, onset: 0, measureNumber: 1, notes: [note(60, { slurLegatoNext: true })] },
      { order: 1, onset: 480, measureNumber: 1, notes: [note(62, { slurLegatoNext: true })] },
      { order: 2, onset: 960, measureNumber: 1, notes: [note(64, lastNote)] },
      // Trailing step so note 2 is not the piece-final note (which would
      // suppress its gap for an unrelated reason and mask the result).
      { order: 3, onset: 1440, measureNumber: 1, notes: [note(65)] },
    ];
  }

  function resolvedDuration(script: PlaybackScript, stepIndex: number): number {
    const dpq = 480;
    const finalKeys = buildFinalNoteKeySet(script, dpq);
    const fermataContext = buildFermataPlaybackContext(script, dpq);
    const consecutive = buildConsecutiveSameNoteKeySet(script, dpq);
    const stepDurations = buildStepPlaybackDurationQuarterNotesByStep(
      script,
      dpq,
      finalKeys,
      consecutive,
      fermataContext,
    );
    return resolveNotePlaybackDurationQuarterNotes(
      stepIndex,
      script[stepIndex].notes[0],
      script,
      stepDurations,
      dpq,
      finalKeys,
      consecutive,
      fermataContext,
    );
  }

  it('control: the last slur note WITHOUT tenuto resumes its gap (proves the flag is absent there)', () => {
    const script = passage({});
    expect(resolvedDuration(script, 0)).toBe(SLUR_FULL); // member: suppressed
    expect(resolvedDuration(script, 1)).toBe(SLUR_FULL); // member: suppressed
    expect(resolvedDuration(script, 2)).toBeCloseTo(PLAIN, 10); // last: gap resumes
  });

  it('tenuto on the last slur note holds full value via tenuto, not via any slur override logic', () => {
    // If the slur's "resume gap at the last note" were implemented as a
    // forced gap on slur-adjacent notes (instead of S0's absent-flag design),
    // this would return 0.965 and FAIL.
    const script = passage({ hasTenuto: true });
    expect(resolvedDuration(script, 2)).toBe(WRITTEN);
  });
});

describe('slur precedence row 4: accent orthogonality (velocity domain)', () => {
  it('hasAccent has no duration pathway: identical durations with and without it, slurred or not', () => {
    // Traced in code: hasAccent is not a member of PlaybackDurationOptions at
    // all, and notePlaybackDurationOptions never reads note.hasAccent -
    // velocity is deferred entirely (PlaybackEngine scheduleAttackRelease
    // comment). This test fails if anyone ever wires accent into duration.
    const base: ScriptNote = {
      pitch: 'C4',
      midi: 60,
      hand: 'R',
      finger: null,
      durationDivisions: 480,
      slurLegatoNext: true,
    };
    const accented: ScriptNote = { ...base, hasAccent: true };
    const emptyContext = { carryForwardSteps: new Set<number>(), delegateToNextStep: new Set<number>() };

    const optionsPlain = notePlaybackDurationOptions(0, base, new Set(), new Set(), emptyContext);
    const optionsAccented = notePlaybackDurationOptions(
      0,
      accented,
      new Set(),
      new Set(),
      emptyContext,
    );
    expect(optionsAccented).toEqual(optionsPlain);
    expect(playbackDurationQuarterNotes(WRITTEN, false, optionsAccented)).toBe(
      playbackDurationQuarterNotes(WRITTEN, false, optionsPlain),
    );
  });
});

describe('slur precedence row 5: fermata composes AFTER the slur base', () => {
  it('fermata on a slurred note doubles the FULL written length (order of operations pinned)', () => {
    // Actual execution order (playbackDurationQuarterNotes): base duration is
    // chosen first (slur -> 1.0), THEN the fermata factor applies -> 2.0.
    // If fermata ran first or the slur branch bypassed the fermata stage,
    // the value would be 1.0 or 1.93 instead - both FAIL here.
    expect(duration({ hasFermata: true, hasSlurLegatoNext: true })).toBe(2);
  });

  it('control: fermata without slur doubles the gapped base (1.93), proving the slurred value moved', () => {
    expect(duration({ hasFermata: true })).toBeCloseTo(1.93, 10);
  });
});

describe('slur precedence row 6: immediate same-pitch re-strike guard', () => {
  it('design pin: the raw base branch defers re-strike masking to the funnel', () => {
    // followedByConsecutiveSameNote is ANY-SPACING (a pitch recurring
    // anywhere later - most notes in tonal music). Gating the slur branch on
    // it at the base level would render slur legato silently inert on real
    // scores (measured: 109 of 117 flagged notes across the four slurred
    // fixtures sit in that set). The merge risk is only the IMMEDIATE
    // re-attack, which notePlaybackDurationOptions masks from script
    // adjacency. If someone re-adds the base-level gate, this FAILS and
    // forces revisiting that funnel contract.
    expect(
      duration({ hasSlurLegatoNext: true, followedByConsecutiveSameNote: true }),
    ).toBe(WRITTEN);
  });

  it('funnel masks the flag when the same pitch re-attacks immediately at the release', () => {
    const note = (extra: Partial<ScriptNote> = {}): ScriptNote => ({
      pitch: 'C4',
      midi: 60,
      hand: 'R',
      finger: null,
      durationDivisions: 480,
      ...extra,
    });
    const script: PlaybackScript = [
      { order: 0, onset: 0, measureNumber: 1, notes: [note({ slurLegatoNext: true })] },
      { order: 1, onset: 480, measureNumber: 1, notes: [note()] },
    ];
    const emptyContext = {
      carryForwardSteps: new Set<number>(),
      delegateToNextStep: new Set<number>(),
    };
    const options = notePlaybackDurationOptions(
      0,
      script[0].notes[0],
      new Set(),
      new Set(),
      emptyContext,
      script,
      480,
    );
    expect(options.hasSlurLegatoNext).toBe(false);
    expect(slurLegatoBlockedByImmediateReattack(script, 0, script[0].notes[0], 480)).toBe(
      true,
    );
  });

  it('a pitch recurring LATER (not immediately) does not block slur legato', () => {
    // C4 slurred into D4; C4 recurs two steps later. The any-spacing
    // consecutive set contains step 0's C4, but the slur target is D4 - no
    // merge risk. If the mask (or the base branch) consulted the any-spacing
    // set, this would return 0.945 and FAIL.
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
            slurLegatoNext: true,
          },
        ],
      },
      {
        order: 1,
        onset: 480,
        measureNumber: 1,
        notes: [{ pitch: 'D4', midi: 62, hand: 'R', finger: null, durationDivisions: 480 }],
      },
      {
        order: 2,
        onset: 960,
        measureNumber: 1,
        notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: null, durationDivisions: 480 }],
      },
      {
        order: 3,
        onset: 1440,
        measureNumber: 1,
        notes: [{ pitch: 'E4', midi: 64, hand: 'R', finger: null, durationDivisions: 960 }],
      },
    ];
    const dpq = 480;
    const finalKeys = buildFinalNoteKeySet(script, dpq);
    const fermataContext = buildFermataPlaybackContext(script, dpq);
    const consecutive = buildConsecutiveSameNoteKeySet(script, dpq);
    // Sanity: the any-spacing set DOES contain step 0's C4 - the mask must
    // see past it.
    expect(consecutive.has('0:R:60')).toBe(true);

    const stepDurations = buildStepPlaybackDurationQuarterNotesByStep(
      script,
      dpq,
      finalKeys,
      consecutive,
      fermataContext,
    );
    const played = resolveNotePlaybackDurationQuarterNotes(
      0,
      script[0].notes[0],
      script,
      stepDurations,
      dpq,
      finalKeys,
      consecutive,
      fermataContext,
    );
    expect(played).toBe(WRITTEN);
  });

  it('immediate re-strike gap survives through the real script pipeline (same pitch, slurred)', () => {
    const note = (extra: Partial<ScriptNote> = {}): ScriptNote => ({
      pitch: 'C4',
      midi: 60,
      hand: 'R',
      finger: null,
      durationDivisions: 480,
      ...extra,
    });
    // Same pitch C4 -> C4 under a slur flag, then a trailing different note
    // so neither is piece-final.
    const script: PlaybackScript = [
      { order: 0, onset: 0, measureNumber: 1, notes: [note({ slurLegatoNext: true })] },
      { order: 1, onset: 480, measureNumber: 1, notes: [note()] },
      {
        order: 2,
        onset: 960,
        measureNumber: 1,
        notes: [{ pitch: 'D4', midi: 62, hand: 'R', finger: null, durationDivisions: 960 }],
      },
    ];
    const dpq = 480;
    const finalKeys = buildFinalNoteKeySet(script, dpq);
    const fermataContext = buildFermataPlaybackContext(script, dpq);
    const consecutive = buildConsecutiveSameNoteKeySet(script, dpq);
    // Sanity: the pipeline really classified step 0's C4 as re-struck.
    expect(consecutive.has('0:R:60')).toBe(true);

    const stepDurations = buildStepPlaybackDurationQuarterNotesByStep(
      script,
      dpq,
      finalKeys,
      consecutive,
      fermataContext,
    );
    const played = resolveNotePlaybackDurationQuarterNotes(
      0,
      script[0].notes[0],
      script,
      stepDurations,
      dpq,
      finalKeys,
      consecutive,
      fermataContext,
    );
    expect(played).toBeCloseTo(0.945, 10);
    expect(played).toBeLessThan(WRITTEN);
  });
});

describe('default-absent equivalence (S1 regression gate)', () => {
  it('an absent flag and an explicit false produce identical values across the option grid', () => {
    const writtens = [0.25, 0.5, 1, 2, 4];
    const combos: PlaybackDurationOptions[] = [
      {},
      { isFinalNote: true },
      { hasStaccato: true },
      { hasStaccatissimo: true },
      { hasTenuto: true },
      { hasDetachedLegato: true },
      { hasMarcato: true },
      { hasFermata: true },
      { followedByConsecutiveSameNote: true },
      { hasStaccato: true, hasFermata: true },
      { hasTenuto: true, hasStaccato: true },
      { isFinalNote: true, hasStaccato: true },
    ];

    for (const written of writtens) {
      for (const tied of [false, true]) {
        for (const combo of combos) {
          expect(
            playbackDurationQuarterNotes(written, tied, {
              ...combo,
              hasSlurLegatoNext: false,
            }),
          ).toBe(playbackDurationQuarterNotes(written, tied, combo));
        }
      }
    }
  });
});
