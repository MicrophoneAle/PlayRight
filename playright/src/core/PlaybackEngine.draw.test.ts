import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackScript, ScoreTiming } from '../types/index.ts';

const drawSchedule = vi.hoisted(() =>
  vi.fn((_callback: () => void, _time: number) => ({})),
);
const staleDrawSchedule = vi.hoisted(() => vi.fn());
const transportScheduleOnce = vi.hoisted(() =>
  vi.fn((callback: (time: number) => void, _time: string | number) => {
    callback(0);
    return 1;
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
    schedule: drawSchedule,
  }),
  Draw: {
    schedule: staleDrawSchedule,
  },
}));

import * as Tone from 'tone';
import { PlaybackEngine } from './PlaybackEngine.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

describe('PlaybackEngine draw scheduling', () => {
  beforeEach(() => {
    drawSchedule.mockClear();
    staleDrawSchedule.mockClear();
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

  it('uses getDraw().schedule for playback visuals, not the stale Tone.Draw export', async () => {
    const engine = new PlaybackEngine();
    engine.attachAudioEngine({
      warm: async () => {},
      init: async () => {},
      scheduleAttackRelease,
    } as never);

    await engine.play();

    expect(drawSchedule).toHaveBeenCalled();
    expect(staleDrawSchedule).not.toHaveBeenCalled();
    expect(Tone.Draw.schedule).not.toHaveBeenCalled();
    expect(scheduleAttackRelease).toHaveBeenCalled();
  });

  it('populates playingMidiNotes when draw press callbacks run', async () => {
    const scheduledCallbacks: Array<() => void> = [];
    drawSchedule.mockImplementation((callback: () => void) => {
      scheduledCallbacks.push(callback);
      return {};
    });

    const engine = new PlaybackEngine();
    engine.attachAudioEngine({
      warm: async () => {},
      init: async () => {},
      scheduleAttackRelease,
    } as never);

    await engine.play();

    expect(scheduledCallbacks.length).toBeGreaterThanOrEqual(2);
    scheduledCallbacks[1]();

    expect(useEngineStore.getState().playingMidiNotes).toContain(60);
    expect(useEngineStore.getState().playingPlaybackNotes).toEqual([
      expect.objectContaining({ stepIndex: 0, midi: 60, hand: 'R' }),
    ]);
  });
});
