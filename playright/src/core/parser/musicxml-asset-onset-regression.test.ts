import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { MusicXMLIngestor } from './MusicXMLIngestor.ts';
import {
  MusicXMLNormalizer,
  resolveCanonicalDivisionsPerQuarter,
} from './MusicXMLNormalizer.ts';
import type { NormalizedElement } from './MusicXMLNormalizer.ts';
import { parseMusicXmlToScript } from './index.ts';

/**
 * Per-asset onset regression coverage for the P0-1 cumulative-onset drift bug.
 * morns previously ended at onset 643 instead of 480 (+34%) due to a tie/chord
 * cursor bug in MusicXMLMapper.ts (tie-stop advancing before same-beat chord
 * tones attach, and tie-merge double counting). morns was not covered by any
 * automated test despite proving the bug, so it is asserted explicitly here.
 *
 * The gate compares the parser's end-of-walk timeline cursor (including rests)
 * against an independent XML division walk — not max(playable note end), which
 * can fall short when a score ends with rests after the last pitched note
 * (unwelcome-school: cursor 3168 vs last note end 3144).
 */

const here = dirname(fileURLToPath(import.meta.url));

interface AssetExpectation {
  path: string;
  mxl?: boolean;
  /** Snapshot captured post-P0-1 fix. Update only for an intentional parser change. */
  expectedStepCount: number;
}

const ASSETS: Record<string, AssetExpectation> = {
  'constant-moderato': {
    path: '../../assets/constant-moderato.musicxml',
    expectedStepCount: 626,
  },
  'glimpse-of-us': {
    path: '../../assets/glimpse-of-us-joji.mxl',
    mxl: true,
    expectedStepCount: 481,
  },
  'hoyo-mix': {
    path: '../../assets/if-i-can-stop-one-heart-from-breaking-hoyo-mix.musicxml',
    expectedStepCount: 627,
  },
  tetoris: {
    path: '../../assets/tetoris.mxl',
    mxl: true,
    expectedStepCount: 849,
  },
  'unwelcome-school': {
    path: '../../assets/unwelcome-school.mxl',
    mxl: true,
    expectedStepCount: 625,
  },
  morns: {
    path: '../../assets/morns-like-these-honkai-star-rail.musicxml',
    expectedStepCount: 123,
  },
  chase: {
    path: '../../assets/chase-setsuna-yuki.musicxml',
    expectedStepCount: 101,
  },
  'river-flows': {
    path: '../../assets/river-flows-in-you.mxl',
    mxl: true,
    expectedStepCount: 544,
  },
  fanfare: {
    path: '../../assets/playright-fanfare.musicxml',
    expectedStepCount: 9,
  },
  kyrie: {
    path: '../../assets/kyrie-eleison.mxl',
    mxl: true,
    expectedStepCount: 60,
  },
};

function canonicalDuration(
  duration: number,
  divisionsAtNote: number,
  canon: number,
): number {
  if (duration === 0) return 0;
  if (divisionsAtNote <= 0) return duration;
  return Math.round((duration * canon) / divisionsAtNote);
}

/**
 * Reconstructs the raw MusicXML cursor total (backup/forward/note duration,
 * chord tones excluded) independently of MusicXMLMapper.ts, so this is a real
 * derived expectation rather than a restatement of the parser's own output.
 */
function xmlDivisionTotal(elements: NormalizedElement[], canon: number): number {
  let cursor = 0;
  for (const element of elements) {
    if (element.type === 'backup') {
      cursor = Math.max(
        0,
        cursor - canonicalDuration(element.duration, element.divisionsAtNote, canon),
      );
    } else if (element.type === 'forward') {
      cursor += canonicalDuration(element.duration, element.divisionsAtNote, canon);
    } else if (element.type === 'note') {
      if (!element.isGrace && !element.isChord) {
        let advance = canonicalDuration(
          element.duration,
          element.divisionsAtNote,
          canon,
        );
        if (advance === 0 && element.isRest && element.isMeasureRest) {
          advance = canonicalDuration(
            (element.timeBeats * element.divisionsAtNote * 4) / element.timeBeatType,
            element.divisionsAtNote,
            canon,
          );
        }
        cursor += advance;
      }
    }
  }
  return cursor;
}

function playableNoteElementCount(elements: NormalizedElement[]): number {
  return elements.filter(
    (element) =>
      element.type === 'note' &&
      !element.isGrace &&
      !element.isRest &&
      element.hasPlayablePitch,
  ).length;
}

async function loadAssetXml(expectation: AssetExpectation): Promise<string> {
  const assetPath = join(here, expectation.path);
  if (!expectation.mxl) {
    return readFileSync(assetPath, 'utf8');
  }

  const archive = await JSZip.loadAsync(readFileSync(assetPath));
  const scoreXml = archive.file('score.xml');
  if (!scoreXml) {
    throw new Error(`${expectation.path} missing score.xml`);
  }

  return scoreXml.async('string');
}

describe('per-asset parser onset regression', () => {
  for (const [name, expectation] of Object.entries(ASSETS)) {
    it(`${name}: timeline cursor matches XML division total, step count in range`, async () => {
      const xml = await loadAssetXml(expectation);
      const raw = MusicXMLIngestor.ingest(xml);
      const { partElements } = MusicXMLNormalizer.normalize(raw);
      const flatElements = partElements.flat();
      const canon = resolveCanonicalDivisionsPerQuarter(flatElements);

      const expectedFinalOnset = Math.max(
        ...partElements.map((part) => xmlDivisionTotal(part, canon)),
      );
      const stepCountCeiling = playableNoteElementCount(flatElements);

      const { script, scoreTiming } = parseMusicXmlToScript(xml);
      const maxNoteEnd = Math.max(
        ...script.flatMap((step) =>
          step.notes.map((note) => step.onset + (note.durationDivisions ?? 0)),
        ),
      );
      const stepCount = script.length;
      const maxOnset = script[script.length - 1].onset;

      console.log(
        `${name.padEnd(16)}| expected ${String(expectedFinalOnset).padEnd(5)}` +
          `| cursor ${String(scoreTiming.totalTimelineDivisions).padEnd(5)}` +
          `| maxNoteEnd ${String(maxNoteEnd).padEnd(5)}| steps ${String(stepCount).padEnd(4)}` +
          `(ceiling ${String(stepCountCeiling).padEnd(4)})| maxOnset ${maxOnset}`,
      );

      expect(scoreTiming.totalTimelineDivisions).toBe(expectedFinalOnset);
      expect(maxNoteEnd).toBeLessThanOrEqual(expectedFinalOnset);

      if (name === 'morns') {
        expect(scoreTiming.totalTimelineDivisions).toBe(480);
      }

      expect(stepCount).toBeGreaterThan(0);
      expect(stepCount).toBeLessThanOrEqual(stepCountCeiling);
      expect(stepCount).toBe(expectation.expectedStepCount);

      expect(maxOnset).toBeLessThanOrEqual(scoreTiming.totalTimelineDivisions);
    });
  }
});
