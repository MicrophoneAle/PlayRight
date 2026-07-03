import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
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
});
