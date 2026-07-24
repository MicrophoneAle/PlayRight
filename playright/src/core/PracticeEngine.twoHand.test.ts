import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngine } from './AudioEngine.ts';
import { PracticeEngine } from './PracticeEngine.ts';
import type { PlaybackScript } from '../types/index.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

function makeScript(steps: PlaybackScript): void {
  useEngineStore.getState().actions.loadScript(steps, '<score/>', 'test');
}

function resetStore(): void {
  useEngineStore.getState().actions.clearScript();
  useEngineStore.setState({
    engineMode: 'two-hand',
    isPracticeActive: false,
    hasPracticeStarted: false,
    currentStepIndex: 0,
    activeHand: 'R',
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

describe('PracticeEngine two-hand finger press', () => {
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

  it('unrequested finger produces no preview, hit, or advance', () => {
    makeScript([
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: 1 }],
      },
    ]);
    engine.start();

    engine.handleFingerPress({ hand: 'R', finger: 5 });

    expect(audio.noteOn).not.toHaveBeenCalled();
    expect(audio.noteOff).not.toHaveBeenCalled();
    expect(useEngineStore.getState().currentStepIndex).toBe(0);
  });

  it('expected note with practice inactive previews once without advancing when auto-start does not apply', () => {
    makeScript([
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: 1 }],
      },
    ]);
    useEngineStore.getState().actions.setEngineMode('one-hand');
    engine.loadCurrentStep({ alignScope: false });

    engine.handleFingerPress({ hand: 'R', finger: 1 });

    expect(audio.noteOn).toHaveBeenCalledTimes(1);
    expect(audio.noteOff).toHaveBeenCalledTimes(1);
    expect(useEngineStore.getState().currentStepIndex).toBe(0);
    expect(useEngineStore.getState().isPracticeActive).toBe(false);
  });

  it('auto-starts two-hand practice on the first correct finger when practice was inactive', () => {
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
    engine.loadCurrentStep({ alignScope: false });
    expect(useEngineStore.getState().isPracticeActive).toBe(false);

    engine.handleFingerPress({ hand: 'R', finger: 1 });
    flushAdvance();

    expect(useEngineStore.getState().isPracticeActive).toBe(true);
    expect(useEngineStore.getState().hasPracticeStarted).toBe(true);
    expect(useEngineStore.getState().currentStepIndex).toBe(1);
  });

  it('expected note with practice active sustains sound until finger release', () => {
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

    engine.handleFingerPress({ hand: 'R', finger: 1 });
    flushAdvance();

    expect(audio.noteOn).toHaveBeenCalledWith(60);
    expect(audio.noteOff).not.toHaveBeenCalled();
    expect(useEngineStore.getState().currentStepIndex).toBe(1);
    expect(useEngineStore.getState().playingPlaybackNotes).toEqual([
      { pressId: 0, stepIndex: 0, midi: 60, hand: 'R' },
    ]);
    expect(useEngineStore.getState().playingMidiNotes).toEqual([60]);

    engine.handleFingerRelease({ hand: 'R', finger: 1 });
    expect(audio.noteOff).toHaveBeenCalledWith(60);
    expect(useEngineStore.getState().playingPlaybackNotes).toEqual([]);
    expect(useEngineStore.getState().playingMidiNotes).toEqual([]);
  });

  it('ends practice on the final note release, not on press', () => {
    makeScript([
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: 1 }],
      },
    ]);
    engine.start();

    engine.handleFingerPress({ hand: 'R', finger: 1 });
    flushAdvance();

    expect(useEngineStore.getState().isPracticeActive).toBe(true);
    expect(audio.noteOff).not.toHaveBeenCalled();

    engine.handleFingerRelease({ hand: 'R', finger: 1 });
    expect(useEngineStore.getState().isPracticeActive).toBe(false);
    expect(audio.noteOff).toHaveBeenCalledWith(60);
  });

  it('does not advance after the first hand in a two-note step until the second hand is hit', () => {
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
      {
        order: 1,
        onset: 1,
        measureNumber: 1,
        notes: [{ pitch: 'D4', midi: 62, hand: 'R', finger: 2 }],
      },
    ]);
    engine.start();

    engine.handleFingerPress({ hand: 'L', finger: 1 });
    flushAdvance();
    expect(useEngineStore.getState().currentStepIndex).toBe(0);

    engine.handleFingerPress({ hand: 'R', finger: 1 });
    flushAdvance();
    expect(useEngineStore.getState().currentStepIndex).toBe(1);
  });

  it('requires each hand and finger for same-midi chord tones at one onset', () => {
    makeScript([
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [
          { pitch: 'C4', midi: 60, hand: 'L', finger: 5 },
          { pitch: 'C4', midi: 60, hand: 'R', finger: 1 },
        ],
      },
      {
        order: 1,
        onset: 1,
        measureNumber: 1,
        notes: [{ pitch: 'D4', midi: 62, hand: 'R', finger: 2 }],
      },
    ]);
    engine.start();

    engine.handleFingerPress({ hand: 'R', finger: 1 });
    flushAdvance();
    expect(useEngineStore.getState().currentStepIndex).toBe(0);

    engine.handleFingerPress({ hand: 'L', finger: 5 });
    flushAdvance();
    expect(useEngineStore.getState().currentStepIndex).toBe(1);
  });

  it('advances a chord when every assigned finger is pressed, ignoring null-finger overflow', () => {
    makeScript([
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [
          { pitch: 'G4', midi: 67, hand: 'R', finger: 1 },
          { pitch: 'B4', midi: 71, hand: 'R', finger: 3 },
          { pitch: 'D5', midi: 74, hand: 'R', finger: null },
        ],
      },
      {
        order: 1,
        onset: 1,
        measureNumber: 1,
        notes: [{ pitch: 'E4', midi: 64, hand: 'R', finger: 2 }],
      },
    ]);
    engine.start();

    engine.handleFingerPress({ hand: 'R', finger: 1 });
    engine.handleFingerPress({ hand: 'R', finger: 3 });
    flushAdvance();
    expect(useEngineStore.getState().currentStepIndex).toBe(1);
  });

  it('registers a chord pressed in one batch without spacing the notes out', () => {
    makeScript([
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [
          { pitch: 'C#3', midi: 49, hand: 'L', finger: 4 },
          { pitch: 'G#3', midi: 56, hand: 'L', finger: 2 },
          { pitch: 'C#4', midi: 61, hand: 'L', finger: 1 },
        ],
      },
      {
        order: 1,
        onset: 1,
        measureNumber: 1,
        notes: [{ pitch: 'E4', midi: 64, hand: 'R', finger: 2 }],
      },
    ]);
    engine.start();

    // All three chord fingers arrive back-to-back (no rAF flush between them).
    engine.handleFingerPress({ hand: 'L', finger: 4 });
    engine.handleFingerPress({ hand: 'L', finger: 2 });
    engine.handleFingerPress({ hand: 'L', finger: 1 });

    expect(useEngineStore.getState().currentStepIndex).toBe(1);
  });

  it('registers a chord pressed immediately after a single note (no frame to spare)', () => {
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
        notes: [
          { pitch: 'C#3', midi: 49, hand: 'L', finger: 4 },
          { pitch: 'G#3', midi: 56, hand: 'L', finger: 2 },
          { pitch: 'C#4', midi: 61, hand: 'L', finger: 1 },
        ],
      },
      {
        order: 2,
        onset: 2,
        measureNumber: 1,
        notes: [{ pitch: 'E4', midi: 64, hand: 'R', finger: 2 }],
      },
    ]);
    engine.start();

    // Single note, then the chord, all in one synchronous burst. The step must
    // advance before the chord keys are matched, or they would be dropped.
    engine.handleFingerPress({ hand: 'R', finger: 1 });
    engine.handleFingerPress({ hand: 'L', finger: 4 });
    engine.handleFingerPress({ hand: 'L', finger: 2 });
    engine.handleFingerPress({ hand: 'L', finger: 1 });

    expect(useEngineStore.getState().currentStepIndex).toBe(2);
  });

  it('does not double-count an already-hit finger', () => {
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

    engine.handleFingerPress({ hand: 'L', finger: 1 });
    engine.handleFingerPress({ hand: 'L', finger: 1 });
    flushAdvance();
    expect(useEngineStore.getState().currentStepIndex).toBe(0);

    engine.handleFingerPress({ hand: 'R', finger: 1 });
    flushAdvance();
    expect(useEngineStore.getState().currentStepIndex).toBe(0);
    expect(useEngineStore.getState().isPracticeActive).toBe(true);
    // L sounds twice (re-articulate on re-press) + R once. Hits still count once each.
    expect(audio.noteOn).toHaveBeenCalledTimes(3);

    engine.handleFingerRelease({ hand: 'L', finger: 1 });
    engine.handleFingerRelease({ hand: 'R', finger: 1 });
    expect(useEngineStore.getState().currentStepIndex).toBe(1);
    expect(useEngineStore.getState().isPracticeActive).toBe(false);
  });

  it('re-sounds an already-hit note after a wrong press without resetting completion', () => {
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
      {
        order: 1,
        onset: 480,
        measureNumber: 1,
        notes: [{ pitch: 'D4', midi: 62, hand: 'R', finger: 2 }],
      },
    ]);
    engine.start();

    engine.handleFingerPress({ hand: 'L', finger: 1 });
    engine.handleFingerRelease({ hand: 'L', finger: 1 });
    expect(audio.noteOn).toHaveBeenCalledTimes(1);

    // A wrong finger stays silent, with no advance and no completion reset.
    engine.handleFingerPress({ hand: 'R', finger: 5 });
    expect(audio.noteOn).toHaveBeenCalledTimes(1);
    expect(useEngineStore.getState().currentStepIndex).toBe(0);

    // Re-pressing the already-correct L1 must sound again while the step
    // stays incomplete.
    engine.handleFingerPress({ hand: 'L', finger: 1 });
    expect(audio.noteOn).toHaveBeenCalledTimes(2);
    expect(audio.noteOn).toHaveBeenLastCalledWith(48);
    expect(useEngineStore.getState().currentStepIndex).toBe(0);

    engine.handleFingerRelease({ hand: 'L', finger: 1 });
    engine.handleFingerPress({ hand: 'R', finger: 1 });
    // Both notes satisfied at least once → advance immediately (non-final step).
    expect(useEngineStore.getState().currentStepIndex).toBe(1);
    expect(audio.noteOn).toHaveBeenCalledWith(60);
  });

  it('re-articulates a matching grace finger while still on that grace position', () => {
    makeScript([
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: 1 }],
        graceBefore: [
          { midi: 69, pitch: 'A4', hand: 'R', kind: 'appoggiatura', finger: 3 },
        ],
      },
    ]);
    engine.start();
    expect(useEngineStore.getState().practiceGraceCursor).toBe(0);

    // The first press sounds, and a sticky second press (no release) must
    // re-articulate via sustainNote before the position advances on the
    // first hit.
    engine.handleFingerPress({ hand: 'R', finger: 3 });
    expect(audio.noteOn).toHaveBeenCalledWith(69);
    // Position advances synchronously once the single grace is satisfied.
    expect(useEngineStore.getState().practiceGraceCursor).toBeNull();

    // On the main position, hit one chord tone, make a wrong press, then
    // re-press. (A single-note grace advances immediately, so a same-position
    // grace re-press after success is not reachable. The main chord covers
    // the principle.)
    makeScript([
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [
          { pitch: 'C4', midi: 60, hand: 'R', finger: 1 },
          { pitch: 'E4', midi: 64, hand: 'R', finger: 3 },
        ],
        graceBefore: [
          { midi: 69, pitch: 'A4', hand: 'R', kind: 'appoggiatura', finger: 2 },
        ],
      },
    ]);
    engine.start();
    vi.mocked(audio.noteOn).mockClear();

    engine.handleFingerPress({ hand: 'R', finger: 2 });
    flushAdvance();
    expect(useEngineStore.getState().practiceGraceCursor).toBeNull();

    engine.handleFingerPress({ hand: 'R', finger: 1 });
    engine.handleFingerRelease({ hand: 'R', finger: 1 });
    engine.handleFingerPress({ hand: 'R', finger: 5 });
    const callsAfterWrong = vi.mocked(audio.noteOn).mock.calls.length;

    engine.handleFingerPress({ hand: 'R', finger: 1 });
    expect(vi.mocked(audio.noteOn).mock.calls.length).toBe(callsAfterWrong + 1);
    expect(useEngineStore.getState().currentStepIndex).toBe(0);

    engine.handleFingerPress({ hand: 'R', finger: 3 });
    flushAdvance();
    engine.handleFingerRelease({ hand: 'R', finger: 1 });
    engine.handleFingerRelease({ hand: 'R', finger: 3 });
    expect(useEngineStore.getState().currentStepIndex).toBe(1);
  });
});
