import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngine } from './AudioEngine.ts';
import { PracticeEngine, PRACTICE_CHORD_INTAKE_MS } from './PracticeEngine.ts';
import { getDynamicKeyMap, getScopeKeyMap, midisFitScopeKeyMap } from './InputManager.ts';
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

  beforeEach(() => {
    vi.useFakeTimers();

    resetStore();

    engine = new PracticeEngine();
    engine.ensureStoreSubscription();
    audio = createMockAudio();
    engine.attachAudioEngine(audio);
  });

  afterEach(() => {
    engine.flushStepCompletionCheck();
    vi.useRealTimers();
  });

  const flushStepCompletion = () => {
    vi.advanceTimersByTime(PRACTICE_CHORD_INTAKE_MS);
  };

  it('advances on a single correct note in one-hand mode', () => {
    makeScript([
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: 1 }],
      },
      {
        order: 1,
        onset: 1,
        measureNumber: 1,
        notes: [{ pitch: 'D4', midi: 62, hand: 'R', finger: 2 }],
      },
    ]);
    engine.start();

    engine.handleNoteOn(60);
    flushStepCompletion();

    expect(useEngineStore.getState().currentStepIndex).toBe(1);
    expect(useEngineStore.getState().expectedMidiNotes).toEqual([62]);
  });

  it('requires every chord tone before advancing', () => {
    makeScript([
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [
          { pitch: 'C4', midi: 60, hand: 'R', finger: 1 },
          { pitch: 'E4', midi: 64, hand: 'R', finger: 3 },
        ],
      },
      {
        order: 1,
        onset: 1,
        measureNumber: 1,
        notes: [{ pitch: 'G4', midi: 67, hand: 'R', finger: 5 }],
      },
    ]);
    engine.start();

    engine.handleNoteOn(60);
    flushStepCompletion();
    expect(useEngineStore.getState().currentStepIndex).toBe(0);

    engine.handleNoteOn(64);
    flushStepCompletion();
    expect(useEngineStore.getState().currentStepIndex).toBe(1);
  });

  it('ignores left-hand notes while practicing the right hand', () => {
    makeScript([
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [
          { pitch: 'C3', midi: 48, hand: 'L', finger: 1 },
          { pitch: 'C4', midi: 60, hand: 'R', finger: 1 },
        ],
      },
    ]);
    engine.start();

    engine.handleNoteOn(48);
    flushStepCompletion();
    expect(useEngineStore.getState().currentStepIndex).toBe(0);

    engine.handleNoteOn(60);
    flushStepCompletion();
    expect(useEngineStore.getState().currentStepIndex).toBe(1);
  });

  it('pause clears expected notes without rewinding the step', () => {
    makeScript([
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: 1 }],
      },
      {
        order: 1,
        onset: 1,
        measureNumber: 1,
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
        measureNumber: 1,
        notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: 1 }],
      },
      {
        order: 1,
        onset: 1,
        measureNumber: 1,
        notes: [{ pitch: 'D4', midi: 62, hand: 'R', finger: 2 }],
      },
    ]);
    engine.start();
    engine.handleNoteOn(60);
    flushStepCompletion();
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
        measureNumber: 1,
        notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: 1 }],
      },
      {
        order: 1,
        onset: 1,
        measureNumber: 1,
        notes: [{ pitch: 'D4', midi: 62, hand: 'R', finger: 2 }],
      },
    ]);
    engine.start();
    engine.handleNoteOn(60);
    flushStepCompletion();
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
        measureNumber: 1,
        notes: [{ pitch: 'E6', midi: highMidi, hand: 'R', finger: 3 }],
      },
    ]);
    useEngineStore.getState().actions.setScopeStart(60);

    engine.start();

    const scopeStart = useEngineStore.getState().scopeStartMidi;
    const map = getDynamicKeyMap(scopeStart);

    expect(midisFitScopeKeyMap([highMidi], scopeStart, 0)).toBe(true);
    expect(Object.values(getScopeKeyMap(scopeStart, 0))).toContain(highMidi);
    expect(map.KeyA).toBeLessThanOrEqual(highMidi);
    expect(useEngineStore.getState().expectedMidiNotes).toEqual([highMidi]);
  });

  it('attacks each midi only once until it is released', () => {
    makeScript([
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: 1 }],
      },
      {
        order: 1,
        onset: 1,
        measureNumber: 1,
        notes: [{ pitch: 'D4', midi: 62, hand: 'R', finger: 2 }],
      },
    ]);
    engine.start();

    engine.handleNoteOn(60);
    engine.handleNoteOn(60);
    expect(audio.noteOn).toHaveBeenCalledTimes(1);

    engine.handleNoteOff(60);
    engine.handleNoteOn(60);
    expect(audio.noteOn).toHaveBeenCalledTimes(2);
  });

  it('does not re-attack held notes when advancing to the next step', () => {
    makeScript([
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [
          { pitch: 'C4', midi: 60, hand: 'R', finger: 1 },
          { pitch: 'E4', midi: 64, hand: 'R', finger: 3 },
        ],
      },
      {
        order: 1,
        onset: 1,
        measureNumber: 1,
        notes: [{ pitch: 'G4', midi: 67, hand: 'R', finger: 5 }],
      },
    ]);
    engine.start();

    engine.handleNoteOn(60);
    engine.handleNoteOn(64);
    expect(audio.noteOn).toHaveBeenCalledTimes(2);

    flushStepCompletion();
    expect(useEngineStore.getState().currentStepIndex).toBe(1);
    expect(audio.noteOn).toHaveBeenCalledTimes(2);
  });

  it('visits every right-hand step in script order while skipping LH-only steps', () => {
    makeScript([
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: 1 }],
      },
      {
        order: 1,
        onset: 480,
        measureNumber: 1,
        notes: [{ pitch: 'C3', midi: 48, hand: 'L', finger: 1 }],
      },
      {
        order: 2,
        onset: 960,
        measureNumber: 1,
        notes: [{ pitch: 'D4', midi: 62, hand: 'R', finger: 2 }],
      },
      {
        order: 3,
        onset: 1440,
        measureNumber: 1,
        notes: [{ pitch: 'E4', midi: 64, hand: 'R', finger: 3 }],
      },
    ]);
    engine.start();

    expect(useEngineStore.getState().currentStepIndex).toBe(0);

    engine.handleNoteOn(60);
    flushStepCompletion();
    expect(useEngineStore.getState().currentStepIndex).toBe(2);

    engine.handleNoteOn(62);
    flushStepCompletion();
    expect(useEngineStore.getState().currentStepIndex).toBe(3);

    engine.handleNoteOn(64);
    flushStepCompletion();
    expect(useEngineStore.getState().isPracticeActive).toBe(false);
  });

  it('does not advance repeated steps while the same key stays held', () => {
    makeScript([
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [{ pitch: 'E6', midi: 88, hand: 'R', finger: 3 }],
      },
      {
        order: 1,
        onset: 480,
        measureNumber: 1,
        notes: [{ pitch: 'E6', midi: 88, hand: 'R', finger: 3 }],
      },
      {
        order: 2,
        onset: 960,
        measureNumber: 1,
        notes: [{ pitch: 'E5', midi: 76, hand: 'R', finger: 3 }],
      },
    ]);
    engine.start();

    engine.handleNoteOn(88);
    flushStepCompletion();

    expect(useEngineStore.getState().currentStepIndex).toBe(1);
    expect(useEngineStore.getState().expectedMidiNotes).toEqual([88]);
  });

  it('marks every same-midi unison voice on one keypress', () => {
    makeScript([
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [
          { pitch: 'C4', midi: 60, hand: 'R', finger: 1 },
          { pitch: 'C4', midi: 60, hand: 'R', finger: 2 },
        ],
      },
      {
        order: 1,
        onset: 480,
        measureNumber: 1,
        notes: [{ pitch: 'D4', midi: 62, hand: 'R', finger: 2 }],
      },
    ]);
    engine.start();

    engine.handleNoteOn(60);
    flushStepCompletion();

    expect(useEngineStore.getState().currentStepIndex).toBe(1);
    expect(useEngineStore.getState().expectedMidiNotes).toEqual([62]);
  });

  it('skips to the nearest playable step when seeking onto an empty hand step', () => {
    makeScript([
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: 1 }],
      },
      {
        order: 1,
        onset: 480,
        measureNumber: 1,
        notes: [{ pitch: 'C3', midi: 48, hand: 'L', finger: 1 }],
      },
      {
        order: 2,
        onset: 960,
        measureNumber: 1,
        notes: [{ pitch: 'E4', midi: 64, hand: 'R', finger: 3 }],
      },
    ]);
    engine.start();

    engine.seekToStep(1);

    expect(useEngineStore.getState().currentStepIndex).toBe(2);
    expect(useEngineStore.getState().expectedMidiNotes).toEqual([64]);
  });
});
