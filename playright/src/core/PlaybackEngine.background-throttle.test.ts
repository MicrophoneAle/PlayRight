/**
 * Regression: audio cutting out (then resuming) after the tab is backgrounded.
 *
 * Tone drives Transport from a setTimeout chain inside a Web Worker, and
 * Clock._loop processes the whole ELAPSED REAL-TIME range on each wake-up. A
 * throttled background tab, a suspended/resumed AudioContext, or a long GC
 * pause on slow hardware therefore does not drop ticks - it delivers them in
 * one late batch, and every callback in that batch reads transport.ticks as
 * the END of that range.
 *
 * That made the rolling-window extension write an entire window of events
 * BEHIND the transport. Tone's Timeline dispatches on exact tick equality
 * (Timeline.forEachAtTime), so those events are stranded forever - and once
 * the window's own extension trigger is stranded, playback goes permanently
 * silent. windowLagTicks cannot rescue it: it is capped at
 * PLAYBACK_MAX_WINDOW_LAG_QUARTERS on purpose.
 *
 * Note the mocked transport in playbackTransportReplay.ts is deliberately
 * forgiving about past-tick events, so it cannot catch this. These tests
 * assert the scheduled tick values against the transport position directly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackScript, ScoreTiming } from '../types/index.ts';

const scheduleOnceState = vi.hoisted(() => ({ nextId: 0 }));
const transportScheduleOnce = vi.hoisted(() =>
  vi.fn<(callback: (time: number) => void, time: string | number) => number>(
    () => {
      scheduleOnceState.nextId += 1;
      return scheduleOnceState.nextId;
    },
  ),
);
const transportTicks = vi.hoisted(() => ({ value: 0 }));

vi.mock('tone', () => ({
  getTransport: () => ({
    PPQ: 480,
    bpm: { value: 120 },
    get ticks() {
      return transportTicks.value;
    },
    set ticks(value: number) {
      transportTicks.value = value;
    },
    start: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    scheduleOnce: transportScheduleOnce,
    clear: vi.fn(),
    cancel: vi.fn(),
  }),
  getDraw: () => ({ schedule: vi.fn() }),
}));

import { PlaybackEngine } from './PlaybackEngine.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

const DPQ = 480;
/** 120bpm at PPQ 480: one quarter = 0.5s, so 960 ticks per wall-clock second. */
const TICKS_PER_SECOND = 960;

const tickOf = (time: string | number) => Number(String(time).slice(0, -1));

function buildScript(): { script: PlaybackScript; scoreTiming: ScoreTiming } {
  const script: PlaybackScript = [];
  for (let beat = 0; beat < 400; beat += 1) {
    script.push({
      order: script.length,
      onset: beat * DPQ,
      measureNumber: Math.floor(beat / 4) + 1,
      notes: [
        { pitch: 'C4', midi: 60, hand: 'R', finger: 1, durationDivisions: DPQ },
      ],
    });
  }
  return {
    script,
    scoreTiming: {
      divisionsPerQuarter: DPQ,
      tempoBpm: 120,
      tempoMap: [{ onset: 0, bpm: 120 }],
      totalTimelineDivisions: 400 * DPQ,
    },
  };
}

interface StallResult {
  scheduledCount: number;
  strandedCount: number;
  rollingWindowStalled: boolean;
  releaseAllCalls: number;
}

/**
 * Play, run three clean rolling-window extensions to reach steady state, then
 * fire the next extension with the transport jumped `stallSeconds` ahead - the
 * state a throttled background tab leaves behind.
 */
async function runStall(stallSeconds: number): Promise<StallResult> {
  transportScheduleOnce.mockClear();
  transportTicks.value = 0;

  const { script, scoreTiming } = buildScript();
  useEngineStore.setState({
    script,
    scoreTiming,
    playMode: true,
    currentStepIndex: 0,
    playingMidiNotes: [],
    playingPlaybackNotes: [],
    isPlaybackActive: false,
    isPlaybackFinished: false,
    isPlaybackPaused: false,
    tempoFactor: 1,
  });

  const releaseAll = vi.fn();
  const engine = new PlaybackEngine();
  engine.attachAudioEngine({
    warm: async () => {},
    init: async () => {},
    scheduleAttackRelease: vi.fn(),
    noteOff: vi.fn(),
    releaseAll,
  } as never);

  await engine.play();

  let extension = transportScheduleOnce.mock.calls.at(-1)!;
  for (let i = 0; i < 3; i += 1) {
    transportScheduleOnce.mockClear();
    transportTicks.value = tickOf(extension[1]);
    extension[0](transportTicks.value);
    extension = transportScheduleOnce.mock.calls.at(-1)!;
  }

  transportScheduleOnce.mockClear();
  releaseAll.mockClear();
  transportTicks.value = tickOf(extension[1]) + stallSeconds * TICKS_PER_SECOND;
  extension[0](transportTicks.value);

  const calls = transportScheduleOnce.mock.calls;
  const scheduled = calls.map(([, time]) => tickOf(time)).filter(Number.isFinite);

  return {
    scheduledCount: scheduled.length,
    strandedCount: scheduled.filter((tick) => tick < transportTicks.value).length,
    // The last event of a window is its next extension trigger. Stranding it
    // is what made the silence permanent rather than momentary.
    rollingWindowStalled:
      calls.length > 0 && tickOf(calls.at(-1)![1]) < transportTicks.value,
    releaseAllCalls: releaseAll.mock.calls.length,
  };
}

