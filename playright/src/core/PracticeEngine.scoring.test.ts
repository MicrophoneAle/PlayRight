import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngine } from './AudioEngine.ts';
import { InputManager } from './InputManager.ts';
import { PracticeEngine } from './PracticeEngine.ts';
import { wrongNoteFeedbackMidi } from './practiceScoring.ts';
import type { PlaybackScript } from '../types/index.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

function makeScript(steps: PlaybackScript): void {
  useEngineStore.getState().actions.loadScript(steps, '<score/>', 'test');
}

function resetStore(mode: 'one-hand' | 'two-hand'): void {
  useEngineStore.getState().actions.clearScript();
  useEngineStore.getState().actions.resetPracticeScoring();
  useEngineStore.setState({
    engineMode: mode,
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
    warm: vi.fn().mockResolvedValue(undefined),
    init: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
  } as unknown as AudioEngine;
}

const records = () => useEngineStore.getState().practicePositionRecords;
const totals = () => ({
  correct: useEngineStore.getState().practiceCorrectNotes,
  wrong: useEngineStore.getState().practiceWrongNotes,
});

const TWO_STEP_SCRIPT: PlaybackScript = [
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
];

describe('PracticeEngine scoring - two-hand finger input', () => {
  let engine: PracticeEngine;
  let audio: AudioEngine;

  beforeEach(() => {
    resetStore('two-hand');
    engine = new PracticeEngine();
    engine.ensureStoreSubscription();
    audio = createMockAudio();
    engine.attachAudioEngine(audio);
  });

  it('records a wrong finger press and sounds an offset feedback pitch', () => {
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

    // R5 is two-or-more fingers above the required R1, so the feedback pitch
    // is a whole tone above C4 (R fingers ascend), attacked and released as a
    // short blip.
    expect(audio.noteOn).toHaveBeenCalledWith(62);
    expect(audio.noteOff).toHaveBeenCalledWith(62);
    expect(records()[0]).toEqual({ attempted: true, wrongAttempts: 1, correct: false });
    expect(totals()).toEqual({ correct: 0, wrong: 1 });
  });

  it('picks the feedback pitch deterministically by finger distance and hand direction', () => {
    const rightHandNotes = [{ pitch: 'C4', midi: 60, hand: 'R' as const, finger: 1 as const }];
    // Adjacent finger → one semitone, upward for the right hand.
    expect(wrongNoteFeedbackMidi({ hand: 'R', finger: 2 }, rightHandNotes)).toBe(61);
    // Two or more fingers away → a whole tone, still upward.
    expect(wrongNoteFeedbackMidi({ hand: 'R', finger: 4 }, rightHandNotes)).toBe(62);

    const leftHandNotes = [{ pitch: 'C3', midi: 48, hand: 'L' as const, finger: 1 as const }];
    // Left-hand finger numbers run DOWN the keyboard, so the offset inverts.
    expect(wrongNoteFeedbackMidi({ hand: 'L', finger: 2 }, leftHandNotes)).toBe(47);
    expect(wrongNoteFeedbackMidi({ hand: 'L', finger: 5 }, leftHandNotes)).toBe(46);

    // Repeated calls are stable (never random).
    expect(wrongNoteFeedbackMidi({ hand: 'R', finger: 4 }, rightHandNotes)).toBe(62);
  });

  it('treats a re-press of an already-hit note as neutral while still sounding it', () => {
    makeScript(TWO_STEP_SCRIPT);
    engine.start();

    engine.handleFingerPress({ hand: 'L', finger: 1 });
    engine.handleFingerRelease({ hand: 'L', finger: 1 });
    expect(totals()).toEqual({ correct: 1, wrong: 0 });

    vi.mocked(audio.noteOn).mockClear();
    engine.handleFingerPress({ hand: 'L', finger: 1 });

    expect(audio.noteOn).toHaveBeenCalledWith(48);
    expect(totals()).toEqual({ correct: 1, wrong: 0 });
    expect(records()[0].wrongAttempts).toBe(0);
    expect(useEngineStore.getState().currentStepIndex).toBe(0);
  });

  it('never advances a step on wrong input alone', () => {
    makeScript(TWO_STEP_SCRIPT);
    engine.start();

    engine.handleFingerPress({ hand: 'R', finger: 5 });
    engine.handleFingerPress({ hand: 'R', finger: 4 });
    engine.handleFingerPress({ hand: 'L', finger: 5 });

    expect(useEngineStore.getState().currentStepIndex).toBe(0);
    expect(records()[0]).toEqual({ attempted: true, wrongAttempts: 3, correct: false });
    expect(totals()).toEqual({ correct: 0, wrong: 3 });

    // Only the two REQUIRED notes advance the step.
    engine.handleFingerPress({ hand: 'L', finger: 1 });
    expect(useEngineStore.getState().currentStepIndex).toBe(0);
    engine.handleFingerPress({ hand: 'R', finger: 1 });
    expect(useEngineStore.getState().currentStepIndex).toBe(1);
    expect(records()[0].correct).toBe(true);
  });

  it('completes a partial chord with its wrong attempt retained', () => {
    makeScript([
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [
          { pitch: 'C4', midi: 60, hand: 'R', finger: 1 },
          { pitch: 'E4', midi: 64, hand: 'R', finger: 3 },
          { pitch: 'G4', midi: 67, hand: 'R', finger: 5 },
        ],
      },
      {
        order: 1,
        onset: 480,
        measureNumber: 1,
        notes: [{ pitch: 'A4', midi: 69, hand: 'R', finger: 5 }],
      },
    ]);
    engine.start();

    engine.handleFingerPress({ hand: 'R', finger: 1 });
    engine.handleFingerPress({ hand: 'R', finger: 3 });
    engine.handleFingerPress({ hand: 'R', finger: 2 });
    expect(records()[0]).toEqual({ attempted: true, wrongAttempts: 1, correct: false });
    expect(useEngineStore.getState().currentStepIndex).toBe(0);

    engine.handleFingerPress({ hand: 'R', finger: 5 });
    expect(records()[0]).toEqual({ attempted: true, wrongAttempts: 1, correct: true });
    expect(useEngineStore.getState().currentStepIndex).toBe(1);
    expect(totals()).toEqual({ correct: 3, wrong: 1 });
  });

  it('records a wrong press against the grace position it happened on', () => {
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

    engine.handleFingerPress({ hand: 'R', finger: 5 });

    // Position 0 is the grace, position 1 the main note.
    expect(records()[0]).toEqual({ attempted: true, wrongAttempts: 1, correct: false });
    expect(records()[1]).toEqual({ attempted: false, wrongAttempts: 0, correct: false });

    engine.handleFingerPress({ hand: 'R', finger: 3 });
    expect(useEngineStore.getState().practiceGraceCursor).toBeNull();
    expect(records()[0].correct).toBe(true);

    // A wrong press now lands on the MAIN position, not the grace.
    engine.handleFingerPress({ hand: 'R', finger: 5 });
    expect(records()[0].wrongAttempts).toBe(1);
    expect(records()[1].wrongAttempts).toBe(1);
  });

  it('accumulates session totals across positions and finalizes only after the final release', () => {
    makeScript(TWO_STEP_SCRIPT);
    engine.start();

    engine.handleFingerPress({ hand: 'R', finger: 5 });
    engine.handleFingerPress({ hand: 'L', finger: 1 });
    engine.handleFingerPress({ hand: 'R', finger: 1 });
    engine.handleFingerRelease({ hand: 'L', finger: 1 });
    engine.handleFingerRelease({ hand: 'R', finger: 1 });
    expect(useEngineStore.getState().currentStepIndex).toBe(1);

    engine.handleFingerPress({ hand: 'R', finger: 3 });
    engine.handleFingerPress({ hand: 'R', finger: 2 });

    // Last note is hit but still held: the piece is not finished yet.
    expect(useEngineStore.getState().practiceSummary).toBeNull();
    expect(useEngineStore.getState().isPracticeActive).toBe(true);

    engine.handleFingerRelease({ hand: 'R', finger: 2 });

    expect(useEngineStore.getState().isPracticeActive).toBe(false);
    expect(useEngineStore.getState().practiceSummary).toEqual({
      correctNotes: 3,
      wrongNotes: 2,
      scoreablePositions: 2,
      completedPositions: 2,
      // L1 then R1 before the step-2 wrong press is the longest clean run.
      longestStreak: 2,
      navigated: false,
    });
  });

  it('resets records on restart and on a script change, but not on a seek', () => {
    makeScript(TWO_STEP_SCRIPT);
    engine.start();

    engine.handleFingerPress({ hand: 'R', finger: 5 });
    expect(totals()).toEqual({ correct: 0, wrong: 1 });

    // A seek preserves accumulated records and only flags navigation.
    engine.seekToStep(1);
    expect(records()[0].wrongAttempts).toBe(1);
    expect(totals()).toEqual({ correct: 0, wrong: 1 });
    expect(useEngineStore.getState().practiceNavigated).toBe(true);

    // Revisiting keeps the earlier wrong attempts and adds to them.
    engine.seekToStep(0);
    engine.handleFingerPress({ hand: 'R', finger: 5 });
    expect(records()[0].wrongAttempts).toBe(2);

    engine.restart();
    expect(totals()).toEqual({ correct: 0, wrong: 0 });
    expect(records()[0]).toEqual({ attempted: false, wrongAttempts: 0, correct: false });
    expect(useEngineStore.getState().practiceNavigated).toBe(false);

    engine.handleFingerPress({ hand: 'R', finger: 5 });
    expect(totals()).toEqual({ correct: 0, wrong: 1 });

    makeScript(TWO_STEP_SCRIPT);
    expect(records()).toEqual([]);
    expect(totals()).toEqual({ correct: 0, wrong: 0 });
  });

  it('opens a session on the auto-start path with no explicit start()', () => {
    makeScript(TWO_STEP_SCRIPT);
    engine.loadCurrentStep({ alignScope: false });
    expect(useEngineStore.getState().isPracticeActive).toBe(false);
    expect(records()).toEqual([]);

    engine.handleFingerPress({ hand: 'L', finger: 1 });

    expect(useEngineStore.getState().isPracticeActive).toBe(true);
    expect(records()).toHaveLength(2);
    expect(totals()).toEqual({ correct: 1, wrong: 0 });

    engine.handleFingerPress({ hand: 'R', finger: 5 });
    expect(totals()).toEqual({ correct: 1, wrong: 1 });
  });

  it('clears records when practice is suspended for fingering program mode', () => {
    makeScript(TWO_STEP_SCRIPT);
    engine.start();
    engine.handleFingerPress({ hand: 'R', finger: 5 });
    expect(totals()).toEqual({ correct: 0, wrong: 1 });

    engine.suspendForFingeringMode();

    expect(records()).toEqual([]);
    expect(totals()).toEqual({ correct: 0, wrong: 0 });
  });
});

