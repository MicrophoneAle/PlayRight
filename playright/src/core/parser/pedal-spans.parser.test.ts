import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMusicXmlToScript } from './index.ts';
import type { ParseMusicXmlResult, PedalSpan } from '../../types/index.ts';
import {
  DANGLING_PEDAL_START_MUSICXML,
  PEDAL_ACROSS_REPEAT_MUSICXML,
  PEDAL_CHANGE_MUSICXML,
  PEDAL_CONFLICTING_PARTS_MUSICXML,
  PEDAL_DISCONTINUE_RESUME_MUSICXML,
  PEDAL_DUPLICATED_PARTS_MUSICXML,
  PEDAL_OFFSET_MUSICXML,
  PEDAL_SECOND_PART_ONLY_MUSICXML,
  PEDAL_START_BEFORE_STOP_SAME_ONSET_MUSICXML,
  STRAY_PEDAL_STOP_MUSICXML,
} from './__fixtures__/pedal.musicxml.ts';

/**
 * Pedal phase A: detection only. scoreTiming.pedalSpans is written here and
 * read by nothing downstream, so these tests check span structure, warnings,
 * and zero perturbation of everything else the parser produces.
 */

function loadXml(name: string): string {
  return readFileSync(new URL(`../../assets/${name}`, import.meta.url), 'utf8');
}

async function loadMxl(name: string): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const buffer = readFileSync(new URL(`../../assets/${name}`, import.meta.url));
  const archive = await JSZip.loadAsync(buffer);
  const scoreFile = Object.keys(archive.files).find(
    (path) => path.endsWith('.xml') && !path.startsWith('META-INF'),
  );
  const scoreXml = scoreFile ? await archive.file(scoreFile)?.async('string') : undefined;
  if (!scoreXml) throw new Error(`${name} missing score xml`);
  return scoreXml;
}

/** Spans in quarter notes (synthetic fixtures use divisions=1, so this is identity there). */
function spansOf(result: ParseMusicXmlResult): Array<[number, number]> {
  return (result.scoreTiming.pedalSpans ?? []).map((span: PedalSpan) => [
    span.startOnset,
    span.endOnset,
  ]);
}

function pedalWarnings(result: ParseMusicXmlResult): string[] {
  return result.warnings.filter((warning) => /pedal/i.test(warning));
}

/** Remove every `<pedal .../>` tag - every bundled and synthetic fixture writes them self-closed. */
function stripPedalTags(xml: string): string {
  const stripped = xml.replace(/<pedal\b[^>]*\/>/g, '');
  if (stripped.includes('<pedal')) {
    throw new Error('non-self-closed <pedal> tag; extend stripPedalTags');
  }
  return stripped;
}

/** Everything the parser returns except the new pedal field and pedal warnings. */
function withoutPedal(result: ParseMusicXmlResult): unknown {
  const { pedalSpans: _pedalSpans, ...scoreTiming } = result.scoreTiming;
  return {
    script: result.script,
    playbackOrder: result.playbackOrder,
    scoreTiming,
    warnings: result.warnings.filter((warning) => !/pedal/i.test(warning)),
  };
}

