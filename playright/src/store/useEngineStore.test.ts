import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackScript } from '../types/index.ts';
import {
  HAND_SPAN_PRESETS,
  selectIsPracticeActive,
  useEngineStore,
} from './useEngineStore.ts';

// setPlayMode(false) lazily imports the real PlaybackEngine and calls stop(),
// which drives Tone's transport. Without this mock the store tests race real
// Tone against the stubbed window global (transport.cancel missing -> flaky
// unhandled rejection in full-suite runs).
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

const AUTO_FINGERING_STORAGE_KEY = 'playright-auto-fingering';
const HAND_SPAN_STORAGE_KEY = 'playright-hand-span';

const sampleScript: PlaybackScript = [
  {
    order: 0,
    onset: 0,
    measureNumber: 1,
    notes: [
      { pitch: 'C4', midi: 60, hand: 'R', finger: null },
      { pitch: 'E4', midi: 64, hand: 'R', finger: 2, fingerSource: 'score' },
    ],
  },
  {
    order: 1,
    onset: 480,
    measureNumber: 1,
    notes: [{ pitch: 'D4', midi: 62, hand: 'R', finger: null }],
  },
];

function resetStore(): void {
  useEngineStore.setState({
    script: null,
    rawXml: null,
    songTitle: null,
    scoreId: null,
    manualFingerings: {},
    fingeringMode: 'off',
    selectedFingeringNote: null,
    programAssignedKeys: [],
    scopeStartMidi: 60,
    scopeTranspose: 0,
    shiftMode: 'semitone',
    engineMode: 'one-hand',
    activeHand: 'R',
    isPracticeActive: false,
    hasPracticeStarted: false,
    currentStepIndex: 0,
    totalSteps: 0,
    expectedMidiNotes: [],
    autoFingering: true,
    handSpan: 1,
  });
}

describe('selectIsPracticeActive', () => {
  beforeEach(() => {
    resetStore();
  });

  it('is false until practice has started and is active', () => {
    useEngineStore.setState({ isPracticeActive: true, hasPracticeStarted: false });
    expect(selectIsPracticeActive(useEngineStore.getState())).toBe(false);

    useEngineStore.setState({ isPracticeActive: false, hasPracticeStarted: true });
    expect(selectIsPracticeActive(useEngineStore.getState())).toBe(false);

    useEngineStore.setState({ isPracticeActive: true, hasPracticeStarted: true });
    expect(selectIsPracticeActive(useEngineStore.getState())).toBe(true);
  });
});

