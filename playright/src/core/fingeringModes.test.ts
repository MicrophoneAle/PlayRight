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
import {
  prepareScriptWithFingering,
} from './fingeringPredictor.ts';
import { parseMusicXmlToScript } from './parser/index.ts';
import { MINIMAL_MUSICXML } from './parser/__fixtures__/minimal.musicxml.ts';
import {
  getDisplayNotesForStep,
  getExpectedNoteForFinger,
  isProgramStepComplete,
  programAssignmentProgress,
  programCurrentNote,
  programStepExpectedMidis,
  programStepNotesAscendingMidi,
  programTargetNote,
} from './practiceSteps.ts';
import { useEngineStore } from '../store/useEngineStore.ts';
import {
  fingeringKey,
  type Finger,
  type ManualFingeringMap,
} from '../types/index.ts';
import type { PlaybackScript } from '../types/index.ts';
import * as scoreLibrary from './scoreLibrary.ts';

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
    selectedFingeringNote: null,
    programAssignedKeys: [],
    programRefingerNoteIndex: null,
    autoFingering: true,
    handSpan: 1,
  });
}

async function loadMinimalFixture(): Promise<PlaybackScript> {
  const { script, scoreTiming } = parseMusicXmlToScript(MINIMAL_MUSICXML);
  const state = useEngineStore.getState();
  const prepared = await prepareScriptWithFingering(
    script,
    {},
    state.autoFingering,
    state.handSpan,
    state.overrideScoreFingerings,
  );
  useEngineStore.getState().actions.loadScript(
    prepared,
    MINIMAL_MUSICXML,
    'minimal',
    { scoreId: 'minimal-fixture' },
    scoreTiming,
  );
  return prepared;
}

describe('program-mode chord targeting', async () => {
  const chordStep: PlaybackScript[number] = {
    order: 0,
    onset: 480,
    measureNumber: 1,
    notes: [
      { pitch: 'E4', midi: 64, hand: 'R', finger: null },
      { pitch: 'G4', midi: 67, hand: 'R', finger: null },
    ],
  };

  it('binds the lowest unassigned pitch on the pressed hand', async () => {
    const assigned = new Set<string>();

    expect(programTargetNote(chordStep, 'R', assigned)?.midi).toBe(64);

    assigned.add(fingeringKey(480, 'R', 64));
    expect(programTargetNote(chordStep, 'R', assigned)?.midi).toBe(67);

    assigned.add(fingeringKey(480, 'R', 67));
    expect(programTargetNote(chordStep, 'R', assigned)).toBeNull();
  });

  it('requires every note in the step before the step is complete', async () => {
    const manualFingerings: ManualFingeringMap = {};
    expect(isProgramStepComplete(chordStep, manualFingerings)).toBe(false);

    manualFingerings[fingeringKey(480, 'R', 64)] = 1;
    expect(isProgramStepComplete(chordStep, manualFingerings)).toBe(false);

    manualFingerings[fingeringKey(480, 'R', 67)] = 2;
    expect(isProgramStepComplete(chordStep, manualFingerings)).toBe(true);
  });

  it('selects the next unassigned note in ascending MIDI order', async () => {
    const step: PlaybackScript[number] = {
      order: 0,
      onset: 0,
      measureNumber: 1,
      notes: [
        { pitch: 'C4', midi: 60, hand: 'R', finger: null },
        { pitch: 'C3', midi: 48, hand: 'L', finger: null },
        { pitch: 'E4', midi: 64, hand: 'R', finger: null },
      ],
    };
    const manualFingerings: ManualFingeringMap = {};

    expect(programCurrentNote(step, manualFingerings)?.midi).toBe(48);
    manualFingerings[fingeringKey(0, 'L', 48)] = 5;
    expect(programCurrentNote(step, manualFingerings)?.midi).toBe(60);
    manualFingerings[fingeringKey(0, 'R', 60)] = 2;
    expect(programCurrentNote(step, manualFingerings)?.midi).toBe(64);
  });

  it('reports per-hand assignment progress by physical playing hand', async () => {
    const lhChordRhSingle: PlaybackScript[number] = {
      order: 0,
      onset: 0,
      measureNumber: 1,
      notes: [
        { pitch: 'C#3', midi: 49, hand: 'L', finger: null },
        { pitch: 'G#3', midi: 56, hand: 'L', finger: null },
        { pitch: 'E5', midi: 76, hand: 'R', finger: null },
      ],
    };
    const manualFingerings: ManualFingeringMap = {
      [fingeringKey(0, 'R', 76)]: 4 as Finger,
    };

    expect(programAssignmentProgress(lhChordRhSingle, manualFingerings)).toEqual({
      needed: { L: 2, R: 1 },
      assignedCounts: { L: 0, R: 1 },
    });

    manualFingerings[fingeringKey(0, 'L', 49)] = { finger: 2, physicalHand: 'R' as const };
    expect(programAssignmentProgress(lhChordRhSingle, manualFingerings)).toEqual({
      needed: { L: 1, R: 2 },
      assignedCounts: { L: 0, R: 2 },
    });
  });

  it('matches practice finger presses by playingHand', async () => {
    const step: PlaybackScript[number] = {
      order: 0,
      onset: 0,
      measureNumber: 1,
      notes: [
        {
          pitch: 'C3',
          midi: 48,
          hand: 'L',
          finger: 2,
          playingHand: 'R',
          fingerSource: 'manual',
        },
      ],
    };

    expect(getExpectedNoteForFinger(step, 'R', 2)).toMatchObject({ midi: 48 });
    expect(getExpectedNoteForFinger(step, 'L', 2)).toBeNull();
  });
});

