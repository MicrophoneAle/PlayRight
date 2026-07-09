import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { parseMusicXmlToScript } from './index.ts';
import { MINIMAL_MUSICXML } from './__fixtures__/minimal.musicxml.ts';
import { TIE_AND_SYNC_MUSICXML } from './__fixtures__/tieAndSync.musicxml.ts';
import { MOMS_LIKE_THESE_MUSICXML } from './__fixtures__/momsLikeThese.musicxml.ts';
import {
  ARTICULATIONS_MUSICXML,
  STRONG_ACCENT_MUSICXML,
} from './__fixtures__/articulations.musicxml.ts';

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
      totalTimelineDivisions: 1440,
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

    expect(fromMxl).toEqual({ script, scoreTiming, warnings: [] });
  });

  it('merges tied segments into one note with combined duration', () => {
    const { script } = parseMusicXmlToScript(TIE_AND_SYNC_MUSICXML);
    const tiedC4 = script[0].notes.find((note) => note.pitch === 'C4');

    expect(script[0].onset).toBe(0);
    expect(tiedC4).toMatchObject({
      midi: 60,
      durationDivisions: 960,
      tiedToNext: false,
    });
  });

  it('keeps consecutive repeated pitches as separate steps', () => {
    const { script } = parseMusicXmlToScript(TIE_AND_SYNC_MUSICXML);

    expect(script[1]).toMatchObject({ onset: 960 });
    expect(script[2]).toMatchObject({ onset: 1200 });
    expect(script[1].notes[0]).toMatchObject({ pitch: 'D4', durationDivisions: 240 });
    expect(script[2].notes[0]).toMatchObject({ pitch: 'D4', durationDivisions: 240 });
  });

  it('syncs chord tones and cross-staff notes on the same beat', () => {
    const { script } = parseMusicXmlToScript(TIE_AND_SYNC_MUSICXML);
    const chordStep = script[3];

    expect(chordStep.onset).toBe(1440);
    expect(chordStep.notes.map((note) => note.pitch).sort()).toEqual([
      'E3',
      'E4',
      'G3',
      'G4',
    ]);
    expect(chordStep.notes.every((note) => note.durationDivisions === 480)).toBe(true);
  });

  it('parses fermata opening chords, eighth-note pairs, and tied intervals', () => {
    const { script } = parseMusicXmlToScript(MOMS_LIKE_THESE_MUSICXML);

    expect(script[0]).toMatchObject({
      measureNumber: 1,
      onset: 0,
    });
    expect(script[0].notes.map((note) => note.pitch).sort()).toEqual([
      'B2',
      'B4',
      'D#5',
      'F#5',
    ]);
    expect(script[0].notes.find((note) => note.pitch === 'B4')?.hasFermata).toBe(true);
    expect(script[0].notes.find((note) => note.pitch === 'B2')?.hasFermata).toBe(true);
    expect(script[0].notes.find((note) => note.pitch === 'D#5')?.hasFermata).toBeFalsy();

    const eighthPair = script.filter(
      (step) =>
        step.measureNumber === 10 &&
        step.notes.length === 1 &&
        step.notes[0].hand === 'R',
    );
    expect(eighthPair).toHaveLength(2);
    expect(eighthPair.map((step) => step.notes[0].pitch)).toEqual(['D5', 'C#5']);

    const intervalStep = script.find(
      (step) =>
        step.measureNumber === 11 &&
        step.notes.some((note) => note.pitch === 'F#5') &&
        step.notes.some((note) => note.pitch === 'A5'),
    );
    expect(intervalStep?.notes.map((note) => note.pitch).sort()).toEqual([
      'A5',
      'F#5',
    ]);

    const tiedD5 = script.find(
      (step) =>
        step.measureNumber === 10 &&
        step.notes.some((note) => note.pitch === 'D5' && note.hand === 'R'),
    );
    expect(tiedD5?.notes.find((note) => note.pitch === 'D5')).toMatchObject({
      durationDivisions: 720,
    });
    expect(
      script.some(
        (step) =>
          step.measureNumber === 11 &&
          step.notes.length === 1 &&
          step.notes[0].pitch === 'D5',
      ),
    ).toBe(false);
  });

  it('parses staccato, accent, plain, and combined articulations without changing timing', () => {
    const { script } = parseMusicXmlToScript(ARTICULATIONS_MUSICXML);

    expect(script).toHaveLength(4);
    expect(script.map((step) => step.onset)).toEqual([0, 480, 960, 1440]);
    expect(script.every((step) => step.notes[0].durationDivisions === 480)).toBe(
      true,
    );

    const c4 = script[0].notes[0];
    const d4 = script[1].notes[0];
    const e4 = script[2].notes[0];
    const f4 = script[3].notes[0];

    expect(c4).toMatchObject({
      pitch: 'C4',
      hasStaccato: true,
    });
    expect(c4.hasAccent).toBeFalsy();

    expect(d4).toMatchObject({
      pitch: 'D4',
      hasAccent: true,
    });
    expect(d4.hasStaccato).toBeFalsy();

    expect(e4).toMatchObject({ pitch: 'E4' });
    expect(e4.hasStaccato).toBeFalsy();
    expect(e4.hasAccent).toBeFalsy();

    expect(f4).toMatchObject({
      pitch: 'F4',
      hasStaccato: true,
      hasAccent: true,
    });
  });

  it('maps strong-accent to hasAccent', () => {
    const { script } = parseMusicXmlToScript(STRONG_ACCENT_MUSICXML);
    const g4 = script[0].notes[0];

    expect(g4).toMatchObject({
      pitch: 'G4',
      hasAccent: true,
    });
    expect(g4.hasStaccato).toBeFalsy();
  });

  it('merges a multi-measure tie into one long note at the first onset', () => {
    const MULTI_MEASURE_TIE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
      </attributes>
      <note>
        <pitch><step>E</step><octave>5</octave></pitch>
        <duration>1920</duration>
        <tie type="start"/>
        <notations><tied type="start"/></notations>
      </note>
    </measure>
    <measure number="2">
      <note>
        <pitch><step>E</step><octave>5</octave></pitch>
        <duration>1920</duration>
        <tie type="stop"/>
        <tie type="start"/>
        <notations>
          <tied type="stop"/>
          <tied type="start"/>
        </notations>
      </note>
    </measure>
    <measure number="3">
      <note>
        <pitch><step>E</step><octave>5</octave></pitch>
        <duration>1920</duration>
        <tie type="stop"/>
        <notations><tied type="stop"/></notations>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const { script } = parseMusicXmlToScript(MULTI_MEASURE_TIE);
    const tiedE5 = script[0].notes.find((note) => note.pitch === 'E5');

    expect(script).toHaveLength(1);
    expect(tiedE5).toMatchObject({
      midi: 76,
      durationDivisions: 5760,
      tiedToNext: false,
    });
  });

  it('merges tie continuations that only mark tie start on later bars', () => {
    const IMPLICIT_CONTINUE_TIE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1920</duration>
        <tie type="start"/>
        <notations><tied type="start"/></notations>
      </note>
    </measure>
    <measure number="2">
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1920</duration>
        <tie type="start"/>
        <notations><tied type="start"/></notations>
      </note>
    </measure>
    <measure number="3">
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1920</duration>
        <tie type="stop"/>
        <notations><tied type="stop"/></notations>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const { script } = parseMusicXmlToScript(IMPLICIT_CONTINUE_TIE);
    const tiedC4 = script[0].notes.find((note) => note.pitch === 'C4');

    expect(script).toHaveLength(1);
    expect(tiedC4).toMatchObject({
      durationDivisions: 5760,
      tiedToNext: false,
    });
  });

  it('ignores orphan tie stops instead of creating an extra practice step', () => {
    const ORPHAN_TIE_STOP = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>480</duration>
        <tie type="start"/>
        <notations><tied type="start"/></notations>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>480</duration>
        <tie type="stop"/>
        <notations><tied type="stop"/></notations>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const { script } = parseMusicXmlToScript(ORPHAN_TIE_STOP);

    expect(script).toHaveLength(1);
    expect(script[0].notes).toHaveLength(1);
    expect(script[0].notes[0]).toMatchObject({
      pitch: 'C4',
      durationDivisions: 480,
      tiedToNext: false,
    });
  });

  it('clears tiedToNext when a tie stop has no matching start', () => {
    const DANGLING_STOP = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>480</duration>
        <tie type="start"/>
        <notations><tied type="start"/></notations>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>480</duration>
        <tie type="stop"/>
        <notations><tied type="stop"/></notations>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const { script } = parseMusicXmlToScript(DANGLING_STOP);

    expect(script.every((step) => step.notes.every((note) => !note.tiedToNext))).toBe(
      true,
    );
  });

  it('keeps same-pitch ties in different voices on one staff separate', () => {
    const TWO_VOICE_TIE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>480</duration>
        <voice>1</voice>
        <staff>1</staff>
        <tie type="start"/>
        <notations><tied type="start"/></notations>
      </note>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>480</duration>
        <voice>2</voice>
        <staff>1</staff>
        <tie type="start"/>
        <notations><tied type="start"/></notations>
      </note>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>480</duration>
        <voice>1</voice>
        <staff>1</staff>
        <tie type="stop"/>
        <notations><tied type="stop"/></notations>
      </note>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>480</duration>
        <voice>2</voice>
        <staff>1</staff>
        <tie type="stop"/>
        <notations><tied type="stop"/></notations>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const { script } = parseMusicXmlToScript(TWO_VOICE_TIE);

    expect(script).toHaveLength(2);
    expect(script[0].onset).toBe(0);
    expect(script[1].onset).toBe(480);
    for (const step of script) {
      expect(step.notes[0]).toMatchObject({
        pitch: 'C4',
        durationDivisions: 960,
        tiedToNext: false,
      });
    }
  });

  it('places chord members at the base note onset after a merged tie continuation', () => {
    const TIE_INTO_CHORD = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>480</duration>
        <tie type="start"/>
        <notations><tied type="start"/></notations>
      </note>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>480</duration>
        <tie type="stop"/>
        <tie type="start"/>
        <notations>
          <tied type="stop"/>
          <tied type="start"/>
        </notations>
      </note>
      <note>
        <chord/>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>480</duration>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const { script } = parseMusicXmlToScript(TIE_INTO_CHORD);

    expect(script).toHaveLength(2);
    expect(script[0]).toMatchObject({ onset: 0 });
    expect(script[0].notes.find((note) => note.pitch === 'C4')).toMatchObject({
      durationDivisions: 960,
      tiedToNext: false,
    });
    expect(script[1]).toMatchObject({ onset: 480 });
    expect(script[1].notes.map((note) => note.pitch)).toEqual(['E4']);
    expect(script.some((step) => step.notes.some((note) => note.pitch === 'E4' && step.onset === 0))).toBe(
      false,
    );
  });

  it('merges a cross-measure D natural tie in a sharp key using the start pitch', () => {
    const CROSS_MEASURE_NATURAL_TIE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
        <key><fifths>4</fifths></key>
      </attributes>
      <note>
        <pitch><step>D</step><alter>0</alter><octave>5</octave></pitch>
        <duration>480</duration>
        <accidental>natural</accidental>
        <tie type="start"/>
        <notations><tied type="start"/></notations>
      </note>
    </measure>
    <measure number="2">
      <note>
        <pitch><step>D</step><octave>5</octave></pitch>
        <duration>480</duration>
        <tie type="stop"/>
        <notations><tied type="stop"/></notations>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const { script } = parseMusicXmlToScript(CROSS_MEASURE_NATURAL_TIE);

    expect(script).toHaveLength(1);
    expect(script[0].onset).toBe(0);
    expect(script[0].notes).toHaveLength(1);
    expect(script[0].notes[0]).toMatchObject({
      pitch: 'D5',
      midi: 74,
      durationDivisions: 960,
      tiedToNext: false,
    });
  });
});

