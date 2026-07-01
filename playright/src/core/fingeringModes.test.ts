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
import { practiceEngine } from './PracticeEngine.ts';
import { handleEditModeFingerPress } from './fingeringEditMode.ts';
import {
  applyManualHandOverrides,
  prepareScriptWithFingering,
} from './fingeringPredictor.ts';
import { parseMusicXmlToScript } from './parser/index.ts';
import { MINIMAL_MUSICXML } from './parser/__fixtures__/minimal.musicxml.ts';
import {
  isProgramStepComplete,
  programAssignmentKey,
  programTargetNote,
} from './practiceSteps.ts';
import { useEngineStore } from '../store/useEngineStore.ts';
import { fingeringKey, manualHandOverrideKey, type Finger } from '../types/index.ts';
import type { PlaybackScript } from '../types/index.ts';

const FINGERING_MODE_STORAGE_KEY = 'playright-fingering-mode';

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
    manualHandOverrides: {},
    selectedFingeringNote: null,
    programAssignedKeys: [],
    autoFingering: true,
    handSpan: 1,
  });
}

function loadMinimalFixture(): PlaybackScript {
  const { script, scoreTiming } = parseMusicXmlToScript(MINIMAL_MUSICXML);
  useEngineStore.getState().actions.loadScript(
    script,
    MINIMAL_MUSICXML,
    'minimal',
    { scoreId: 'minimal-fixture' },
    scoreTiming,
  );
  return script;
}

describe('program-mode chord targeting', () => {
  const chordStep: PlaybackScript[number] = {
    order: 0,
    onset: 480,
    measureNumber: 1,
    notes: [
      { pitch: 'E4', midi: 64, hand: 'R', finger: null },
      { pitch: 'G4', midi: 67, hand: 'R', finger: null },
    ],
  };

  it('binds the lowest unassigned pitch on the pressed hand', () => {
    const assigned = new Set<string>();

    expect(programTargetNote(chordStep, 'R', assigned)?.midi).toBe(64);

    assigned.add(programAssignmentKey('R', 64));
    expect(programTargetNote(chordStep, 'R', assigned)?.midi).toBe(67);

    assigned.add(programAssignmentKey('R', 67));
    expect(programTargetNote(chordStep, 'R', assigned)).toBeNull();
  });

  it('requires every note in the step before the step is complete', () => {
    const assigned = new Set<string>();
    expect(isProgramStepComplete(chordStep, assigned)).toBe(false);

    assigned.add(programAssignmentKey('R', 64));
    expect(isProgramStepComplete(chordStep, assigned)).toBe(false);

    assigned.add(programAssignmentKey('R', 67));
    expect(isProgramStepComplete(chordStep, assigned)).toBe(true);
  });
});

