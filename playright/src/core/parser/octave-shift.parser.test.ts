import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OCTAVE_SHIFT_MUSICXML } from './__fixtures__/octaveShift.musicxml.ts';
import { parseMusicXmlToScript } from './index.ts';

const MORNS_PATH = new URL(
  '../../assets/morns-like-these-honkai-star-rail.musicxml',
  import.meta.url,
);

/**
 * MusicXML <pitch> is the SOUNDING pitch; <octave-shift> only tells the
 * renderer to engrave the passage an octave lower/higher with a bracket.
 * These tests lock the parser to that spec: MIDI comes straight from pitch
 * data with no extra shift (a naive +12 "fix" would push morns' final E7 to
 * E8 = MIDI 112, off the piano, and the range guard would drop the note),
 * and direction elements never advance the P0-1 timeline.
 */
describe('octave-shift directions', () => {
  it('fixture: pitch data under 8va/8vb brackets maps to MIDI unshifted', () => {
    const { script, warnings } = parseMusicXmlToScript(OCTAVE_SHIFT_MUSICXML);

    const byOnset = new Map(
      script.map((step) => [
        step.onset,
        step.notes.map((note) => `${note.pitch}:${note.midi}:${note.hand}`).sort(),
      ]),
    );

    // Direction elements advance no time: onsets are exactly the note durations.
    expect([...byOnset.keys()].sort((a, b) => a - b)).toEqual([0, 480, 960, 1440]);

    expect(byOnset.get(0)).toEqual(['C4:60:R', 'G2:43:L'].sort());
    // Tied pair inside the 8va span merges into one attack, pitch unshifted.
    expect(byOnset.get(480)).toEqual(['D6:86:R']);
    expect(byOnset.get(960)).toEqual(['G3:55:L']);
    expect(byOnset.get(1440)).toEqual(['C4:60:R']);

    const tiedNote = script.find((step) => step.onset === 480)!.notes[0];
    expect(tiedNote.durationDivisions).toBe(960);

    expect(warnings.some((warning) => /octave/i.test(warning))).toBe(false);
  });

  it('morns 8va passage (m27-30, staff 1): sounding MIDI preserved up to E7', () => {
    const xml = readFileSync(MORNS_PATH, 'utf8');
    const { script } = parseMusicXmlToScript(xml);

    const rightHand = script
      .filter((step) => step.measureNumber >= 27)
      .flatMap((step) =>
        step.notes
          .filter((note) => note.hand === 'R')
          .map((note) => ({ onset: step.onset, pitch: note.pitch, midi: note.midi })),
      );

    expect(rightHand).toEqual([
      { onset: 416, pitch: 'E6', midi: 88 },
      { onset: 428, pitch: 'D#6', midi: 87 },
      { onset: 432, pitch: 'C#6', midi: 85 },
      { onset: 444, pitch: 'D#6', midi: 87 },
      { onset: 448, pitch: 'E6', midi: 88 },
      { onset: 460, pitch: 'E7', midi: 100 },
      { onset: 464, pitch: 'E7', midi: 100 },
    ]);
  });

  it('morns 8vb passage (m9-10, staff 2): sounding E3/B3 preserved across the tie', () => {
    const xml = readFileSync(MORNS_PATH, 'utf8');
    const { script } = parseMusicXmlToScript(xml);

    const bracketStep = script.find((step) => step.onset === 142)!;
    const leftHand = bracketStep.notes
      .filter((note) => note.hand === 'L')
      .map((note) => `${note.pitch}:${note.midi}`)
      .sort();

    expect(leftHand).toEqual(['B3:59', 'E3:52']);

    // P0-1 guard: octave-shift handling must never move the timeline.
    expect(script[script.length - 1].onset).toBe(464);
  });
});
