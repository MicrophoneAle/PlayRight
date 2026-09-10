/**
 * Regression: a slow async re-parse must not overwrite a newly loaded score
 * or graft its fingerings onto the new scoreId.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManualFingeringMap, PlaybackScript } from '../types/index.ts';

const {
  deferredPrepare,
  updateScoreManualFingeringsMock,
  RAW_A,
  RAW_B,
  scriptA,
  scriptB,
} = vi.hoisted(() => {
  let resolvePrepare: ((script: PlaybackScript) => void) | null = null;
  let rejectPrepare: ((reason?: unknown) => void) | null = null;

  const scriptA: PlaybackScript = [
    {
      order: 0,
      onset: 0,
      measureNumber: 1,
      notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: null }],
    },
  ];

  const scriptB: PlaybackScript = [
    {
      order: 0,
      onset: 0,
      measureNumber: 1,
      notes: [{ pitch: 'E4', midi: 64, hand: 'R', finger: 1, fingerSource: 'manual' }],
    },
    {
      order: 1,
      onset: 480,
      measureNumber: 1,
      notes: [{ pitch: 'G4', midi: 67, hand: 'R', finger: null }],
    },
  ];

  const deferredPrepare = {
    promise: null as Promise<PlaybackScript> | null,
    reset() {
      this.promise = new Promise<PlaybackScript>((resolve, reject) => {
        resolvePrepare = resolve;
        rejectPrepare = reject;
      });
    },
    resolve(script: PlaybackScript) {
      resolvePrepare?.(script);
    },
    reject(reason?: unknown) {
      rejectPrepare?.(reason);
    },
  };
  deferredPrepare.reset();

  return {
    deferredPrepare,
    updateScoreManualFingeringsMock: vi.fn(async () => ({ ok: true as const })),
    RAW_A: '<score-a/>',
    RAW_B: '<score-b/>',
    scriptA,
    scriptB,
  };
});

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

vi.mock('../core/aiFingeringInference.ts', () => ({
  getMLFingerCosts: async () => [],
  initFingeringModel: async () => undefined,
  disposeFingeringModel: () => undefined,
  wasFingeringModelInitialized: () => false,
  resetFingeringModelForTests: () => undefined,
  getLastMlFingeringFallbackReason: () => null,
}));

vi.mock('../core/fingeringPredictor.ts', () => ({
  applyFingeringSettings: vi.fn(async (script: PlaybackScript) => script),
  prepareScriptWithFingering: vi.fn(() => deferredPrepare.promise!),
}));

vi.mock('../core/parser/index.ts', () => ({
  parseMusicXmlToScript: vi.fn((rawXml: string) => {
    const script =
      rawXml === RAW_A ? structuredClone(scriptA) : structuredClone(scriptB);
    return {
      script,
      scoreTiming: { divisionsPerQuarter: 1, tempoMap: [] },
      playbackOrder: script.map((step, stepIndex) => ({
        stepIndex,
        playbackOnset: step.onset,
        passIndex: 0,
      })),
      warnings: [],
    };
  }),
}));

vi.mock('../core/scoreLibrary.ts', () => ({
  updateScoreManualFingerings: updateScoreManualFingeringsMock,
}));

import {
  resetScriptGenerationForTests,
  useEngineStore,
} from './useEngineStore.ts';

/** Distinctive result only the stale reprocess of score A would produce. */
const staleReprocessResult: PlaybackScript = [
  {
    order: 0,
    onset: 0,
    measureNumber: 1,
    notes: [
      {
        pitch: 'C4',
        midi: 60,
        hand: 'R',
        finger: 5,
        fingerSource: 'predicted',
      },
    ],
  },
];

const fingeringsB: ManualFingeringMap = { '0:R:64': 1 };

function resetStore(): void {
  resetScriptGenerationForTests();
  deferredPrepare.reset();
  updateScoreManualFingeringsMock.mockClear();
  useEngineStore.setState({
    script: null,
    rawXml: null,
    songTitle: null,
    scoreId: null,
    scoreTiming: null,
    playbackOrder: null,
    manualFingerings: {},
    fingeringMode: 'off',
    selectedFingeringNote: null,
    programAssignedKeys: [],
    overrideScoreFingerings: false,
    autoFingering: true,
    handSpan: 1,
    currentStepIndex: 0,
    totalSteps: 0,
  });
}

describe('script-generation staleness guard', () => {
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('setManualFinger: stale reprocess after loadScript does not overwrite the new score', async () => {
    const { actions } = useEngineStore.getState();
    actions.loadScript(structuredClone(scriptA), RAW_A, 'Score A', {
      scoreId: 'score-a',
      manualFingerings: {},
    });

    actions.setManualFinger(0, 'R', 60, 2, 'user-1');

    expect(updateScoreManualFingeringsMock).toHaveBeenCalledTimes(1);
    expect(updateScoreManualFingeringsMock).toHaveBeenCalledWith(
      'score-a',
      'user-1',
      { '0:R:60': 2 },
    );

    actions.loadScript(structuredClone(scriptB), RAW_B, 'Score B', {
      scoreId: 'score-b',
      manualFingerings: fingeringsB,
    });

    expect(useEngineStore.getState().scoreId).toBe('score-b');
    expect(useEngineStore.getState().script).toEqual(scriptB);
    expect(useEngineStore.getState().manualFingerings).toEqual(fingeringsB);

    deferredPrepare.resolve(structuredClone(staleReprocessResult));
    await Promise.resolve();
    await Promise.resolve();

    const state = useEngineStore.getState();
    expect(state.scoreId).toBe('score-b');
    expect(state.rawXml).toBe(RAW_B);
    expect(state.songTitle).toBe('Score B');
    expect(state.script).toEqual(scriptB);
    expect(state.manualFingerings).toEqual(fingeringsB);
    expect(state.script?.[0]?.notes[0]?.finger).not.toBe(5);

    // Persist fired only for the score that was current at finger-press time.
    expect(updateScoreManualFingeringsMock).toHaveBeenCalledTimes(1);
    expect(updateScoreManualFingeringsMock).not.toHaveBeenCalledWith(
      'score-b',
      expect.anything(),
      expect.anything(),
    );
  });

  it('setOverrideScoreFingerings: stale reprocess after loadScript leaves the new script intact', async () => {
    const { actions } = useEngineStore.getState();
    actions.loadScript(structuredClone(scriptA), RAW_A, 'Score A', {
      scoreId: 'score-a',
      manualFingerings: {},
    });

    actions.setOverrideScoreFingerings(true);
    expect(useEngineStore.getState().overrideScoreFingerings).toBe(true);

    actions.loadScript(structuredClone(scriptB), RAW_B, 'Score B', {
      scoreId: 'score-b',
      manualFingerings: fingeringsB,
    });

    deferredPrepare.resolve(structuredClone(staleReprocessResult));
    await Promise.resolve();
    await Promise.resolve();

    const state = useEngineStore.getState();
    expect(state.scoreId).toBe('score-b');
    expect(state.script).toEqual(scriptB);
    expect(state.manualFingerings).toEqual(fingeringsB);
    // Toggle was applied synchronously before the await; discarding the
    // reprocess must not roll it back or leave a half-applied setting.
    expect(state.overrideScoreFingerings).toBe(true);
    expect(state.script?.[0]?.notes[0]?.midi).toBe(64);
  });
});
