/**
 * Regression: audible delay between a practice keypress and the note sounding.
 *
 * Tone resolves an omitted schedule time through TimeBase.valueOf() ->
 * _noArg() -> Time._now() -> Context.now(), and Context.now() is
 * `currentTime + lookAhead`. This context runs a 100ms lookAhead because
 * scheduled playback needs it (rolling schedule window, dense scores on slow
 * machines), so `triggerAttack(note, undefined)` put every LIVE keypress a
 * full 100ms into the future.
 *
 * Live input must use `context.currentTime` (Tone's `immediate()`), while
 * play mode keeps passing explicit transport times. The scheduled-path test
 * below is the guard that this separation is never collapsed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => {
  const ctx = {
    currentTime: 10,
    lookAhead: 0.1,
    state: 'running' as string,
    rawContext: {
      sampleRate: 44100,
      createBuffer: () => ({}),
      createBufferSource: () => ({ buffer: null, connect() {}, start() {} }),
      destination: {},
    },
    resume: () => Promise.resolve(),
    on() {},
    off() {},
  };
  return { ctx, attacks: [] as number[], releases: [] as number[] };
});
const { ctx, attacks, releases } = H;

vi.mock('tone', () => {
  const { ctx, attacks, releases } = H;
  // Mirrors Tone's real resolution: undefined -> context.now() (with lookAhead).
  const resolve = (t: unknown): number =>
    t === undefined ? ctx.currentTime + ctx.lookAhead : (t as number);
  class FakeInstrument {
    triggerAttack(_n: string, time?: unknown) {
      attacks.push(resolve(time));
    }
    triggerRelease(_n: string, time?: unknown) {
      releases.push(resolve(time));
    }
    triggerAttackRelease(_n: string, _d: unknown, time?: unknown) {
      attacks.push(resolve(time));
    }
    releaseAll() {}
    dispose() {}
    toDestination() {
      return this;
    }
  }
  return {
    Context: class {
      constructor() {
        return ctx as never;
      }
    },
    setContext: () => {},
    getContext: () => ctx,
    start: () => Promise.resolve(),
    loaded: () => Promise.resolve(),
    Sampler: FakeInstrument,
    PolySynth: FakeInstrument,
    Synth: class {},
    Time: (v: unknown) => ({ toSeconds: () => (typeof v === 'number' ? v : 0.5) }),
    getTransport: () => ({ PPQ: 480, bpm: { value: 120 } }),
    getDraw: () => ({ schedule: vi.fn() }),
  };
});

import * as Tone from 'tone';
import { AudioEngine } from './AudioEngine.ts';

/** Latency budget for live input, in ms of audio-domain scheduling offset. */
const LIVE_LATENCY_BUDGET_MS = 1;

function makeEngine(withSampler: boolean): AudioEngine {
  const engine = new AudioEngine();
  if (withSampler) {
    // Stand in for a finished loadSampler() so the real sampler branch runs.
    (engine as unknown as { sampler: unknown }).sampler = new Tone.Sampler();
    (engine as unknown as { loaded: boolean }).loaded = true;
  }
  return engine;
}

const offsetsFrom = (base: number, times: number[]) =>
  times.map((t) => (t - base) * 1000);

describe('AudioEngine live-input latency', () => {
  beforeEach(() => {
    attacks.length = 0;
    releases.length = 0;
    ctx.currentTime = 10;
    ctx.state = 'running';
  });

  it('schedules a live note-on immediately, not at now() + lookAhead', () => {
    const engine = makeEngine(true);
    engine.noteOn(60);
    const [offsetMs] = offsetsFrom(ctx.currentTime, attacks);

    expect(offsetMs).toBeLessThanOrEqual(LIVE_LATENCY_BUDGET_MS);
    // The bug scheduled it exactly one lookAhead ahead.
    expect(offsetMs).toBeLessThan(ctx.lookAhead * 1000);
  });

  it('schedules a live note-off immediately too', () => {
    const engine = makeEngine(true);
    engine.noteOn(60);
    engine.noteOff(60);
    const [offsetMs] = offsetsFrom(ctx.currentTime, releases);

    expect(offsetMs).toBeLessThanOrEqual(LIVE_LATENCY_BUDGET_MS);
  });

  it('uses the immediate path before samples load (preview synth)', () => {
    const engine = makeEngine(false);
    engine.noteOn(60);
    const [offsetMs] = offsetsFrom(ctx.currentTime, attacks);

    expect(offsetMs).toBeLessThanOrEqual(LIVE_LATENCY_BUDGET_MS);
  });

  it('holds across repeated presses as the clock advances (fast passage)', () => {
    const engine = makeEngine(true);
    const worst: number[] = [];

    for (let i = 0; i < 64; i += 1) {
      ctx.currentTime += 0.05; // ~fast passage, 50ms between attacks
      attacks.length = 0;
      engine.noteOn(60 + (i % 12));
      worst.push(offsetsFrom(ctx.currentTime, attacks)[0]);
    }

    // No drift or accumulation over a run of presses.
    expect(Math.max(...worst)).toBeLessThanOrEqual(LIVE_LATENCY_BUDGET_MS);
  });

  it('holds for a chord of simultaneous presses', () => {
    const engine = makeEngine(true);
    for (const midi of [60, 64, 67, 71, 74]) {
      engine.noteOn(midi);
    }

    const offsets = offsetsFrom(ctx.currentTime, attacks);
    expect(offsets).toHaveLength(5);
    // Every voice immediate, and no per-voice accumulation.
    expect(Math.max(...offsets)).toBeLessThanOrEqual(LIVE_LATENCY_BUDGET_MS);
    expect(new Set(offsets).size).toBe(1);
  });

  it('holds on the first press after a long idle gap', () => {
    const engine = makeEngine(true);
    engine.noteOn(60);
    attacks.length = 0;

    ctx.currentTime += 600; // ten minutes idle
    engine.noteOn(62);

    const [offsetMs] = offsetsFrom(ctx.currentTime, attacks);
    expect(offsetMs).toBeLessThanOrEqual(LIVE_LATENCY_BUDGET_MS);
  });

  it('resumes a suspended context on a live press without delaying the attack', () => {
    const engine = makeEngine(true);
    ctx.state = 'suspended';
    engine.noteOn(60);

    const [offsetMs] = offsetsFrom(ctx.currentTime, attacks);
    expect(offsetMs).toBeLessThanOrEqual(LIVE_LATENCY_BUDGET_MS);
  });

  it('leaves the play-mode scheduled path exactly as written', () => {
    const engine = makeEngine(true);
    // PlaybackEngine passes transport-derived absolute times. These must be
    // used verbatim - no lookAhead removal, no immediate() substitution.
    const scheduledAt = ctx.currentTime + 0.75;
    engine.scheduleAttackRelease(60, 0.5, scheduledAt);
    engine.schedulePlayedNote(64, 0.25, scheduledAt + 1);

    expect(attacks).toEqual([scheduledAt, scheduledAt + 1]);
  });
});
