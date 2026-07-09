import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./PlaybackEngine.ts', () => ({
  playbackEngine: {
    stop: vi.fn(),
    setTempoFactor: vi.fn(),
  },
}));

vi.mock('./PracticeEngine.ts', () => ({
  practiceEngine: {
    stop: vi.fn(),
    suspendForFingeringMode: vi.fn(),
  },
}));

import type { AudioEngine } from './AudioEngine.ts';
import { FingeringProgramEngine } from './FingeringProgramEngine.ts';
import { parseMusicXmlToScript } from './parser/index.ts';
import { isProgramStepComplete, programActiveTarget, programCurrentTarget } from './practiceSteps.ts';
import { useEngineStore } from '../store/useEngineStore.ts';
import { fingeringKey, graceFingeringKey } from '../types/index.ts';
import type { Finger, Hand, ManualFingeringMap, PlaybackScript, StepOrder } from '../types/index.ts';

function createMockAudio(): AudioEngine {
  return {
    noteOn: vi.fn(),
    noteOff: vi.fn(),
    warm: vi.fn(),
    init: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
  } as unknown as AudioEngine;
}

function resetStore(): void {
  useEngineStore.getState().actions.clearScript();
  useEngineStore.setState({
    fingeringMode: 'off',
    engineMode: 'one-hand',
    playMode: false,
    isPracticeActive: false,
    hasPracticeStarted: false,
    isPlaybackActive: false,
    currentStepIndex: 0,
    manualFingerings: {},
    selectedFingeringNote: null,
    programAssignedKeys: [],
    programRefingerNoteIndex: null,
    autoFingering: true,
    handSpan: 1,
  });
}

async function loadRiverFlowsScript(): Promise<PlaybackScript> {
  const JSZip = (await import('jszip')).default;
  const buffer = readFileSync(new URL('../assets/river-flows-in-you.mxl', import.meta.url));
  const archive = await JSZip.loadAsync(buffer);
  const scoreXml = await archive.file('score.xml')?.async('string');
  if (!scoreXml) throw new Error('river-flows-in-you.mxl missing score.xml');
  return parseMusicXmlToScript(scoreXml).script;
}

