import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
 */

const here = dirname(fileURLToPath(import.meta.url));

interface AssetExpectation {
  path: string;
  /** Snapshot captured 2026-07-03 post-P0-1 fix. Update only for an intentional
   *  parser change to chord/tie grouping; a drift here is a real regression. */
  expectedStepCount: number;
}

const ASSETS: Record<string, AssetExpectation> = {
  morns: {
    path: '../../assets/morns-like-these-honkai-star-rail.musicxml',
    expectedStepCount: 123,
  },
  chase: {
    path: '../../assets/chase-setsuna-yuki.musicxml',
    expectedStepCount: 101,
  },
  fanfare: {
    path: '../../assets/playright-fanfare.musicxml',
    expectedStepCount: 9,
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
    } else if (!element.isGrace && !element.isChord) {
      let advance = canonicalDuration(element.duration, element.divisionsAtNote, canon);
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

describe('per-asset parser onset regression', () => {
  for (const [name, expectation] of Object.entries(ASSETS)) {
    it(`${name}: final onset matches XML division total, step count in range`, () => {
      const xml = readFileSync(join(here, expectation.path), 'utf8');
      const raw = MusicXMLIngestor.ingest(xml);
      const { partElements } = MusicXMLNormalizer.normalize(raw);
      const flatElements = partElements.flat();
      const canon = resolveCanonicalDivisionsPerQuarter(flatElements);

      const expectedFinalOnset = Math.max(
        ...partElements.map((part) => xmlDivisionTotal(part, canon)),
      );
      // Derived ceiling: a step can never contain more notes than there are raw
      // playable note elements, so step count can never exceed this count.
      const stepCountCeiling = playableNoteElementCount(flatElements);

      const { script } = parseMusicXmlToScript(xml);
      const finalOnset = Math.max(
        ...script.flatMap((step) =>
          step.notes.map((note) => step.onset + (note.durationDivisions ?? 0)),
        ),
      );
      const stepCount = script.length;
      const maxOnset = script[script.length - 1].onset;

      console.log(
        `${name.padEnd(8)}| expected final onset ${String(expectedFinalOnset).padEnd(6)}` +
          `| actual ${String(finalOnset).padEnd(6)}| steps ${String(stepCount).padEnd(5)}` +
          `(ceiling ${String(stepCountCeiling).padEnd(5)})| maxOnset ${maxOnset}`,
      );

      expect(finalOnset).toBe(expectedFinalOnset);

      if (name === 'morns') {
        // Regression guard for the P0-1 tie/chord cursor bug: pre-fix this was 643 (+34%).
        expect(finalOnset).toBe(480);
      }

      // Step count "range": the upper bound is derived from the raw XML (see
      // stepCountCeiling above); the exact count is pinned to the post-P0-1
      // snapshot because deriving it precisely from XML would mean
      // re-deriving the mapper's own chord/tie-merge logic.
      expect(stepCount).toBeGreaterThan(0);
      expect(stepCount).toBeLessThanOrEqual(stepCountCeiling);
      expect(stepCount).toBe(expectation.expectedStepCount);

      // Derived: the last step must start before the timeline ends, since it
      // has positive duration.
      expect(maxOnset).toBeLessThan(finalOnset);
    });
  }
});