describe('FingeringProgramEngine', () => {
  let engine: FingeringProgramEngine;
  let audio: AudioEngine;

  beforeEach(() => {
    resetStore();
    engine = new FingeringProgramEngine();
    audio = createMockAudio();
    engine.attachAudioEngine(audio);
  });

  afterEach(() => {
    engine.stop();
    vi.unstubAllGlobals();
  });

  it('records RH finger on step note and advances like two-hand mode', () => {
    loadMinimalFixture();
    useEngineStore.setState({ fingeringMode: 'program' });
    engine.start();

    expect(useEngineStore.getState().currentStepIndex).toBe(0);

    engine.handleFingerPress({ hand: 'L', finger: 5 });
    engine.handleFingerPress({ hand: 'R', finger: 2 });

    const state = useEngineStore.getState();
    expect(state.manualFingerings[fingeringKey(0, 'L', 48)]).toBe(5);
    expect(state.manualFingerings[fingeringKey(0, 'R', 60)]).toBe(2);
    expect(state.currentStepIndex).toBe(1);
  });

  it('requires all chord notes before advancing and keeps each finger', () => {
    loadMinimalFixture();
    useEngineStore.setState({ fingeringMode: 'program', currentStepIndex: 1 });
    engine.start();
    useEngineStore.getState().actions.setStepIndex(1);

    engine.handleFingerPress({ hand: 'R', finger: 1 });
    expect(useEngineStore.getState().currentStepIndex).toBe(1);

    engine.handleFingerPress({ hand: 'R', finger: 2 });
    const state = useEngineStore.getState();
    expect(state.manualFingerings[fingeringKey(480, 'R', 64)]).toBe(1);
    expect(state.manualFingerings[fingeringKey(480, 'R', 67)]).toBe(2);
    expect(state.currentStepIndex).toBe(2);
  });

  it('advances when LH chord and RH single note each receive a finger press', () => {
    const lhChordRhSingle: PlaybackScript = [
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [
          { pitch: 'C#3', midi: 49, hand: 'L', finger: null },
          { pitch: 'G#3', midi: 56, hand: 'L', finger: null },
          { pitch: 'E5', midi: 76, hand: 'R', finger: null },
        ],
      },
      {
        order: 1,
        onset: 480,
        measureNumber: 1,
        notes: [{ pitch: 'D4', midi: 62, hand: 'R', finger: null }],
      },
    ];

    useEngineStore.setState({
      script: lhChordRhSingle,
      rawXml: null,
      totalSteps: lhChordRhSingle.length,
      fingeringMode: 'program',
      currentStepIndex: 0,
      manualFingerings: {},
    });
    engine.start();

    engine.handleFingerPress({ hand: 'L', finger: 5 });
    expect(useEngineStore.getState().currentStepIndex).toBe(0);

    engine.handleFingerPress({ hand: 'R', finger: 4 });
    expect(useEngineStore.getState().currentStepIndex).toBe(0);

    engine.handleFingerPress({ hand: 'L', finger: 4 });
    const state = useEngineStore.getState();
    expect(state.manualFingerings[fingeringKey(0, 'L', 49)]).toBe(5);
    expect(state.manualFingerings[fingeringKey(0, 'L', 56)]).toBe(4);
    expect(state.manualFingerings[fingeringKey(0, 'R', 76)]).toBe(4);
    expect(state.currentStepIndex).toBe(1);
  });

  it('survives script reprocess while programming a LH chord step', () => {
    const CHASE_XML = readFileSync(
      new URL('../assets/chase-setsuna-yuki.musicxml', import.meta.url),
      'utf8',
    );
    const { script, scoreTiming } = parseMusicXmlToScript(CHASE_XML);
    const stepIndex = 1;
    const step = script[stepIndex];
    const lhNotes = step.notes.filter((note) => note.hand === 'L');
    const rhNotes = step.notes.filter((note) => note.hand === 'R');

    expect(lhNotes.length).toBeGreaterThanOrEqual(2);
    expect(rhNotes.length).toBeGreaterThanOrEqual(1);

    useEngineStore.getState().actions.loadScript(
      script,
      CHASE_XML,
      'chase',
      { scoreId: 'chase-fixture' },
      scoreTiming,
    );
    useEngineStore.setState({ fingeringMode: 'program', currentStepIndex: stepIndex });
    engine.start();
    useEngineStore.getState().actions.setStepIndex(stepIndex);

    for (const note of lhNotes) {
      engine.handleFingerPress({ hand: 'L', finger: 5 });
      expect(
        useEngineStore.getState().manualFingerings[
          fingeringKey(step.onset, note.hand, note.midi)
        ],
      ).toBeDefined();
    }

    for (const note of rhNotes) {
      engine.handleFingerPress({ hand: 'R', finger: 1 });
      expect(
        useEngineStore.getState().manualFingerings[
          fingeringKey(step.onset, note.hand, note.midi)
        ],
      ).toBeDefined();
    }

    expect(useEngineStore.getState().currentStepIndex).toBe(stepIndex + 1);
  });

  it('uses suspend instead of stop when entering program mode', () => {
    const storage = new Map<string, string>();
    const localStorageMock = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
    };
    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubGlobal('window', { localStorage: localStorageMock });

    vi.mocked(practiceEngine.stop).mockClear();
    vi.mocked(practiceEngine.suspendForFingeringMode).mockClear();

    loadMinimalFixture();
    useEngineStore.setState({
      engineMode: 'two-hand',
      isPracticeActive: true,
      hasPracticeStarted: true,
      currentStepIndex: 0,
    });

    useEngineStore.getState().actions.setFingeringMode('program');

    expect(practiceEngine.suspendForFingeringMode).toHaveBeenCalled();
    expect(practiceEngine.stop).not.toHaveBeenCalled();

    engine.handleFingerPress({ hand: 'L', finger: 5 });
    engine.handleFingerPress({ hand: 'R', finger: 2 });
    expect(useEngineStore.getState().currentStepIndex).toBe(1);
  });

  it('does not reset step index when start runs after the user has advanced', () => {
    loadMinimalFixture();
    useEngineStore.setState({ fingeringMode: 'program', currentStepIndex: 0, engineMode: 'two-hand' });
    engine.ensureStoreSubscription();

    engine.handleFingerPress({ hand: 'L', finger: 5 });
    engine.handleFingerPress({ hand: 'R', finger: 2 });
    expect(useEngineStore.getState().currentStepIndex).toBe(1);

    engine.start();
    expect(useEngineStore.getState().currentStepIndex).toBe(1);
  });

  it('does not restart program when program mode is selected again', () => {
    const storage = new Map<string, string>();
    const localStorageMock = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
    };
    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubGlobal('window', { localStorage: localStorageMock });

    loadMinimalFixture();
    useEngineStore.setState({ fingeringMode: 'program', currentStepIndex: 2, engineMode: 'two-hand' });

    useEngineStore.getState().actions.setFingeringMode('program');

    expect(useEngineStore.getState().currentStepIndex).toBe(2);
  });

  it('leaves unprogrammed notes on predicted fingers without a completion gate', () => {
    loadMinimalFixture();
    useEngineStore.setState({ fingeringMode: 'program' });
    engine.start();

    engine.handleFingerPress({ hand: 'L', finger: 5 });
    engine.handleFingerPress({ hand: 'R', finger: 2 });

    const afterFirstStep = useEngineStore.getState();
    const unprogrammed = afterFirstStep.script?.[2].notes.find((note) => note.midi === 62);
    expect(afterFirstStep.manualFingerings[fingeringKey(960, 'R', 62)]).toBeUndefined();
    expect(unprogrammed?.finger).not.toBeNull();
    expect(unprogrammed?.fingerSource).not.toBe('manual');
  });
});

