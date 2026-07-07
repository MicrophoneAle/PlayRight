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

// 2026-07-07: the superseding in-sequence rule (OUT_OF_SEQUENCE_PENALTY)
// lifted the pure-DP benchmark from 26/59 to 36/59.
const EXPECTED_DP_MATCHES = 36;

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

  it('falls back to the pure-DP benchmark when the model is not loaded', async () => {
    // Shipped default from the 2026-07-03 sweep (see fingeringMlConfig.ts).
    expect(ML_COST_WEIGHT).toBe(150);

    await disposeFingeringModel();
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

  it('stays close to the DP benchmark with the PIG emission model at the shipped weight', async () => {
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

    const withMl = await predictFingering(parsed, options);
    const mlMatches = countMatches(
      rhFingersInTimelineOrder(withMl).slice(0, TARGET_RH.length),
      TARGET_RH,
    );

    console.log(
      `chase RH: DP-only ${dpMatches}/${TARGET_RH.length}, ML+DP at weight ${ML_COST_WEIGHT}: ${mlMatches}/${TARGET_RH.length}`,
    );

    // 2026-07-07: the in-sequence rule lifted pure DP to 36/59, above ML+DP
    // (31/59) — the ML emission now mostly shifts choices between equally
    // in-sequence fingerings (3-2 vs 4-3 zigzags). Hard requirement: ML must
    // not fall below 31/59; both counts still beat the pre-rule 32/59 peak
    // in violation terms (zero out-of-sequence progressions).
    expect(mlMatches).toBeGreaterThanOrEqual(31);
  });
});
