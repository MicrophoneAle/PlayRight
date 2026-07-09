import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseMusicXmlToScript } from './parser/index.ts';
import { buildPracticePositions } from './practiceSteps.ts';
import type { PracticePosition } from '../types/index.ts';

async function loadMxlScoreXml(relativePath: string): Promise<string> {
  const buffer = readFileSync(new URL(relativePath, import.meta.url));
  const archive = await JSZip.loadAsync(buffer);
  const scoreXml = await archive.file('score.xml')?.async('string');
  if (!scoreXml) {
    throw new Error(`${relativePath} missing score.xml`);
  }
  return scoreXml;
}

function mainOnlyPositions(stepCount: number): PracticePosition[] {
  return Array.from({ length: stepCount }, (_, stepIndex) => ({
    kind: 'main' as const,
    stepIndex,
  }));
}

describe('buildPracticePositions', () => {
  it('chase: zero graces yields a plain main-only walk', () => {
    const xml = readFileSync(
      new URL('../assets/chase-setsuna-yuki.musicxml', import.meta.url),
      'utf8',
    );
    const { script } = parseMusicXmlToScript(xml);
    expect(script.every((step) => (step.graceBefore?.length ?? 0) === 0)).toBe(true);

    const positions = buildPracticePositions(script);
    expect(positions).toEqual(mainOnlyPositions(script.length));
  });

  it('morns: single-grace steps insert one grace position before each main', () => {
    const xml = readFileSync(
      new URL('../assets/morns-like-these-honkai-star-rail.musicxml', import.meta.url),
      'utf8',
    );
    const { script } = parseMusicXmlToScript(xml);

    const positions = buildPracticePositions(script);
    const graceSteps = script
      .map((step, stepIndex) => ({ stepIndex, graceCount: step.graceBefore?.length ?? 0 }))
      .filter((entry) => entry.graceCount > 0);

    expect(graceSteps).toEqual([
      { stepIndex: 16, graceCount: 1 },
      { stepIndex: 31, graceCount: 1 },
      { stepIndex: 56, graceCount: 1 },
    ]);

    for (const { stepIndex } of graceSteps) {
      const blockStart = positions.findIndex(
        (position) => position.kind === 'grace' && position.stepIndex === stepIndex,
      );
      expect(positions[blockStart]).toEqual({
        kind: 'grace',
        stepIndex,
        graceIndex: 0,
      });
      expect(positions[blockStart + 1]).toEqual({ kind: 'main', stepIndex });
    }

    expect(positions.length).toBe(script.length + graceSteps.length);
  });

  it('river-flows-in-you: multi-grace runs preserve graceIndex order before main', async () => {
    const xml = await loadMxlScoreXml('../assets/river-flows-in-you.mxl');
    const { script } = parseMusicXmlToScript(xml);

    const positions = buildPracticePositions(script);
    const multiGraceSteps = script
      .map((step, stepIndex) => ({ stepIndex, graces: step.graceBefore ?? [] }))
      .filter((entry) => entry.graces.length > 1);

    expect(multiGraceSteps.length).toBeGreaterThanOrEqual(6);

    for (const { stepIndex, graces } of multiGraceSteps) {
      const blockStart = positions.findIndex(
        (position) => position.kind === 'grace' && position.stepIndex === stepIndex,
      );
      expect(blockStart).toBeGreaterThanOrEqual(0);

      for (let graceIndex = 0; graceIndex < graces.length; graceIndex += 1) {
        expect(positions[blockStart + graceIndex]).toEqual({
          kind: 'grace',
          stepIndex,
          graceIndex,
        });
      }

      expect(positions[blockStart + graces.length]).toEqual({
        kind: 'main',
        stepIndex,
      });
    }

    // Measure 9 / step 63: A4 then C#5 graces before the main attack.
    const step63Block = positions.slice(
      positions.findIndex((p) => p.stepIndex === 63 && p.kind === 'grace'),
      positions.findIndex((p) => p.stepIndex === 63 && p.kind === 'main') + 1,
    );
    expect(step63Block).toEqual([
      { kind: 'grace', stepIndex: 63, graceIndex: 0 },
      { kind: 'grace', stepIndex: 63, graceIndex: 1 },
      { kind: 'main', stepIndex: 63 },
    ]);
    expect(script[63].graceBefore!.map((grace) => grace.midi)).toEqual([69, 73]);

    expect(positions.length).toBe(
      script.length +
        script.reduce((sum, step) => sum + (step.graceBefore?.length ?? 0), 0),
    );
  });
});
