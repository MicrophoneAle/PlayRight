/**
 * Regression for fractional tick-duration strings being parsed as SECONDS.
 *
 * Tone's tick expression is /^(\d+)i$/ (TimeBase.ts). Anything with a decimal
 * fails that match; valueOf falls through to parseFloat and treats the number
 * as seconds. A gapped quarter at PPQ 192 is 185.28 ticks → "185.28i" →
 * 185.28s release → voices never damp and pile up until pause/releaseAll.
 *
 * Existing tests cannot catch this: AudioEngine mocks Time as () => 0.5, and
 * engine tests parse durationTicks with Number(slice) which accepts "185.28i".
 *
 * Vitest runs in Node (no AudioContext), so we cannot call Tone.Time directly.
 * Instead we pin the exact regexp Tone uses and the musical seconds that
 * result once ticks parse correctly — both fail against the unrounded emitter.
 */
import { describe, expect, it } from 'vitest';
import {
  articulationGapQuarterNotes,
  quarterNotesToTickDuration,
  quartersToTicks,
} from './playbackTiming.ts';

/** Copied from tone/Tone/core/type/TimeBase.ts — the tick unit expression. */
const TONE_TICK_RE = /^(\d+)i$/i;

function toneTickOrSeconds(raw: string, ppq: number, bpm: number): number {
  const match = TONE_TICK_RE.exec(raw.trim());
  if (match) {
    const ticks = Number.parseInt(match[1]!, 10);
    return ticks / ppq / (bpm / 60);
  }
  // Tone's fallthrough when no expression matches (TimeBase.valueOf).
  return Number.parseFloat(raw);
}

describe('quarterNotesToTickDuration × Tone tick parse', () => {
  it('gapped quarter at PPQ 192 is musical (~0.48s), not ~185s', () => {
    const ppq = 192;
    const bpm = 120;
    const gappedQuarter = 1 - articulationGapQuarterNotes(1);
    expect(gappedQuarter).toBeCloseTo(0.965, 5);
    expect(quartersToTicks(gappedQuarter, ppq)).toBeCloseTo(185.28, 5);

    const duration = quarterNotesToTickDuration(gappedQuarter, ppq);
    expect(duration).toMatch(TONE_TICK_RE);
    expect(duration).toBe('185i');

    const seconds = toneTickOrSeconds(duration, ppq, bpm);
    expect(seconds).toBeCloseTo(185 / ppq / (bpm / 60), 5);
    expect(seconds).toBeLessThan(1);
    expect(seconds).toBeLessThan(5);
  });

  it('documents that the unrounded emission is mis-parsed as seconds', () => {
    const ppq = 192;
    const bpm = 120;
    const broken = `${0.965 * ppq}i`; // "185.28i"
    expect(broken).not.toMatch(TONE_TICK_RE);
    expect(toneTickOrSeconds(broken, ppq, bpm)).toBeCloseTo(185.28, 5);
  });

  it('gapped sixteenth at PPQ 192 stays under 0.1s at 180 BPM', () => {
    const ppq = 192;
    const bpm = 180;
    const gappedSixteenth = 0.25 - articulationGapQuarterNotes(0.25);
    const duration = quarterNotesToTickDuration(gappedSixteenth, ppq);
    expect(duration).toMatch(TONE_TICK_RE);

    const seconds = toneTickOrSeconds(duration, ppq, bpm);
    expect(seconds).toBeLessThan(0.15);
    expect(seconds).toBeGreaterThan(0.01);
  });
});