describe('PracticeEngine scoring - unmapped keys are ignored', () => {
  let audio: AudioEngine;
  let engine: PracticeEngine;
  let inputManager: InputManager | null = null;
  let listeners: Map<string, Set<(event: unknown) => void>>;

  class MockKeyboardEvent {
    defaultPrevented = false;
    readonly type: 'keydown' | 'keyup';
    readonly key: string;
    readonly code: string;
    readonly repeat: boolean;

    constructor(type: 'keydown' | 'keyup', key: string, code: string, repeat = false) {
      this.type = type;
      this.key = key;
      this.code = code;
      this.repeat = repeat;
    }

    preventDefault(): void {
      this.defaultPrevented = true;
    }
  }

  beforeEach(() => {
    listeners = new Map();
    vi.stubGlobal('window', {
      addEventListener(type: string, listener: (event: unknown) => void): void {
        const bucket = listeners.get(type) ?? new Set<(event: unknown) => void>();
        bucket.add(listener);
        listeners.set(type, bucket);
      },
      removeEventListener(type: string, listener: (event: unknown) => void): void {
        listeners.get(type)?.delete(listener);
      },
      localStorage: { getItem: () => null, setItem: () => {} },
    });

    resetStore('two-hand');
    engine = new PracticeEngine();
    engine.ensureStoreSubscription();
    audio = createMockAudio();
    engine.attachAudioEngine(audio);
    inputManager = new InputManager(audio, () => 60, {
      onFingerPress: (mapping) => engine.handleFingerPress(mapping),
      onFingerRelease: (mapping) => engine.handleFingerRelease(mapping),
    });
  });

  afterEach(() => {
    inputManager?.destroy();
    inputManager = null;
    vi.unstubAllGlobals();
  });

  const press = (key: string, code: string) => {
    const event = new MockKeyboardEvent('keydown', key, code);
    for (const listener of listeners.get('keydown') ?? []) {
      listener(event);
    }
  };

  it('ignores space, enter, and arrow keys entirely - no record, no sound', () => {
    makeScript(TWO_STEP_SCRIPT);
    engine.start();
    vi.mocked(audio.noteOn).mockClear();

    press(' ', 'Space');
    press('Enter', 'Enter');
    press('ArrowRight', 'ArrowRight');
    press('ArrowLeft', 'ArrowLeft');
    press('ArrowUp', 'ArrowUp');

    expect(audio.noteOn).not.toHaveBeenCalled();
    expect(totals()).toEqual({ correct: 0, wrong: 0 });
    expect(records()[0]).toEqual({ attempted: false, wrongAttempts: 0, correct: false });

    // A mapped finger key on the same session still registers as wrong.
    press('[', 'BracketLeft');
    expect(totals()).toEqual({ correct: 0, wrong: 1 });
  });
});