const REAL_FIXTURES: Array<{
  name: string;
  load: () => Promise<string> | string;
  /** Pinned snapshot - update only for an intentional parser change. */
  expectedSpanCount: number;
  /** Spans that abut the previous one (a pedal change), pinned the same way. */
  expectedChangeCount: number;
}> = [
  { name: 'chase-setsuna-yuki', load: () => loadXml('chase-setsuna-yuki.musicxml'), expectedSpanCount: 22, expectedChangeCount: 21 },
  { name: 'clair-de-lune', load: () => loadMxl('clair-de-lune-debussy.mxl'), expectedSpanCount: 118, expectedChangeCount: 116 },
  { name: 'constant-moderato', load: () => loadXml('constant-moderato.musicxml'), expectedSpanCount: 82, expectedChangeCount: 75 },
  { name: 'glimpse-of-us', load: () => loadMxl('glimpse-of-us-joji.mxl'), expectedSpanCount: 107, expectedChangeCount: 105 },
  { name: 'hoyo-mix', load: () => loadXml('if-i-can-stop-one-heart-from-breaking-hoyo-mix.musicxml'), expectedSpanCount: 47, expectedChangeCount: 41 },
  { name: 'tetoris', load: () => loadMxl('tetoris.mxl'), expectedSpanCount: 141, expectedChangeCount: 131 },
  { name: 'kyrie-eleison', load: () => loadMxl('kyrie-eleison.mxl'), expectedSpanCount: 0, expectedChangeCount: 0 },
  { name: 'morns', load: () => loadXml('morns-like-these-honkai-star-rail.musicxml'), expectedSpanCount: 0, expectedChangeCount: 0 },
  { name: 'fanfare', load: () => loadXml('playright-fanfare.musicxml'), expectedSpanCount: 0, expectedChangeCount: 0 },
  { name: 'river-flows', load: () => loadMxl('river-flows-in-you.mxl'), expectedSpanCount: 0, expectedChangeCount: 0 },
  { name: 'unwelcome-school', load: () => loadMxl('unwelcome-school.mxl'), expectedSpanCount: 0, expectedChangeCount: 0 },
];

const SYNTHETIC_FIXTURES: Array<{ name: string; xml: string }> = [
  { name: 'change', xml: PEDAL_CHANGE_MUSICXML },
  { name: 'start-before-stop', xml: PEDAL_START_BEFORE_STOP_SAME_ONSET_MUSICXML },
  { name: 'dangling', xml: DANGLING_PEDAL_START_MUSICXML },
  { name: 'stray-stop', xml: STRAY_PEDAL_STOP_MUSICXML },
  { name: 'discontinue-resume', xml: PEDAL_DISCONTINUE_RESUME_MUSICXML },
  { name: 'offset', xml: PEDAL_OFFSET_MUSICXML },
  { name: 'second-part-only', xml: PEDAL_SECOND_PART_ONLY_MUSICXML },
  { name: 'conflicting-parts', xml: PEDAL_CONFLICTING_PARTS_MUSICXML },
  { name: 'duplicated-parts', xml: PEDAL_DUPLICATED_PARTS_MUSICXML },
  { name: 'across-repeat', xml: PEDAL_ACROSS_REPEAT_MUSICXML },
];