describe('edit mode and crossover', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('changes only the selected chord note when editing', () => {
    loadMinimalFixture();
    useEngineStore.setState({
      fingeringMode: 'edit',
      currentStepIndex: 1,
      selectedFingeringNote: {
        stepIndex: 1,
        onset: 480,
        hand: 'R',
        midi: 67,
      },
    });

    handleEditModeFingerPress({ hand: 'R', finger: 4 });

    const state = useEngineStore.getState();
    expect(state.manualFingerings[fingeringKey(480, 'R', 67)]).toBe(4);
    expect(state.manualFingerings[fingeringKey(480, 'R', 64)]).toBeUndefined();
    expect(
      state.script?.[1].notes.find((note) => note.midi === 67)?.fingerSource,
    ).toBe('manual');
  });

  it('crossover reassigns hand, moves manual key, and reflects in script', () => {
    loadMinimalFixture();
    useEngineStore.setState({
      fingeringMode: 'edit',
      selectedFingeringNote: {
        stepIndex: 0,
        onset: 0,
        hand: 'L',
        midi: 48,
      },
    });

    handleEditModeFingerPress({ hand: 'R', finger: 3 });

    const state = useEngineStore.getState();
    expect(state.manualFingerings[fingeringKey(0, 'L', 48)]).toBeUndefined();
    expect(state.manualFingerings[fingeringKey(0, 'R', 48)]).toBe(3);
    expect(state.manualHandOverrides[manualHandOverrideKey(0, 48)]).toBe('R');
    expect(state.selectedFingeringNote?.hand).toBe('R');

    const note = state.script?.[0].notes.find((entry) => entry.midi === 48);
    expect(note?.hand).toBe('R');
    expect(note?.finger).toBe(3);
    expect(note?.fingerSource).toBe('manual');
  });

  it('re-edit overwrites and clear reverts to predicted', () => {
    loadMinimalFixture();
    const { actions } = useEngineStore.getState();

    actions.setManualFinger(480, 'R', 64, 1);
    actions.setManualFinger(480, 'R', 64, 5);
    expect(useEngineStore.getState().manualFingerings[fingeringKey(480, 'R', 64)]).toBe(5);

    actions.clearManualFinger(480, 'R', 64);
    const cleared = useEngineStore.getState();
    expect(cleared.manualFingerings[fingeringKey(480, 'R', 64)]).toBeUndefined();
    const note = cleared.script?.[1].notes.find((entry) => entry.midi === 64);
    expect(note?.fingerSource).not.toBe('manual');
  });
});

