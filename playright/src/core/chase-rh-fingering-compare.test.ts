import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, it } from 'vitest';
import {
  disposeFingeringModel,
  initFingeringModel,
} from './aiFingeringInference.ts';
import { parseMusicXmlToScript } from './parser/index.ts';
import { extractHandTimelines, predictFingering } from './fingeringPredictor.ts';
import type { PlaybackScript } from '../types/index.ts';
import type { NoteEvent } from './fingeringPredictor.ts';

const CHASE_XML = readFileSync(
  new URL('../assets/chase-setsuna-yuki.musicxml', import.meta.url),
  'utf8',
);

/** User-provided RH target fingering for chase-setsuna-yuki. */
const TARGET_RH = [
  1, 5, 4, 3, 4, 3, 1, 1, 1, 2, 3, 4, 1, 2, 3, 5, 4, 3, 4, 3, 1, 1, 1, 2, 3,
  4, 1, 2, 1, 3, 3, 3, 2, 3, 4, 5, 1, 3, 3, 3, 1, 5, 4, 3, 5, 4, 3, 4, 3, 1,
  2, 3, 3, 3, 3, 2, 3, 5, 3,
] as const;

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

function compareFingering(
  label: string,
  actual: (number | null)[],
  target: readonly number[],
): void {
  const compared = Math.min(actual.length, target.length);
  let matches = 0;
  const mismatches: Array<{
    index: number;
    expected: number;
    got: number | null;
  }> = [];

  for (let index = 0; index < compared; index += 1) {
    if (actual[index] === target[index]) {
      matches += 1;
    } else {
      mismatches.push({
        index,
        expected: target[index],
        got: actual[index],
      });
    }
  }

  const pct = ((matches / target.length) * 100).toFixed(1);
  console.log(`\n=== ${label} ===`);
  console.log(`Match: ${matches}/${target.length} (${pct}%)`);
  console.log(`Predicted RH notes: ${actual.length}, target length: ${target.length}`);

  if (actual.length !== target.length) {
    console.log(
      `Length delta: ${actual.length - target.length > 0 ? '+' : ''}${actual.length - target.length}`,
    );
  }

  console.log('Predicted:', actual.join(' '));
  console.log('Target:   ', target.join(' '));

  if (mismatches.length > 0) {
    console.log('First mismatches (index expected→got):');
    for (const mismatch of mismatches.slice(0, 15)) {
      console.log(
        `  [${mismatch.index}] ${mismatch.expected} → ${mismatch.got ?? 'null'}`,
      );
    }
    if (mismatches.length > 15) {
      console.log(`  ... and ${mismatches.length - 15} more`);
    }
  }
}

describe('chase RH fingering comparison', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const modelPath = join(__dirname, '../../public/fingering_model.onnx');

  afterAll(async () => {
    await disposeFingeringModel();
  });

  it('compares DP-only vs ML-augmented RH fingering against user target', async () => {
    const { script: parsed, scoreTiming } = parseMusicXmlToScript(CHASE_XML);
    const options = { divisionsPerQuarter: scoreTiming.divisionsPerQuarter };

    await disposeFingeringModel();

    const dpOnly = await predictFingering(parsed, options);
    compareFingering(
      'DP-only (no ONNX session)',
      rhFingersInTimelineOrder(dpOnly),
      TARGET_RH,
    );

    compareFingering(
      'DP-only first 59 RH notes only',
      rhFingersInTimelineOrder(dpOnly).slice(0, TARGET_RH.length),
      TARGET_RH,
    );

    const dpOverride = await predictFingering(parsed, {
      ...options,
      overrideScore: true,
    });
    compareFingering(
      'DP-only override score fingerings',
      rhFingersInTimelineOrder(dpOverride).slice(0, TARGET_RH.length),
      TARGET_RH,
    );

    await initFingeringModel(modelPath);

    const withMl = await predictFingering(parsed, options);
    compareFingering(
      'ML + DP (ONNX costs active)',
      rhFingersInTimelineOrder(withMl),
      TARGET_RH,
    );

    const dpFingers = rhFingersInTimelineOrder(dpOnly);
    const mlFingers = rhFingersInTimelineOrder(withMl);
    let mlChanged = 0;
    for (
      let index = 0;
      index < Math.max(dpFingers.length, mlFingers.length);
      index += 1
    ) {
      if (dpFingers[index] !== mlFingers[index]) {
        mlChanged += 1;
      }
    }

    console.log(`\nML changed ${mlChanged} RH finger assignments vs DP-only`);

    const timeline = extractHandTimelines(dpOnly).R;
    const byStep = new Map<number, NoteEvent[]>();
    for (const event of timeline) {
      const group = byStep.get(event.stepIndex) ?? [];
      group.push(event);
      byStep.set(event.stepIndex, group);
    }

    const monophonicRh = [...byStep.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([stepIndex, events]) => {
        const representative = [...events].sort(
          (left, right) => left.midi - right.midi,
        )[events.length - 1];
        const note = dpOnly[stepIndex].notes.find(
          (entry) => entry.hand === 'R' && entry.midi === representative.midi,
        );
        return note?.finger ?? null;
      });

    console.log(`\nRH timeline notes: ${timeline.length}`);
    console.log(`RH steps (monophonic reps): ${monophonicRh.length}`);
    compareFingering(
      'DP-only monophonic (highest RH note per step)',
      monophonicRh,
      TARGET_RH,
    );
  });
});
