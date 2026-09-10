/**
 * Pickup / anacrusis (measure number="0") regression.
 *
 * MusicXMLValidator previously required measureNumber >= 1, so any MuseScore /
 * Finale score with `<measure number="0" implicit="yes">` failed the whole
 * parse. Sheet sync already treated 0 as a valid label; the schema did not.
 */
import { describe, expect, it } from 'vitest';
import { parseMusicXmlToScript } from './index.ts';
import {
  PICKUP_SIMPLE_MUSICXML,
  PICKUP_THEN_REPEAT_MUSICXML,
} from './__fixtures__/pickupAnacrusis.musicxml.ts';

describe('pickup anacrusis (measure number 0)', () => {
  it('parses a pickup measure and does not pad it to a full bar', () => {
    const { script, warnings } = parseMusicXmlToScript(PICKUP_SIMPLE_MUSICXML);

    expect(warnings).toEqual([]);
    expect(script.map((step) => step.measureNumber)).toEqual([0, 1, 1, 1, 1, 2]);
    expect(script.map((step) => step.onset)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(script[0]?.notes[0]?.pitch).toBe('G4');
    // Measure 1 starts immediately after the one-quarter pickup — not after a
    // phantom full 4/4 bar of rest (which would put it at onset 4).
    expect(script[1]).toMatchObject({ onset: 1, measureNumber: 1 });
    expect(script[5]).toMatchObject({ onset: 5, measureNumber: 2 });
  });

  it('resolves a pickup followed by a repeat without replaying the pickup', () => {
    const { script, playbackOrder, warnings } = parseMusicXmlToScript(
      PICKUP_THEN_REPEAT_MUSICXML,
    );

    expect(warnings).toEqual([]);
    expect(script.map((step) => step.measureNumber)).toEqual([0, 1, 2, 3]);
    expect(script.map((step) => step.onset)).toEqual([0, 1, 2, 3]);

    const measureWalk = playbackOrder.map(
      (entry) => script[entry.stepIndex].measureNumber,
    );
    expect(measureWalk).toEqual([0, 1, 2, 1, 2, 3]);

    // Pickup is pass 0 once; the repeated region is pass 0 then pass 1.
    expect(playbackOrder.map((entry) => entry.passIndex)).toEqual([
      0, 0, 0, 1, 1, 0,
    ]);
    expect(playbackOrder.map((entry) => entry.playbackOnset)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
  });
});
