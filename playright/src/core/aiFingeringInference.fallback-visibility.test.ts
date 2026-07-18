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
  getLastMlFingeringFallbackReason,
  getMLFingerCosts,
  resetFingeringModelForTests,
} from './aiFingeringInference.ts';
import { predictFingering } from './fingeringPredictor.ts';
import { parseMusicXmlToScript } from './parser/index.ts';

/**
 * Bug 2: getMLFingerCosts previously caught init/inference failure and
 * returned [] with zero user-visible signal. These tests force each failure
 * mode and confirm (a) the new signal actually fires (getLastMl
 * FingeringFallbackReason + a deduped console.warn), (b) fingering still
 * completes via the pure-DP fallback (no functional regression), and (c) the
 * previously-unguarded inference-time failure no longer throws uncaught.
 */

function noteEvent(midi: number, onset: number) {
  return { stepIndex: onset, midi, authoredFinger: null, onset };
}

describe('aiFingeringInference: ML fallback visibility', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await resetFingeringModelForTests();
    create.mockReset();
    release.mockReset();
    run.mockReset();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    await resetFingeringModelForTests();
    warnSpy.mockRestore();
  });

  it('reports no fallback and stays silent when ML is untouched (baseline)', () => {
    expect(getLastMlFingeringFallbackReason()).toBeNull();
  });

  it('init failure: getMLFingerCosts falls back to [] (unchanged behavior), signal fires, warns once', async () => {
    create.mockRejectedValue(new Error('injected init failure'));

    const notes = [noteEvent(60, 0), noteEvent(62, 480)];
    const first = await getMLFingerCosts(notes as never, 'R');
    expect(first).toEqual([]); // fallback behavior itself is unchanged
    expect(getLastMlFingeringFallbackReason()).toBe('init-failed');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('init-failed');

    // A second phrase hitting the SAME failure must not spam the console -
    // the retry itself still happens (create is called again; not our
    // scope to change), only the log is deduped.
    const second = await getMLFingerCosts(notes as never, 'R');
    expect(second).toEqual([]);
    expect(create).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('inference failure: previously uncaught, now falls back to [] instead of throwing, signal fires', async () => {
    create.mockResolvedValue({ release, run });
    run.mockRejectedValue(new Error('injected inference failure'));

    const notes = [noteEvent(60, 0), noteEvent(62, 480)];

    // The core assertion: this must resolve, not reject. Before the fix,
    // the unguarded `await activeSession.run(...)` let this exception
    // propagate uncaught out of getMLFingerCosts.
    await expect(getMLFingerCosts(notes as never, 'R')).resolves.toEqual([]);
    expect(getLastMlFingeringFallbackReason()).toBe('inference-failed');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('inference-failed');
  });

  it('recovery: a subsequent successful call clears the fallback reason and re-arms the warning', async () => {
    create.mockRejectedValueOnce(new Error('injected init failure'));
    const notes = [noteEvent(60, 0), noteEvent(62, 480)];

    await getMLFingerCosts(notes as never, 'R');
    expect(getLastMlFingeringFallbackReason()).toBe('init-failed');

    await disposeFingeringModel();
    create.mockResolvedValue({ release, run });
    run.mockResolvedValue({ finger_logits: { data: new Float32Array(10).fill(0) } });

    const recovered = await getMLFingerCosts(notes as never, 'R');
    expect(recovered).toHaveLength(2);
    expect(getLastMlFingeringFallbackReason()).toBeNull();

    // A fresh failure after recovery must warn again (not permanently deduped).
    await disposeFingeringModel();
    create.mockRejectedValue(new Error('injected init failure again'));
    await getMLFingerCosts(notes as never, 'R');
    expect(getLastMlFingeringFallbackReason()).toBe('init-failed');
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('end-to-end: predictFingering still completes with valid fingers when ML init is forced to fail', async () => {
    create.mockRejectedValue(new Error('injected init failure'));

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>480</duration><staff>1</staff></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>480</duration><staff>1</staff></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>480</duration><staff>1</staff></note>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>480</duration><staff>2</staff></note>
      <note><pitch><step>D</step><octave>3</octave></pitch><duration>480</duration><staff>2</staff></note>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>480</duration><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

    const { script, scoreTiming } = parseMusicXmlToScript(xml);
    const predicted = await predictFingering(script, {
      divisionsPerQuarter: scoreTiming.divisionsPerQuarter,
    });

    // Functional correctness of the fallback path itself: every note got a
    // real finger (1-5), not null/undefined/NaN from a half-crashed path.
    const allNotes = predicted.flatMap((step) => step.notes);
    expect(allNotes).toHaveLength(6);
    for (const note of allNotes) {
      expect(note.finger).not.toBeNull();
      expect([1, 2, 3, 4, 5]).toContain(note.finger);
      expect(note.fingerSource).toBe('predicted');
    }
    expect(getLastMlFingeringFallbackReason()).toBe('init-failed');
  });

  it('no-session fallback (init resolves but leaves no session) is also visible, not silent', async () => {
    // A stale generation: dispose() bumps initGeneration mid-flight, so the
    // late create() resolves but discards itself, leaving session=null
    // without ever throwing.
    let resolveCreate!: (value: { release: typeof release; run: typeof run }) => void;
    create.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );

    const notes = [noteEvent(60, 0)];
    const pending = getMLFingerCosts(notes as never, 'R');
    await disposeFingeringModel();
    resolveCreate({ release, run });

    const result = await pending;
    expect(result).toEqual([]);
    expect(getLastMlFingeringFallbackReason()).toBe('no-session');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('no-session');
  });
});