describe('PlaybackEngine rolling window under a stalled transport clock', () => {
  beforeEach(() => {
    transportScheduleOnce.mockClear();
    transportTicks.value = 0;
  });

  // 60s is what a hidden tab's heavily throttled timer produces; 7-12s covers
  // a mildly throttled tab and a slow-hardware stall. All previously stranded
  // events outright. (The 400-beat fixture is 200s long, so these stay
  // mid-piece; running past the end is covered separately below.)
  it.each([7, 8, 12, 60])(
    'strands no events after a %ss transport stall',
    async (stallSeconds) => {
      const result = await runStall(stallSeconds);

      expect(result.scheduledCount).toBeGreaterThan(0);
      expect(result.strandedCount).toBe(0);
      expect(result.rollingWindowStalled).toBe(false);
    },
  );

  it('releases notes sounding from before the stall so none hang across the resync', async () => {
    const result = await runStall(60);
    expect(result.releaseAllCalls).toBeGreaterThan(0);
  });

  it('completes playback when the stall outlasts the rest of the piece', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // The fixture is 400 quarters at 120bpm = 200s long.
    const result = await runStall(400);

    // Nothing left to schedule, and critically no hang: playback ends cleanly.
    expect(result.scheduledCount).toBe(0);
    expect(result.releaseAllCalls).toBeGreaterThan(0);
    expect(useEngineStore.getState().isPlaybackFinished).toBe(true);
    warn.mockRestore();
  });

  // The existing 12-quarter extension lead already absorbs short stalls. Those
  // must keep taking the untouched normal path, so the capped-lag tempo
  // behaviour locked by PlaybackEngine.schedule-tick.test.ts is unchanged.
  it.each([0, 2, 4, 6])(
    'leaves the normal path untouched for a %ss stall (within the extension lead)',
    async (stallSeconds) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await runStall(stallSeconds);

      expect(result.strandedCount).toBe(0);
      expect(result.releaseAllCalls).toBe(0);
      expect(
        warn.mock.calls.filter(([message]) =>
          String(message).includes('resynchronizing'),
        ),
      ).toEqual([]);
      warn.mockRestore();
    },
  );
});

describe('PlaybackEngine.resyncAfterInterruption', () => {
  beforeEach(() => {
    transportScheduleOnce.mockClear();
    transportTicks.value = 0;
  });

  it('is a no-op unless playback is actively running', () => {
    const engine = new PlaybackEngine();
    transportScheduleOnce.mockClear();

    engine.resyncAfterInterruption();

    expect(transportScheduleOnce).not.toHaveBeenCalled();
  });

  it('recovers a window whose own extension trigger was stranded', async () => {
    transportTicks.value = 0;
    const { script, scoreTiming } = buildScript();
    useEngineStore.setState({
      script,
      scoreTiming,
      playMode: true,
      currentStepIndex: 0,
      playingMidiNotes: [],
      playingPlaybackNotes: [],
      isPlaybackActive: false,
      isPlaybackFinished: false,
      isPlaybackPaused: false,
      tempoFactor: 1,
    });

    const engine = new PlaybackEngine();
    engine.attachAudioEngine({
      warm: async () => {},
      init: async () => {},
      scheduleAttackRelease: vi.fn(),
      noteOff: vi.fn(),
      releaseAll: vi.fn(),
    } as never);
    await engine.play();

    // Nothing fires the pending extension: this is the permanent-stall state
    // that left playback silent with no scheduled event able to recover it.
    transportTicks.value = 60 * TICKS_PER_SECOND;
    transportScheduleOnce.mockClear();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    engine.resyncAfterInterruption();

    const scheduled = transportScheduleOnce.mock.calls
      .map(([, time]) => tickOf(time))
      .filter(Number.isFinite);
    expect(scheduled.length).toBeGreaterThan(0);
    expect(scheduled.filter((tick) => tick < transportTicks.value)).toEqual([]);
    warn.mockRestore();
  });
});
