import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackScript, ScoreTiming } from '../types/index.ts';

vi.mock('tone', () => ({
  getTransport: () => ({
    PPQ: 480,
    bpm: { value: 120 },
    ticks: 0,
    start: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    scheduleOnce: vi.fn(() => 0),
    clear: vi.fn(),
    cancel: vi.fn(),
  }),
  getDraw: () => ({ schedule: vi.fn() }),
}));

import { PlaybackEngine } from './PlaybackEngine.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

type EngineVisualAccess = {
  isPlaying: boolean;
  isPaused: boolean;
  pressPlayingNote: (
    stepIndex: number,
    midi: number,
    hand: 'L' | 'R',
    pressId: number,
  ) => void;
  releasePlayingNote: (pressId: number) => void;
  applyStepVisual: (
    stepIndex: number,
    entryIndex: number,
    options?: { immediate?: boolean },
  ) => void;
  flushVisualStoreSyncImmediate: () => void;
};

describe('PlaybackEngine visual store coalesce', () => {
  const rafCallbacks: FrameRequestCallback[] = [];
  let nextRafId = 1;
  let engine: PlaybackEngine;

  beforeEach(() => {
    rafCallbacks.length = 0;
    nextRafId = 1;
    vi.stubGlobal(
      'requestAnimationFrame',
      (callback: FrameRequestCallback): number => {
        rafCallbacks.push(callback);
        return nextRafId++;
      },
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      void id;
      rafCallbacks.length = 0;
    });

    const script: PlaybackScript = [
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [
          { pitch: 'C4', midi: 60, hand: 'R', finger: 1, durationDivisions: 480 },
          { pitch: 'E4', midi: 64, hand: 'R', finger: 3, durationDivisions: 480 },
        ],
      },
      {
        order: 1,
        onset: 480,
        measureNumber: 1,
        notes: [
          { pitch: 'D4', midi: 62, hand: 'R', finger: 2, durationDivisions: 480 },
        ],
      },
    ];
    const scoreTiming: ScoreTiming = {
      divisionsPerQuarter: 480,
      tempoBpm: 120,
      tempoMap: [{ onset: 0, bpm: 120 }],
      totalTimelineDivisions: 960,
    };

    useEngineStore.setState({
      script,
      scoreTiming,
      playMode: true,
      engineMode: 'one-hand',
      activeHand: 'R',
      currentStepIndex: 0,
      currentPlaybackOrderIndex: 0,
      expectedMidiNotes: [],
      playingMidiNotes: [],
      playingPlaybackNotes: [],
      isPlaybackActive: true,
      isPlaybackFinished: false,
      isPlaybackPaused: false,
    });

    engine = new PlaybackEngine();
    const access = engine as unknown as EngineVisualAccess;
    access.isPlaying = true;
    access.isPaused = false;
  });

  afterEach(() => {
    engine.dispose();
    vi.unstubAllGlobals();
  });

  it('defers playing-note store writes to one animation frame during live playback', () => {
    const access = engine as unknown as EngineVisualAccess;

    access.pressPlayingNote(0, 60, 'R', 1);
    access.pressPlayingNote(0, 64, 'R', 2);

    expect(useEngineStore.getState().playingMidiNotes).toEqual([]);
    expect(rafCallbacks).toHaveLength(1);

    rafCallbacks[0](0);

    expect(useEngineStore.getState().playingMidiNotes).toEqual([60, 64]);
    expect(useEngineStore.getState().playingPlaybackNotes).toHaveLength(2);
  });

  it('batches step visual + presses into a single coalesced store flush', () => {
    const access = engine as unknown as EngineVisualAccess;

    access.applyStepVisual(1, 1);
    access.pressPlayingNote(1, 62, 'R', 3);

    expect(useEngineStore.getState().currentStepIndex).toBe(0);
    expect(useEngineStore.getState().playingMidiNotes).toEqual([]);
    expect(rafCallbacks).toHaveLength(1);

    rafCallbacks[0](0);

    expect(useEngineStore.getState().currentStepIndex).toBe(1);
    expect(useEngineStore.getState().currentPlaybackOrderIndex).toBe(1);
    expect(useEngineStore.getState().expectedMidiNotes).toEqual([62]);
    expect(useEngineStore.getState().playingMidiNotes).toEqual([62]);
  });

  it('writes immediately when seek asks for an immediate step visual', () => {
    const access = engine as unknown as EngineVisualAccess;

    access.applyStepVisual(1, 1, { immediate: true });

    expect(rafCallbacks).toHaveLength(0);
    expect(useEngineStore.getState().currentStepIndex).toBe(1);
    expect(useEngineStore.getState().expectedMidiNotes).toEqual([62]);
  });

  it('does not leave a stale coalesced flush after pause clears highlights', () => {
    const access = engine as unknown as EngineVisualAccess;

    access.pressPlayingNote(0, 60, 'R', 1);
    expect(rafCallbacks).toHaveLength(1);

    engine.pause();

    expect(useEngineStore.getState().playingMidiNotes).toEqual([]);
    expect(rafCallbacks).toHaveLength(0);

    // A cancelled frame must not re-light keys.
    access.flushVisualStoreSyncImmediate();
    expect(useEngineStore.getState().playingMidiNotes).toEqual([]);
  });
});
