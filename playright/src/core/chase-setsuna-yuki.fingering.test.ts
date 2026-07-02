import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMusicXmlToScript } from './parser/index.ts';
import { predictFingering } from './fingeringPredictor.ts';

const CHASE_XML = readFileSync(
  new URL('../assets/chase-setsuna-yuki.musicxml', import.meta.url),
  'utf8',
);

describe('chase-setsuna-yuki fingering analysis', () => {
  it('predicts fingerings for both hands without errors', async () => {
    const { script: parsed } = parseMusicXmlToScript(CHASE_XML);
    const script = await predictFingering(parsed);

    const totalNotes = script.flatMap((step) => step.notes).length;
    const predicted = script
      .flatMap((step) => step.notes)
      .filter((note) => note.fingerSource === 'predicted').length;

    expect(totalNotes).toBeGreaterThan(0);
    expect(predicted).toBeGreaterThan(0);
  });
});
