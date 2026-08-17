import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseMusicXmlToScript } from './index.ts';

describe('Clair de Lune opening unison collapse', () => {
  it('keeps one F4–Ab4 at the pickup onset with the hidden sustain duration', async () => {
    const buffer = readFileSync(
      new URL('../../assets/clair-de-lune-debussy.mxl', import.meta.url),
    );
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('score.xml')?.async('string');
    if (xml === undefined) {
      throw new Error('clair-de-lune-debussy.mxl missing score.xml');
    }

    const { script } = parseMusicXmlToScript(xml);
    const opening = script[0];

    expect(opening?.onset).toBe(240);
    expect(opening?.measureNumber).toBe(1);
    expect(opening?.notes).toHaveLength(2);
    expect(opening?.notes.map((note) => `${note.hand}:${note.pitch}`).sort()).toEqual([
      'L:Ab4',
      'L:F4',
    ]);
    expect(opening?.notes.every((note) => note.durationDivisions === 1920)).toBe(true);

    const next = script[1];
    expect(next?.onset).toBe(480);
    expect(next?.notes.map((note) => note.pitch).sort()).toEqual(['Ab5', 'F5']);
  });
});
