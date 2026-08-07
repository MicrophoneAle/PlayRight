import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngine } from './AudioEngine.ts';
import { PracticeEngine } from './PracticeEngine.ts';
import { practiceAccuracyPercent, practiceRank } from './practiceScoring.ts';
import type { PlaybackScript } from '../types/index.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

function makeScript(steps: PlaybackScript): void {
  useEngineStore.getState().actions.loadScript(steps, '<score/>', 'test');
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

/** One three-note chord, then one single note. Seven notes are NOT required. */
const CHORD_SCRIPT: PlaybackScript = [
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
];

const state = () => useEngineStore.getState();

describe('PracticeEngine run summary (SC1)', () => {
  let engine: PracticeEngine;

  beforeEach(() => {
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

    engine = new PracticeEngine();
    engine.ensureStoreSubscription();
    engine.attachAudioEngine(createMockAudio());
  });

  it('counts notes, not positions, so a chord contributes its full denominator', () => {
    makeScript(CHORD_SCRIPT);
    engine.start();

    engine.handleFingerPress({ hand: 'R', finger: 1 });
    engine.handleFingerPress({ hand: 'R', finger: 3 });
    engine.handleFingerPress({ hand: 'R', finger: 5 });
    engine.handleFingerRelease({ hand: 'R', finger: 1 });
    engine.handleFingerRelease({ hand: 'R', finger: 3 });
    engine.handleFingerRelease({ hand: 'R', finger: 5 });

    // Three notes from ONE position, not one.
    expect(state().practiceCorrectNotes).toBe(3);

    engine.handleFingerPress({ hand: 'R', finger: 5 });
    engine.handleFingerRelease({ hand: 'R', finger: 5 });

    const summary = state().practiceSummary;
    expect(summary).not.toBeNull();
    expect(summary?.correctNotes).toBe(4);
    expect(summary?.completedPositions).toBe(2);
    expect(practiceAccuracyPercent(summary!.correctNotes, summary!.wrongNotes)).toBe(100);
    expect(practiceRank(summary!.correctNotes, summary!.wrongNotes)).toBe('SS');
  });

  it('produces a note-granular denominator when a chord is played with errors', () => {
    makeScript(CHORD_SCRIPT);
    engine.start();

    engine.handleFingerPress({ hand: 'R', finger: 1 });
    engine.handleFingerPress({ hand: 'R', finger: 2 });
    engine.handleFingerPress({ hand: 'R', finger: 3 });
    engine.handleFingerPress({ hand: 'R', finger: 5 });

    // 3 correct chord tones + 1 wrong = a denominator of 4, not 1 position.
    expect(state().practiceCorrectNotes).toBe(3);
    expect(state().practiceWrongNotes).toBe(1);
    expect(practiceAccuracyPercent(3, 1)).toBe(75);
    expect(practiceRank(3, 1)).toBe('C');
  });

  it('opens the modal on the final release, not on the final press', () => {
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
    expect(state().practiceSummary).toBeNull();
    expect(state().scoreSummaryOpen).toBe(false);
    expect(state().isPracticeActive).toBe(true);

    engine.handleFingerRelease({ hand: 'R', finger: 1 });
    expect(state().practiceSummary).not.toBeNull();
    expect(state().scoreSummaryOpen).toBe(true);
  });

  it('marks a navigated run so no rank is awarded', () => {
    makeScript(CHORD_SCRIPT);
    engine.start();

    engine.seekToStep(1);
    engine.handleFingerPress({ hand: 'R', finger: 5 });
    engine.handleFingerRelease({ hand: 'R', finger: 5 });

    const summary = state().practiceSummary;
    expect(summary?.navigated).toBe(true);
    // The counts and accuracy still stand; only the rank is withheld, which the
    // modal does by not calling practiceRank at all for a navigated run.
    expect(summary?.correctNotes).toBe(1);
    expect(practiceAccuracyPercent(summary!.correctNotes, summary!.wrongNotes)).toBe(100);
  });

  it('tracks the longest clean streak across wrong presses', () => {
    makeScript(CHORD_SCRIPT);
    engine.start();

    engine.handleFingerPress({ hand: 'R', finger: 1 });
    engine.handleFingerPress({ hand: 'R', finger: 3 });
    expect(state().practiceLongestStreak).toBe(2);

    engine.handleFingerPress({ hand: 'R', finger: 2 });
    expect(state().practiceCurrentStreak).toBe(0);
    expect(state().practiceLongestStreak).toBe(2);

    engine.handleFingerPress({ hand: 'R', finger: 5 });
    engine.handleFingerPress({ hand: 'R', finger: 5 });
    engine.handleFingerRelease({ hand: 'R', finger: 5 });

    // The run ends on a 2-note streak, so the earlier 2 still stands as best.
    expect(state().practiceSummary?.longestStreak).toBe(2);
  });

  it('resets live stats and closes the modal when a new run starts', () => {
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
    engine.handleFingerPress({ hand: 'R', finger: 1 });
    engine.handleFingerRelease({ hand: 'R', finger: 1 });
    expect(state().scoreSummaryOpen).toBe(true);
    expect(state().practiceWrongNotes).toBe(1);

    engine.restart();

    expect(state().scoreSummaryOpen).toBe(false);
    expect(state().practiceSummary).toBeNull();
    expect(state().practiceCorrectNotes).toBe(0);
    expect(state().practiceWrongNotes).toBe(0);
    expect(state().practiceLongestStreak).toBe(0);
    expect(practiceAccuracyPercent(0, 0)).toBeNull();
  });

  describe('scoring disabled', () => {
    afterEach(() => {
      useEngineStore.setState({ scoringEnabled: true });
    });

    it('counts nothing, sounds no clash, and opens no modal', () => {
      useEngineStore.setState({ scoringEnabled: false });
      makeScript(CHORD_SCRIPT);
      engine.start();

      // A wrong finger and every correct one: neither is counted.
      engine.handleFingerPress({ hand: 'R', finger: 2 });
      engine.handleFingerPress({ hand: 'R', finger: 1 });
      engine.handleFingerPress({ hand: 'R', finger: 3 });
      engine.handleFingerPress({ hand: 'R', finger: 5 });
      engine.handleFingerPress({ hand: 'R', finger: 5 });
      engine.handleFingerRelease({ hand: 'R', finger: 5 });

      expect(state().practiceCorrectNotes).toBe(0);
      expect(state().practiceWrongNotes).toBe(0);
      expect(state().practicePositionRecords).toHaveLength(0);
      expect(state().practiceSummary).toBeNull();
      expect(state().scoreSummaryOpen).toBe(false);
      // The run itself still progressed to the end.
      expect(state().currentStepIndex).toBe(CHORD_SCRIPT.length);
    });

    it('discards an in-progress session when scoring is turned off mid-run', () => {
      makeScript(CHORD_SCRIPT);
      engine.start();
      engine.handleFingerPress({ hand: 'R', finger: 1 });
      expect(state().practiceCorrectNotes).toBe(1);

      useEngineStore.setState({ scoringEnabled: false });
      engine.handleScoringEnabledChange(false);

      expect(state().practiceCorrectNotes).toBe(0);
      expect(state().practicePositionRecords).toHaveLength(0);
    });

    it('restarts unranked when scoring is turned back on mid-run', () => {
      makeScript(CHORD_SCRIPT);
      engine.start();
      engine.handleFingerPress({ hand: 'R', finger: 1 });

      useEngineStore.setState({ scoringEnabled: false });
      engine.handleScoringEnabledChange(false);
      useEngineStore.setState({ scoringEnabled: true });
      engine.handleScoringEnabledChange(true);

      // Fresh counters, and the partial run can never earn a rank.
      expect(state().practiceCorrectNotes).toBe(0);
      expect(state().practiceNavigated).toBe(true);

      engine.handleFingerPress({ hand: 'R', finger: 3 });
      engine.handleFingerPress({ hand: 'R', finger: 5 });
      engine.handleFingerPress({ hand: 'R', finger: 5 });
      engine.handleFingerRelease({ hand: 'R', finger: 5 });

      expect(state().practiceSummary?.navigated).toBe(true);
      expect(state().practiceSummary?.correctNotes).toBe(3);
    });
  });

  it('updates live accuracy on every press mid-session', () => {
    makeScript(CHORD_SCRIPT);
    engine.start();

    engine.handleFingerPress({ hand: 'R', finger: 1 });
    expect(practiceAccuracyPercent(state().practiceCorrectNotes, state().practiceWrongNotes))
      .toBe(100);

    engine.handleFingerPress({ hand: 'R', finger: 2 });
    expect(practiceAccuracyPercent(state().practiceCorrectNotes, state().practiceWrongNotes))
      .toBe(50);

    engine.handleFingerPress({ hand: 'R', finger: 3 });
    expect(practiceAccuracyPercent(state().practiceCorrectNotes, state().practiceWrongNotes))
      .toBe(66);
  });
});