describe('accidental resolution', () => {
  const ACCIDENTAL_SHARP = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
        <key><fifths>0</fifths></key>
      </attributes>
      <note>
        <pitch><step>F</step><octave>4</octave></pitch>
        <accidental>sharp</accidental>
        <duration>480</duration>
      </note>
    </measure>
  </part>
</score-partwise>`;

  const ACCIDENTAL_NATURAL = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
        <key><fifths>4</fifths></key>
      </attributes>
      <note>
        <pitch><step>G</step><octave>4</octave></pitch>
        <accidental>natural</accidental>
        <duration>480</duration>
      </note>
    </measure>
  </part>
</score-partwise>`;

  const ACCIDENTAL_CARRY = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
        <key><fifths>0</fifths></key>
      </attributes>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <accidental>sharp</accidental>
        <duration>480</duration>
      </note>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>480</duration>
      </note>
    </measure>
  </part>
</score-partwise>`;

  const ACCIDENTAL_RESET = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
        <key><fifths>0</fifths></key>
      </attributes>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <accidental>sharp</accidental>
        <duration>480</duration>
      </note>
    </measure>
    <measure number="2">
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>480</duration>
      </note>
    </measure>
  </part>
</score-partwise>`;

  const EXPLICIT_ALTER = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
        <key><fifths>0</fifths></key>
      </attributes>
      <note>
        <pitch><step>D</step><alter>1</alter><octave>5</octave></pitch>
        <accidental>flat</accidental>
        <duration>480</duration>
      </note>
    </measure>
  </part>
</score-partwise>`;

  const EXPLICIT_ALTER_EVERY_NOTE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
        <key><fifths>4</fifths></key>
      </attributes>
      <note>
        <pitch><step>B</step><alter>0</alter><octave>4</octave></pitch>
        <duration>480</duration>
      </note>
      <note>
        <pitch><step>D</step><alter>1</alter><octave>5</octave></pitch>
        <duration>480</duration>
      </note>
      <note>
        <pitch><step>F</step><alter>1</alter><octave>5</octave></pitch>
        <duration>480</duration>
      </note>
    </measure>
  </part>
</score-partwise>`;

  it('resolves a written sharp accidental without pitch alter', () => {
    const { script } = parseMusicXmlToScript(ACCIDENTAL_SHARP);

    expect(script).toHaveLength(1);
    expect(script[0].notes[0]).toMatchObject({ pitch: 'F#4', midi: 66 });
  });

  it('resolves a written natural that cancels the key signature', () => {
    const { script } = parseMusicXmlToScript(ACCIDENTAL_NATURAL);

    expect(script).toHaveLength(1);
    expect(script[0].notes[0]).toMatchObject({ pitch: 'G4', midi: 67 });
  });

  it('carries an accidental through the rest of the measure', () => {
    const { script } = parseMusicXmlToScript(ACCIDENTAL_CARRY);

    expect(script).toHaveLength(2);
    expect(script[0].notes[0]).toMatchObject({ pitch: 'C#5', midi: 73 });
    expect(script[1].notes[0]).toMatchObject({ pitch: 'C#5', midi: 73 });
  });

  it('resets carried accidentals at a barline', () => {
    const { script } = parseMusicXmlToScript(ACCIDENTAL_RESET);

    expect(script).toHaveLength(2);
    expect(script[0].notes[0]).toMatchObject({ pitch: 'C#5', midi: 73 });
    expect(script[1].notes[0]).toMatchObject({ pitch: 'C5', midi: 72 });
  });

  it('uses explicit pitch alter over accidental and carry', () => {
    const { script } = parseMusicXmlToScript(EXPLICIT_ALTER);

    expect(script).toHaveLength(1);
    expect(script[0].notes[0]).toMatchObject({ pitch: 'D#5', midi: 75 });
  });

  it('parses scores with explicit alter on every note identically to before', () => {
    const { script } = parseMusicXmlToScript(EXPLICIT_ALTER_EVERY_NOTE);

    expect(script).toHaveLength(3);
    expect(script[0].notes[0]).toMatchObject({ pitch: 'B4', midi: 71 });
    expect(script[1].notes[0]).toMatchObject({ pitch: 'D#5', midi: 75 });
    expect(script[2].notes[0]).toMatchObject({ pitch: 'F#5', midi: 78 });
  });
});

