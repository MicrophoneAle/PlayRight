import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackScript } from '../types/index.ts';

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
import { parseMusicXmlToScript } from './parser/index.ts';
import { quartersToTicks } from './playbackTiming.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

const GRACE_DURATION_QUARTERS = 1 / 8;
const PPQ = 480;

function parseTransportTick(tickTime: string): number {
  return Number.parseFloat(tickTime.replace('i', ''));
}

function roundedTransportTickTime(quarterNotes: number): string {
  return `${Math.round(quartersToTicks(quarterNotes, PPQ))}i`;
}

describe('GN-3 PlaybackEngine grace note scheduling', () => {
  beforeEach(() => {
    transportScheduleOnce.mockClear();
    transportStart.mockClear();
    scheduleAttackRelease.mockClear();
  });

  it('morns measure 5: 32nd grace ends at main attack without shifting main onset', async () => {
    const mornsXml = readFileSync(
      new URL('../assets/morns-like-these-honkai-star-rail.musicxml', import.meta.url),
      'utf8',
    );
    const { script, scoreTiming } = parseMusicXmlToScript(mornsXml);
    const graceStepIndex = script.findIndex(
      (step) => step.measureNumber === 5 && step.graceBefore?.length,
    );
    expect(graceStepIndex).toBeGreaterThan(0);

    const graceStep = script[graceStepIndex];
    const divisionsPerQuarter = scoreTiming.divisionsPerQuarter;

    const mainAttackQuarters = graceStep.onset / divisionsPerQuarter;
    const graceAttackQuarters = mainAttackQuarters - GRACE_DURATION_QUARTERS;
    const mainAttackTick = roundedTransportTickTime(mainAttackQuarters);
    const graceAttackTick = roundedTransportTickTime(graceAttackQuarters);
    const graceDuration = roundedTransportTickTime(GRACE_DURATION_QUARTERS);

    useEngineStore.setState({
      script: script.slice(graceStepIndex - 1, graceStepIndex + 1) as PlaybackScript,
      scoreTiming,
      playMode: true,
      currentStepIndex: 0,
      playingMidiNotes: [],
      playingPlaybackNotes: [],
      isPlaybackActive: false,
      isPlaybackFinished: false,
      isPlaybackPaused: false,
    });

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

    const scheduledTimes = scheduled.map(({ time }) => time);
    expect(scheduledTimes).toContain(graceAttackTick);
    expect(scheduledTimes).toContain(mainAttackTick);

    let graceAudioCall: [number, string, number] | undefined;
    for (const { callback } of scheduled.filter(({ time }) => time === graceAttackTick)) {
      scheduleAttackRelease.mockClear();
      callback(0);
      const call = scheduleAttackRelease.mock.calls.find(
        ([midi]) => midi === graceStep.graceBefore![0].midi,
      );
      if (call) {
        graceAudioCall = call as [number, string, number];
        break;
      }
    }

    expect(graceAudioCall).toEqual([
      graceStep.graceBefore![0].midi,
      graceDuration,
      0,
    ]);

    // Borrowed from preceding tail: prev E5 release moves up to the grace window
    // start (9300i), not the natural quarter end at main attack (9360i).
    expect(scheduledTimes.filter((time) => time === graceAttackTick).length).toBeGreaterThanOrEqual(
      2,
    );

    scheduleAttackRelease.mockClear();
    for (const { callback } of scheduled.filter(({ time }) => time === mainAttackTick)) {
      callback(0);
    }

    const mainMidi = graceStep.notes.find((note) => note.pitch === 'F#5')!.midi;
    expect(scheduleAttackRelease).toHaveBeenCalledWith(
      mainMidi,
      expect.not.stringMatching(/^0i$/),
      0,
    );

    const mainAttackTickValue = parseTransportTick(mainAttackTick);
    const graceAttackTickValue = parseTransportTick(graceAttackTick);
    expect(mainAttackTickValue - graceAttackTickValue).toBe(
      Math.round(quartersToTicks(GRACE_DURATION_QUARTERS, PPQ)),
    );
  });
});