describe('useEngineStore settings and mode', () => {
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
    useEngineStore.getState().actions.loadScript(
      sampleScript,
      '<score/>',
      'fixture',
    );
    useEngineStore.setState({
      currentStepIndex: 1,
      isPracticeActive: true,
      hasPracticeStarted: true,
      expectedMidiNotes: [62],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts one-hand and two-hand engine modes while defaulting to one-hand', () => {
    expect(useEngineStore.getState().engineMode).toBe('one-hand');

    useEngineStore.getState().actions.setEngineMode('two-hand');
    expect(useEngineStore.getState().engineMode).toBe('two-hand');

    useEngineStore.getState().actions.setEngineMode('one-hand');
    expect(useEngineStore.getState().engineMode).toBe('one-hand');
  });

  it('persists autoFingering and recomputes the script without resetting practice state', async () => {
    const before = useEngineStore.getState();

    useEngineStore.getState().actions.setAutoFingering(false);

    expect(storage.get(AUTO_FINGERING_STORAGE_KEY)).toBe('false');

    await vi.waitFor(() => {
      expect(useEngineStore.getState().autoFingering).toBe(false);
    });

    const after = useEngineStore.getState();
    expect(after.script).not.toBe(before.script);
    expect(after.currentStepIndex).toBe(1);
    expect(after.isPracticeActive).toBe(true);
    expect(after.hasPracticeStarted).toBe(true);
    expect(after.expectedMidiNotes).toEqual([62]);
    expect(
      after.script?.[0].notes.find((note) => note.midi === 60)?.fingerSource,
    ).toBeUndefined();
    expect(
      after.script?.[0].notes.find((note) => note.midi === 64)?.fingerSource,
    ).toBe('score');
  });

  it('persists handSpan and recomputes the script without resetting practice state', async () => {
    const before = useEngineStore.getState();

    useEngineStore.getState().actions.setHandSpan(1.15);

    expect(storage.get(HAND_SPAN_STORAGE_KEY)).toBe('1.15');

    await vi.waitFor(() => {
      expect(useEngineStore.getState().handSpan).toBe(1.15);
    });

    const after = useEngineStore.getState();
    expect(HAND_SPAN_PRESETS).toContain(after.handSpan);
    expect(after.script).not.toBe(before.script);
    expect(after.currentStepIndex).toBe(1);
    expect(after.isPracticeActive).toBe(true);
    expect(after.hasPracticeStarted).toBe(true);
  });

  it('resets currentStepIndex and clears stale expected notes when toggling playMode', () => {
    useEngineStore.setState({
      currentStepIndex: 1,
      expectedMidiNotes: [62],
      playingMidiNotes: [60],
      playingPlaybackNotes: [{ pressId: 1, stepIndex: 1, midi: 60, hand: 'R' }],
      isPracticeActive: true,
      hasPracticeStarted: true,
    });

    useEngineStore.getState().actions.setPlayMode(true);

    let state = useEngineStore.getState();
    expect(state.playMode).toBe(true);
    expect(state.currentStepIndex).toBe(0);
    expect(state.expectedMidiNotes).toEqual([]);
    expect(state.hasPracticeStarted).toBe(false);
    expect(state.isPracticeActive).toBe(false);

    useEngineStore.setState({
      currentStepIndex: 1,
      expectedMidiNotes: [62],
      playingMidiNotes: [64],
      playingPlaybackNotes: [{ pressId: 2, stepIndex: 1, midi: 64, hand: 'R' }],
      isPlaybackActive: true,
      isPlaybackPaused: true,
    });

    useEngineStore.getState().actions.setPlayMode(false);

    state = useEngineStore.getState();
    expect(state.playMode).toBe(false);
    expect(state.currentStepIndex).toBe(0);
    expect(state.expectedMidiNotes).toEqual([]);
    expect(state.playingMidiNotes).toEqual([]);
    expect(state.playingPlaybackNotes).toEqual([]);
    expect(state.isPlaybackActive).toBe(false);
    expect(state.isPlaybackPaused).toBe(false);
    expect(state.isPlaybackFinished).toBe(false);
  });

  it('does not auto-show play fingerings when auto-show setting is off', () => {
    useEngineStore.setState({
      engineMode: 'two-hand',
      playMode: false,
      showTwoHandFingeringsInPlayMode: false,
      playModeFingeringsVisible: false,
    });

    useEngineStore.getState().actions.setPlayMode(true);

    expect(useEngineStore.getState().playModeFingeringsVisible).toBe(false);
  });

  it('auto-shows play fingerings when auto-show setting is on and engine is two-hand', () => {
    useEngineStore.setState({
      engineMode: 'two-hand',
      playMode: false,
      showTwoHandFingeringsInPlayMode: true,
      playModeFingeringsVisible: false,
    });

    useEngineStore.getState().actions.setPlayMode(true);

    expect(useEngineStore.getState().playModeFingeringsVisible).toBe(true);
  });

  it('clears play fingerings visibility when leaving play mode', () => {
    useEngineStore.setState({
      engineMode: 'two-hand',
      playMode: true,
      playModeFingeringsVisible: true,
    });

    useEngineStore.getState().actions.setPlayMode(false);

    expect(useEngineStore.getState().playModeFingeringsVisible).toBe(false);
  });

  it('persists auto-show play fingerings setting in localStorage', () => {
    useEngineStore.getState().actions.setShowTwoHandFingeringsInPlayMode(true);

    expect(window.localStorage.getItem('playright-show-two-hand-fingerings-in-play-mode')).toBe(
      'true',
    );
    expect(useEngineStore.getState().showTwoHandFingeringsInPlayMode).toBe(true);
  });
});
