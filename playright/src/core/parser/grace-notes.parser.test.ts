import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ACCIACCATURA_BASELINE_MUSICXML,
  ACCIACCATURA_BEFORE_MAIN_MUSICXML,
  APPOGGIATURA_BEFORE_MAIN_MUSICXML,
} from './__fixtures__/graceNotes.musicxml.ts';
import { MusicXMLIngestor } from './MusicXMLIngestor.ts';
import { MusicXMLNormalizer } from './MusicXMLNormalizer.ts';
import type { NormalizedNote } from './MusicXMLNormalizer.ts';
import { parseMusicXmlToScript } from './index.ts';

const MORNS_PATH = new URL(
  '../../assets/morns-like-these-honkai-star-rail.musicxml',
  import.meta.url,
);

function graceNotesFromXml(xml: string): NormalizedNote[] {
  const raw = MusicXMLIngestor.ingest(xml);
  const { partElements } = MusicXMLNormalizer.normalize(raw);
  return (partElements[0] ?? []).filter(
    (element): element is NormalizedNote =>
      element.type === 'note' && element.isGrace,
  );
}

function mainStepWithGrace(xml: string) {
  const { script } = parseMusicXmlToScript(xml);
  const step = script.find((entry) => entry.graceBefore && entry.graceBefore.length > 0);
  expect(step).toBeDefined();
  return { script, step: step! };
}

describe('GN-1/GN-2 grace note parser fixtures', () => {
  it('acciaccatura: normalizer captures graceSlash and graceType', () => {
    const [grace] = graceNotesFromXml(ACCIACCATURA_BEFORE_MAIN_MUSICXML);
    expect(grace).toMatchObject({
      isGrace: true,
      graceSlash: true,
      graceType: '32nd',
      step: 'C',
      octave: 5,
    });
  });

  it('acciaccatura: graceBefore rides on main note without advancing onset', () => {
    const { script, step } = mainStepWithGrace(ACCIACCATURA_BEFORE_MAIN_MUSICXML);
    const { script: baseline } = parseMusicXmlToScript(ACCIACCATURA_BASELINE_MUSICXML);
    const baselineMain = baseline.find((entry) =>
      entry.notes.some((note) => note.pitch === 'E5'),
    );

    expect(script).toHaveLength(2);
    expect(step.onset).toBe(480);
    expect(baselineMain?.onset).toBe(480);
    expect(step.graceBefore).toEqual([
      {
        midi: 72,
        pitch: 'C5',
        hand: 'R',
        kind: 'acciaccatura',
      },
    ]);
    expect(step.notes.map((note) => note.pitch)).toEqual(['E5']);
  });

  it('appoggiatura: normalizer captures missing slash and graceType', () => {
    const [grace] = graceNotesFromXml(APPOGGIATURA_BEFORE_MAIN_MUSICXML);
    expect(grace).toMatchObject({
      isGrace: true,
      graceSlash: false,
      graceStealTime: 'following',
      graceType: 'eighth',
      step: 'D',
      octave: 5,
    });
  });

  it('appoggiatura: graceBefore kind is appoggiatura and onset is unchanged', () => {
    const { script, step } = mainStepWithGrace(APPOGGIATURA_BEFORE_MAIN_MUSICXML);

    expect(script).toHaveLength(2);
    expect(step.onset).toBe(480);
    expect(step.graceBefore).toEqual([
      {
        midi: 74,
        pitch: 'D5',
        hand: 'R',
        kind: 'appoggiatura',
        stealTime: 'following',
      },
    ]);
    expect(step.notes.map((note) => note.pitch)).toEqual(['G5']);
  });
});

describe('GN-2 morns graceBefore regression', () => {
  const mornsXml = readFileSync(MORNS_PATH, 'utf8');
  const { script } = parseMusicXmlToScript(mornsXml);

  it('attaches exactly three graceBefore entries at measures 5, 9, and 14', () => {
    const graceSteps = script.filter((step) => step.graceBefore?.length);
    expect(graceSteps).toHaveLength(3);
    expect(graceSteps.map((step) => step.measureNumber).sort((a, b) => a - b)).toEqual([
      5, 9, 14,
    ]);
  });

  it.each([
    { measureNumber: 5, mainPitches: ['F#5', 'E4', 'B4'], onset: 78 },
    { measureNumber: 9, mainPitches: ['F#5', 'E3', 'B3'], onset: 142 },
    { measureNumber: 14, mainPitches: ['F#5', 'D#4'], onset: 214 },
  ])(
    'measure $measureNumber: E5 acciaccatura graceBefore on F# chord at onset $onset',
    ({ measureNumber, mainPitches, onset }) => {
      const step = script.find(
        (entry) => entry.measureNumber === measureNumber && entry.graceBefore?.length,
      );

      expect(step).toMatchObject({
        measureNumber,
        onset,
        graceBefore: [
          {
            midi: 76,
            pitch: 'E5',
            hand: 'R',
            kind: 'acciaccatura',
          },
        ],
      });
      expect(step!.notes.map((note) => note.pitch).sort()).toEqual([...mainPitches].sort());
    },
  );
});