describe('FingeringProgramEngine grace capture (Phase 3, P3-1)', () => {
  let engine: FingeringProgramEngine;
  let audio: AudioEngine;
  let riverFlows: PlaybackScript;

  beforeEach(async () => {
    resetStore();
    engine = new FingeringProgramEngine();
    audio = createMockAudio();
    engine.attachAudioEngine(audio);
    riverFlows = await loadRiverFlowsScript();
  });

  afterEach(() => {
    engine.stop();
    vi.unstubAllGlobals();
  });

  it('captures step 63s 2-grace run before its main notes, in graceIndex order', () => {
    const step63 = riverFlows[63];
    expect(step63.onset).toBe(256);
    expect(step63.graceBefore).toHaveLength(2);
    expect(step63.graceBefore?.[0]).toMatchObject({ midi: 69, hand: 'R' });
    expect(step63.graceBefore?.[1]).toMatchObject({ midi: 73, hand: 'R' });

    useEngineStore.setState({
      script: [step63],
      rawXml: null,
      totalSteps: 1,
      fingeringMode: 'program',
      currentStepIndex: 0,
      manualFingerings: {},
    });
    engine.start();

    // grace0: A4 (midi 69, R) must be the first capture target, not a main note.
    expect(programCurrentTarget(step63, useEngineStore.getState().manualFingerings)).toMatchObject(
      { kind: 'grace', graceIndex: 0 },
    );
    engine.handleFingerPress({ hand: 'R', finger: 1 });
    let manualFingerings = useEngineStore.getState().manualFingerings;
    expect(manualFingerings[graceFingeringKey(256, 'R', 69, 0)]).toBe(1);
    expect(isProgramStepComplete(step63, manualFingerings)).toBe(false);

    // grace1: C#5 (midi 73, R) captured next.
    engine.handleFingerPress({ hand: 'R', finger: 2 });
    manualFingerings = useEngineStore.getState().manualFingerings;
    expect(manualFingerings[graceFingeringKey(256, 'R', 73, 1)]).toBe(2);

    // Both graces done -> mains walk starts (ascending MIDI: F#3=54 L, then A5=81 R).
    engine.handleFingerPress({ hand: 'L', finger: 5 });
    engine.handleFingerPress({ hand: 'R', finger: 4 });

    const state = useEngineStore.getState();
    expect(state.manualFingerings[fingeringKey(256, 'L', 54)]).toBe(5);
    expect(state.manualFingerings[fingeringKey(256, 'R', 81)]).toBe(4);
    expect(isProgramStepComplete(state.script![0], state.manualFingerings)).toBe(true);
    // Single-step script: completing it stops practice rather than advancing further.
    expect(state.isPracticeActive).toBe(false);
  });

  it('captures step 84s grace/main collision (both midi 83, hand R) into distinct keys', () => {
    const step84 = riverFlows[84];
    expect(step84.onset).toBe(312);
    expect(step84.notes.find((n) => n.hand === 'R')?.midi).toBe(83);
    expect(step84.graceBefore?.[0]).toMatchObject({ midi: 83, hand: 'R' });
    expect(step84.graceBefore?.[1]).toMatchObject({ midi: 85, hand: 'R' });

    useEngineStore.setState({
      script: [step84],
      rawXml: null,
      totalSteps: 1,
      fingeringMode: 'program',
      currentStepIndex: 0,
      manualFingerings: {},
    });
    engine.start();

    engine.handleFingerPress({ hand: 'R', finger: 2 }); // grace0 (83, R)
    engine.handleFingerPress({ hand: 'R', finger: 3 }); // grace1 (85, R)
    engine.handleFingerPress({ hand: 'L', finger: 5 }); // main (64, L)
    engine.handleFingerPress({ hand: 'R', finger: 1 }); // main (83, R) -- shares midi+hand with grace0

    const { manualFingerings } = useEngineStore.getState();
    expect(manualFingerings[graceFingeringKey(312, 'R', 83, 0)]).toBe(2);
    expect(manualFingerings[graceFingeringKey(312, 'R', 85, 1)]).toBe(3);
    expect(manualFingerings[fingeringKey(312, 'L', 64)]).toBe(5);
    expect(manualFingerings[fingeringKey(312, 'R', 83)]).toBe(1);
    // The grace and its colliding main note landed on distinct keys with distinct values.
    expect(manualFingerings[graceFingeringKey(312, 'R', 83, 0)]).not.toBe(
      manualFingerings[fingeringKey(312, 'R', 83)],
    );
  });

  it('refinger pass on a complete step walks graces then mains, in the same order as capture', () => {
    const step63 = riverFlows[63];
    useEngineStore.setState({
      script: [step63],
      rawXml: null,
      totalSteps: 1,
      fingeringMode: 'program',
      currentStepIndex: 0,
      manualFingerings: {},
    });
    engine.start();

    // First pass: capture all four targets with an easily distinguishable finger set.
    engine.handleFingerPress({ hand: 'R', finger: 1 }); // grace0
    engine.handleFingerPress({ hand: 'R', finger: 2 }); // grace1
    engine.handleFingerPress({ hand: 'L', finger: 5 }); // main L
    engine.handleFingerPress({ hand: 'R', finger: 4 }); // main R
    expect(useEngineStore.getState().isPracticeActive).toBe(false);

    // Jump back onto the now-complete step to start a refinger pass.
    engine.seekToStep(0);
    expect(useEngineStore.getState().programRefingerNoteIndex).toBe(0);

    engine.handleFingerPress({ hand: 'R', finger: 3 }); // overwrite grace0
    let manualFingerings = useEngineStore.getState().manualFingerings;
    expect(manualFingerings[graceFingeringKey(256, 'R', 69, 0)]).toBe(3);

    engine.handleFingerPress({ hand: 'L', finger: 1 }); // overwrite grace1 (cross-hand capture)
    manualFingerings = useEngineStore.getState().manualFingerings;
    expect(manualFingerings[graceFingeringKey(256, 'R', 73, 1)]).toEqual({
      finger: 1,
      physicalHand: 'L',
    });

    engine.handleFingerPress({ hand: 'L', finger: 2 }); // overwrite main L
    engine.handleFingerPress({ hand: 'R', finger: 5 }); // overwrite main R, completes the pass

    manualFingerings = useEngineStore.getState().manualFingerings;
    expect(manualFingerings[fingeringKey(256, 'L', 54)]).toBe(2);
    expect(manualFingerings[fingeringKey(256, 'R', 81)]).toBe(5);
    expect(useEngineStore.getState().programRefingerNoteIndex).toBeNull();
  });

  it('the displayed hint (programActiveTarget, P3-2) matches the actual next capture target through a graced refinger pass', () => {
    const step63 = riverFlows[63];
    useEngineStore.setState({
      script: [step63],
      rawXml: null,
      totalSteps: 1,
      fingeringMode: 'program',
      currentStepIndex: 0,
      manualFingerings: {},
    });
    engine.start();

    const assertHintMatchesNextBinding = (mapping: { hand: Hand; finger: Finger }) => {
      const before = useEngineStore.getState();
      const hint = programActiveTarget(
        before.script![0],
        before.manualFingerings,
        before.programRefingerNoteIndex,
      );
      expect(hint).not.toBeNull();

      engine.handleFingerPress(mapping);

      const after = useEngineStore.getState();
      const key =
        hint!.kind === 'grace'
          ? graceFingeringKey(step63.onset, hint!.note.hand, hint!.note.midi, hint!.graceIndex)
          : fingeringKey(step63.onset, hint!.note.hand, hint!.note.midi);
      const expectedValue =
        mapping.hand === hint!.note.hand
          ? mapping.finger
          : { finger: mapping.finger, physicalHand: mapping.hand };
      // The hint computed BEFORE the press exactly identifies what the press
      // just bound - proves the UI's "Next:" display can't drift from what
      // handleFingerPress actually does, on both the normal capture walk...
      expect(after.manualFingerings[key]).toEqual(expectedValue);
    };

    assertHintMatchesNextBinding({ hand: 'R', finger: 1 }); // grace0
    assertHintMatchesNextBinding({ hand: 'R', finger: 2 }); // grace1
    assertHintMatchesNextBinding({ hand: 'L', finger: 5 }); // main L
    assertHintMatchesNextBinding({ hand: 'R', finger: 4 }); // main R
    expect(useEngineStore.getState().isPracticeActive).toBe(false);

    // ...and the refinger pass, including a mid-pass cross-hand grace capture.
    engine.seekToStep(0);
    assertHintMatchesNextBinding({ hand: 'R', finger: 3 });
    assertHintMatchesNextBinding({ hand: 'L', finger: 1 });
    assertHintMatchesNextBinding({ hand: 'L', finger: 2 });
    assertHintMatchesNextBinding({ hand: 'R', finger: 5 });
    expect(useEngineStore.getState().programRefingerNoteIndex).toBeNull();
  });

  describe('skip-forward stays on a step that is only partially complete (Phase 3)', () => {
    it('grace assigned, main not -> skip-forward does not advance past the step', () => {
      const step63 = riverFlows[63];
      const manualFingerings: ManualFingeringMap = {};
      manualFingerings[graceFingeringKey(256, 'R', 69, 0)] = 1;
      manualFingerings[graceFingeringKey(256, 'R', 73, 1)] = 2;
      expect(isProgramStepComplete(step63, manualFingerings)).toBe(false);

      const dummyIncompleteStep: StepOrder = {
        order: 1,
        onset: 1000,
        measureNumber: 99,
        notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: null }],
      };

      useEngineStore.setState({
        script: [step63, dummyIncompleteStep],
        rawXml: null,
        totalSteps: 2,
        fingeringMode: 'program',
        currentStepIndex: 0,
        manualFingerings,
      });
      engine.start();

      expect(useEngineStore.getState().currentStepIndex).toBe(0);
    });

    it('main assigned, grace not -> skip-forward does not advance past the step', () => {
      const step63 = riverFlows[63];
      const manualFingerings: ManualFingeringMap = {};
      manualFingerings[fingeringKey(256, 'L', 54)] = 5;
      manualFingerings[fingeringKey(256, 'R', 81)] = 4;
      expect(isProgramStepComplete(step63, manualFingerings)).toBe(false);

      const dummyIncompleteStep: StepOrder = {
        order: 1,
        onset: 1000,
        measureNumber: 99,
        notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: null }],
      };

      useEngineStore.setState({
        script: [step63, dummyIncompleteStep],
        rawXml: null,
        totalSteps: 2,
        fingeringMode: 'program',
        currentStepIndex: 0,
        manualFingerings,
      });
      engine.start();

      expect(useEngineStore.getState().currentStepIndex).toBe(0);
    });
  });
});
