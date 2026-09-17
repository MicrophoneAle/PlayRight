import { describe, expect, it } from 'vitest';
import { parseMusicXmlToScript } from './index.ts';
import {
  CROSS_STAFF_CHORD_MUSICXML,
  CROSS_VOICE_TIE_MUSICXML,
  UNMATCHED_TIE_STOP_MUSICXML,
} from './__fixtures__/crossStaffTieChord.musicxml.ts';

describe('cross-voice ties and cross-staff chords', () => {
  it('merges a tie-stop that MuseScore reassigned to a different voice', () => {
    const { script, scoreTiming, warnings } = parseMusicXmlToScript(
      CROSS_VOICE_TIE_MUSICXML,
    );

    expect(script).toHaveLength(1);
    expect(script[0].notes).toHaveLength(1);
    expect(script[0].notes[0]).toMatchObject({
      pitch: 'C4',
      durationDivisions: 8,
      tiedToNext: false,
    });
    expect(scoreTiming.totalTimelineDivisions).toBe(8);
    expect(
      warnings.some((w) => w.includes('no matching start')),
    ).toBe(false);
  });

  it('stacks a cross-staff <chord/> tone without advancing the cursor', () => {
    const { script, scoreTiming } = parseMusicXmlToScript(
      CROSS_STAFF_CHORD_MUSICXML,
    );

    expect(scoreTiming.totalTimelineDivisions).toBe(8);
    expect(script).toHaveLength(2);
    expect(script[0].onset).toBe(0);
    expect(script[0].notes.map((n) => n.pitch).sort()).toEqual(['C5', 'E3']);
    expect(script[1].onset).toBe(4);
    expect(script[1].notes.map((n) => n.pitch)).toEqual(['D5']);
  });

  it('keeps an unmatched tie-stop as a normal note and warns', () => {
    const { script, warnings } = parseMusicXmlToScript(UNMATCHED_TIE_STOP_MUSICXML);

    expect(script).toHaveLength(2);
    expect(script.map((s) => s.notes[0].pitch)).toEqual(['E4', 'G4']);
    expect(script[1].notes[0].tiedToNext).toBeFalsy();
    expect(
      warnings.some(
        (w) =>
          w.includes('Tie stop for G4') &&
          w.includes('no matching start') &&
          w.includes('treating as a normal note'),
      ),
    ).toBe(true);
  });
});
