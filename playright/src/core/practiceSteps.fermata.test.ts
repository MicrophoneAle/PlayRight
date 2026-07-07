import { describe, expect, it } from 'vitest';
import { MOMS_LIKE_THESE_MUSICXML } from './parser/__fixtures__/momsLikeThese.musicxml.ts';
import { parseMusicXmlToScript } from './parser/index.ts';
import { stepHasPracticeFermataIndicator } from './practiceSteps.ts';

describe('practice-mode fermata policy', () => {
  const { script, scoreTiming } = parseMusicXmlToScript(MOMS_LIKE_THESE_MUSICXML);
  const { divisionsPerQuarter } = scoreTiming;

  it('detects fermata-marked opening chord for a practice sustain cue', () => {
    expect(script[0].notes.some((note) => note.hasFermata)).toBe(true);
    expect(stepHasPracticeFermataIndicator(script, 0, divisionsPerQuarter)).toBe(
      true,
    );
  });

  it('flags carry-forward steps that receive delegated fermata weight', () => {
    expect(stepHasPracticeFermataIndicator(script, 1, divisionsPerQuarter)).toBe(
      true,
    );
  });

  it('does not flag ordinary steps without fermata weight', () => {
    expect(stepHasPracticeFermataIndicator(script, 2, divisionsPerQuarter)).toBe(
      false,
    );
  });
});
