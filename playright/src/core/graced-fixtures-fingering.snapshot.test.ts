import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMusicXmlToScript } from './parser/index.ts';
import { predictFingering } from './fingeringPredictor.ts';

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

/**
 * Gold-fingering snapshot gate for the four fixtures with grace notes. The
 * Phase 2 DP inclusion of graces shifts nearby main-note fingerings because
 * a pianist genuinely fingers around an ornament differently. That effect
 * was verified phrase/seed-chain-local to the triggering grace before this
 * snapshot was pinned (see the Phase 2 report for the full before/after
 * diff). Any future change to the DP that moves fingering on these pieces
 * will show up as a snapshot diff here, forcing a deliberate review rather
 * than a silent shift.
 *
 * Re-pinned 2026-07-27 after rest splits switched from onset-gap to sound-gap
 * (Runaway RH octaves were false-split into solo finger-5 phrases) and a
 * narrow OPEN_TRIAD_SKIP_BONUS for descending 3→1 thirds (5-3-1 broken
 * chords). Chase RH gold held at 45/59; review the diff before accepting
 * further gold moves.
 *
 * Re-pinned 2026-07-28 after fixing a cost-curve inversion in
 * isScaleOrArpeggioCrossing. Gate-rejected crossings fell through to a branch
 * that only applies OUT_OF_SEQUENCE_PENALTY when absInterval <=
 * OUT_OF_SEQUENCE_MAX_INTERVAL (5), so anything wider got just
 * CONTRACTION_BASE + 0.5*interval. The curve went non-monotonic with a ~500x
 * cliff - a 7-semitone thumb turn cost 8.5 against 41 for a 3-semitone one and
 * 4007.5 for a 5-semitone one - making wide "crossings" cheaper than narrow
 * ones, the opposite of both piano technique and the gate's own intent. The
 * fix prices crossing SHAPES at every width (the leap exemption is for genuine
 * repositions, which a too-wide thumb turn is not). These snapshots reflect
 * the corrected monotonic curve. Chase RH gold held at 45/59.
 *
 * river-flows-in-you carries the largest diff (293/840). That is driven by the
 * gate's absInterval <= 4 window, NOT by its finger clause: widening the
 * window to <= 12 drops it to 130, while changing the finger threshold moves
 * nothing. Admitting finger 2 as a crossing finger was measured and rejected -
 * it raises churn on all four pieces (river-flows 293 -> 323), breaks the
 * out-of-sequence invariant with 7 genuine LH violations in river-flows
 * (descending pitch with descending finger numbers, no thumb involved), and
 * produces exactly the cramped substitutions the scale rule exists to prevent
 * (m23 RH arpeggio 1,3,1,4 -> 1,2,1,3).
 *
 * Thumb-under-to-2 IS idiomatic in broken-chord figuration, so the ideal
 * behaviour differs between scalar and arpeggiated passages. Distinguishing
 * them needs harmonic context (is this figure spelling a chord?) that the DP
 * does not currently model - interval width alone does not separate an
 * arpeggio from a leap. Noted as a possible future feature, not a pending bug.
 *
 * Runs pure DP (mlCostWeight: 0) for determinism, with no ONNX model dependency.
 */
describe('graced fixtures gold fingering snapshot', () => {
  it.each([
    { label: 'morns-like-these', load: () => loadXml('morns-like-these-honkai-star-rail.musicxml') },
    { label: 'constant-moderato', load: () => loadXml('constant-moderato.musicxml') },
    { label: 'unwelcome-school', load: () => loadMxl('unwelcome-school.mxl') },
    { label: 'river-flows-in-you', load: () => loadMxl('river-flows-in-you.mxl') },
  ])('$label: main-note and grace fingerings match the pinned snapshot', async ({ label, load }) => {
    const xml = await load();
    const { script, scoreTiming } = parseMusicXmlToScript(xml);
    const predicted = await predictFingering(script, {
      divisionsPerQuarter: scoreTiming.divisionsPerQuarter,
      mlCostWeight: 0,
    });

    const fingerings: string[] = [];
    predicted.forEach((step) => {
      for (const note of step.notes) {
        fingerings.push(`m${step.measureNumber} ${note.hand} midi${note.midi} -> ${note.finger}`);
      }
      step.graceBefore?.forEach((grace, graceIndex) => {
        fingerings.push(
          `m${step.measureNumber} ${grace.hand} grace${graceIndex} midi${grace.midi} -> ${grace.finger ?? null}`,
        );
      });
    });

    await expect(fingerings.join('\n')).toMatchFileSnapshot(
      `./__snapshots__/graced-fixtures/${label}.txt`,
    );
  });
});
