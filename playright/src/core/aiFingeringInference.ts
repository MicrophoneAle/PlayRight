import * as ort from 'onnxruntime-web';
import type { Hand } from '../types/index.ts';
import type { NoteEvent } from './fingeringPredictor.ts';
import {
  buildModelFeatureRow,
  FINGERING_FEATURE_COUNT,
} from './fingeringModelFeatures.ts';
import { isMlFingeringEnabled } from './fingeringMlConfig.ts';

let session: ort.InferenceSession | null = null;
let initPromise: Promise<void> | null = null;
let inferenceChain: Promise<unknown> = Promise.resolve();

function enqueueInference<T>(run: () => Promise<T>): Promise<T> {
  const result = inferenceChain.then(run, run);
  inferenceChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
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

  initPromise = (async () => {
    try {
      session = await ort.InferenceSession.create(modelUrl);
      console.log('ONNX Model loaded successfully!');
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

export async function disposeFingeringModel(): Promise<void> {
  inferenceChain = Promise.resolve();
  const activeSession = session;
  session = null;
  initPromise = null;

  if (activeSession) {
    await activeSession.release();
  }
}

/**
 * Returns a 2D array of costs.
 * result[noteIndex][finger - 1] = cost
 */
export async function getMLFingerCosts(
  phraseNotes: NoteEvent[],
  hand: Hand,
): Promise<number[][]> {
  if (phraseNotes.length === 0) {
    return [];
  }

  if (initPromise) {
    await initPromise;
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
