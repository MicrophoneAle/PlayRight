import * as ort from 'onnxruntime-web';
import type { Hand } from '../types/index.ts';
import type { NoteEvent } from './fingeringPredictor.ts';
import {
  buildModelFeatureRow,
  FINGERING_FEATURE_COUNT,
} from './fingeringModelFeatures.ts';
import { isMlFingeringEnabled } from './fingeringMlConfig.ts';

let session: ort.InferenceSession | null = null;
/** Shared in-flight init so concurrent callers await one create(), not many. */
let initPromise: Promise<void> | null = null;
/**
 * True after a successful InferenceSession.create in this page lifetime.
 * Survives dispose() so bfcache restore can re-init only when ML was actually used.
 */
let sessionHadBeenInitialized = false;
/** Bumped on dispose so an in-flight create that finishes late is discarded. */
let initGeneration = 0;
let inferenceChain: Promise<unknown> = Promise.resolve();

function enqueueInference<T>(run: () => Promise<T>): Promise<T> {
  const result = inferenceChain.then(run, run);
  inferenceChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** True if ML was successfully loaded at least once this page lifetime. */
export function wasFingeringModelInitialized(): boolean {
  return sessionHadBeenInitialized;
}

export async function initFingeringModel(
  modelUrl = '/fingering_model.onnx',
  options: { force?: boolean } = {},
): Promise<void> {
  if (!options.force && !isMlFingeringEnabled()) {
    return;
  }

  if (session) {
    return;
  }

  if (initPromise) {
    return initPromise;
  }

  const generation = initGeneration;
  initPromise = (async () => {
    try {
      const created = await ort.InferenceSession.create(modelUrl);
      if (generation !== initGeneration) {
        await created.release();
        return;
      }
      session = created;
      sessionHadBeenInitialized = true;
      console.log('ONNX Model loaded successfully!');
    } finally {
      if (generation === initGeneration) {
        initPromise = null;
      }
    }
  })();

  return initPromise;
}

export async function disposeFingeringModel(): Promise<void> {
  initGeneration += 1;
  inferenceChain = Promise.resolve();
  const activeSession = session;
  session = null;
  initPromise = null;

  if (activeSession) {
    await activeSession.release();
  }
}

/** Test-only: dispose session and clear the page-lifetime init flag. */
export async function resetFingeringModelForTests(): Promise<void> {
  await disposeFingeringModel();
  sessionHadBeenInitialized = false;
}

/**
 * Returns a 2D array of costs.
 * result[noteIndex][finger - 1] = cost
 *
 * Lazily initializes the ONNX session on first use when ML is enabled.
 * Concurrent callers share the same in-flight init promise.
 */
export async function getMLFingerCosts(
  phraseNotes: NoteEvent[],
  hand: Hand,
): Promise<number[][]> {
  if (phraseNotes.length === 0) {
    return [];
  }

  if (!isMlFingeringEnabled()) {
    return [];
  }

  try {
    await initFingeringModel();
  } catch {
    return [];
  }

  if (!session) {
    return [];
  }

  const seqLength = phraseNotes.length;
  const inputData = new Float32Array(seqLength * FINGERING_FEATURE_COUNT);

  for (let i = 0; i < seqLength; i++) {
    const row = buildModelFeatureRow({
      hand,
      index: i,
      phraseNotes,
    });
    inputData.set(row, i * FINGERING_FEATURE_COUNT);
  }

  const tensor = new ort.Tensor('float32', inputData, [
    1,
    seqLength,
    FINGERING_FEATURE_COUNT,
  ]);
  const activeSession = session;
  const results = await enqueueInference(() =>
    activeSession.run({ note_sequence: tensor }),
  );

  const logits = results.finger_logits.data as Float32Array;
  const costs: number[][] = [];

  for (let i = 0; i < seqLength; i++) {
    const noteLogits = logits.slice(i * 5, (i + 1) * 5);

    const maxLogit = Math.max(...Array.from(noteLogits));
    const expScores = Array.from(noteLogits).map((val) =>
      Math.exp(val - maxLogit),
    );
    const sumExp = expScores.reduce((a, b) => a + b, 0);

    const noteCosts = expScores.map((exp) => {
      const prob = exp / sumExp;
      return -Math.log(prob + 1e-7);
    });

    costs.push(noteCosts);
  }

  return costs;
}
