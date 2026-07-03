import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  disposeFingeringModel,
  initFingeringModel,
} from './aiFingeringInference.ts';
import { parseMusicXmlToScript } from './parser/index.ts';
import {
  ML_COST_WEIGHT,
  extractHandTimelines,
  predictFingering,
} from './fingeringPredictor.ts';
import type { PlaybackScript } from '../types/index.ts';
import type { NoteEvent } from './fingeringPredictor.ts';

const CHASE_XML = readFileSync(
  new URL('../assets/chase-setsuna-yuki.musicxml', import.meta.url),
  'utf8',
);

/** User-provided RH target fingering for chase-setsuna-yuki (opening section). */
const TARGET_RH = [
  1, 5, 4, 3, 4, 3, 1, 1, 1, 2, 3, 4, 1, 2, 3, 5, 4, 3, 4, 3, 1, 1, 1, 2, 3,
  4, 1, 2, 1, 3, 3, 3, 2, 3, 4, 5, 1, 3, 3, 3, 1, 5, 4, 3, 5, 4, 3, 4, 3, 1,
  2, 3, 3, 3, 3, 2, 3, 5, 3,
] as const;

const EXPECTED_DP_MATCHES = 26;

function rhFingersInTimelineOrder(script: PlaybackScript): (number | null)[] {
  const timeline = extractHandTimelines(script).R;

  return timeline.map((event: NoteEvent) => {
    const step = script[event.stepIndex];
    const note = step.notes.find(
      (entry) => entry.hand === 'R' && entry.midi === event.midi,
    );
    return note?.finger ?? null;
  });
}

function countMatches(
  actual: (number | null)[],
  target: readonly number[],
): number {
  const compared = Math.min(actual.length, target.length);
  let matches = 0;

  for (let index = 0; index < compared; index += 1) {
    if (actual[index] === target[index]) {
      matches += 1;
    }
  }

  return matches;
}

describe('chase RH fingering comparison', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const modelPath = join(__dirname, '../../public/fingering_model.onnx');

  afterAll(async () => {
    await disposeFingeringModel();
  });

  it('matches the DP-only chase benchmark with ML disabled by default', async () => {
    expect(ML_COST_WEIGHT).toBe(0);

    const { script: parsed, scoreTiming } = parseMusicXmlToScript(CHASE_XML);
    const predicted = await predictFingering(parsed, {
      divisionsPerQuarter: scoreTiming.divisionsPerQuarter,
    });

    const fingers = rhFingersInTimelineOrder(predicted).slice(
      0,
      TARGET_RH.length,
    );
    const matches = countMatches(fingers, TARGET_RH);

    expect(matches).toBe(EXPECTED_DP_MATCHES);
    expect(fingers.slice(0, 9)).toEqual([1, 5, 4, 3, 4, 3, 1, 1, 1]);
  });

  // Skipped 2026-07-03: fingering_model.onnx is still the stale 52-dim model
  // trained on the synthetic dataset. fingeringModelFeatures.ts now builds the
  // canonical 24-dim feature vector (see public/fingering_model_features.json),
  // so this forced-load path throws an ONNX shape mismatch (expected 52, got
  // 24) until the model is retrained on pig_aggregated.csv against the new
  // schema. Re-enable once retrained.
  it.skip('documents ML+DP regression when mlCostWeight is forced to 1', async () => {
    const { script: parsed, scoreTiming } = parseMusicXmlToScript(CHASE_XML);
    const options = { divisionsPerQuarter: scoreTiming.divisionsPerQuarter };

    await disposeFingeringModel();
    const dpOnly = await predictFingering(parsed, options);
    const dpMatches = countMatches(
      rhFingersInTimelineOrder(dpOnly).slice(0, TARGET_RH.length),
      TARGET_RH,
    );
    expect(dpMatches).toBe(EXPECTED_DP_MATCHES);

    await initFingeringModel(modelPath, { force: true });

    const withMl = await predictFingering(parsed, {
      ...options,
      mlCostWeight: 1,
    });
    const mlMatches = countMatches(
      rhFingersInTimelineOrder(withMl).slice(0, TARGET_RH.length),
      TARGET_RH,
    );

    expect(mlMatches).toBeLessThan(dpMatches);
  });
});
