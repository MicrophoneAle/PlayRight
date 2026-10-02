import { describe, expect, it } from 'vitest';
import {
  buildNextSameMidiAttackOnsets,
  PLAYBACK_ARTICULATION_GAP_MIN_QUARTERS,
  PLAYBACK_PEDAL_SUSTAIN_FACTOR,
  pedalSustainedQuarterNotes,
  playbackDurationQuarterNotes,
} from './playbackTiming.ts';
import type { PedalSpan, PlaybackScript, ScriptNote } from '../types/index.ts';

const DPQ = 480;
const q = (quarters: number) => quarters * DPQ;
const span = (start: number, end: number): PedalSpan => ({
  startOnset: q(start),
  endOnset: q(end),
});

/** Sounded quarters for a note attacked at `onsetQuarters` with resolved base `base`. */
function pedaled(
  base: number,
  onsetQuarters: number,
  spans: PedalSpan[],
  nextSameMidiQuarters?: number,
): number {
  return pedalSustainedQuarterNotes(
    base,
    q(onsetQuarters),
    DPQ,
    spans,
    nextSameMidiQuarters === undefined ? undefined : q(nextSameMidiQuarters),
  );
}

describe('pedalSustainedQuarterNotes', () => {
  const longPedal = [span(0, 16)];

  it('is the identity without pedal or when the release is outside every span', () => {
    expect(pedaled(0.95, 0, [])).toBe(0.95);
    expect(pedaled(0.95, 4, [span(0, 2)])).toBe(0.95);
  });

  it('extends a plain note by the factor while the pedal is down', () => {
    const base = playbackDurationQuarterNotes(1);
    expect(pedaled(base, 0, longPedal)).toBeCloseTo(base * PLAYBACK_PEDAL_SUSTAIN_FACTOR, 9);
  });

  it('caps the extension at the pedal lift', () => {
    expect(pedaled(1, 0, [span(0, 1.2)])).toBeCloseTo(1.2, 9);
  });

  it('gives no extension to a key released exactly at a pedal change', () => {
    // Tenuto/slur-legato release lands exactly on the next span's start: the
    // change lifts the damper there, so the old harmony must not ring on.
    expect(pedaled(1, 0, [span(0, 1), span(1, 4)])).toBe(1);
  });

  it('never shortens a note below its unpedaled length (1-division span drift)', () => {
    expect(pedalSustainedQuarterNotes(1, 0, DPQ, [{ startOnset: 0, endOnset: q(1) - 1 }], undefined)).toBe(1);
  });

  it('caps at the next same-pitch attack minus the minimum gap, so re-strikes stay separate', () => {
    expect(pedaled(0.95, 0, longPedal, 1)).toBeCloseTo(1 - PLAYBACK_ARTICULATION_GAP_MIN_QUARTERS, 9);
  });

  describe('composition with articulation effects (pedal multiplies the articulated base)', () => {
    const cases: Array<[string, Parameters<typeof playbackDurationQuarterNotes>[2]]> = [
      ['staccato', { hasStaccato: true }],
      ['staccatissimo', { hasStaccatissimo: true }],
      ['marcato', { hasMarcato: true }],
      ['detached-legato', { hasDetachedLegato: true }],
    ];

    for (const [name, options] of cases) {
      it(`${name}: pedaled = articulated base x factor`, () => {
        const base = playbackDurationQuarterNotes(1, false, options);
        expect(pedaled(base, 0, longPedal)).toBeCloseTo(base * PLAYBACK_PEDAL_SUSTAIN_FACTOR, 9);
      });
    }

    it('a staccato quarter under pedal still sounds shorter than its written value', () => {
      const base = playbackDurationQuarterNotes(1, false, { hasStaccato: true });
      expect(pedaled(base, 0, longPedal)).toBeLessThan(1);
    });

    it('tenuto and slur legato (full value) extend from the written length', () => {
      expect(pedaled(playbackDurationQuarterNotes(1, false, { hasTenuto: true }), 0, longPedal)).toBeCloseTo(1.75, 9);
      expect(pedaled(playbackDurationQuarterNotes(1, false, { hasSlurLegatoNext: true }), 0, longPedal)).toBeCloseTo(1.75, 9);
    });
  });
});

describe('buildNextSameMidiAttackOnsets', () => {
  const note = (midi: number, hand: 'L' | 'R', extra: Partial<ScriptNote> = {}): ScriptNote =>
    ({ midi, hand, pitch: '', finger: null, durationDivisions: DPQ, ...extra }) as ScriptNote;
  const step = (index: number, notes: ScriptNote[], graceMidis: number[] = []) => ({
    order: index,
    onset: q(index),
    measureNumber: 1,
    notes,
    ...(graceMidis.length > 0
      ? { graceBefore: graceMidis.map((midi) => ({ midi, hand: 'R' as const, pitch: '' })) }
      : {}),
  });

  it('finds the next attack in either hand, skipping tie continuations, and counts graces early', () => {
    const script = [
      step(0, [note(60, 'R', { tiedToNext: true }), note(48, 'L')]),
      step(1, [note(60, 'R')]), // tie continuation of step 0's C4: not an attack
      step(2, [note(60, 'L')]), // same pitch, other hand
      step(3, [note(64, 'R')], [48]), // grace on the bass pitch
    ] as unknown as PlaybackScript;

    const next = buildNextSameMidiAttackOnsets(script, DPQ, 1 / 8);
    expect(next.get('0:R:60')).toBe(q(2));
    expect(next.get('1:R:60')).toBe(q(2));
    expect(next.get('0:L:48')).toBe(q(3) - q(1 / 8));
    expect(next.has('2:L:60')).toBe(false);
  });
});
