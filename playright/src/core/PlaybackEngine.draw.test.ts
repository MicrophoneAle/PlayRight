import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackScript, ScoreTiming } from '../types/index.ts';

const transportScheduleOnce = vi.hoisted(() =>
  vi.fn((callback: (time: number) => void, _time: string | number) => {
    callback(0);
    return transportScheduleOnce.mock.calls.length;
  }),
);
const transportStart = vi.hoisted(() => vi.fn());
const scheduleAttackRelease = vi.hoisted(() => vi.fn());

vi.mock('tone', () => ({
  getTransport: () => ({
    PPQ: 480,
    bpm: { value: 120 },
    ticks: 0,
    start: transportStart,
    stop: vi.fn(),
    pause: vi.fn(),
    scheduleOnce: transportScheduleOnce,
    clear: vi.fn(),
    cancel: vi.fn(),
  }),
  getDraw: () => ({
    schedule: vi.fn(),
  }),
  Draw: {
    schedule: vi.fn(),
  },
}));

import { PlaybackEngine } from './PlaybackEngine.ts';
import {
  playbackReleaseOnsetQuarterNotes,
  quartersToTicks,
} from './playbackTiming.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

function roundedTransportTickTime(quarterNotes: number, ppq: number): string {
  return `${Math.round(quartersToTicks(quarterNotes, ppq))}i`;
}

