import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { parseMusicXmlToScript } from './index.ts';
import { MINIMAL_MUSICXML } from './__fixtures__/minimal.musicxml.ts';

async function unzipScoreXmlFromMxlBuffer(buffer: ArrayBuffer): Promise<string> {
  const archive = await JSZip.loadAsync(buffer);
  const scoreXml = await archive.file('score.xml')?.async('string');

  if (scoreXml === undefined) {
    throw new Error('MXL fixture is missing score.xml');
  }

  return scoreXml;
}

async function buildMxlBuffer(xml: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="score.xml" media-type="application/vnd.recordare.musicxml+xml"/>
  </rootfiles>
</container>`,
  );
  zip.file('score.xml', xml);
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('parseMusicXmlToScript', () => {
  const { script, scoreTiming } = parseMusicXmlToScript(MINIMAL_MUSICXML);

  it('captures score-level timing metadata', () => {
    expect(scoreTiming).toEqual({
      divisionsPerQuarter: 480,
      tempoBpm: 100,
    });
  });

  it('parses step count and onset timing from divisions', () => {
    expect(script).toHaveLength(3);
    expect(script[0]).toMatchObject({ order: 0, onset: 0 });
    expect(script[1]).toMatchObject({ order: 1, onset: 480 });
    expect(script[2]).toMatchObject({ order: 2, onset: 960 });
  });

  it('maps pitch, midi, and hand per staff', () => {
    const opening = script[0].notes;
    const chordStep = script[1].notes;
    const c4 = opening.find((note) => note.pitch === 'C4');
    const c3 = opening.find((note) => note.pitch === 'C3');
    const e4 = chordStep.find((note) => note.pitch === 'E4');
    const g4 = chordStep.find((note) => note.pitch === 'G4');
    const d4 = script[2].notes.find((note) => note.pitch === 'D4');

    expect(c4).toMatchObject({ midi: 60, hand: 'R' });
    expect(c3).toMatchObject({ midi: 48, hand: 'L' });
    expect(e4).toMatchObject({ midi: 64, hand: 'R' });
    expect(g4).toMatchObject({ midi: 67, hand: 'R' });
    expect(d4).toMatchObject({ midi: 62, hand: 'R' });
  });

  it('groups chord tones at a shared onset', () => {
    const chordStep = script[1].notes.filter((note) => note.hand === 'R');
    expect(chordStep.map((note) => note.pitch).sort()).toEqual(['E4', 'G4']);
    expect(script[0].notes.map((note) => note.pitch).sort()).toEqual(['C3', 'C4']);
  });

  it('preserves note duration in divisions on each script note', () => {
    for (const step of script) {
      for (const note of step.notes) {
        expect(note.durationDivisions).toBe(480);
      }
    }
  });

  it('preserves score fingerings and leaves absent fingerings null', () => {
    const c4 = script[0].notes.find((note) => note.pitch === 'C4');
    const e4 = script[1].notes.find((note) => note.pitch === 'E4');
    const c3 = script[0].notes.find((note) => note.pitch === 'C3');
    const d4 = script[2].notes.find((note) => note.pitch === 'D4');

    expect(c4?.finger).toBe(2);
    expect(c4?.fingerSource).toBe('score');
    expect(e4?.finger).toBeNull();
    expect(e4?.fingerSource).toBeUndefined();
    expect(c3?.finger).toBeNull();
    expect(c3?.fingerSource).toBeUndefined();
    expect(d4?.finger).toBeNull();
    expect(d4?.fingerSource).toBeUndefined();
  });

  it('unzips MXL and parses to the same PlaybackScript as plain MusicXML', async () => {
    const mxlBuffer = await buildMxlBuffer(MINIMAL_MUSICXML);
    const xmlFromMxl = await unzipScoreXmlFromMxlBuffer(mxlBuffer);
    const fromMxl = parseMusicXmlToScript(xmlFromMxl);

    expect(fromMxl).toEqual({ script, scoreTiming });
  });
});
