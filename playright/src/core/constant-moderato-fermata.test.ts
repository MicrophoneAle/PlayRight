import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseMusicXmlToScript } from './parser/index.ts';
import {
  buildConsecutiveSameNoteKeySet,
  buildFermataPlaybackContext,
  buildFinalNoteKeySet,
  buildPlaybackFermataOffsetsByStep,
  buildStepPlaybackDurationQuarterNotesByStep,
  noteDurationQuarterNotes,
  playbackDurationQuarterNotes,
  resolveNotePlaybackDurationQuarterNotes,
  scheduledPlaybackAttackQuarterNotes,
  stepOnsetQuarterNotes,
} from './playbackTiming.ts';

const here = dirname(fileURLToPath(import.meta.url));
const xml = readFileSync(
  join(here, '../assets/constant-moderato.musicxml'),
  'utf8',
);

describe('constant moderato fermata playback', () => {
  it('carries fermata from the pickup eighth onto the abutting whole-note chord', () => {
    const { script, scoreTiming } = parseMusicXmlToScript(xml);
    const dpq = scoreTiming.divisionsPerQuarter;
    const fermataContext = buildFermataPlaybackContext(script, dpq);
    const finalKeys = buildFinalNoteKeySet(script, dpq);
    const offsets = buildPlaybackFermataOffsetsByStep(
      script,
      dpq,
      finalKeys,
      fermataContext,
    );
    const consecutive = buildConsecutiveSameNoteKeySet(script, dpq, offsets);
    const stepDurations = buildStepPlaybackDurationQuarterNotesByStep(
      script,
      dpq,
      finalKeys,
      consecutive,
      fermataContext,
    );

    const pickupStepIndex = script.findIndex(
      (step) =>
        step.measureNumber === 7 &&
        step.notes.some((note) => note.pitch === 'Ab4' && note.hasFermata),
    );
    const wholeChordStepIndex = pickupStepIndex + 1;

    expect(pickupStepIndex).toBeGreaterThanOrEqual(0);
    expect(fermataContext.delegateToNextStep.has(pickupStepIndex)).toBe(true);
    expect(fermataContext.carryForwardSteps.has(wholeChordStepIndex)).toBe(true);

    const pickupFermata = script[pickupStepIndex].notes.find(
      (note) => note.hasFermata,
    )!;
    const pickupWritten = noteDurationQuarterNotes(
      pickupFermata.durationDivisions ?? dpq,
      dpq,
    );
    const pickupPlayed = resolveNotePlaybackDurationQuarterNotes(
      pickupStepIndex,
      pickupFermata,
      script,
      stepDurations,
      dpq,
      finalKeys,
      consecutive,
      fermataContext,
    );
    const pickupNormal = playbackDurationQuarterNotes(pickupWritten);
    expect(pickupPlayed).toBeLessThan(pickupWritten);
    expect(pickupPlayed).toBeCloseTo(pickupNormal, 1);

    const wholeChordNote = script[wholeChordStepIndex].notes.find(
      (note) => note.pitch === 'Ab4' && note.hand === 'R',
    )!;
    const wholeWritten = noteDurationQuarterNotes(
      wholeChordNote.durationDivisions ?? dpq,
      dpq,
    );
    const wholePlayed = resolveNotePlaybackDurationQuarterNotes(
      wholeChordStepIndex,
      wholeChordNote,
      script,
      stepDurations,
      dpq,
      finalKeys,
      consecutive,
      fermataContext,
    );
    const wholeWithoutFermata = playbackDurationQuarterNotes(wholeWritten);
    const longestWritten = Math.max(
      ...script[wholeChordStepIndex].notes.map((note) =>
        noteDurationQuarterNotes(note.durationDivisions ?? dpq, dpq),
      ),
    );
    const longestWithFermata = playbackDurationQuarterNotes(
      longestWritten,
      script[wholeChordStepIndex].notes.some((note) => note.tiedToNext),
      { hasFermata: true },
    );

    expect(wholePlayed).toBeGreaterThan(wholeWithoutFermata * 1.9);
    expect(stepDurations[wholeChordStepIndex]).toBeCloseTo(longestWithFermata, 1);

    const pickupAttack = scheduledPlaybackAttackQuarterNotes(
      script[pickupStepIndex].onset,
      dpq,
      offsets[pickupStepIndex],
    );
    const pickupRelease = pickupAttack + stepDurations[pickupStepIndex];
    const chordAttack = scheduledPlaybackAttackQuarterNotes(
      script[wholeChordStepIndex].onset,
      dpq,
      offsets[wholeChordStepIndex],
    );
    const nextStepIndex = wholeChordStepIndex + 1;
    const chordRelease =
      chordAttack + stepDurations[wholeChordStepIndex];
    const nextAttack = scheduledPlaybackAttackQuarterNotes(
      script[nextStepIndex].onset,
      dpq,
      offsets[nextStepIndex],
    );

    expect(chordAttack).toBeGreaterThanOrEqual(pickupRelease - 1e-9);
    expect(nextAttack).toBeGreaterThanOrEqual(chordRelease - 1e-9);
    expect(offsets[nextStepIndex]).toBeGreaterThan(offsets[wholeChordStepIndex]);

    // Regression guard: the carried chord must attack at its own written
    // onset (only the normal, sub-quarter articulation gap after the pickup
    // releases) - not delayed by a bogus silent gap from double-counting the
    // fermata extension as a pre-attack push (it previously pre-pushed the
    // chord's own attack by ~7.95 quarters before also re-deriving the
    // post-chord push from the chord's real release).
    const writtenChordAttack = stepOnsetQuarterNotes(
      script[wholeChordStepIndex].onset,
      dpq,
    );
    expect(offsets[wholeChordStepIndex]).toBeCloseTo(0, 6);
    expect(chordAttack).toBeCloseTo(writtenChordAttack, 6);
    expect(chordAttack - pickupRelease).toBeLessThan(0.1);

    // The post-chord push should reflect a single application of the excess
    // hold (chord's extended release minus the next step's written onset),
    // not that amount plus the extension already spent before the chord.
    const expectedPostChordPush =
      chordRelease -
      stepOnsetQuarterNotes(script[nextStepIndex].onset, dpq);
    expect(offsets[nextStepIndex]).toBeCloseTo(expectedPostChordPush, 6);
  });

  it('keeps the measure 9 half-note fermata on its own step', () => {
    const { script, scoreTiming } = parseMusicXmlToScript(xml);
    const dpq = scoreTiming.divisionsPerQuarter;
    const fermataContext = buildFermataPlaybackContext(script, dpq);

    const fermataStepIndex = script.findIndex(
      (step) =>
        step.measureNumber === 9 &&
        step.notes.some((note) => note.pitch === 'C5' && note.hasFermata),
    );

    expect(fermataStepIndex).toBeGreaterThanOrEqual(0);
    expect(fermataContext.delegateToNextStep.has(fermataStepIndex)).toBe(false);
    expect(fermataContext.carryForwardSteps.has(fermataStepIndex)).toBe(false);
  });
});