describe('applyManualHandOverrides', () => {
  it('updates note hand before manual fingering is applied', () => {
    const script: PlaybackScript = [
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [{ pitch: 'C3', midi: 48, hand: 'L', finger: null }],
      },
    ];

    const withHands = applyManualHandOverrides(script, {
      [manualHandOverrideKey(0, 48)]: 'R',
    });
    const prepared = prepareScriptWithFingering(
      withHands,
      { [fingeringKey(0, 'R', 48)]: 2 as Finger },
      false,
      1,
    );

    const note = prepared[0].notes[0];
    expect(note.hand).toBe('R');
    expect(note.finger).toBe(2);
    expect(note.fingerSource).toBe('manual');
  });
});

describe('useEngineStore fingering mode', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    resetStore();
    storage.clear();
    const localStorageMock = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
    };
    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubGlobal('window', { localStorage: localStorageMock });
    loadMinimalFixture();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('entering program mode stops play and practice', async () => {
    useEngineStore.setState({
      playMode: false,
      isPracticeActive: true,
      hasPracticeStarted: true,
      isPlaybackActive: false,
    });

    useEngineStore.getState().actions.setFingeringMode('program');
    await vi.waitFor(() => {
      expect(useEngineStore.getState().isPracticeActive).toBe(true);
    });

    const state = useEngineStore.getState();
    expect(state.playMode).toBe(false);
    expect(state.fingeringMode).toBe('program');
    expect(state.engineMode).toBe('two-hand');
    expect(state.hasPracticeStarted).toBe(true);
    expect(storage.get(FINGERING_MODE_STORAGE_KEY)).toBe('program');
  });

  it('entering edit mode stops active practice and playback', () => {
    useEngineStore.setState({
      isPracticeActive: true,
      hasPracticeStarted: true,
      isPlaybackActive: true,
    });

    useEngineStore.getState().actions.setFingeringMode('edit');

    const state = useEngineStore.getState();
    expect(state.fingeringMode).toBe('edit');
    expect(state.isPracticeActive).toBe(false);
    expect(state.isPlaybackActive).toBe(false);
  });

  it('leaving program mode restores off and stops program session', async () => {
    useEngineStore.getState().actions.setEngineMode('one-hand');
    useEngineStore.getState().actions.setFingeringMode('program');
    await vi.waitFor(() => {
      expect(useEngineStore.getState().fingeringMode).toBe('program');
    });

    useEngineStore.getState().actions.setFingeringMode('off');

    const state = useEngineStore.getState();
    expect(state.fingeringMode).toBe('off');
    expect(state.engineMode).toBe('one-hand');
    expect(state.isPracticeActive).toBe(false);
  });

  it('exits program mode when switching to one-hand practice', () => {
    useEngineStore.getState().actions.setEngineMode('two-hand');
    useEngineStore.getState().actions.setFingeringMode('program');

    useEngineStore.getState().actions.setEngineMode('one-hand');

    const state = useEngineStore.getState();
    expect(state.engineMode).toBe('one-hand');
    expect(state.fingeringMode).toBe('off');
  });
});
