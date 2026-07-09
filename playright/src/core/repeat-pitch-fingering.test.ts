import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { parseMusicXmlToScript } from './parser/index.ts';
import { extractHandTimelines, predictFingering } from './fingeringPredictor.ts';
import type { Finger } from '../types/index.ts';

async function loadMxl(name: string): Promise<string> {
  const buffer = readFileSync(new URL(`../assets/${name}`, import.meta.url));
  const archive = await JSZip.loadAsync(buffer);
  const scoreXml = await archive.file('score.xml')?.async('string');
  if (!scoreXml) {
    throw new Error(`${name} missing score.xml`);
  }
  return scoreXml;
}

function fingersForMidiSteps(
  script: Awaited<ReturnType<typeof predictFingering>>,
  hand: 'L' | 'R',
  midi: number,
  fromStep: number,
  toStep: number,
): Finger[] {
  const timeline = extractHandTimelines(script)[hand];
  return timeline
    .filter(
      (event) =>
        event.kind !== 'grace' &&
        event.midi === midi &&
        event.stepIndex >= fromStep &&
        event.stepIndex <= toStep,
    )
    .map((event) => {
      const step = script[event.stepIndex];
      return step.notes.find((note) => note.hand === hand && note.midi === midi)?.finger ?? null;
    })
    .filter((finger): finger is Finger => finger !== null);
}

describe('short same-pitch repeat runs', () => {
  it('keeps one finger across glimpse RH C5 repeated-note run after chord attack', async () => {
    const xml = await loadMxl('glimpse-of-us-joji.mxl');
    const { script, scoreTiming } = parseMusicXmlToScript(xml);
    const predicted = await predictFingering(script, {
      divisionsPerQuarter: scoreTiming.divisionsPerQuarter,
      mlCostWeight: 0,
    });

    // Before reinforcement (2026-07): [5, 3, 3, 3, 3, 3, 3]
    const fingers = fingersForMidiSteps(predicted, 'R', 72, 18, 25);
    expect(fingers).toEqual([5, 5, 5, 5, 5, 5, 5]);
  });

  it('keeps one finger across tetoris RH repeated Ab4 tremolo', async () => {
    const xml = await loadMxl('tetoris.mxl');
    const { script, scoreTiming } = parseMusicXmlToScript(xml);
    const predicted = await predictFingering(script, {
      divisionsPerQuarter: scoreTiming.divisionsPerQuarter,
      mlCostWeight: 0,
    });

    // Before reinforcement (2026-07): [5, 5, 5, 5, 5, 5, 3]
    const fingers = fingersForMidiSteps(predicted, 'R', 68, 146, 152);
    expect(fingers.slice(1).every((finger) => finger === fingers[1])).toBe(true);
  });
});
