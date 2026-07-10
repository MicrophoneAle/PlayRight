import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseMusicXmlToScript } from './index.ts';
import type { ParseMusicXmlResult } from '../../types/index.ts';

/**
 * R0 gate: repeat/ending resolution into PlaybackOrder.
 *
 * unwelcome-school is the only bundled asset with repeat barlines (four
 * regions, volta endings incl. same-measure start+stop, discontinue type, and
 * a final repeat with no ending 2). The expected measure walk below is
 * hand-derived from the score's barline markup:
 *
 *   1-16, 9-15, 17-25, 18-22, 26-36, 29-35, 37-61, 54-58, 62-66
 *
 * Every other bundled asset has zero repeat/ending/sound-jump markup, so
 * PlaybackOrder must be the exact identity mapping for them — the permanent
 * guard that this feature can never perturb non-repeat scores.
 */

const here = dirname(fileURLToPath(import.meta.url));

interface PlaybackOrderEntryShape {
  stepIndex: number;
  playbackOnset: number;
  passIndex: number;
}

function getPlaybackOrder(result: ParseMusicXmlResult): PlaybackOrderEntryShape[] {
  const playbackOrder = (
    result as ParseMusicXmlResult & { playbackOrder?: PlaybackOrderEntryShape[] }
  ).playbackOrder;
  expect(playbackOrder, 'parse result must ship playbackOrder').toBeDefined();
  return playbackOrder!;
}

async function loadAssetXml(relativePath: string, mxl: boolean): Promise<string> {
  const assetPath = join(here, relativePath);
  if (!mxl) {
    return readFileSync(assetPath, 'utf8');
  }

  const archive = await JSZip.loadAsync(readFileSync(assetPath));
  const scoreXml = archive.file('score.xml');
  if (!scoreXml) {
    throw new Error(`${relativePath} missing score.xml`);
  }

  return scoreXml.async('string');
}

/** Inclusive measure-number range. */
function measureRange(start: number, end: number): number[] {
  const result: number[] = [];
  for (let measure = start; measure <= end; measure += 1) {
    result.push(measure);
  }
  return result;
}

const UNWELCOME_EXPECTED_MEASURE_WALK = [
  ...measureRange(1, 16),
  ...measureRange(9, 15),
  ...measureRange(17, 25),
  ...measureRange(18, 22),
  ...measureRange(26, 36),
  ...measureRange(29, 35),
  ...measureRange(37, 61),
  ...measureRange(54, 58),
  ...measureRange(62, 66),
];

const REPLAYED_MEASURES = new Set([
  ...measureRange(9, 15),
  ...measureRange(18, 22),
  ...measureRange(29, 35),
  ...measureRange(54, 58),
]);

const IDENTITY_ASSETS: Array<[string, string, boolean]> = [
  ['chase-setsuna-yuki', '../../assets/chase-setsuna-yuki.musicxml', false],
  ['constant-moderato', '../../assets/constant-moderato.musicxml', false],
  ['hoyo-mix', '../../assets/if-i-can-stop-one-heart-from-breaking-hoyo-mix.musicxml', false],
  ['morns-like-these', '../../assets/morns-like-these-honkai-star-rail.musicxml', false],
  ['playright-fanfare', '../../assets/playright-fanfare.musicxml', false],
  ['glimpse-of-us-joji', '../../assets/glimpse-of-us-joji.mxl', true],
  ['kyrie-eleison', '../../assets/kyrie-eleison.mxl', true],
  ['river-flows-in-you', '../../assets/river-flows-in-you.mxl', true],
  ['tetoris', '../../assets/tetoris.mxl', true],
];

describe('R0 PlaybackOrder: unwelcome-school repeat resolution', () => {
  it('resolves the hand-derived measure walk through all four repeat regions', async () => {
    const xml = await loadAssetXml('../../assets/unwelcome-school.mxl', true);
    const result = parseMusicXmlToScript(xml);
    const { script } = result;
    const playbackOrder = getPlaybackOrder(result);

    // Collapse consecutive same-measure entries into the measure walk.
    const measureWalk: number[] = [];
    for (const entry of playbackOrder) {
      const measureNumber = script[entry.stepIndex].measureNumber;
      if (measureWalk[measureWalk.length - 1] !== measureNumber) {
        measureWalk.push(measureNumber);
      }
    }

    expect(measureWalk).toEqual(UNWELCOME_EXPECTED_MEASURE_WALK);
  });

  it('entry count = document steps + one extra visit per step in replayed measures', async () => {
    const xml = await loadAssetXml('../../assets/unwelcome-school.mxl', true);
    const result = parseMusicXmlToScript(xml);
    const { script } = result;
    const playbackOrder = getPlaybackOrder(result);

    const replayedStepCount = script.filter((step) =>
      REPLAYED_MEASURES.has(step.measureNumber),
    ).length;

    expect(playbackOrder.length).toBe(script.length + replayedStepCount);

    // Each document step appears at least once; replayed steps exactly twice.
    const visitCounts = new Map<number, number>();
    for (const entry of playbackOrder) {
      visitCounts.set(entry.stepIndex, (visitCounts.get(entry.stepIndex) ?? 0) + 1);
    }
    for (const step of script) {
      const expected = REPLAYED_MEASURES.has(step.measureNumber) ? 2 : 1;
      expect(visitCounts.get(step.order) ?? 0).toBe(expected);
    }
  });

  it('playbackOnset strictly increases and passIndex counts visits per step', async () => {
    const xml = await loadAssetXml('../../assets/unwelcome-school.mxl', true);
    const result = parseMusicXmlToScript(xml);
    const playbackOrder = getPlaybackOrder(result);

    for (let index = 1; index < playbackOrder.length; index += 1) {
      expect(playbackOrder[index].playbackOnset).toBeGreaterThan(
        playbackOrder[index - 1].playbackOnset,
      );
    }

    const seen = new Map<number, number>();
    for (const entry of playbackOrder) {
      const priorVisits = seen.get(entry.stepIndex) ?? 0;
      expect(entry.passIndex).toBe(priorVisits);
      seen.set(entry.stepIndex, priorVisits + 1);
    }
  });
});

describe('R0 PlaybackOrder: identity guard for non-repeat assets', () => {
  for (const [name, path, mxl] of IDENTITY_ASSETS) {
    it(`${name}: PlaybackOrder is the exact identity mapping`, async () => {
      const xml = await loadAssetXml(path, mxl);
      const result = parseMusicXmlToScript(xml);
      const playbackOrder = getPlaybackOrder(result);

      expect(playbackOrder).toEqual(
        result.script.map((step, stepIndex) => ({
          stepIndex,
          playbackOnset: step.onset,
          passIndex: 0,
        })),
      );
    });
  }
});
