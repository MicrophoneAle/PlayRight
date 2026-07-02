import * as ort from 'onnxruntime-web';
import type { NoteEvent } from './fingeringPredictor.ts';

let session: ort.InferenceSession | null = null;
let initPromise: Promise<void> | null = null;
let inferenceChain: Promise<unknown> = Promise.resolve();

// The exact number of features your Python script printed out
// UPDATE THIS to match the console output from your training script!
const INPUT_FEATURE_COUNT = 38;

function enqueueInference<T>(run: () => Promise<T>): Promise<T> {
  const result = inferenceChain.then(run, run);
  inferenceChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function initFingeringModel(): Promise<void> {
  if (session) {
    return;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      session = await ort.InferenceSession.create('/fingering_model.onnx');
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

  // We initialize everything to 0.
  // Because we used StandardScaler in Python, 0 represents the "average" value.
  // This is a great trick to safely ignore features we don't have (like MFCC audio data).
  const inputData = new Float32Array(1 * seqLength * INPUT_FEATURE_COUNT);

  for (let i = 0; i < seqLength; i++) {
    const note = phraseNotes[i];
    const prevMidi = i > 0 ? phraseNotes[i - 1].midi : note.midi;
    const pitchDelta = note.midi - prevMidi;
    const isBlackKey = [1, 3, 6, 8, 10].includes(note.midi % 12) ? 1 : 0;

    const baseIndex = i * INPUT_FEATURE_COUNT;

    // Feature 0: Pitch Delta
    inputData[baseIndex + 0] = pitchDelta;
    // Feature 1: Is Black Key
    inputData[baseIndex + 1] = isBlackKey;
    // The rest remain 0 (average) for now.
  }

  const tensor = new ort.Tensor('float32', inputData, [
    1,
    seqLength,
    INPUT_FEATURE_COUNT,
  ]);
  const activeSession = session;
  const results = await enqueueInference(() =>
    activeSession.run({ note_sequence: tensor }),
  );

  const logits = results.finger_logits.data as Float32Array;
  const costs: number[][] = [];

  for (let i = 0; i < seqLength; i++) {
    const noteLogits = logits.slice(i * 5, (i + 1) * 5);

    // 1. Softmax: Convert raw logits to probabilities (0.0 to 1.0)
    const maxLogit = Math.max(...Array.from(noteLogits));
    const expScores = Array.from(noteLogits).map((val) =>
      Math.exp(val - maxLogit),
    );
    const sumExp = expScores.reduce((a, b) => a + b, 0);

    // 2. Negative Log Likelihood: Convert probability to a physical "cost"
    const noteCosts = expScores.map((exp) => {
      const prob = exp / sumExp;
      return -Math.log(prob + 1e-7); // +1e-7 prevents Infinity on 0% probability
    });

    costs.push(noteCosts);
  }

  return costs;
}
