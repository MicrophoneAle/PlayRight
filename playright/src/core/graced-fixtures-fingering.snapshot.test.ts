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
 * Gold-fingering snapshot gate for the four fixtures with grace notes
 * (Phase 2: DP inclusion of graces shifts nearby main-note fingerings - a
 * pianist genuinely fingers around an ornament differently, verified
 * phrase/seed-chain-local to the triggering grace before this snapshot was
 * pinned; see the Phase 2 report for the full before/after diff). Any future
 * change to the DP that moves fingering on these pieces will show up as a
 * snapshot diff here, forcing a deliberate review rather than a silent shift.
 *
 * Pure DP (mlCostWeight: 0) for determinism - no ONNX model dependency.
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
