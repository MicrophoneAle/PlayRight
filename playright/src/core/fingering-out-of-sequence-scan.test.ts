import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMusicXmlToScript } from './parser/index.ts';
import {
  extractHandTimelines,
  PHRASE_MIN_ONSET_GAP_QUARTERS,
  predictFingering,
  transitionCost,
} from './fingeringPredictor.ts';
import type { NoteEvent } from './fingeringPredictor.ts';
import type { Hand } from '../types/index.ts';

function loadXml(name: string): string {
  return readFileSync(new URL(`../assets/${name}`, import.meta.url), 'utf8');
}

async function loadMxl(name: string): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const buffer = readFileSync(new URL(`../assets/${name}`, import.meta.url));
  const archive = await JSZip.loadAsync(buffer);
  const scoreXml = await archive.file('score.xml')?.async('string');
  if (!scoreXml) throw new Error(`${name} missing score.xml`);
  return scoreXml;
}

const FIXTURES: Array<{ label: string; load: () => Promise<string> | string }> = [
  { label: 'morns-like-these', load: () => loadXml('morns-like-these-honkai-star-rail.musicxml') },
  { label: 'chase-setsuna-yuki', load: () => loadXml('chase-setsuna-yuki.musicxml') },
  { label: 'playright-fanfare', load: () => loadXml('playright-fanfare.musicxml') },
  { label: 'constant-moderato', load: () => loadXml('constant-moderato.musicxml') },
  {
    label: 'if-i-can-stop-one-heart',
    load: () => loadXml('if-i-can-stop-one-heart-from-breaking-hoyo-mix.musicxml'),
  },
  { label: 'tetoris', load: () => loadMxl('tetoris.mxl') },
  { label: 'unwelcome-school', load: () => loadMxl('unwelcome-school.mxl') },
  { label: 'kyrie-eleison', load: () => loadMxl('kyrie-eleison.mxl') },
  { label: 'glimpse-of-us-joji', load: () => loadMxl('glimpse-of-us-joji.mxl') },
  { label: 'river-flows-in-you', load: () => loadMxl('river-flows-in-you.mxl') },
];

/**
 * Recreates the "8-piece zero-out-of-sequence-violation scan" referenced only
 * in a code comment (transitionCost's CROSSING_ONTO_BLACK_COST doc, "chase RH
 * gold fell 32/59 -> 22/59") as a durable, automated test across all 10
 * bundled fixtures (the original 8 plus the 2 assets added since).
 *
 * A "violation" is transitionCost's full OUT_OF_SEQUENCE_PENALTY branch
 * (direction mismatch, small interval, not a legal crossing, neither finger
 * a thumb) - NOT the smaller THUMB_PIVOT_REVERSAL_COST case, which the DP's
 * own docs treat as tolerated ("a single pivot stays affordable"). The
 * threshold sits strictly between the pivot cost ceiling (~4010: 4000 +
 * small contraction/gap terms) and the full-penalty floor (~8000), so it
 * only fires on genuine violations.
 */
const VIOLATION_COST_THRESHOLD = 6000;

function onsetGroupKeyForScan(event: NoteEvent): string {
  return event.kind === 'grace'
    ? `g:${event.stepIndex}:${event.graceIndex}`
    : `m:${event.stepIndex}`;
}

interface FingeredEvent {
  event: NoteEvent;
  finger: number | null;
}

interface Representative {
  midi: number;
  onset: number;
  finger: number | null;
  /** Onset group size this representative came from - see note below. */
  groupSize: number;
}

/** Mirrors fingerPhraseWithChords' representative selection (RH = top note, LH = bottom note per onset). */
function groupRepresentatives(events: FingeredEvent[], hand: Hand): Representative[] {
  const groups = new Map<string, FingeredEvent[]>();
  const order: string[] = [];

  for (const entry of events) {
    const key = onsetGroupKeyForScan(entry.event);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(entry);
  }

  return order.map((key) => {
    const group = [...groups.get(key)!].sort((a, b) => a.event.midi - b.event.midi);
    const repIndex = hand === 'R' ? group.length - 1 : 0;
    const rep = group[repIndex];
    return { midi: rep.event.midi, onset: rep.event.onset, finger: rep.finger, groupSize: group.length };
  });
}

interface Violation {
  index: number;
  midi: [number, number];
  finger: [number, number];
  cost: number;
}

