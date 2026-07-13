import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
const release = vi.fn(async () => undefined);
const run = vi.fn();

vi.mock('onnxruntime-web', () => ({
  InferenceSession: {
    create: (...args: unknown[]) => create(...args),
  },
  Tensor: class FakeTensor {
    type: string;
    data: Float32Array;
    dims: number[];
    constructor(type: string, data: Float32Array, dims: number[]) {
      this.type = type;
      this.data = data;
      this.dims = dims;
    }
  },
}));

vi.mock('./fingeringMlConfig.ts', () => ({
  ML_COST_WEIGHT: 150,
  isMlFingeringEnabled: () => true,
}));

import {
  disposeFingeringModel,
  getMLFingerCosts,
  initFingeringModel,
  resetFingeringModelForTests,
  wasFingeringModelInitialized,
} from './aiFingeringInference.ts';
import { restoreSessionAfterPageShow } from './sessionLifecycle.ts';

vi.mock('../store/useEngineStore.ts', () => ({
  useEngineStore: {
    getState: () => ({
      actions: {
        setPracticeActive: vi.fn(),
        setHasPracticeStarted: vi.fn(),
        setPlaybackActive: vi.fn(),
        setPlaybackFinished: vi.fn(),
        setPlaybackPaused: vi.fn(),
        setExpectedNotes: vi.fn(),
        setPlayingMidiNotes: vi.fn(),
        setPlayingPlaybackNotes: vi.fn(),
      },
    }),
  },
}));

vi.mock('./FingeringProgramEngine.ts', () => ({
  fingeringProgramEngine: { stop: vi.fn() },
}));
vi.mock('./PlaybackEngine.ts', () => ({
  playbackEngine: { stop: vi.fn() },
}));
vi.mock('./PracticeEngine.ts', () => ({
  practiceEngine: { stop: vi.fn() },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('aiFingeringInference lazy init', () => {
  beforeEach(async () => {
    await resetFingeringModelForTests();
    create.mockReset();
    release.mockReset();
    run.mockReset();
    run.mockResolvedValue({
      finger_logits: { data: new Float32Array(5).fill(0) },
    });
  });

  afterEach(async () => {
    await resetFingeringModelForTests();
  });

  it('does not create a session until getMLFingerCosts is called', async () => {
    expect(wasFingeringModelInitialized()).toBe(false);
    expect(create).not.toHaveBeenCalled();

    const pending = deferred<{ release: typeof release; run: typeof run }>();
    create.mockReturnValueOnce(pending.promise);

    const notes = [
      {
        midi: 60,
        onset: 0,
        duration: 1,
        measureNumber: 1,
        isBlack: false,
      },
    ];

    const costsPromise = getMLFingerCosts(notes as never, 'R');
    expect(create).toHaveBeenCalledTimes(1);

    pending.resolve({ release, run });
    const costs = await costsPromise;
    expect(costs).toHaveLength(1);
    expect(costs[0]).toHaveLength(5);
    expect(wasFingeringModelInitialized()).toBe(true);
  });

  it('shares one in-flight create across concurrent getMLFingerCosts callers', async () => {
    const pending = deferred<{ release: typeof release; run: typeof run }>();
    create.mockReturnValueOnce(pending.promise);

    const notes = [
      {
        midi: 60,
        onset: 0,
        duration: 1,
        measureNumber: 1,
        isBlack: false,
      },
    ];

    const first = getMLFingerCosts(notes as never, 'R');
    const second = getMLFingerCosts(notes as never, 'R');
    expect(create).toHaveBeenCalledTimes(1);

    pending.resolve({ release, run });
    const [a, b] = await Promise.all([first, second]);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('bfcache restore re-inits only when ML was previously initialized', async () => {
    expect(wasFingeringModelInitialized()).toBe(false);
    await restoreSessionAfterPageShow(true);
    expect(create).not.toHaveBeenCalled();

    create.mockResolvedValueOnce({ release, run });
    await initFingeringModel('/fake.onnx', { force: true });
    expect(wasFingeringModelInitialized()).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);

    await disposeFingeringModel();
    expect(wasFingeringModelInitialized()).toBe(true);

    create.mockResolvedValueOnce({ release, run });
    await restoreSessionAfterPageShow(true);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
