import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEMPO_MAP_MUSICXML } from './parser/__fixtures__/tempoMap.musicxml.ts';
import { parseMusicXmlToScript } from './parser/index.ts';

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

function loadTempoMapScore(tempoFactor = 1): void {
  const { script, scoreTiming, playbackOrder } =
    parseMusicXmlToScript(TEMPO_MAP_MUSICXML);
  useEngineStore.setState({
    script,
    scoreTiming,
    playbackOrder,
    tempoFactor,
    currentStepIndex: 0,
    playMode: true,
    isPlaybackActive: false,
    isPlaybackFinished: false,
    isPlaybackPaused: false,
  });
}

function attachStubAudio(engine: PlaybackEngine): void {
  engine.attachAudioEngine({
    warm: async () => {},
    init: async () => {},
    scheduleAttackRelease: vi.fn(),
    releaseAll: vi.fn(),
  } as never);
}

describe('PlaybackEngine tempo map', () => {
  beforeEach(() => {
    scheduleOnce.mockClear();
    transportBpm.value = 120;
    loadTempoMapScore();
  });

  it('sets Transport BPM from the opening tempo-map entry on play', async () => {
    const engine = new PlaybackEngine();
    attachStubAudio(engine);

    await engine.play();
    expect(transportBpm.value).toBe(120);
  });

  it('schedules Transport BPM updates when consecutive entries change tempo', async () => {
    const engine = new PlaybackEngine();
    attachStubAudio(engine);

    await engine.play();

    const bpmFromCallbacks: number[] = [];
    const scheduledCallbacks = scheduleOnce.mock.calls as unknown as Array<
      [(() => void) | undefined, ...unknown[]]
    >;
    let simulatedBpm = 120;
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

    expect(bpmFromCallbacks).toEqual([60, 90]);
  });

  it('applies the active map tempo when seeking into a later region', () => {
    const engine = new PlaybackEngine();
    attachStubAudio(engine);

    engine.seekToStep(1);
    expect(transportBpm.value).toBe(60);

    engine.seekToStep(2);
    expect(transportBpm.value).toBe(90);
  });

  it('multiplies tempo-map BPM by tempoFactor', async () => {
    loadTempoMapScore(0.5);
    const engine = new PlaybackEngine();
    attachStubAudio(engine);

    await engine.play();
    expect(transportBpm.value).toBe(60);

    engine.seekToStep(1);
    expect(transportBpm.value).toBe(30);
  });
});
