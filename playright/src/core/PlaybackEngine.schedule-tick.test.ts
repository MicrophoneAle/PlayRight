import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYBACK_SCHEDULE_AHEAD_QUARTERS } from './PlaybackEngine.ts';
import { parseMusicXmlToScript } from './parser/index.ts';
import {
  buildFermataPlaybackContext,
  buildFinalNoteKeySet,
  buildPlaybackFermataOffsetsByStep,
  quartersToTicks,
  scheduledPlaybackAttackQuarterNotes,
} from './playbackTiming.ts';
import type { PlaybackScript } from '../types/index.ts';

const PPQ = 480;
const TRANSPORT_DRIFT_TICKS = 6;

async function loadTetorisXml(): Promise<string> {
  const buffer = readFileSync(
    new URL('../assets/tetoris.mxl', import.meta.url),
  );
  const archive = await JSZip.loadAsync(buffer);
  const scoreXml = await archive.file('score.xml')?.async('string');
  if (!scoreXml) {
    throw new Error('tetoris.mxl missing score.xml');
  }
  return scoreXml;
}

interface ClampRecord {
  stepIndex: number;
  roundedTicks: number;
  minTick: number;
  windowFromStepIndex: number;
}

/**
 * Mirrors extendScheduleWindow tick floors (post-fix) for regression coverage
 * without spinning up Tone transport.
 */
function collectRollingWindowClamps(
  script: PlaybackScript,
  divisionsPerQuarter: number,
  fermataOffsets: number[],
  transportDriftTicks: number,
  useLegacyTransportFloor: boolean,
): ClampRecord[] {
  const clamps: ClampRecord[] = [];
  let nextUnscheduledStepIndex = 0;
  let lastScheduledAttackTick = -1;

  while (nextUnscheduledStepIndex < script.length) {
    const fromStepIndex = nextUnscheduledStepIndex;
    const anchorQuarters = scheduledPlaybackAttackQuarterNotes(
      script[fromStepIndex].onset,
      divisionsPerQuarter,
      fermataOffsets[fromStepIndex],
    );
    const windowEndQuarters = anchorQuarters + PLAYBACK_SCHEDULE_AHEAD_QUARTERS;
    const transportTicks =
      fromStepIndex === 0
        ? Math.round(quartersToTicks(anchorQuarters, PPQ))
        : Math.round(quartersToTicks(anchorQuarters, PPQ)) + transportDriftTicks;

    let lastSafeAttackTick: number;
    if (useLegacyTransportFloor) {
      lastSafeAttackTick = Math.max(
        lastScheduledAttackTick,
        Math.round(transportTicks) - 1,
      );
    } else {
      lastSafeAttackTick = lastScheduledAttackTick;
      if (lastSafeAttackTick < 0) {
        lastSafeAttackTick = Math.max(-1, Math.round(transportTicks) - 1);
      }
    }

    let lastScheduledStep = fromStepIndex;

    for (let stepIndex = fromStepIndex; stepIndex < script.length; stepIndex += 1) {
      const attackOnsetQuarters = scheduledPlaybackAttackQuarterNotes(
        script[stepIndex].onset,
        divisionsPerQuarter,
        fermataOffsets[stepIndex],
      );

      if (stepIndex > fromStepIndex && attackOnsetQuarters > windowEndQuarters) {
        break;
      }

      const roundedTicks = Math.round(quartersToTicks(attackOnsetQuarters, PPQ));
      if (roundedTicks < lastSafeAttackTick) {
        clamps.push({
          stepIndex,
          roundedTicks,
          minTick: lastSafeAttackTick,
          windowFromStepIndex: fromStepIndex,
        });
      }

      lastSafeAttackTick =
        roundedTicks < lastSafeAttackTick ? lastSafeAttackTick + 1 : roundedTicks;
      lastScheduledStep = stepIndex + 1;
    }

    nextUnscheduledStepIndex = lastScheduledStep;
    lastScheduledAttackTick = lastSafeAttackTick;

    if (lastScheduledStep >= script.length || lastScheduledStep === fromStepIndex) {
      break;
    }
  }

  return clamps;
}

const transportPause = vi.hoisted(() => vi.fn());

vi.mock('tone', () => ({
  getTransport: () => ({
    PPQ: PPQ,
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

describe('PlaybackEngine rolling-window tick floors', () => {
  it('tetoris: legacy transport floor clamps first step of each window under drift', async () => {
    const xml = await loadTetorisXml();
    const { script, scoreTiming } = parseMusicXmlToScript(xml);
    const fermataOffsets = buildPlaybackFermataOffsetsByStep(
      script,
      scoreTiming.divisionsPerQuarter,
      buildFinalNoteKeySet(script, scoreTiming.divisionsPerQuarter),
      buildFermataPlaybackContext(script, scoreTiming.divisionsPerQuarter),
    );

    const legacyClamps = collectRollingWindowClamps(
      script,
      scoreTiming.divisionsPerQuarter,
      fermataOffsets,
      TRANSPORT_DRIFT_TICKS,
      true,
    );

    expect(legacyClamps.length).toBeGreaterThan(0);
    expect(legacyClamps.some((record) => record.stepIndex === 639)).toBe(true);
  });

  it('tetoris: musical floor avoids window-boundary clamps under transport drift', async () => {
    const xml = await loadTetorisXml();
    const { script, scoreTiming } = parseMusicXmlToScript(xml);
    const fermataOffsets = buildPlaybackFermataOffsetsByStep(
      script,
      scoreTiming.divisionsPerQuarter,
      buildFinalNoteKeySet(script, scoreTiming.divisionsPerQuarter),
      buildFermataPlaybackContext(script, scoreTiming.divisionsPerQuarter),
    );

    const clamps = collectRollingWindowClamps(
      script,
      scoreTiming.divisionsPerQuarter,
      fermataOffsets,
      TRANSPORT_DRIFT_TICKS,
      false,
    );

    expect(clamps).toEqual([]);
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
