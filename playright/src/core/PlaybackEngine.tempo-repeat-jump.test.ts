import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TEMPO_DACAPO_SEEK_MUSICXML,
  TEMPO_REPEAT_MUSICXML,
} from './parser/__fixtures__/tempoRepeatJump.musicxml.ts';
import { TEMPO_MAP_MUSICXML } from './parser/__fixtures__/tempoMap.musicxml.ts';
import { parseMusicXmlToScript } from './parser/index.ts';
import {
  tempoBpmsAlongPlaybackOrder,
  tempoBpmAtOnset,
  tempoChangePlaybackEntryIndices,
} from './playbackTiming.ts';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const scheduleOnce = vi.hoisted(() => vi.fn(() => 1));
const transportBpm = vi.hoisted(() => ({ value: 120 }));

vi.mock('tone', () => ({
  getTransport: () => ({
    PPQ: 480,
    bpm: transportBpm,
    ticks: 0,
    start: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    scheduleOnce,
    clear: vi.fn(),
    cancel: vi.fn(),
  }),
  getDraw: () => ({ schedule: vi.fn() }),
}));

import { PlaybackEngine } from './PlaybackEngine.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

/**
 * P2-9 × R0 interaction: tempoMap is keyed by document-order onset; playback
 * order may revisit earlier onsets after repeats. No bundled asset has both
 * mid-score tempo changes and repeats, so these synthetic fixtures own the gate.
 */

const here = dirname(fileURLToPath(import.meta.url));

async function loadMxl(relativeFromCore: string): Promise<string> {
  const archive = await JSZip.loadAsync(readFileSync(join(here, relativeFromCore)));
  const scoreXml = archive.file('score.xml');
  if (!scoreXml) {
    throw new Error(`missing score.xml in ${relativeFromCore}`);
  }
  return scoreXml.async('string');
}

function attachStubAudio(engine: PlaybackEngine): void {
  engine.attachAudioEngine({
    warm: async () => {},
    init: async () => {},
    scheduleAttackRelease: vi.fn(),
    releaseAll: vi.fn(),
  } as never);
}

function collectScheduledBpmChanges(startingBpm: number): number[] {
  // Walk callbacks in schedule order with a running BPM so a later restore
  // to an earlier marking (e.g. 60 → 120 after a repeat jump) is visible.
  let simulatedBpm = startingBpm;
  const bpmFromCallbacks: number[] = [];
  const scheduledCallbacks = scheduleOnce.mock.calls as unknown as Array<
    [(() => void) | undefined, ...unknown[]]
  >;
  for (const call of scheduledCallbacks) {
    const callback = call[0];
    if (typeof callback !== 'function') {
      continue;
    }
    transportBpm.value = simulatedBpm;
    try {
      callback();
    } catch {
      // Note/visual callbacks may throw without a full Tone/DOM setup.
    }
    if (transportBpm.value !== simulatedBpm) {
      bpmFromCallbacks.push(transportBpm.value);
      simulatedBpm = transportBpm.value;
    }
  }
  transportBpm.value = startingBpm;
  return bpmFromCallbacks;
}

