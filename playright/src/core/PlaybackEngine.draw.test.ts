import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackScript, ScoreTiming } from '../types/index.ts';

const transportScheduleOnce = vi.hoisted(() =>
  vi.fn((callback: (time: number) => void, _time: string | number) => {
    callback(0);
    return transportScheduleOnce.mock.calls.length;
  }),
);
const scheduleAttackRelease = vi.hoisted(() => vi.fn());

vi.mock('tone', () => ({
  getTransport: () => ({
    PPQ: 480,
    bpm: { value: 120 },
    ticks: 0,
    start: vi.fn(),
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
import { useEngineStore } from '../store/useEngineStore.ts';

describe('PlaybackEngine playback visuals', () => {
  beforeEach(() => {
    transportScheduleOnce.mockClear();
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

  it('pre-schedules attack and release on the transport timeline', async () => {
    const engine = new PlaybackEngine();
    engine.attachAudioEngine({
      warm: async () => {},
      init: async () => {},
      scheduleAttackRelease,
    } as never);

    await engine.play();

    expect(transportScheduleOnce.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(scheduleAttackRelease).toHaveBeenCalled();
    expect(useEngineStore.getState().playingMidiNotes).toEqual([]);
    expect(useEngineStore.getState().playingPlaybackNotes).toEqual([]);
  });

  it('clears playingMidiNotes after the pre-scheduled release callback', async () => {
    const deferredCallbacks: Array<() => void> = [];
    let scheduleCallCount = 0;
    transportScheduleOnce.mockImplementation((callback, _time) => {
      scheduleCallCount += 1;
      if (scheduleCallCount <= 2) {
        callback(0);
      } else {
        deferredCallbacks.push(() => callback(0));
      }
      return scheduleCallCount;
    });

    const engine = new PlaybackEngine();
    engine.attachAudioEngine({
      warm: async () => {},
      init: async () => {},
      scheduleAttackRelease,
    } as never);

    await engine.play();

    expect(useEngineStore.getState().playingMidiNotes).toEqual([60]);

    for (const callback of deferredCallbacks) {
      callback();
    }

    expect(useEngineStore.getState().playingMidiNotes).toEqual([]);
    expect(useEngineStore.getState().playingPlaybackNotes).toEqual([]);
  });

  it('drops stale highlights when advancing to a later step', async () => {
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

    let scheduleCallCount = 0;
    transportScheduleOnce.mockImplementation((callback, time) => {
      scheduleCallCount += 1;
      const tickTime = String(time);
      const firesImmediately = tickTime === '0i' || tickTime === '480i';

      if (firesImmediately) {
        callback(0);
      }

      return scheduleCallCount;
    });

    const engine = new PlaybackEngine();
    engine.attachAudioEngine({
      warm: async () => {},
      init: async () => {},
      scheduleAttackRelease,
    } as never);

    await engine.play();

    expect(useEngineStore.getState().playingMidiNotes).toEqual([62]);
    expect(useEngineStore.getState().playingPlaybackNotes).toEqual([
      expect.objectContaining({ stepIndex: 1, midi: 62, hand: 'R' }),
    ]);
  });
});