/**
 * Only a genuine rest gap (onset gap >= PHRASE_MIN_ONSET_GAP_DIVISIONS) makes
 * the DP treat a transition as free repositioning (segmentIntoPhrases splits
 * there AND predictFingersForHand's prevContext seeding stops there too).
 * Any other adjacent pair - same phrase, or a phrase split purely by frame
 * span / directional run with no rest - is genuinely scored via transitionCost
 * (directly, or via prevContext seeding at the boundary), so it must be
 * included in the scan or real violations at those boundaries go undetected.
 *
 * Chord onsets (groupSize > 1) are excluded on EITHER side of the pair: a
 * chord representative's finger is forced by assignChordFingers (interval-
 * optimal per chord, e.g. an open fifth wants finger 1-5 every time it
 * recurs) via authoredFinger, not chosen freely by fingerPhrase's melodic DP
 * - allowedFingers() collapses to that single forced value, so transitionCost
 * has no alternative to minimize against and a "violation" there reflects
 * chord-internal spacing, not a melodic in-sequence failure. The in-sequence
 * rule (and this scan) targets single-note melodic runs, matching how the
 * chase RH gold-compare target sequence is itself single notes only.
 */
function countOutOfSequenceViolations(
  representatives: Representative[],
  hand: Hand,
  divisionsPerQuarter: number,
): { violations: Violation[]; checked: number } {
  const violations: Violation[] = [];
  let checked = 0;

  // Same per-piece scaling the predictor itself now uses (2026-07-18 wiring
  // fix): the old raw 480-division constant never fired at real
  // divisionsPerQuarter values (1-12), so this exclusion - documented above
  // as the scan's design since day one - had silently never engaged. Pairs
  // across a genuine rest split are free repositions in the DP (no
  // prevContext seeding) and were never meant to be scanned.
  const restGapDivisions = PHRASE_MIN_ONSET_GAP_QUARTERS * divisionsPerQuarter;

  for (let i = 1; i < representatives.length; i += 1) {
    const prev = representatives[i - 1];
    const cur = representatives[i];
    if (prev.finger === null || cur.finger === null) {
      continue;
    }
    if (prev.groupSize > 1 || cur.groupSize > 1) {
      continue;
    }
    if (cur.onset - prev.onset >= restGapDivisions) {
      continue;
    }

    checked += 1;
    const cost = transitionCost(
      hand,
      prev.finger as 1 | 2 | 3 | 4 | 5,
      prev.midi,
      cur.finger as 1 | 2 | 3 | 4 | 5,
      cur.midi,
    );

    if (cost >= VIOLATION_COST_THRESHOLD) {
      violations.push({ index: i, midi: [prev.midi, cur.midi], finger: [prev.finger, cur.finger], cost });
    }
  }

  return { violations, checked };
}

describe('fingering out-of-sequence violation scan (durable, all 10 fixtures)', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.label}: zero out-of-sequence violations (pure DP)`, async () => {
      const xml = await fixture.load();
      const { script, scoreTiming } = parseMusicXmlToScript(xml);
      const predicted = await predictFingering(script, {
        divisionsPerQuarter: scoreTiming.divisionsPerQuarter,
        mlCostWeight: 0,
      });

      const timelines = extractHandTimelines(predicted);
      const report: string[] = [];
      let totalChecked = 0;

      for (const hand of ['L', 'R'] as Hand[]) {
        const withFingers: FingeredEvent[] = timelines[hand].map((event) => {
          const step = predicted[event.stepIndex];
          const finger =
            event.kind === 'grace'
              ? (step.graceBefore?.[event.graceIndex ?? -1]?.finger ?? null)
              : (step.notes.find((n) => n.hand === hand && n.midi === event.midi)?.finger ?? null);
          return { event, finger: finger ?? null };
        });

        const representatives = groupRepresentatives(withFingers, hand);
        const { violations, checked } = countOutOfSequenceViolations(
          representatives,
          hand,
          scoreTiming.divisionsPerQuarter,
        );
        totalChecked += checked;
        for (const v of violations) {
          report.push(
            `${hand} onset#${v.index}: midi ${v.midi[0]}->${v.midi[1]} finger ${v.finger[0]}->${v.finger[1]} cost=${v.cost}`,
          );
        }
      }

      console.log(`[violation-scan] ${fixture.label}: checked ${totalChecked} melodic transitions`);
      expect(report, report.join('\n')).toEqual([]);
      expect(totalChecked).toBeGreaterThan(0);
    });
  }
});