describe('PracticeEngine scoring - one-hand MIDI input', () => {
  let engine: PracticeEngine;
  let audio: AudioEngine;

  beforeEach(() => {
    resetStore('one-hand');
    engine = new PracticeEngine();
    engine.ensureStoreSubscription();
    audio = createMockAudio();
    engine.attachAudioEngine(audio);
  });

  it('records unmatched, other-hand, and early presses as wrong, and re-presses as neutral', () => {
    // A right-hand chord, so the position stays open after the first correct
    // note and a re-press is still judged against the SAME position.
    makeScript([
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [
          { pitch: 'C3', midi: 48, hand: 'L', finger: 1 },
          { pitch: 'C4', midi: 60, hand: 'R', finger: 1 },
          { pitch: 'E4', midi: 64, hand: 'R', finger: 3 },
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

    // No note at this position with this pitch.
    engine.handleNoteOn(66);
    engine.handleNoteOff(66);
    expect(totals()).toEqual({ correct: 0, wrong: 1 });

    // The other hand's note (activeHand is R, so C3/L is not practiced here).
    engine.handleNoteOn(48);
    engine.handleNoteOff(48);
    expect(totals()).toEqual({ correct: 0, wrong: 2 });

    // Early: D4 belongs to the NEXT position.
    engine.handleNoteOn(62);
    engine.handleNoteOff(62);
    expect(totals()).toEqual({ correct: 0, wrong: 3 });
    expect(records()[0]).toEqual({ attempted: true, wrongAttempts: 3, correct: false });
    expect(useEngineStore.getState().currentStepIndex).toBe(0);

    // One correct chord tone: progress, but the position stays open.
    engine.handleNoteOn(60);
    expect(totals()).toEqual({ correct: 1, wrong: 3 });
    expect(records()[0].correct).toBe(false);

    // A re-press of that same note is neutral - neither progress nor an error.
    engine.handleNoteOn(60);
    expect(totals()).toEqual({ correct: 1, wrong: 3 });
    expect(records()[0].wrongAttempts).toBe(3);

    // The remaining chord tone completes the position.
    engine.handleNoteOn(64);
    expect(totals()).toEqual({ correct: 2, wrong: 3 });
    expect(records()[0].correct).toBe(true);
  });
});
