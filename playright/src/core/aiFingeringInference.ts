/**
 * Type-only import: onnxruntime-web's JS wrapper is ~396KB raw / 107KB gzip
 * (14% of the app bundle) and is dead weight for every session that never
 * runs ML fingering. A static import pulled it into the entry chunk, so slow
 * machines paid its parse/compile cost on every load even though the prior
 * lazy-init work already deferred the much larger WASM + model FETCH.
 * The module itself is now fetched on first use too, via loadOrt() below.
 */
import type * as OrtModule from 'onnxruntime-web';
import type { Hand } from '../types/index.ts';
import type { NoteEvent } from './fingeringPredictor.ts';
import {
  buildModelFeatureRow,
  FINGERING_FEATURE_COUNT,
} from './fingeringModelFeatures.ts';
import { isMlFingeringEnabled } from './fingeringMlConfig.ts';

/**
 * Resolved onnxruntime-web module, cached after the first dynamic import.
 * Never reset by dispose(): the module itself is immutable and re-importing
 * is free after the first fetch, while clearing it would re-download on every
 * bfcache restore.
 */
let ortModule: typeof OrtModule | null = null;
let ortModulePromise: Promise<typeof OrtModule> | null = null;

function loadOrt(): Promise<typeof OrtModule> {
  if (ortModule) {
    return Promise.resolve(ortModule);
  }

  if (!ortModulePromise) {
    ortModulePromise = import('onnxruntime-web')
      .then((loaded) => {
        ortModule = loaded;
        return loaded;
      })
      .catch((error) => {
        // Allow a later attempt to retry rather than caching the rejection.
        ortModulePromise = null;
        throw error;
      });
  }

  return ortModulePromise;
}

let session: OrtModule.InferenceSession | null = null;
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

/**
 * Reason ML fell back to pure-DP costs on the MOST RECENT call to
 * getMLFingerCosts while ML was enabled (mlCostWeight > 0) - null when that
 * call succeeded, or when ML has never been attempted this generation.
 * Never set/cleared by the `!isMlFingeringEnabled()` early return, since an
 * intentional mlCostWeight=0 is not a failure and must not touch this state.
 */
let lastMlFingeringFallbackReason: 'init-failed' | 'no-session' | 'inference-failed' | null =
  null;
/** Dedup key for the console warning, so it warns once per DISTINCT reason per generation, not once per phrase. */
let lastWarnedReason: string | null = null;

/** Non-null when the most recent enabled-ML attempt fell back to pure DP. See notes above. */
export function getLastMlFingeringFallbackReason(): typeof lastMlFingeringFallbackReason {
  return lastMlFingeringFallbackReason;
}

function reportMlFingeringFallback(
  reason: NonNullable<typeof lastMlFingeringFallbackReason>,
  detail: unknown,
): void {
  lastMlFingeringFallbackReason = reason;
  if (lastWarnedReason === reason) {
    return;
  }
  lastWarnedReason = reason;
  console.warn(
    `[aiFingeringInference] ML fingering fell back to pure DP (${reason}) - subsequent auto-fingering uses rule-based costs only until the model recovers.`,
    detail,
  );
}

function reportMlFingeringSuccess(): void {
  lastMlFingeringFallbackReason = null;
  lastWarnedReason = null;
}

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
      const ort = await loadOrt();
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
  lastMlFingeringFallbackReason = null;
  lastWarnedReason = null;

  if (activeSession) {
    await activeSession.release();
  }
}

/** Test-only helper that disposes the session and clears the page-lifetime init flag. */
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
  } catch (err) {
    reportMlFingeringFallback('init-failed', err);
    return [];
  }

  if (!session) {
    // initFingeringModel resolved without throwing but left no session -
    // e.g. a stale generation discarded a late create(). Not an exception,
    // but still a fallback the caller (and user) should be able to see.
    reportMlFingeringFallback('no-session', undefined);
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

  // Safe without an await: reaching here means initFingeringModel resolved
  // AND left a live session, which is only possible once loadOrt() resolved.
  const ort = ortModule!;
  const tensor = new ort.Tensor('float32', inputData, [
    1,
    seqLength,
    FINGERING_FEATURE_COUNT,
  ]);
  const activeSession = session;

  let results: Awaited<ReturnType<typeof activeSession.run>>;
  try {
    results = await enqueueInference(() =>
      activeSession.run({ note_sequence: tensor }),
    );
  } catch (err) {
    // This path was previously unguarded. An inference-time failure (as
    // opposed to an init-time failure) threw uncaught here, propagating through
    // fingerPhrase's un-try/catch'd `await getMLFingerCosts(...)` and
    // rejecting the whole predictFingering() Promise.all - losing BOTH
    // hands' fingering entirely, a strictly worse outcome than the pure-DP
    // fallback this function's contract otherwise guarantees. Bringing this
    // path in line with the init-failure contract (catch, report, return
    // [], let the caller fall back) rather than changing what the fallback
    // IS.
    reportMlFingeringFallback('inference-failed', err);
    return [];
  }

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

  reportMlFingeringSuccess();
  return costs;
}
