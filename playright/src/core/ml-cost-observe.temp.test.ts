// TEMP OBSERVATION - remove before commit
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, it, vi } from 'vitest';

const observed: number[][][] = [];

vi.mock('./aiFingeringInference.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./aiFingeringInference.ts')>();
  return {
    ...actual,
    getMLFingerCosts: async (
      ...args: Parameters<typeof actual.getMLFingerCosts>
    ) => {
      const costs = await actual.getMLFingerCosts(...args);
      if (costs.length > 0) observed.push(costs);
      return costs;
    },
  };
});

import {
  disposeFingeringModel,
  initFingeringModel,
} from './aiFingeringInference.ts';
import { parseMusicXmlToScript } from './parser/index.ts';
import { extractHandTimelines, predictFingering } from './fingeringPredictor.ts';
import type { Hand, PlaybackScript } from '../types/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const modelPath = join(here, '../../public/fingering_model.onnx');
const CHASE_XML = readFileSync(join(here, '../assets/chase-setsuna-yuki.musicxml'), 'utf8');
const MORNS_XML = readFileSync(
  join(here, '../assets/morns-like-these-honkai-star-rail.musicxml'),
  'utf8',
);

const BLACK = new Set([1, 3, 6, 8, 10]);

interface Pathologies {
  nulls: number;
  sameFingerMove: number;
  chordOrderViolations: number;
  thumbOnBlack: number;
}

function checkHand(script: PlaybackScript, hand: Hand): Pathologies {
  const timeline = extractHandTimelines(script)[hand];
  const withFingers = timeline.map((event) => {
    const note = script[event.stepIndex].notes.find(
      (entry) => entry.hand === hand && entry.midi === event.midi,
    );
    return { ...event, finger: note?.finger ?? null };
  });

  const result: Pathologies = {
    nulls: 0,
    sameFingerMove: 0,
    chordOrderViolations: 0,
    thumbOnBlack: 0,
  };

  for (let i = 0; i < withFingers.length; i += 1) {
    const cur = withFingers[i];
    if (cur.finger === null) {
      result.nulls += 1;
      continue;
    }
    if (cur.finger === 1 && BLACK.has(cur.midi % 12)) {
      result.thumbOnBlack += 1;
    }
    const prev = i > 0 ? withFingers[i - 1] : null;
    if (
      prev &&
      prev.finger !== null &&
      prev.stepIndex !== cur.stepIndex &&
      prev.finger === cur.finger &&
      prev.midi !== cur.midi
    ) {
      result.sameFingerMove += 1;
    }
    if (prev && prev.finger !== null && prev.stepIndex === cur.stepIndex) {
      const ok =
        hand === 'R' ? cur.finger > prev.finger : cur.finger < prev.finger;
      if (!ok) result.chordOrderViolations += 1;
    }
  }
  return result;
}

function fmt(p: Pathologies): string {
  return `${p.nulls}/${p.sameFingerMove}/${p.chordOrderViolations}/${p.thumbOnBlack}`;
}

describe('TEMP observed ML cost magnitudes and 150-vs-300 pathologies', () => {
  afterAll(async () => {
    await disposeFingeringModel();
  });

  it('observes real costs fed to the DP and compares pathologies', async () => {
    const chase = parseMusicXmlToScript(CHASE_XML);
    const morns = parseMusicXmlToScript(MORNS_XML);

    await initFingeringModel(modelPath, { force: true });

    const results: Record<string, Record<Hand, Pathologies>> = {};

    for (const weight of [150, 300]) {
      for (const [name, parsed] of [
        ['chase', chase],
        ['morns', morns],
      ] as const) {
        const predicted = await predictFingering(parsed.script, {
          divisionsPerQuarter: parsed.scoreTiming.divisionsPerQuarter,
          mlCostWeight: weight,
        });
        results[`${name}@${weight}`] = {
          R: checkHand(predicted, 'R'),
          L: checkHand(predicted, 'L'),
        };
      }
    }

    // Cost stats over every matrix the DP actually received (both weights hit
    // the same model, costs are weight-independent - dedupe not needed).
    let maxEntry = 0;
    let maxSpread = 0;
    let noteCount = 0;
    const allEntries: number[] = [];
    for (const matrix of observed) {
      for (const noteCosts of matrix) {
        noteCount += 1;
        const hi = Math.max(...noteCosts);
        const lo = Math.min(...noteCosts);
        maxEntry = Math.max(maxEntry, hi);
        maxSpread = Math.max(maxSpread, hi - lo);
        allEntries.push(...noteCosts);
      }
    }
    allEntries.sort((a, b) => a - b);
    const p95 = allEntries[Math.floor(allEntries.length * 0.95)];

    console.log(`\nnotes observed: ${noteCount} (phrase calls: ${observed.length})`);
    console.log(`max per-note-finger cost (nll): ${maxEntry.toFixed(3)} -> x150 = ${(maxEntry * 150).toFixed(0)}, x300 = ${(maxEntry * 300).toFixed(0)}`);
    console.log(`max per-note spread (worst - best finger): ${maxSpread.toFixed(3)} -> x150 = ${(maxSpread * 150).toFixed(0)}, x300 = ${(maxSpread * 300).toFixed(0)}`);
    console.log(`p95 cost entry: ${p95.toFixed(3)} -> x150 = ${(p95 * 150).toFixed(0)}`);

    console.log('\npathologies (nulls/sameFingerMove/chordOrder/thumbBlack):');
    console.log('asset  hand | weight 150 | weight 300');
    for (const name of ['chase', 'morns'] as const) {
      for (const hand of ['R', 'L'] as const) {
        console.log(
          `${name.padEnd(6)} ${hand}    | ${fmt(results[`${name}@150`][hand]).padEnd(10)} | ${fmt(results[`${name}@300`][hand])}`,
        );
      }
    }
  });
});
