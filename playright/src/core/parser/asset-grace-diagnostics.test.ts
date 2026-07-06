import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MusicXMLIngestor } from './MusicXMLIngestor.ts';
import { MusicXMLNormalizer } from './MusicXMLNormalizer.ts';
import type { NormalizedNote } from './MusicXMLNormalizer.ts';
import { parseMusicXmlToScript } from './index.ts';

const ASSETS = [
  {
    name: 'morns',
    path: new URL('../../assets/morns-like-these-honkai-star-rail.musicxml', import.meta.url),
    expectedGraceCount: 3,
    expectedGraceMeasures: [5, 9, 14],
  },
  {
    name: 'chase',
    path: new URL('../../assets/chase-setsuna-yuki.musicxml', import.meta.url),
    expectedGraceCount: 0,
    expectedGraceMeasures: [] as number[],
  },
  {
    name: 'fanfare',
    path: new URL('../../assets/playright-fanfare.musicxml', import.meta.url),
    expectedGraceCount: 0,
    expectedGraceMeasures: [] as number[],
  },
] as const;

function countGraceTagsInXml(xml: string): number {
  return (xml.match(/<grace[\s/>]/g) ?? []).length;
}

function graceWarningFor(result: ReturnType<typeof parseMusicXmlToScript>): string | undefined {
  return result.warnings.find((warning) => warning.includes('grace note'));
}

function graceNotesInMeasure(
  elements: ReturnType<typeof MusicXMLNormalizer.normalize>['partElements'][number],
  measureNumber: number,
): NormalizedNote[] {
  return elements.filter(
    (element): element is NormalizedNote =>
      element.type === 'note' && element.isGrace && element.measureNumber === measureNumber,
  );
}

describe('asset grace note diagnostics', () => {
  it.each(ASSETS)(
    '$name: grace detection warning and skip behavior',
    ({ path, expectedGraceCount, expectedGraceMeasures }) => {
      const xml = readFileSync(path, 'utf8');
      expect(countGraceTagsInXml(xml)).toBe(expectedGraceCount);

      const result = parseMusicXmlToScript(xml);
      const graceWarning = graceWarningFor(result);

      if (expectedGraceCount === 0) {
        expect(graceWarning).toBeUndefined();
        return;
      }

      expect(graceWarning).toBeDefined();
      expect(graceWarning).toContain(`${expectedGraceCount} grace note`);
      expect(graceWarning).toContain('does not play or finger grace notes');
      for (const measure of expectedGraceMeasures) {
        expect(graceWarning).toContain(String(measure));
      }
    },
  );

  it('morns: grace notes capture slash, steal-time, and type metadata', () => {
    const mornsAsset = ASSETS.find((asset) => asset.name === 'morns');
    expect(mornsAsset).toBeDefined();

    const xml = readFileSync(mornsAsset!.path, 'utf8');
    const raw = MusicXMLIngestor.ingest(xml);
    const { partElements } = MusicXMLNormalizer.normalize(raw);
    const flatGraceNotes = partElements
      .flat()
      .filter((element): element is NormalizedNote => element.type === 'note' && element.isGrace);

    expect(flatGraceNotes).toHaveLength(3);

    for (const measure of mornsAsset!.expectedGraceMeasures) {
      const graceNotes = graceNotesInMeasure(partElements[0] ?? [], measure);
      expect(graceNotes).toHaveLength(1);
      expect(graceNotes[0]).toMatchObject({
        isGrace: true,
        graceSlash: true,
        graceStealTime: undefined,
        graceType: 'eighth',
        step: 'E',
        octave: 5,
      });
    }

    for (const graceNote of flatGraceNotes) {
      expect(graceNote).toMatchObject({
        graceSlash: true,
        graceStealTime: undefined,
        graceType: 'eighth',
      });
    }
  });

  it('normalizer captures grace slash, steal-time, and type from inline XML', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes><divisions>480</divisions></attributes>
      <note>
        <grace slash="yes" steal-time-previous="yes"/>
        <pitch><step>C</step><octave>4</octave></pitch>
        <type>16th</type>
      </note>
      <note>
        <grace steal-time-following="yes"/>
        <pitch><step>D</step><octave>4</octave></pitch>
        <type>eighth</type>
      </note>
      <note>
        <grace/>
        <pitch><step>E</step><octave>4</octave></pitch>
      </note>
      <note>
        <pitch><step>F</step><octave>4</octave></pitch>
        <duration>480</duration>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const raw = MusicXMLIngestor.ingest(xml);
    const { partElements } = MusicXMLNormalizer.normalize(raw);
    const graceNotes = (partElements[0] ?? []).filter(
      (element): element is NormalizedNote => element.type === 'note' && element.isGrace,
    );

    expect(graceNotes).toHaveLength(3);
    expect(graceNotes[0]).toMatchObject({
      isGrace: true,
      graceSlash: true,
      graceStealTime: 'previous',
      graceType: '16th',
    });
    expect(graceNotes[1]).toMatchObject({
      isGrace: true,
      graceSlash: false,
      graceStealTime: 'following',
      graceType: 'eighth',
    });
    expect(graceNotes[2]).toMatchObject({
      isGrace: true,
      graceSlash: false,
      graceStealTime: undefined,
      graceType: undefined,
    });

    const mainNote = (partElements[0] ?? []).find(
      (element): element is NormalizedNote =>
        element.type === 'note' && !element.isGrace && element.step === 'F',
    );
    expect(mainNote).toMatchObject({
      isGrace: false,
      graceSlash: false,
      graceStealTime: undefined,
      graceType: undefined,
    });
  });
});
