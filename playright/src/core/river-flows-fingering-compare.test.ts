/**
 * PRIMARY fingering regression gate (both hands, 840 notes).
 *
 * Michael's river-flows-in-you manual_fingerings (Supabase dump checked in as
 * `__fixtures__/river-flows-manual-fingerings.json`) are the ground truth.
 * Chase RH (`chase-rh-fingering-compare.test.ts`) remains the secondary
 * high-agreement RH smoke check (59 notes).
 *
 * Floors below are regression stops from the 2026-09-17 measured baseline
 * (DP-only ~375/840, LH ~161/297, RH ~214/543) — NOT quality targets.
 * Integrity asserts that every gold key still resolves against the current
 * parse: manual_fingerings keys are onset-based, and onset drift has silently
 * orphaned keys before.
 *
 * Anchors must stay stripped: predict on the bare parse with overrideScore,
 * never applyManualFingerings, or the DP compares against itself.
 */
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
  predictFingering,
} from './fingeringPredictor.ts';
import { parseManualFingerings } from './scoreLibrary.ts';
import {
  fingeringKey,
  graceFingeringKey,
  type Finger,
  type Hand,
  type ManualFingeringMap,
  type ManualFingeringValue,
  type PlaybackScript,
} from '../types/index.ts';

const GOLD_RAW = JSON.parse(
  readFileSync(
    new URL(
      './__fixtures__/river-flows-manual-fingerings.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as unknown;

const GOLD_KEYS = Object.keys(GOLD_RAW as object);
const GOLD = parseManualFingerings(GOLD_RAW);

/** Measured 2026-09-17 DP-only floors with slack — not aspirational targets. */
const FLOOR_OVERALL = 370;
const FLOOR_LH = 155;
const FLOOR_RH = 205;
const GOLD_TOTAL = 840;
const GOLD_LH = 297;
const GOLD_RH = 543;

/** ML must not fall more than this many matches below DP-only on this piece. */
const ML_EPSILON = 10;

async function loadRiverXml(): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const buffer = readFileSync(
    new URL('../assets/river-flows-in-you.mxl', import.meta.url),
  );
  const archive = await JSZip.loadAsync(buffer);
  const xml = await archive.file('score.xml')?.async('string');
  if (!xml) {
    throw new Error('river-flows-in-you.mxl missing score.xml');
  }
  return xml;
}

function fingerOf(value: ManualFingeringValue): Finger {
  return typeof value === 'number' ? value : value.finger;
}

function scriptKeySet(script: PlaybackScript): Set<string> {
  const keys = new Set<string>();
  for (const step of script) {
    for (const note of step.notes) {
      keys.add(fingeringKey(step.onset, note.hand, note.midi));
    }
    step.graceBefore?.forEach((grace, graceIndex) => {
      keys.add(
        graceFingeringKey(step.onset, grace.hand, grace.midi, graceIndex),
      );
    });
  }
  return keys;
}

function integrity(script: PlaybackScript, manuals: ManualFingeringMap) {
  const keys = scriptKeySet(script);
  let resolved = 0;
  let orphaned = 0;
  const orphanSample: string[] = [];
  for (const key of Object.keys(manuals)) {
    if (keys.has(key)) {
      resolved += 1;
    } else {
      orphaned += 1;
      if (orphanSample.length < 8) {
        orphanSample.push(key);
      }
    }
  }
  return { resolved, orphaned, orphanSample };
}

type Agreement = {
  overall: number;
  byHand: Record<Hand, number>;
  compared: number;
  comparedByHand: Record<Hand, number>;
};

function agreement(
  predicted: PlaybackScript,
  manuals: ManualFingeringMap,
): Agreement {
  let overall = 0;
  let compared = 0;
  const byHand: Record<Hand, number> = { L: 0, R: 0 };
  const comparedByHand: Record<Hand, number> = { L: 0, R: 0 };

  const score = (
    key: string,
    hand: Hand,
    finger: Finger | null | undefined,
  ) => {
    const gold = manuals[key as keyof typeof manuals];
    if (gold === undefined || finger == null) {
      return;
    }
    compared += 1;
    comparedByHand[hand] += 1;
    if (finger === fingerOf(gold)) {
      overall += 1;
      byHand[hand] += 1;
    }
  };

  for (const step of predicted) {
    step.graceBefore?.forEach((grace, graceIndex) => {
      score(
        graceFingeringKey(step.onset, grace.hand, grace.midi, graceIndex),
        grace.hand,
        grace.finger,
      );
    });
    for (const note of step.notes) {
      score(
        fingeringKey(step.onset, note.hand, note.midi),
        note.hand,
        note.finger,
      );
    }
  }

  return { overall, byHand, compared, comparedByHand };
}

describe('river-flows fingering comparison (PRIMARY gate)', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const modelPath = join(__dirname, '../../public/fingering_model.onnx');

  afterAll(async () => {
    await disposeFingeringModel();
  });

  it('keeps the gold map intact against the current parse (onset-key integrity)', async () => {
    expect(GOLD_KEYS.length).toBe(GOLD_TOTAL);
    expect(Object.keys(GOLD).length).toBe(GOLD_TOTAL);

    const xml = await loadRiverXml();
    const { script } = parseMusicXmlToScript(xml);
    const { resolved, orphaned, orphanSample } = integrity(script, GOLD);

    expect(resolved).toBe(GOLD_TOTAL);
    expect(orphaned).toBe(0);
    expect(orphanSample).toEqual([]);
  });

  it('holds DP-only regression floors with anchors stripped', async () => {
    await disposeFingeringModel();
    const xml = await loadRiverXml();
    const { script, scoreTiming } = parseMusicXmlToScript(xml);

    // Bare parse only — do not applyManualFingerings (would collapse allowedFingers).
    const predicted = await predictFingering(script, {
      divisionsPerQuarter: scoreTiming.divisionsPerQuarter,
      mlCostWeight: 0,
      overrideScore: true,
    });

    const { resolved, orphaned } = integrity(script, GOLD);
    expect(resolved).toBe(GOLD_TOTAL);
    expect(orphaned).toBe(0);

    const result = agreement(predicted, GOLD);
    expect(result.compared).toBe(GOLD_TOTAL);
    expect(result.comparedByHand.L).toBe(GOLD_LH);
    expect(result.comparedByHand.R).toBe(GOLD_RH);

    expect(result.overall).toBeGreaterThanOrEqual(FLOOR_OVERALL);
    expect(result.byHand.L).toBeGreaterThanOrEqual(FLOOR_LH);
    expect(result.byHand.R).toBeGreaterThanOrEqual(FLOOR_RH);

    console.log(
      `river-flows PRIMARY (DP-only): ${result.overall}/${GOLD_TOTAL}` +
        ` (L ${result.byHand.L}/${GOLD_LH}, R ${result.byHand.R}/${GOLD_RH})` +
        ` floors ${FLOOR_OVERALL}/${FLOOR_LH}/${FLOOR_RH}`,
    );
  }, 120_000);

  it('keeps ML+DP within epsilon of DP-only at the shipped weight', async () => {
    expect(ML_COST_WEIGHT).toBe(150);

    const xml = await loadRiverXml();
    const { script, scoreTiming } = parseMusicXmlToScript(xml);
    const options = {
      divisionsPerQuarter: scoreTiming.divisionsPerQuarter,
      overrideScore: true as const,
    };

    await disposeFingeringModel();
    const dpOnly = await predictFingering(script, {
      ...options,
      mlCostWeight: 0,
    });
    const dp = agreement(dpOnly, GOLD);
    expect(dp.overall).toBeGreaterThanOrEqual(FLOOR_OVERALL);

    await initFingeringModel(modelPath, { force: true });
    const withMl = await predictFingering(script, {
      ...options,
      mlCostWeight: ML_COST_WEIGHT,
    });
    const ml = agreement(withMl, GOLD);

    console.log(
      `river-flows PRIMARY: DP-only ${dp.overall}/${GOLD_TOTAL},` +
        ` ML+DP at weight ${ML_COST_WEIGHT}: ${ml.overall}/${GOLD_TOTAL}` +
        ` (epsilon ${ML_EPSILON})`,
    );

    // Measured 2026-09-17: ML helped by +6 (381 vs 375). Floor = DP − epsilon
    // so ML must not regress far below pure DP on this both-hands gold set.
    expect(ml.overall).toBeGreaterThanOrEqual(dp.overall - ML_EPSILON);
    expect(ml.overall).toBeGreaterThanOrEqual(FLOOR_OVERALL - ML_EPSILON);
  }, 120_000);
});
