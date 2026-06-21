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

  it('schedules one transport callback per step with relative release', async () => {
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

    expect(transportScheduleOnce.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(scheduleAttackRelease).toHaveBeenCalled();
    expect(
      transportScheduleOnce.mock.calls.some(([_, time]) => String(time).startsWith('+')),
    ).toBe(true);
    expect(useEngineStore.getState().playingMidiNotes).toEqual([60]);
  });

  it('clears highlights at each step boundary and on release', async () => {
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

      if (tickTime === '0i' || tickTime === '480i') {
        callback(0);
      } else if (tickTime.startsWith('+')) {
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

    expect(useEngineStore.getState().playingMidiNotes).toEqual([]);
    expect(useEngineStore.getState().playingPlaybackNotes).toEqual([]);
  });
});