describe('tempoMap × playbackOrder interaction', () => {
  it('tempo-repeat fixture: second pass restores pre-change BPM after backward jump', () => {
    const { script, scoreTiming, playbackOrder } =
      parseMusicXmlToScript(TEMPO_REPEAT_MUSICXML);

    expect(scoreTiming.tempoMap).toEqual([
      { onset: 0, bpm: 120 },
      { onset: 2, bpm: 60 },
    ]);
    // Document: 5 measures × 1 step; playback revisits m2–m4 once.
    expect(playbackOrder.map((entry) => script[entry.stepIndex].measureNumber)).toEqual([
      1, 2, 3, 4, 2, 3, 4, 5,
    ]);
    expect(playbackOrder.some((entry, index) => {
      if (index === 0) {
        return false;
      }
      return (
        script[entry.stepIndex].onset <
        script[playbackOrder[index - 1].stepIndex].onset
      );
    })).toBe(true);

    const bpms = tempoBpmsAlongPlaybackOrder(
      script,
      playbackOrder,
      scoreTiming.tempoMap,
      scoreTiming.tempoBpm,
    );
    expect(bpms).toEqual([120, 120, 60, 60, 120, 60, 60, 60]);
    // Critical second-pass restore (entry index 4 = m2 pass 1).
    expect(bpms[4]).toBe(120);
    expect(tempoChangePlaybackEntryIndices(bpms)).toEqual([2, 4, 5]);
  });

  it('tempo-repeat fixture: PlaybackEngine schedules the second-pass restore', async () => {
    const { script, scoreTiming, playbackOrder } =
      parseMusicXmlToScript(TEMPO_REPEAT_MUSICXML);
    useEngineStore.setState({
      script,
      scoreTiming,
      playbackOrder,
      tempoFactor: 1,
      currentStepIndex: 0,
      playMode: true,
      isPlaybackActive: false,
      isPlaybackFinished: false,
      isPlaybackPaused: false,
    });
    scheduleOnce.mockClear();
    transportBpm.value = 120;

    const engine = new PlaybackEngine();
    attachStubAudio(engine);
    await engine.play();

    expect(transportBpm.value).toBe(120);
    expect(collectScheduledBpmChanges(120)).toEqual([60, 120, 60]);
  });

  it('D.C. seek target uses document-onset tempo of the TARGET, not the source', () => {
    const { script, scoreTiming, playbackOrder, warnings } = parseMusicXmlToScript(
      TEMPO_DACAPO_SEEK_MUSICXML,
    );

    expect(scoreTiming.tempoMap).toEqual([
      { onset: 0, bpm: 100 },
      { onset: 2, bpm: 50 },
    ]);
    // Sound jumps are surfaced but not unrolled into playbackOrder yet.
    expect(warnings.some((warning) => /sound jump/i.test(warning))).toBe(true);
    expect(playbackOrder).toEqual(
      script.map((step, stepIndex) => ({
        stepIndex,
        playbackOnset: step.onset,
        passIndex: 0,
      })),
    );

    const sourceStep = script.find((step) => step.measureNumber === 4)!;
    const targetStep = script.find((step) => step.measureNumber === 1)!;
    expect(tempoBpmAtOnset(scoreTiming.tempoMap, sourceStep.onset, 100)).toBe(50);
    expect(tempoBpmAtOnset(scoreTiming.tempoMap, targetStep.onset, 100)).toBe(100);
  });

  it('seekToStep across a tempo boundary applies the target document tempo', () => {
    const { script, scoreTiming, playbackOrder } = parseMusicXmlToScript(
      TEMPO_DACAPO_SEEK_MUSICXML,
    );
    useEngineStore.setState({
      script,
      scoreTiming,
      playbackOrder,
      tempoFactor: 1,
      currentStepIndex: 0,
      playMode: true,
      isPlaybackActive: false,
      isPlaybackFinished: false,
      isPlaybackPaused: false,
    });
    transportBpm.value = 120;

    const engine = new PlaybackEngine();
    attachStubAudio(engine);

    const sourceIndex = script.findIndex((step) => step.measureNumber === 4);
    const targetIndex = script.findIndex((step) => step.measureNumber === 1);

    engine.seekToStep(sourceIndex);
    expect(transportBpm.value).toBe(50);

    engine.seekToStep(targetIndex);
    expect(transportBpm.value).toBe(100);
  });

  it('lookup is document-onset keyed: fabricated jump order still yields target BPM', () => {
    // Simulate a resolved D.C.-style jump in playbackOrder without waiting on
    // sound-jump resolution: late slow region then back to opening onset.
    const { script, scoreTiming } = parseMusicXmlToScript(TEMPO_DACAPO_SEEK_MUSICXML);
    const fabricatedOrder = [
      { stepIndex: 0, playbackOnset: 0, passIndex: 0 },
      { stepIndex: 1, playbackOnset: 1, passIndex: 0 },
      { stepIndex: 2, playbackOnset: 2, passIndex: 0 },
      { stepIndex: 3, playbackOnset: 3, passIndex: 0 },
      // D.C. back to measure 1 (document onset 0) on a later playback timeline.
      { stepIndex: 0, playbackOnset: 4, passIndex: 1 },
      { stepIndex: 1, playbackOnset: 5, passIndex: 1 },
    ];

    const bpms = tempoBpmsAlongPlaybackOrder(
      script,
      fabricatedOrder,
      scoreTiming.tempoMap,
      scoreTiming.tempoBpm,
    );
    expect(bpms).toEqual([100, 100, 50, 50, 100, 100]);
    expect(tempoChangePlaybackEntryIndices(bpms)).toEqual([2, 4]);
  });
});

