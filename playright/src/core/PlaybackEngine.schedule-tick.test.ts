import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findAttackScheduleClamps,
  findInterAttackGapMismatches,
  loadTetorisScript,
  loadUnwelcomeSchoolScript,
  simulatePlaybackAttackSchedule,
} from './playbackScheduleSimulation.ts';

const TRANSPORT_DRIFT_TICKS = 6;

const transportPause = vi.hoisted(() => vi.fn());

vi.mock('tone', () => ({
  getTransport: () => ({
    PPQ: 480,
    bpm: { value: 120 },
    ticks: 0,
    start: vi.fn(),
    stop: vi.fn(),
    pause: transportPause,
    scheduleOnce: vi.fn(),
    clear: vi.fn(),
    cancel: vi.fn(),
  }),
  getDraw: () => ({ schedule: vi.fn() }),
}));

import { PlaybackEngine } from './PlaybackEngine.ts';

describe('playback tempo regression (rolling-window scheduling)', () => {
  it('unwelcome-school: single tempo from score metadata', async () => {
    const { scoreTiming } = await loadUnwelcomeSchoolScript();
    expect(scoreTiming.tempoBpm).toBe(180);
  });

  it('unwelcome-school: legacy transport floor creates alternating gap distortion under drift', async () => {
    const { script, scoreTiming } = await loadUnwelcomeSchoolScript();
    const attacks = simulatePlaybackAttackSchedule(
      script,
      scoreTiming.divisionsPerQuarter,
      {
        extensionTransportDriftTicks: TRANSPORT_DRIFT_TICKS,
        useLegacyTransportFloor: true,
        useWindowLagShift: false,
      },
    );

    const mismatches = findInterAttackGapMismatches(attacks);
    const speedups = mismatches.filter(
      (gap) => gap.scheduledGap < gap.musicalGap,
    );
    const slowdowns = mismatches.filter(
      (gap) => gap.scheduledGap > gap.musicalGap,
    );

    expect(mismatches.length).toBeGreaterThan(0);
    expect(speedups.length).toBeGreaterThan(0);
    expect(slowdowns.length).toBeGreaterThan(0);
  });

  it('unwelcome-school: window lag preserves score tempo spacing under late extensions', async () => {
    const { script, scoreTiming } = await loadUnwelcomeSchoolScript();
    const attacks = simulatePlaybackAttackSchedule(
      script,
      scoreTiming.divisionsPerQuarter,
      {
        extensionTransportDriftTicks: TRANSPORT_DRIFT_TICKS,
        useLegacyTransportFloor: false,
        useWindowLagShift: true,
      },
    );

    const mismatches = findInterAttackGapMismatches(attacks);
    const speedups = mismatches.filter(
      (gap) => gap.scheduledGap < gap.musicalGap,
    );

    expect(speedups).toEqual([]);
    expect(mismatches.length).toBeLessThanOrEqual(1);
    expect(findAttackScheduleClamps(attacks).every(
      (clamp) => clamp.scheduledTick - clamp.musicalTick <= TRANSPORT_DRIFT_TICKS,
    )).toBe(true);
  });

  it('tetoris: window lag preserves score tempo spacing under late extensions', async () => {
    const { script, scoreTiming } = await loadTetorisScript();
    const attacks = simulatePlaybackAttackSchedule(
      script,
      scoreTiming.divisionsPerQuarter,
      {
        extensionTransportDriftTicks: TRANSPORT_DRIFT_TICKS,
        useLegacyTransportFloor: false,
        useWindowLagShift: true,
      },
    );

    const mismatches = findInterAttackGapMismatches(attacks);
    expect(mismatches.filter((gap) => gap.scheduledGap < gap.musicalGap)).toEqual(
      [],
    );
  });
});

describe('PlaybackEngine piece completion', () => {
  beforeEach(() => {
    transportPause.mockClear();
  });

  it('pauses transport with the scheduled callback time, not wall clock', () => {
    const engine = new PlaybackEngine();
    (
      engine as unknown as { isPlaying: boolean; isPaused: boolean; completePlayback: (time?: number) => void }
    ).isPlaying = true;
    (
      engine as unknown as { isPlaying: boolean; isPaused: boolean; completePlayback: (time?: number) => void }
    ).isPaused = false;

    (
      engine as unknown as { completePlayback: (time?: number) => void }
    ).completePlayback(42);

    expect(transportPause).toHaveBeenCalledWith(42);
    expect(transportPause).not.toHaveBeenCalledWith();
  });
});
