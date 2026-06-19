import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngine } from './AudioEngine.ts';
import { PracticeEngine } from './PracticeEngine.ts';
import { getDynamicKeyMap } from './InputManager.ts';
import type { PlaybackScript } from '../types/index.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

function makeScript(steps: PlaybackScript, rawXml = '<score/>'): void {
  useEngineStore.getState().actions.loadScript(steps, rawXml, 'test');
}

function resetStore(): void {
  useEngineStore.getState().actions.clearScript();
  useEngineStore.setState({
    engineMode: 'one-hand',
    activeHand: 'R',
    isPracticeActive: false,
    hasPracticeStarted: false,
    currentStepIndex: 0,
    scopeStartMidi: 60,
    expectedMidiNotes: [],
  });
}

function createMockAudio(): AudioEngine {
  return {
    noteOn: vi.fn(),
    noteOff: vi.fn(),
    warm: vi.fn(),
    init: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
  } as unknown as AudioEngine;
}

describe('PracticeEngine one-hand progression', () => {
  let engine: PracticeEngine;
  let audio: AudioEngine;
  let rafCallback: FrameRequestCallback | null = null;

  beforeEach(() => {
    resetStore();
    rafCallback = null;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallback = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    engine = new PracticeEngine();
    engine.ensureStoreSubscription();
    audio = createMockAudio();
    engine.attachAudioEngine(audio);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const flushAdvance = () => {
    rafCallback?.(0);
    rafCallback = null;
  };

  it('advances on a single correct note in one-hand mode', () => {
    makeScript([
      {
        order: 0,
        onset: 0,
        notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: 1 }],
      },
      {
        order: 1,
        onset: 1,
        notes: [{ pitch: 'D4', midi: 62, hand: 'R', finger: 2 }],
      },
    ]);
    engine.start();

    engine.handleNoteOn(60);
    flushAdvance();

    expect(useEngineStore.getState().currentStepIndex).toBe(1);
    expect(useEngineStore.getState().expectedMidiNotes).toEqual([62]);
  });

  it('requires every chord tone before advancing', () => {
    makeScript([
      {
        order: 0,
        onset: 0,
        notes: [
          { pitch: 'C4', midi: 60, hand: 'R', finger: 1 },
          { pitch: 'E4', midi: 64, hand: 'R', finger: 3 },
        ],
      },
      {
        order: 1,
        onset: 1,
        notes: [{ pitch: 'G4', midi: 67, hand: 'R', finger: 5 }],
      },
    ]);
    engine.start();

    engine.handleNoteOn(60);
    flushAdvance();
    expect(useEngineStore.getState().currentStepIndex).toBe(0);

    engine.handleNoteOn(64);
    flushAdvance();
    expect(useEngineStore.getState().currentStepIndex).toBe(1);
  });

  it('ignores left-hand notes while practicing the right hand', () => {
    makeScript([
      {
        order: 0,
        onset: 0,
        notes: [
          { pitch: 'C3', midi: 48, hand: 'L', finger: 1 },
          { pitch: 'C4', midi: 60, hand: 'R', finger: 1 },
        ],
      },
    ]);
    engine.start();

    engine.handleNoteOn(48);
    flushAdvance();
    expect(useEngineStore.getState().currentStepIndex).toBe(0);

    engine.handleNoteOn(60);
    flushAdvance();
    expect(useEngineStore.getState().currentStepIndex).toBe(1);
  });

  it('pause clears expected notes without rewinding the step', () => {
    makeScript([
      {
        order: 0,
        onset: 0,
        notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: 1 }],
      },
      {
        order: 1,
        onset: 1,
        notes: [{ pitch: 'D4', midi: 62, hand: 'R', finger: 2 }],
      },
    ]);
    engine.start();
    expect(useEngineStore.getState().currentStepIndex).toBe(0);

    engine.pause();

    const state = useEngineStore.getState();
    expect(state.isPracticeActive).toBe(false);
    expect(state.hasPracticeStarted).toBe(true);
    expect(state.currentStepIndex).toBe(0);
    expect(state.expectedMidiNotes).toEqual([]);
  });

  it('stop returns to the beginning and ends practice', () => {
    makeScript([
      {
        order: 0,
        onset: 0,
        notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: 1 }],
      },
      {
        order: 1,
        onset: 1,
        notes: [{ pitch: 'D4', midi: 62, hand: 'R', finger: 2 }],
      },
    ]);
    engine.start();
    engine.handleNoteOn(60);
    flushAdvance();
    expect(useEngineStore.getState().currentStepIndex).toBe(1);

    engine.stop();

    const state = useEngineStore.getState();
    expect(state.currentStepIndex).toBe(0);
    expect(state.isPracticeActive).toBe(false);
    expect(state.hasPracticeStarted).toBe(false);
    expect(state.expectedMidiNotes).toEqual([]);
  });

  it('restart rewinds to step zero while keeping practice active', () => {
    makeScript([
      {
        order: 0,
        onset: 0,
        notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: 1 }],
      },
      {
        order: 1,
        onset: 1,
        notes: [{ pitch: 'D4', midi: 62, hand: 'R', finger: 2 }],
      },
    ]);
    engine.start();
    engine.handleNoteOn(60);
    flushAdvance();
    expect(useEngineStore.getState().currentStepIndex).toBe(1);

    engine.restart();

    const state = useEngineStore.getState();
    expect(state.currentStepIndex).toBe(0);
    expect(state.isPracticeActive).toBe(true);
    expect(state.hasPracticeStarted).toBe(true);
    expect(state.expectedMidiNotes).toEqual([60]);
  });

  it('aligns the scope when step notes fall outside the current core anchors', () => {
    const highMidi = 88;
    makeScript([
      {
        order: 0,
        onset: 0,
        notes: [{ pitch: 'E6', midi: highMidi, hand: 'R', finger: 3 }],
      },
    ]);
    useEngineStore.getState().actions.setScopeStart(60);

    engine.start();

    const scopeStart = useEngineStore.getState().scopeStartMidi;
    const map = getDynamicKeyMap(scopeStart);

    expect(map.KeyA).toBeLessThanOrEqual(highMidi);
    expect(map.Semicolon).toBeGreaterThanOrEqual(highMidi);
    expect(useEngineStore.getState().expectedMidiNotes).toEqual([highMidi]);
  });
});