describe('parseMusicXmlToScript defensive fixes', () => {
  const SCORE_TIMEWISE = `<?xml version="1.0" encoding="UTF-8"?>
<score-timewise version="3.1">
  <measure number="1">
    <attributes>
      <divisions>480</divisions>
    </attributes>
    <note>
      <pitch>
        <step>C</step>
        <octave>4</octave>
      </pitch>
      <duration>480</duration>
    </note>
  </measure>
</score-timewise>`;

  const MULTI_PART = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
      </attributes>
      <note>
        <pitch>
          <step>C</step>
          <octave>4</octave>
        </pitch>
        <duration>480</duration>
        <staff>1</staff>
      </note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <note>
        <pitch>
          <step>D</step>
          <octave>4</octave>
        </pitch>
        <duration>480</duration>
        <staff>1</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;

  const CUE_THEN_PITCHED = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
      </attributes>
      <note>
        <cue/>
        <pitch>
          <step>C</step>
          <octave>4</octave>
        </pitch>
        <duration>480</duration>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>D</step>
          <octave>4</octave>
        </pitch>
        <duration>480</duration>
        <staff>1</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;

  const UNPITCHED_THEN_PITCHED = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
      </attributes>
      <note>
        <unpitched>
          <display-step>C</display-step>
          <display-octave>4</display-octave>
        </unpitched>
        <duration>480</duration>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>E</step>
          <octave>4</octave>
        </pitch>
        <duration>480</duration>
        <staff>1</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;

  const GRACE_THEN_PITCHED = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
      </attributes>
      <note>
        <grace/>
        <pitch>
          <step>C</step>
          <octave>4</octave>
        </pitch>
        <duration>240</duration>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>D</step>
          <octave>4</octave>
        </pitch>
        <duration>480</duration>
        <staff>1</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;

  const MEASURE_REST_THEN_PITCHED = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
      </attributes>
      <note>
        <rest measure="yes"/>
        <staff>1</staff>
      </note>
    </measure>
    <measure number="2">
      <note>
        <pitch>
          <step>C</step>
          <octave>4</octave>
        </pitch>
        <duration>480</duration>
        <staff>1</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;

  it('rejects score-timewise with a clear error', () => {
    expect(() => parseMusicXmlToScript(SCORE_TIMEWISE)).toThrow(
      /score-timewise MusicXML, which PlayRight does not support/i,
    );
  });

  it('merges a two-part score into both hands at aligned onsets', () => {
    const { script, warnings } = parseMusicXmlToScript(MULTI_PART);

    expect(warnings).toEqual([]);
    expect(script).toHaveLength(1);
    expect(script[0]).toMatchObject({ onset: 0, measureNumber: 1 });
    expect(script[0].notes).toHaveLength(2);
    expect(script[0].notes).toContainEqual(
      expect.objectContaining({ pitch: 'C4', midi: 60, hand: 'R' }),
    );
    expect(script[0].notes).toContainEqual(
      expect.objectContaining({ pitch: 'D4', midi: 62, hand: 'L' }),
    );
  });

  it('keeps two-part onsets separate when they differ by one division', () => {
    const NEAR_MISS_MULTI_PART = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>480</duration>
      </note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <forward><duration>1</duration></forward>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>480</duration>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const { script } = parseMusicXmlToScript(NEAR_MISS_MULTI_PART);

    expect(script).toHaveLength(2);
    expect(script[0]).toMatchObject({ onset: 0, measureNumber: 1 });
    expect(script[0].notes.map((note) => note.pitch)).toEqual(['C4']);
    expect(script[1]).toMatchObject({ onset: 1, measureNumber: 1 });
    expect(script[1].notes.map((note) => note.pitch)).toEqual(['D4']);
  });

  it('keeps RH and LH steps separate when onset drift is non-zero', () => {
    const CROSS_HAND_DRIFT = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>480</duration>
      </note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <forward><duration>40</duration></forward>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>480</duration>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const { script } = parseMusicXmlToScript(CROSS_HAND_DRIFT);

    expect(script).toHaveLength(2);
    expect(script[0]).toMatchObject({ onset: 0, measureNumber: 1 });
    expect(script[0].notes).toContainEqual(
      expect.objectContaining({ pitch: 'C4', hand: 'R' }),
    );
    expect(script[1]).toMatchObject({ onset: 40, measureNumber: 1 });
    expect(script[1].notes).toContainEqual(
      expect.objectContaining({ pitch: 'D4', hand: 'L' }),
    );
  });

  it('keeps consecutive bass eighth notes as separate steps after a grand-staff backup', () => {
    const GRAND_STAFF_BASS_EIGHTHS = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="50">
      <attributes>
        <divisions>480</divisions>
        <staves>2</staves>
      </attributes>
      <note>
        <pitch><step>G</step><alter>1</alter><octave>4</octave></pitch>
        <duration>960</duration>
        <voice>1</voice>
        <staff>1</staff>
      </note>
      <backup><duration>960</duration></backup>
      <note>
        <pitch><step>E</step><octave>2</octave></pitch>
        <duration>240</duration>
        <voice>5</voice>
        <staff>2</staff>
      </note>
      <note>
        <pitch><step>F</step><alter>1</alter><octave>2</octave></pitch>
        <duration>240</duration>
        <voice>5</voice>
        <staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const { script } = parseMusicXmlToScript(GRAND_STAFF_BASS_EIGHTHS);
    const bassE2Step = script.find((step) =>
      step.notes.some((note) => note.pitch === 'E2'),
    );
    const bassFSharpStep = script.find((step) =>
      step.notes.some((note) => note.pitch === 'F#2'),
    );

    expect(bassE2Step).toMatchObject({ onset: 0, measureNumber: 50 });
    expect(bassE2Step?.notes.filter((note) => note.hand === 'L')).toHaveLength(1);
    expect(bassFSharpStep).toMatchObject({ onset: 240, measureNumber: 50 });
    expect(bassFSharpStep?.notes).toEqual([
      expect.objectContaining({
        pitch: 'F#2',
        hand: 'L',
        durationDivisions: 240,
      }),
    ]);
    expect(bassE2Step).not.toBe(bassFSharpStep);
    expect(
      script.some(
        (step) =>
          step.measureNumber === 50 &&
          step.notes.some((note) => note.pitch === 'E2') &&
          step.notes.some((note) => note.pitch === 'F#2'),
      ),
    ).toBe(false);
  });

  it('does not snap nearby onsets into one step', () => {
    const NEARBY_ONSETS = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
      </attributes>
      <note>
        <pitch><step>C</step><octave>3</octave></pitch>
        <duration>240</duration>
        <staff>2</staff>
      </note>
      <note>
        <pitch><step>D</step><octave>3</octave></pitch>
        <duration>238</duration>
        <staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const { script } = parseMusicXmlToScript(NEARBY_ONSETS);

    expect(script).toHaveLength(2);
    expect(script[0]).toMatchObject({ onset: 0 });
    expect(script[1].onset).toBeGreaterThan(script[0].onset);
    expect(script[0].notes[0].hand).toBe('L');
    expect(script[1].notes[0].hand).toBe('L');
  });

  it('skips cue notes but preserves later onsets', () => {
    const { script, warnings } = parseMusicXmlToScript(CUE_THEN_PITCHED);

    expect(warnings).toEqual([]);
    expect(script).toHaveLength(1);
    expect(script[0].onset).toBe(480);
    expect(script[0].notes[0]).toMatchObject({ pitch: 'D4', midi: 62 });
    expect(script.flatMap((step) => step.notes).some((note) => note.midi === 0)).toBe(false);
  });

  it('skips unpitched notes but preserves later onsets', () => {
    const { script } = parseMusicXmlToScript(UNPITCHED_THEN_PITCHED);

    expect(script).toHaveLength(1);
    expect(script[0].onset).toBe(480);
    expect(script[0].notes[0]).toMatchObject({ pitch: 'E4', midi: 64 });
    expect(script.flatMap((step) => step.notes).some((note) => note.midi === 0)).toBe(false);
  });

  it('does not advance time for grace notes', () => {
    const { script } = parseMusicXmlToScript(GRACE_THEN_PITCHED);

    expect(script).toHaveLength(1);
    expect(script[0].onset).toBe(0);
    expect(script[0].notes[0]).toMatchObject({ pitch: 'D4', midi: 62 });
    expect(script[0].graceBefore).toEqual([
      {
        midi: 60,
        pitch: 'C4',
        hand: 'R',
        kind: 'appoggiatura',
      },
    ]);
  });

  it('does not warn when grace notes are present', () => {
    const { warnings } = parseMusicXmlToScript(GRACE_THEN_PITCHED);

    expect(warnings.some((warning) => /grace note/i.test(warning))).toBe(false);
  });

  it('advances a full measure for measure rests without duration', () => {
    const { script } = parseMusicXmlToScript(MEASURE_REST_THEN_PITCHED);

    expect(script).toHaveLength(1);
    expect(script[0].onset).toBe(1920);
    expect(script[0].notes[0]).toMatchObject({ pitch: 'C4', midi: 60 });
  });

  it('skips out-of-range notes with a warning instead of failing validation', () => {
    const OUT_OF_RANGE_THEN_PITCHED = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
      </attributes>
      <note>
        <pitch><step>C</step><octave>10</octave></pitch>
        <duration>480</duration>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>480</duration>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const { script, warnings } = parseMusicXmlToScript(OUT_OF_RANGE_THEN_PITCHED);

    expect(warnings.some((warning) => /outside the piano range/i.test(warning))).toBe(
      true,
    );
    expect(script).toHaveLength(1);
    expect(script[0].onset).toBe(480);
    expect(script[0].notes).toHaveLength(1);
    expect(script[0].notes[0]).toMatchObject({ pitch: 'D4', midi: 62 });
  });

  it('skips unrecognized pitch steps without emitting midi 0', () => {
    const UNKNOWN_STEP_THEN_PITCHED = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
      </attributes>
      <note>
        <pitch><step>H</step><octave>4</octave></pitch>
        <duration>480</duration>
      </note>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>480</duration>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const { script } = parseMusicXmlToScript(UNKNOWN_STEP_THEN_PITCHED);

    expect(script.flatMap((step) => step.notes).some((note) => note.midi === 0)).toBe(
      false,
    );
    expect(script).toHaveLength(1);
    expect(script[0].notes[0]).toMatchObject({ pitch: 'E4', midi: 64 });
  });

  it('clamps backup overshoot so onsets never go negative', () => {
    const BACKUP_OVERSHOOT = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>480</duration>
      </note>
      <backup>
        <duration>960</duration>
      </backup>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>480</duration>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const { script } = parseMusicXmlToScript(BACKUP_OVERSHOOT);

    expect(script.every((step) => step.onset >= 0)).toBe(true);
    expect(script).toHaveLength(1);
    expect(script[0].onset).toBe(0);
    expect(script[0].notes.map((note) => note.pitch)).toEqual(['C4', 'D4']);
  });
});

describe('mid-piece divisions changes', () => {
  const CHANGING_DIVISIONS = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>480</duration>
      </note>
    </measure>
    <measure number="2">
      <attributes>
        <divisions>240</divisions>
      </attributes>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>240</duration>
      </note>
    </measure>
  </part>
</score-partwise>`;

  it('normalizes onsets to a single canonical divisions base across measures', () => {
    const { script, scoreTiming } = parseMusicXmlToScript(CHANGING_DIVISIONS);

    expect(scoreTiming.divisionsPerQuarter).toBe(480);
    expect(script).toHaveLength(2);
    expect(script[0]).toMatchObject({ onset: 0, measureNumber: 1 });
    expect(script[0].notes[0]).toMatchObject({
      pitch: 'C4',
      durationDivisions: 480,
    });
    expect(script[1]).toMatchObject({ onset: 480, measureNumber: 2 });
    expect(script[1].notes[0]).toMatchObject({
      pitch: 'D4',
      durationDivisions: 480,
    });
  });
});