describe('tempo×repeat interaction: existing fixtures unchanged', () => {
  it('constant-moderato still exposes mid-score tempo map on identity playbackOrder', () => {
    const xml = readFileSync(
      join(here, '../assets/constant-moderato.musicxml'),
      'utf8',
    );
    const { script, scoreTiming, playbackOrder } = parseMusicXmlToScript(xml);
    const measure16 = script.find((step) => step.measureNumber === 16)!;
    const measure17 = script.find((step) => step.measureNumber === 17)!;

    expect(scoreTiming.totalTimelineDivisions).toBe(3168);
    expect(scoreTiming.tempoMap).toEqual([
      { onset: 0, bpm: 90 },
      { onset: measure16.onset, bpm: 80 },
      { onset: measure17.onset, bpm: 90 },
    ]);
    expect(playbackOrder).toEqual(
      script.map((step, stepIndex) => ({
        stepIndex,
        playbackOnset: step.onset,
        passIndex: 0,
      })),
    );
  });

  it('unwelcome-school still has a single tempo across its non-identity playbackOrder', async () => {
    const xml = await loadMxl('../assets/unwelcome-school.mxl');
    const { script, scoreTiming, playbackOrder } = parseMusicXmlToScript(xml);

    expect(scoreTiming.tempoMap).toEqual([{ onset: 0, bpm: 180 }]);
    expect(playbackOrder.length).toBeGreaterThan(script.length);

    const bpms = tempoBpmsAlongPlaybackOrder(
      script,
      playbackOrder,
      scoreTiming.tempoMap,
      scoreTiming.tempoBpm,
    );
    expect(new Set(bpms)).toEqual(new Set([180]));
    expect(tempoChangePlaybackEntryIndices(bpms)).toEqual([]);
  });

  it('plain tempo-map fixture (no repeats) still changes only on rising document onsets', () => {
    const { script, scoreTiming, playbackOrder } =
      parseMusicXmlToScript(TEMPO_MAP_MUSICXML);
    const bpms = tempoBpmsAlongPlaybackOrder(
      script,
      playbackOrder,
      scoreTiming.tempoMap,
      scoreTiming.tempoBpm,
    );
    expect(bpms).toEqual([120, 60, 90, 90]);
    expect(tempoChangePlaybackEntryIndices(bpms)).toEqual([1, 2]);
  });
});

describe('PlaybackEngine D.C.-style seek (tempo boundary)', () => {
  beforeEach(() => {
    scheduleOnce.mockClear();
    transportBpm.value = 120;
  });

  it('applies tempoFactor on seek to jump target', () => {
    const { script, scoreTiming, playbackOrder } = parseMusicXmlToScript(
      TEMPO_DACAPO_SEEK_MUSICXML,
    );
    useEngineStore.setState({
      script,
      scoreTiming,
      playbackOrder,
      tempoFactor: 1.5,
      currentStepIndex: 0,
      playMode: true,
    });

    const engine = new PlaybackEngine();
    attachStubAudio(engine);
    engine.seekToStep(script.findIndex((step) => step.measureNumber === 1));
    expect(transportBpm.value).toBe(150);
  });
});