describe('FingeringProgramEngine', async () => {
  let engine: FingeringProgramEngine;
  let audio: AudioEngine;

  beforeEach(async () => {
    resetStore();
    engine = new FingeringProgramEngine();
    audio = createMockAudio();
    engine.attachAudioEngine(audio);
  });

  afterEach(() => {
    engine.stop();
    vi.unstubAllGlobals();
  });

  it('records RH finger on step note and advances like two-hand mode', async () => {
    await loadMinimalFixture();
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

  it('records RH crossover on bass note and counts physical RH in progress', async () => {
    const lhBassRhTreble: PlaybackScript = [
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [
          { pitch: 'C3', midi: 48, hand: 'L', finger: null },
          { pitch: 'C4', midi: 60, hand: 'R', finger: null },
        ],
      },
    ];

    useEngineStore.setState({
      script: lhBassRhTreble,
      rawXml: null,
      totalSteps: 1,
      fingeringMode: 'program',
      currentStepIndex: 0,
      manualFingerings: {},
    });
    engine.start();

    engine.handleFingerPress({ hand: 'R', finger: 2 });

    const state = useEngineStore.getState();
    expect(state.manualFingerings[fingeringKey(0, 'L', 48)]).toEqual({
      finger: 2,
      physicalHand: 'R',
    });
    expect(
      programAssignmentProgress(lhBassRhTreble[0], state.manualFingerings),
    ).toEqual({
      needed: { L: 0, R: 2 },
      assignedCounts: { L: 0, R: 1 },
    });
  });

  it('persists crossover assignment shape to the score library', async () => {
    const persistSpy = vi
      .spyOn(scoreLibrary, 'updateScoreManualFingerings')
      .mockResolvedValue({ ok: true });

    const lhBassRhTreble: PlaybackScript = [
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [{ pitch: 'C3', midi: 48, hand: 'L', finger: null }],
      },
    ];

    useEngineStore.setState({
      script: lhBassRhTreble,
      rawXml: null,
      totalSteps: 1,
      fingeringMode: 'program',
      currentStepIndex: 0,
      scoreId: 'crossover-score',
      manualFingerings: {},
    });
    engine.start();

    engine.handleFingerPress({ hand: 'R', finger: 2 }, 'clerk-user-abc');

    await vi.waitFor(() => {
      expect(persistSpy).toHaveBeenCalledWith(
        'crossover-score',
        'clerk-user-abc',
        expect.objectContaining({
          [fingeringKey(0, 'L', 48)]: { finger: 2, physicalHand: 'R' },
        }),
      );
    });

    persistSpy.mockRestore();
  });

  it('recalls crossover from persisted manual fingerings into playingHand', async () => {
    const lhBassRhTreble: PlaybackScript = [
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [{ pitch: 'C3', midi: 48, hand: 'L', finger: null }],
      },
    ];
    const manualFingerings: ManualFingeringMap = {
      [fingeringKey(0, 'L', 48)]: { finger: 2 as Finger, physicalHand: 'R' as const },
    };

    const prepared = await prepareScriptWithFingering(
      lhBassRhTreble,
      manualFingerings,
      false,
      1,
    );

    expect(prepared[0].notes[0]).toMatchObject({
      hand: 'L',
      finger: 2,
      playingHand: 'R',
    });
    expect(getExpectedNoteForFinger(prepared[0], 'R', 2)?.midi).toBe(48);
  });

  it('persists program fingerings to the score library when userId is provided', async () => {
    const persistSpy = vi
      .spyOn(scoreLibrary, 'updateScoreManualFingerings')
      .mockResolvedValue({ ok: true });

    await loadMinimalFixture();
    useEngineStore.setState({
      fingeringMode: 'program',
      scoreId: 'saved-score-id',
    });
    engine.start();

    engine.handleFingerPress({ hand: 'L', finger: 5 }, 'clerk-user-abc');

    await vi.waitFor(() => {
      expect(persistSpy).toHaveBeenCalledWith(
        'saved-score-id',
        'clerk-user-abc',
        expect.objectContaining({
          [fingeringKey(0, 'L', 48)]: 5,
        }),
      );
    });

    persistSpy.mockRestore();
  });

  it('does not call score library persist without userId', async () => {
    const persistSpy = vi
      .spyOn(scoreLibrary, 'updateScoreManualFingerings')
      .mockResolvedValue({ ok: true });

    await loadMinimalFixture();
    useEngineStore.setState({
      fingeringMode: 'program',
      scoreId: 'saved-score-id',
    });
    engine.start();

    engine.handleFingerPress({ hand: 'R', finger: 2 });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(persistSpy).not.toHaveBeenCalled();

    persistSpy.mockRestore();
  });

  it('requires all chord notes before advancing and keeps each finger', async () => {
    await loadMinimalFixture();
    useEngineStore.setState({ fingeringMode: 'program', currentStepIndex: 1 });
    engine.start();

    engine.handleFingerPress({ hand: 'R', finger: 1 });
    expect(useEngineStore.getState().currentStepIndex).toBe(1);

    engine.handleFingerPress({ hand: 'R', finger: 2 });
    const state = useEngineStore.getState();
    expect(state.manualFingerings[fingeringKey(480, 'R', 64)]).toBe(1);
    expect(state.manualFingerings[fingeringKey(480, 'R', 67)]).toBe(2);
    expect(state.currentStepIndex).toBe(2);
  });

  it('advances when LH chord and RH single note each receive a finger press', async () => {
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

    engine.handleFingerPress({ hand: 'L', finger: 4 });
    expect(useEngineStore.getState().currentStepIndex).toBe(0);

    engine.handleFingerPress({ hand: 'R', finger: 4 });
    const state = useEngineStore.getState();
    expect(state.manualFingerings[fingeringKey(0, 'L', 49)]).toBe(5);
    expect(state.manualFingerings[fingeringKey(0, 'L', 56)]).toBe(4);
    expect(state.manualFingerings[fingeringKey(0, 'R', 76)]).toBe(4);
    expect(state.currentStepIndex).toBe(1);
  });

  it('survives script reprocess while programming a LH chord step', async () => {
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

    for (const note of programStepNotesAscendingMidi(step)) {
      engine.handleFingerPress({ hand: note.hand, finger: note.hand === 'L' ? 5 : 1 });
      expect(
        useEngineStore.getState().manualFingerings[
          fingeringKey(step.onset, note.hand, note.midi)
        ],
      ).toBeDefined();
    }

    expect(useEngineStore.getState().currentStepIndex).toBe(stepIndex + 1);
  });

  it('uses suspend instead of stop when entering program mode', async () => {
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

    await loadMinimalFixture();
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

  it('does not reset step index when start runs after the user has advanced', async () => {
    await loadMinimalFixture();
    useEngineStore.setState({ fingeringMode: 'program', currentStepIndex: 0, engineMode: 'two-hand' });
    engine.ensureStoreSubscription();

    engine.handleFingerPress({ hand: 'L', finger: 5 });
    engine.handleFingerPress({ hand: 'R', finger: 2 });
    expect(useEngineStore.getState().currentStepIndex).toBe(1);

    engine.start();
    expect(useEngineStore.getState().currentStepIndex).toBe(1);
  });

  it('does not restart program when program mode is selected again', async () => {
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

    await loadMinimalFixture();
    useEngineStore.setState({ fingeringMode: 'program', currentStepIndex: 2, engineMode: 'two-hand' });

    useEngineStore.getState().actions.setFingeringMode('program');

    expect(useEngineStore.getState().currentStepIndex).toBe(2);
  });

  it('advances chase step 2 (1 RH + 2 LH) only after all three presses', async () => {
    const CHASE_XML = readFileSync(
      new URL('../assets/chase-setsuna-yuki.musicxml', import.meta.url),
      'utf8',
    );
    const { script, scoreTiming } = parseMusicXmlToScript(CHASE_XML);
    const stepIndex = 1;
    const scoreTimingBefore = scoreTiming;

    useEngineStore.getState().actions.loadScript(
      script,
      CHASE_XML,
      'chase',
      { scoreId: 'chase-fixture' },
      scoreTiming,
    );
    useEngineStore.setState({ fingeringMode: 'program', currentStepIndex: stepIndex, engineMode: 'two-hand' });
    engine.start();

    const assigned = () =>
      programAssignmentProgress(
        useEngineStore.getState().script![stepIndex],
        useEngineStore.getState().manualFingerings,
      );

    engine.handleFingerPress({ hand: 'R', finger: 1 });
    expect(useEngineStore.getState().currentStepIndex).toBe(stepIndex);
    expect(assigned()).toEqual({
      needed: { L: 1, R: 2 },
      assignedCounts: { L: 0, R: 1 },
    });
    expect(useEngineStore.getState().scoreTiming).toBe(scoreTimingBefore);

    engine.handleFingerPress({ hand: 'L', finger: 1 });
    expect(useEngineStore.getState().currentStepIndex).toBe(stepIndex);
    expect(assigned()).toEqual({
      needed: { L: 1, R: 2 },
      assignedCounts: { L: 1, R: 1 },
    });

    engine.handleFingerPress({ hand: 'L', finger: 2 });
    expect(useEngineStore.getState().currentStepIndex).toBe(stepIndex + 1);
  });

  it('advances forward after sheet jump to a mid-piece step', async () => {
    const CHASE_XML = readFileSync(
      new URL('../assets/chase-setsuna-yuki.musicxml', import.meta.url),
      'utf8',
    );
    const { script, scoreTiming } = parseMusicXmlToScript(CHASE_XML);
    const jumpIndex = 5;

    useEngineStore.getState().actions.loadScript(
      script,
      CHASE_XML,
      'chase',
      { scoreId: 'chase-fixture' },
      scoreTiming,
    );
    useEngineStore.setState({ fingeringMode: 'program', engineMode: 'two-hand' });
    engine.start();
    engine.seekToStep(jumpIndex);

    expect(useEngineStore.getState().currentStepIndex).toBe(jumpIndex);
    expect(useEngineStore.getState().programRefingerNoteIndex).toBe(0);

    const stepBefore = useEngineStore.getState().script![jumpIndex];
    const ascending = programStepNotesAscendingMidi(stepBefore);

    for (let finger = 1; finger <= ascending.length; finger += 1) {
      const note = ascending[finger - 1];
      engine.handleFingerPress({ hand: note.hand, finger: finger as Finger });
    }

    expect(useEngineStore.getState().currentStepIndex).toBe(jumpIndex + 1);
    expect(useEngineStore.getState().programRefingerNoteIndex).toBeNull();
  });

  it('preserves step index until every note in the step is assigned', async () => {
    const CHASE_XML = readFileSync(
      new URL('../assets/chase-setsuna-yuki.musicxml', import.meta.url),
      'utf8',
    );
    const { script, scoreTiming } = parseMusicXmlToScript(CHASE_XML);
    const stepIndex = 1;

    useEngineStore.getState().actions.loadScript(
      script,
      CHASE_XML,
      'chase',
      { scoreId: 'chase-fixture' },
      scoreTiming,
    );
    useEngineStore.setState({ fingeringMode: 'program', currentStepIndex: stepIndex, engineMode: 'two-hand' });
    engine.start();

    engine.handleFingerPress({ hand: 'R', finger: 1 });

    expect(useEngineStore.getState().currentStepIndex).toBe(stepIndex);
  });

  it('blocks external step seeks while in program mode', async () => {
    await loadMinimalFixture();
    useEngineStore.setState({ fingeringMode: 'program', currentStepIndex: 2, engineMode: 'two-hand' });

    useEngineStore.getState().actions.setStepIndex(1);

    expect(useEngineStore.getState().currentStepIndex).toBe(2);
  });

  it('seekToStep lands on a complete step for refingering instead of skipping forward', async () => {
    const CHASE_XML = readFileSync(
      new URL('../assets/chase-setsuna-yuki.musicxml', import.meta.url),
      'utf8',
    );
    const { script, scoreTiming } = parseMusicXmlToScript(CHASE_XML);
    const step1 = script[1];
    const prefilled: ManualFingeringMap = {};
    for (const note of step1.notes) {
      prefilled[fingeringKey(step1.onset, note.hand, note.midi)] = 1 as Finger;
    }

    useEngineStore.getState().actions.loadScript(
      script,
      CHASE_XML,
      'chase',
      { scoreId: 'chase-seek', manualFingerings: prefilled },
      scoreTiming,
    );
    useEngineStore.setState({ fingeringMode: 'program', currentStepIndex: 3, engineMode: 'two-hand' });
    engine.ensureStoreSubscription();

    engine.seekToStep(1);

    expect(useEngineStore.getState().currentStepIndex).toBe(1);
    expect(useEngineStore.getState().programRefingerNoteIndex).toBe(0);
  });

  it('refinger mode overwrites an existing fingering on a clicked complete step', async () => {
    const persistSpy = vi
      .spyOn(scoreLibrary, 'updateScoreManualFingerings')
      .mockResolvedValue({ ok: true });

    const CHASE_XML = readFileSync(
      new URL('../assets/chase-setsuna-yuki.musicxml', import.meta.url),
      'utf8',
    );
    const { script, scoreTiming } = parseMusicXmlToScript(CHASE_XML);
    const step1 = script[1];
    const prefilled: ManualFingeringMap = {};
    for (const note of step1.notes) {
      prefilled[fingeringKey(step1.onset, note.hand, note.midi)] = 1 as Finger;
    }

    useEngineStore.getState().actions.loadScript(
      script,
      CHASE_XML,
      'chase',
      { scoreId: 'chase-refinger', manualFingerings: prefilled },
      scoreTiming,
    );
    useEngineStore.setState({ fingeringMode: 'program', engineMode: 'two-hand' });
    engine.start();
    engine.seekToStep(1);

    const ascending = programStepNotesAscendingMidi(step1);
    engine.handleFingerPress({ hand: 'R', finger: 2 }, 'clerk-user-abc');

    expect(useEngineStore.getState().currentStepIndex).toBe(1);
    expect(useEngineStore.getState().manualFingerings[
      fingeringKey(step1.onset, ascending[0].hand, ascending[0].midi)
    ]).toEqual({ finger: 2, physicalHand: 'R' });
    expect(useEngineStore.getState().programRefingerNoteIndex).toBe(1);

    await vi.waitFor(() => {
      expect(persistSpy).toHaveBeenCalledWith(
        'chase-refinger',
        'clerk-user-abc',
        expect.objectContaining({
          [fingeringKey(step1.onset, ascending[0].hand, ascending[0].midi)]: {
            finger: 2,
            physicalHand: 'R',
          },
        }),
      );
    });

    persistSpy.mockRestore();
  });

  it('reprograms a complete step on finger press without sheet click', async () => {
    const persistSpy = vi
      .spyOn(scoreLibrary, 'updateScoreManualFingerings')
      .mockResolvedValue({ ok: true });

    const CHASE_XML = readFileSync(
      new URL('../assets/chase-setsuna-yuki.musicxml', import.meta.url),
      'utf8',
    );
    const { script, scoreTiming } = parseMusicXmlToScript(CHASE_XML);
    const step1 = script[1];
    const prefilled: ManualFingeringMap = {};
    for (const note of step1.notes) {
      prefilled[fingeringKey(step1.onset, note.hand, note.midi)] = 1 as Finger;
    }

    useEngineStore.getState().actions.loadScript(
      script,
      CHASE_XML,
      'chase',
      { scoreId: 'chase-reprogram', manualFingerings: prefilled },
      scoreTiming,
    );
    useEngineStore.setState({
      fingeringMode: 'program',
      engineMode: 'two-hand',
      currentStepIndex: 1,
      programRefingerNoteIndex: null,
      isPracticeActive: true,
      hasPracticeStarted: true,
    });
    engine.ensureStoreSubscription();

    const ascending = programStepNotesAscendingMidi(step1);
    engine.handleFingerPress({ hand: 'R', finger: 3 }, 'clerk-user-abc');

    expect(useEngineStore.getState().currentStepIndex).toBe(1);
    expect(useEngineStore.getState().manualFingerings[
      fingeringKey(step1.onset, ascending[0].hand, ascending[0].midi)
    ]).toEqual({ finger: 3, physicalHand: 'R' });
    expect(useEngineStore.getState().programRefingerNoteIndex).toBe(1);

    await vi.waitFor(() => {
      expect(persistSpy).toHaveBeenCalledWith(
        'chase-reprogram',
        'clerk-user-abc',
        expect.objectContaining({
          [fingeringKey(step1.onset, ascending[0].hand, ascending[0].midi)]: {
            finger: 3,
            physicalHand: 'R',
          },
        }),
      );
    });

    persistSpy.mockRestore();
  });

  it('highlights every note in the current program step', async () => {
    const CHASE_XML = readFileSync(
      new URL('../assets/chase-setsuna-yuki.musicxml', import.meta.url),
      'utf8',
    );
    const { script, scoreTiming } = parseMusicXmlToScript(CHASE_XML);

    useEngineStore.getState().actions.loadScript(
      script,
      CHASE_XML,
      'chase',
      { scoreId: 'chase-highlight' },
      scoreTiming,
    );
    useEngineStore.setState({ fingeringMode: 'program', currentStepIndex: 1, engineMode: 'two-hand' });
    engine.start();

    expect(useEngineStore.getState().expectedMidiNotes.sort((a, b) => a - b)).toEqual(
      script[1].notes.map((note) => note.midi).sort((a, b) => a - b),
    );
  });

  it('resolves full two-hand step notes for program sheet highlighting', async () => {
    const CHASE_XML = readFileSync(
      new URL('../assets/chase-setsuna-yuki.musicxml', import.meta.url),
      'utf8',
    );
    const { script } = parseMusicXmlToScript(CHASE_XML);
    const step = script[1];

    const practiceNotes = getDisplayNotesForStep(step, false, 'two-hand', 'R');
    const expectedMidis = programStepExpectedMidis(step);

    expect(practiceNotes).toHaveLength(step.notes.length);
    expect(practiceNotes.map((n) => `${n.hand}:${n.pitch}`)).toEqual(
      step.notes.map((n) => `${n.hand}:${n.pitch}`),
    );
    expect(expectedMidis.length).toBeGreaterThan(0);
    expect(new Set(expectedMidis)).toEqual(new Set(step.notes.map((n) => n.midi)));
  });

  it('leaves unprogrammed notes on predicted fingers without a completion gate', async () => {
    await loadMinimalFixture();
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

describe('useEngineStore fingering mode', async () => {
  const storage = new Map<string, string>();

  beforeEach(async () => {
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
    await loadMinimalFixture();
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

  it('exits program mode when switching to one-hand practice', async () => {
    useEngineStore.getState().actions.setEngineMode('two-hand');
    useEngineStore.getState().actions.setFingeringMode('program');

    useEngineStore.getState().actions.setEngineMode('one-hand');

    const state = useEngineStore.getState();
    expect(state.engineMode).toBe('one-hand');
    expect(state.fingeringMode).toBe('off');
  });
});
