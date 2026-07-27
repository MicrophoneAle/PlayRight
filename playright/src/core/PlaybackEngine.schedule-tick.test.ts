import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findAttackScheduleClamps,
  findInterAttackGapMismatches,
  loadTetorisScript,
  loadUnwelcomeSchoolScript,
  simulatePlaybackAttackSchedule,
} from './playbackScheduleSimulation.ts';
import {
  PLAYBACK_MAX_WINDOW_LAG_QUARTERS,
  PLAYBACK_SCHEDULE_EXTENSION_LEAD_QUARTERS,
  quartersToTicks,
} from './playbackTiming.ts';
import type { PlaybackScript, ScoreTiming } from '../types/index.ts';

const TRANSPORT_DRIFT_TICKS = 6;

const transportPause = vi.hoisted(() => vi.fn());
const transportScheduleOnce = vi.hoisted(() =>
  vi.fn((_callback: (time: number) => void, _time: string | number) =>
    transportScheduleOnce.mock.calls.length,
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
    pause: transportPause,
    scheduleOnce: transportScheduleOnce,
    clear: vi.fn(),
    cancel: vi.fn(),
  }),
  getDraw: () => ({ schedule: vi.fn() }),
}));

import { PlaybackEngine } from './PlaybackEngine.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

describe('playback tempo regression (rolling-window scheduling)', () => {
  beforeEach(() => {
    transportScheduleOnce.mockClear();
    transportPause.mockClear();
    transportTicks.value = 0;
  });

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

  it('unwelcome-school: lag cap bounds cumulative crawl under large extension drift', async () => {
    const { script, scoreTiming } = await loadUnwelcomeSchoolScript();
    const largeDrift = 480; // 1 quarter note at PPQ 480
    const attacks = simulatePlaybackAttackSchedule(
      script,
      scoreTiming.divisionsPerQuarter,
      {
        extensionTransportDriftTicks: largeDrift,
        useLegacyTransportFloor: false,
        useWindowLagShift: true,
        useWindowLagCap: true,
      },
    );

    const maxLagTicks = Math.round(480 * PLAYBACK_MAX_WINDOW_LAG_QUARTERS);
    expect(
      findAttackScheduleClamps(attacks).every(
        (clamp) => clamp.scheduledTick - clamp.musicalTick <= maxLagTicks,
      ),
    ).toBe(true);
    expect(
      findInterAttackGapMismatches(attacks).filter(
        (gap) => gap.scheduledGap < gap.musicalGap,
      ),
    ).toEqual([]);
  });

  it('unwelcome-school: early-lead extensions keep score tempo with modest main-thread drift', async () => {
    const { script, scoreTiming } = await loadUnwelcomeSchoolScript();
    // Drift well under the 12q lead (~5760 ticks) — the old late-at-anchor
    // model would still shift the window; early lead absorbs it.
    const modestDrift = 240;
    const attacks = simulatePlaybackAttackSchedule(
      script,
      scoreTiming.divisionsPerQuarter,
      {
        extensionTransportDriftTicks: modestDrift,
        useLegacyTransportFloor: false,
        useWindowLagShift: true,
        useEarlyExtensionLead: true,
      },
    );

    expect(findAttackScheduleClamps(attacks)).toEqual([]);
    expect(findInterAttackGapMismatches(attacks)).toEqual([]);
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

  it('schedules the next window lead quarters before its first attack', async () => {
    // Sparse onsets every 24q so the early-lead extension tick (12q before the
    // next window) cannot collide with a note attack time.
    const divisionsPerQuarter = 480;
    const script: PlaybackScript = [];
    for (let beat = 0; beat <= 120; beat += 24) {
      script.push({
        order: script.length,
        onset: beat * divisionsPerQuarter,
        measureNumber: Math.floor(beat / 4) + 1,
        notes: [
          {
            pitch: 'C4',
            midi: 60,
            hand: 'R',
            finger: 1,
            durationDivisions: divisionsPerQuarter,
          },
        ],
      });
    }
    const scoreTiming: ScoreTiming = {
      divisionsPerQuarter,
      tempoBpm: 120,
      tempoMap: [{ onset: 0, bpm: 120 }],
      totalTimelineDivisions: 120 * divisionsPerQuarter,
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

    const scheduledTicks = transportScheduleOnce.mock.calls
      .map(([, time]) => String(time))
      .filter((time) => time.endsWith('i'))
      .map((time) => Number(time.slice(0, -1)));

    const leadTicks = Math.round(
      quartersToTicks(PLAYBACK_SCHEDULE_EXTENSION_LEAD_QUARTERS, 480),
    );
    // First next-window attack after a 24q window is at 48q; lead trigger at 36q.
    const expectedFirstLeadTick = Math.round(quartersToTicks(48, 480)) - leadTicks;
    expect(scheduledTicks).toContain(expectedFirstLeadTick);
    // Must not only schedule the extension at the next-window attack itself.
    expect(expectedFirstLeadTick).toBeLessThan(Math.round(quartersToTicks(48, 480)));
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