describe('PlaybackEngine playback visuals', () => {
  beforeEach(() => {
    transportScheduleOnce.mockClear();
    transportStart.mockClear();
    scheduleAttackRelease.mockClear();

    const script: PlaybackScript = [
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: 1, durationDivisions: 480 }],
      },
    ];
    const scoreTiming: ScoreTiming = {
      divisionsPerQuarter: 480,
      tempoBpm: 120,
      totalTimelineDivisions: 480,
    };

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
    });
  });

  it('schedules absolute release times alongside step attacks', async () => {
    const script: PlaybackScript = [
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: 1, durationDivisions: 480 }],
      },
      {
        order: 1,
        onset: 480,
        measureNumber: 1,
        notes: [{ pitch: 'D4', midi: 62, hand: 'R', finger: 1, durationDivisions: 480 }],
      },
    ];

    useEngineStore.setState({ script });

    transportScheduleOnce.mockImplementation((callback, time) => {
      if (String(time) === '0i') {
        callback(0);
      }

      return transportScheduleOnce.mock.calls.length;
    });

    const engine = new PlaybackEngine();
    engine.attachAudioEngine({
      warm: async () => {},
      init: async () => {},
      scheduleAttackRelease,
    } as never);

    await engine.play();

    const releaseTickTime = roundedTransportTickTime(
      playbackReleaseOnsetQuarterNotes(0, 1, false),
      480,
    );

    expect(transportScheduleOnce.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(scheduleAttackRelease).toHaveBeenCalled();
    expect(
      transportScheduleOnce.mock.calls.some(([_, time]) => String(time) === releaseTickTime),
    ).toBe(true);
    expect(useEngineStore.getState().playingMidiNotes).toEqual([60]);
  });

  it('releases highlights before the next attack via absolute scheduling', async () => {
    const script: PlaybackScript = [
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: 1, durationDivisions: 480 }],
      },
      {
        order: 1,
        onset: 480,
        measureNumber: 1,
        notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: 1, durationDivisions: 480 }],
      },
    ];

    useEngineStore.setState({ script });

    const releaseTickTime = roundedTransportTickTime(
      playbackReleaseOnsetQuarterNotes(0, 1, false, {
        followedByConsecutiveSameNote: true,
      }),
      480,
    );
    const scheduled: Array<{ time: string; callback: (time: number) => void }> = [];
    transportScheduleOnce.mockImplementation((callback, time) => {
      scheduled.push({ time: String(time), callback });
      return scheduled.length;
    });

    const engine = new PlaybackEngine();
    engine.attachAudioEngine({
      warm: async () => {},
      init: async () => {},
      scheduleAttackRelease,
    } as never);

    await engine.play();

    const parseTick = (tickTime: string) => Number.parseFloat(tickTime.replace('i', ''));

    for (const { time, callback } of scheduled.sort(
      (left, right) => parseTick(left.time) - parseTick(right.time),
    )) {
      if (time === '0i' || time === releaseTickTime) {
        callback(0);
      }
    }

    expect(scheduled.map(({ time }) => time)).toContain(releaseTickTime);
    expect(useEngineStore.getState().playingMidiNotes).toEqual([]);
    expect(useEngineStore.getState().playingPlaybackNotes).toEqual([]);
  });

  it('defers a same-pitch re-strike press so the key visibly re-strikes', async () => {
    vi.useFakeTimers();

    const script: PlaybackScript = [
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: 1, durationDivisions: 480 }],
      },
      {
        order: 1,
        onset: 480,
        measureNumber: 1,
        notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: 1, durationDivisions: 480 }],
      },
    ];

    useEngineStore.setState({ script, isPlaybackActive: true });

    const scheduled: Array<{ time: string; callback: (time: number) => void }> = [];
    transportScheduleOnce.mockImplementation((callback, time) => {
      scheduled.push({ time: String(time), callback });
      return scheduled.length;
    });

    const engine = new PlaybackEngine();
    engine.attachAudioEngine({
      warm: async () => {},
      init: async () => {},
      scheduleAttackRelease,
    } as never);

    await engine.play();

    const stepAttacks = scheduled
      .filter(({ time }) => time === '0i' || time.endsWith('480i'))
      .map(({ callback }) => callback);
    const firstRelease = scheduled.find(
      ({ time }) => time !== '0i' && !time.endsWith('480i'),
    )?.callback;

    stepAttacks[0]?.(0);
    expect(useEngineStore.getState().playingMidiNotes).toEqual([60]);

    firstRelease?.(0);
    expect(useEngineStore.getState().playingMidiNotes).toEqual([]);

    stepAttacks[1]?.(0);
    expect(useEngineStore.getState().playingMidiNotes).toEqual([]);

    await vi.advanceTimersByTimeAsync(40);
    expect(useEngineStore.getState().playingMidiNotes).toEqual([60]);

    vi.useRealTimers();
  });

  it('keeps a longer prior-step highlight after a later step attacks', async () => {
    const script: PlaybackScript = [
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [
          {
            pitch: 'C3',
            midi: 48,
            hand: 'L',
            finger: 1,
            durationDivisions: 1920,
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
            finger: 1,
            durationDivisions: 480,
          },
        ],
      },
    ];

    useEngineStore.setState({ script });

    const scheduled: Array<{ time: string; callback: (time: number) => void }> = [];
    transportScheduleOnce.mockImplementation((callback, time) => {
      scheduled.push({ time: String(time), callback });
      return scheduled.length;
    });

    const engine = new PlaybackEngine();
    engine.attachAudioEngine({
      warm: async () => {},
      init: async () => {},
      scheduleAttackRelease,
    } as never);

    await engine.play();

    const stepAttacks = scheduled
      .filter(({ time }) => time === '0i' || time.endsWith('480i'))
      .map(({ callback }) => callback);

    stepAttacks[0]?.(0);
    expect(useEngineStore.getState().playingMidiNotes).toEqual([48]);

    stepAttacks[1]?.(0);
    expect(useEngineStore.getState().playingMidiNotes).toEqual([48, 62]);
  });

  it('resumes from step 0 after restart() (Restart then Play)', async () => {
    const script: PlaybackScript = [
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: 1, durationDivisions: 480 }],
      },
      {
        order: 1,
        onset: 480,
        measureNumber: 1,
        notes: [{ pitch: 'D4', midi: 62, hand: 'R', finger: 1, durationDivisions: 480 }],
      },
    ];

    useEngineStore.setState({ script });

    transportScheduleOnce.mockImplementation((callback, time) => {
      if (String(time) === '0i') {
        callback(0);
      }

      return transportScheduleOnce.mock.calls.length;
    });

    const engine = new PlaybackEngine();
    engine.attachAudioEngine({
      warm: async () => {},
      init: async () => {},
      scheduleAttackRelease,
      releaseAll: vi.fn(),
    } as never);

    await engine.play();
    engine.pause();

    await engine.restart();
    expect(useEngineStore.getState().currentStepIndex).toBe(0);
    expect(useEngineStore.getState().isPlaybackPaused).toBe(true);

    transportScheduleOnce.mockClear();
    transportStart.mockClear();

    engine.resume();

    expect(transportScheduleOnce).toHaveBeenCalled();
    expect(transportStart).toHaveBeenCalled();
    expect(useEngineStore.getState().isPlaybackPaused).toBe(false);
  });

  it('reschedules and resumes after seek while paused', async () => {
    const script: PlaybackScript = [
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: 1, durationDivisions: 480 }],
      },
      {
        order: 1,
        onset: 480,
        measureNumber: 1,
        notes: [{ pitch: 'D4', midi: 62, hand: 'R', finger: 1, durationDivisions: 480 }],
      },
    ];

    useEngineStore.setState({ script });

    transportScheduleOnce.mockImplementation((callback, time) => {
      if (String(time) === '0i') {
        callback(0);
      }

      return transportScheduleOnce.mock.calls.length;
    });

    const engine = new PlaybackEngine();
    engine.attachAudioEngine({
      warm: async () => {},
      init: async () => {},
      scheduleAttackRelease,
      releaseAll: vi.fn(),
    } as never);

    await engine.play();
    engine.pause();
    transportScheduleOnce.mockClear();
    transportStart.mockClear();

    engine.seekToStep(1);
    expect(transportScheduleOnce).toHaveBeenCalled();

    engine.resume();
    expect(transportStart).toHaveBeenCalled();
    expect(useEngineStore.getState().isPlaybackPaused).toBe(false);
  });
});
