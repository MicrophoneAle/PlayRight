import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngine } from './AudioEngine.ts';
import { PracticeEngine } from './PracticeEngine.ts';
import { loadUnwelcomeSchoolScript } from './playbackScheduleSimulation.ts';
import type { PlaybackOrder, PlaybackScript } from '../types/index.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

/**
 * Q4 scope decision: practice mode ignores repeats. Run against the REAL
 * unwelcome-school fixture (625 document steps, 822-entry R0 playback order
 * across four repeat regions) rather than a synthetic stand-in: with the
 * real unrolled order sitting in the store, one-hand (R) practice-mode step
 * progression must stay strictly linear over the document-order script and
 * never touch currentPlaybackOrderIndex (play mode's alone — PracticeEngine
 * never reads playbackOrder or currentPlaybackOrderIndex by construction).
 */

let realScript: PlaybackScript;
let realPlaybackOrder: PlaybackOrder;

beforeAll(async () => {
  const result = await loadUnwelcomeSchoolScript();
  realScript = result.script;
  realPlaybackOrder = result.playbackOrder;
});

function createMockAudio(): AudioEngine {
  return {
    noteOn: vi.fn(),
    noteOff: vi.fn(),
    warm: vi.fn(),
    init: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
  } as unknown as AudioEngine;
}

describe('practice-mode step progression with a repeat-unrolled playback order — real fixture', () => {
  let engine: PracticeEngine;
  let rafCallback: FrameRequestCallback | null = null;

  beforeEach(() => {
    rafCallback = null;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallback = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    useEngineStore.getState().actions.clearScript();
    useEngineStore.setState({
      engineMode: 'one-hand',
      activeHand: 'R',
      isPracticeActive: false,
      hasPracticeStarted: false,
      currentStepIndex: 0,
      currentPlaybackOrderIndex: 0,
      scopeStartMidi: 60,
      expectedMidiNotes: [],
    });

    engine = new PracticeEngine();
    engine.attachAudioEngine(createMockAudio());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const flushAdvance = () => {
    rafCallback?.(0);
    rafCallback = null;
  };

  it('advances strictly forward through the real 625-step document script, never revisiting the four repeated sections', () => {
    useEngineStore
      .getState()
      .actions.loadScript(
        realScript,
        '<score/>',
        'test',
        undefined,
        undefined,
        realPlaybackOrder,
      );

    engine.start();

    const observedStepIndices: number[] = [];
    const maxIterations = realScript.length * 2;
    let iterations = 0;

    while (
      useEngineStore.getState().isPracticeActive &&
      iterations < maxIterations
    ) {
      const midis = useEngineStore.getState().expectedMidiNotes;
      if (midis.length === 0) {
        break;
      }

      // Press every expected R-hand pitch at once (handles real chords);
      // registerPracticeHit marks every matching-pitch index per press, so a
      // single pass over the distinct midis is sufficient even for doubled
      // voices at the same pitch.
      for (const midi of midis) {
        engine.handleNoteOn(midi);
      }
      for (const midi of midis) {
        engine.handleNoteOff(midi);
      }
      flushAdvance();

      observedStepIndices.push(useEngineStore.getState().currentStepIndex);
      // Practice must never touch play mode's playback-order position, at
      // every intermediate tick — not just checked once at the end.
      expect(useEngineStore.getState().currentPlaybackOrderIndex).toBe(0);

      iterations += 1;
    }

    // Reached the end of the piece via normal completion, not the safety cap.
    expect(iterations).toBeLessThan(maxIterations);
    expect(useEngineStore.getState().isPracticeActive).toBe(false);

    // Non-decreasing at every recorded press: 12 real steps carry a
    // graceBefore (appoggiatura/acciaccatura), and checkStepCompletion walks
    // grace sub-positions before advancing currentStepIndex - so consecutive
    // presses can legitimately repeat the same step index (grace, then main).
    // What must NEVER happen is a decrease.
    for (let i = 1; i < observedStepIndices.length; i += 1) {
      expect(observedStepIndices[i]).toBeGreaterThanOrEqual(
        observedStepIndices[i - 1],
      );
    }

    // The actual repeat-linearity invariant: once a document step is left, it
    // is never revisited - the strictly-increasing check applies to the set
    // of DISTINCT step indices in visitation order, across all four real
    // repeat boundaries (m16->m9, m25->m18, m36->m29, m61->m54).
    const distinctVisitedInOrder = observedStepIndices.filter(
      (stepIndex, i) => i === 0 || stepIndex !== observedStepIndices[i - 1],
    );
    for (let i = 1; i < distinctVisitedInOrder.length; i += 1) {
      expect(distinctVisitedInOrder[i]).toBeGreaterThan(
        distinctVisitedInOrder[i - 1],
      );
    }

    // The real fixture has R-hand notes on most but not necessarily every one
    // of the 625 steps (some steps may be L-hand only); confirm meaningful
    // coverage rather than a near-empty walk.
    expect(observedStepIndices.length).toBeGreaterThan(400);
  });
});