describe('pedal span detection', () => {
  it('models type="change" as two spans abutting at the change onset', () => {
    const result = parseMusicXmlToScript(PEDAL_CHANGE_MUSICXML);
    expect(spansOf(result)).toEqual([[0, 2], [2, 8]]);
    expect(pedalWarnings(result)).toEqual([]);
  });

  it('pairs a same-onset stop and start by time, not document order', () => {
    const result = parseMusicXmlToScript(PEDAL_START_BEFORE_STOP_SAME_ONSET_MUSICXML);
    expect(spansOf(result)).toEqual([[0, 4], [4, 8]]);
    expect(pedalWarnings(result)).toEqual([]);
  });

  it('discards a dangling pedal start with a warning instead of extending to the end', () => {
    const result = parseMusicXmlToScript(DANGLING_PEDAL_START_MUSICXML);
    expect(result.scoreTiming.pedalSpans).toBeUndefined();
    expect(pedalWarnings(result)).toEqual([
      'A pedal down at onset 0 (measure 1) has no release; no pedal applied.',
    ]);
  });

  it('ignores a release with nothing down, with a warning', () => {
    const result = parseMusicXmlToScript(STRAY_PEDAL_STOP_MUSICXML);
    expect(spansOf(result)).toEqual([[2, 4]]);
    expect(pedalWarnings(result)).toEqual([
      'A pedal release at onset 1 (measure 1) has no pedal down before it; ignored.',
    ]);
  });

  it('treats discontinue as a lift, resume as a depress, and continue as no change', () => {
    const result = parseMusicXmlToScript(PEDAL_DISCONTINUE_RESUME_MUSICXML);
    expect(spansOf(result)).toEqual([[0, 2], [3, 8]]);
    expect(pedalWarnings(result)).toEqual([
      'Sostenuto pedal marks are not modeled in playback; ignored.',
    ]);
  });

  it('honors a direction <offset>', () => {
    expect(spansOf(parseMusicXmlToScript(PEDAL_OFFSET_MUSICXML))).toEqual([[1, 4]]);
  });

  it('reads pedal from any part, not only the first', () => {
    const result = parseMusicXmlToScript(PEDAL_SECOND_PART_ONLY_MUSICXML);
    expect(spansOf(result)).toEqual([[0, 4]]);
    expect(pedalWarnings(result)).toEqual([]);
  });

  it('unions conflicting parts with a warning, and dedupes identical parts silently', () => {
    const conflicting = parseMusicXmlToScript(PEDAL_CONFLICTING_PARTS_MUSICXML);
    expect(spansOf(conflicting)).toEqual([[0, 4]]);
    expect(pedalWarnings(conflicting)).toEqual([
      'Pedal markings differ between parts; using their combined pedal-down ranges.',
    ]);

    const duplicated = parseMusicXmlToScript(PEDAL_DUPLICATED_PARTS_MUSICXML);
    expect(spansOf(duplicated)).toEqual([[0, 4]]);
    expect(pedalWarnings(duplicated)).toEqual([]);
  });

  it('keeps a span across a repeat boundary in document onsets, leaving playback order alone', () => {
    const result = parseMusicXmlToScript(PEDAL_ACROSS_REPEAT_MUSICXML);
    expect(spansOf(result)).toEqual([[7, 9]]);
    // Sanity: the fixture really unrolls (m1 m2 m1 m2 m3), so document and
    // playback order differ across the span.
    expect(result.playbackOrder.map((entry) => entry.playbackOnset)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ]);
    expect(result.playbackOrder.map((entry) => entry.stepIndex)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  describe('real fixtures', () => {
    for (const fixture of REAL_FIXTURES) {
      it(`${fixture.name}: pinned span and change counts, no pedal warnings, sorted and non-overlapping`, async () => {
        const result = parseMusicXmlToScript(await fixture.load());
        const spans = result.scoreTiming.pedalSpans ?? [];

        if (fixture.expectedSpanCount === 0) {
          expect(result.scoreTiming.pedalSpans).toBeUndefined();
        }
        expect(spans).toHaveLength(fixture.expectedSpanCount);
        expect(pedalWarnings(result)).toEqual([]);

        let changes = 0;
        for (let index = 0; index < spans.length; index += 1) {
          expect(spans[index].endOnset).toBeGreaterThan(spans[index].startOnset);
          if (index > 0) {
            expect(spans[index].startOnset).toBeGreaterThanOrEqual(spans[index - 1].endOnset);
            if (spans[index].startOnset === spans[index - 1].endOnset) {
              changes += 1;
            }
          }
        }
        expect(changes).toBe(fixture.expectedChangeCount);
      });
    }
  });

  describe('differential: stripping pedal marks changes nothing but pedalSpans', () => {
    for (const fixture of REAL_FIXTURES) {
      it(fixture.name, async () => {
        const xml = await fixture.load();
        const withPedal = parseMusicXmlToScript(xml);
        const withoutPedalMarks = parseMusicXmlToScript(stripPedalTags(xml));

        expect(withoutPedalMarks.scoreTiming.pedalSpans).toBeUndefined();
        expect(withoutPedal(withoutPedalMarks)).toEqual(withoutPedal(withPedal));
      });
    }

    for (const fixture of SYNTHETIC_FIXTURES) {
      it(`synthetic ${fixture.name}`, () => {
        const withPedal = parseMusicXmlToScript(fixture.xml);
        const withoutPedalMarks = parseMusicXmlToScript(stripPedalTags(fixture.xml));

        expect(withoutPedalMarks.scoreTiming.pedalSpans).toBeUndefined();
        expect(withoutPedal(withoutPedalMarks)).toEqual(withoutPedal(withPedal));
      });
    }
  });
});
