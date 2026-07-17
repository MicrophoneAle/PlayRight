import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMusicXmlToScript } from './index.ts';
import type { ParseMusicXmlResult, PlaybackScript, ScriptNote } from '../../types/index.ts';
import {
  DANGLING_SLUR_START_MUSICXML,
  GRACE_INTO_MAIN_SLUR_MUSICXML,
  GRACE_TO_GRACE_SLUR_MUSICXML,
  MULTI_VOICE_SLURS_MUSICXML,
  SLUR_STOP_ON_TIE_MERGED_NOTE_MUSICXML,
} from './__fixtures__/slurs.musicxml.ts';

/**
 * S0: slur detection and pairing ONLY. slurLegatoNext is written here but
 * completely unread by anything downstream (playbackTiming/PlaybackEngine) -
 * these tests verify parse-time structural correctness (pairing, chord/tie/
 * grace edge cases, warnings, zero timeline perturbation), never playback
 * behavior.
 */

function loadXml(name: string): string {
  return readFileSync(new URL(`../../assets/${name}`, import.meta.url), 'utf8');
}

async function loadMxl(name: string): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const buffer = readFileSync(new URL(`../../assets/${name}`, import.meta.url));
  const archive = await JSZip.loadAsync(buffer);
  const scoreXml = await archive.file('score.xml')?.async('string');
  if (!scoreXml) throw new Error(`${name} missing score.xml`);
  return scoreXml;
}

function countSlurLegatoNotes(result: ParseMusicXmlResult): number {
  let count = 0;
  for (const step of result.script) {
    for (const note of step.notes) {
      if (note.slurLegatoNext) {
        count += 1;
      }
    }
  }
  return count;
}

function everyNoteLacksSlurFlag(script: PlaybackScript): boolean {
  return script.every((step) => step.notes.every((note) => note.slurLegatoNext !== true));
}

function notesAtMeasure(script: PlaybackScript, measureNumber: number): ScriptNote[] {
  return script
    .filter((step) => step.measureNumber === measureNumber)
    .flatMap((step) => step.notes);
}

function flaggedPitches(notes: ScriptNote[]): string[] {
  return notes.filter((note) => note.slurLegatoNext === true).map((note) => note.pitch).sort();
}

/** Strip every self-closed `<slur .../>` tag - every bundled/synthetic fixture writes them this way. */
function stripSlurTags(xml: string): string {
  return xml.replace(/<slur[^>]*\/>/g, '');
}

/** Deep-comparable script with slurLegatoNext removed from every note. */
function withoutSlurFlag(script: PlaybackScript): unknown {
  return script.map((step) => ({
    ...step,
    notes: step.notes.map(({ slurLegatoNext: _slurLegatoNext, ...rest }) => rest),
  }));
}

const REAL_FIXTURES: Array<{
  name: string;
  load: () => Promise<string> | string;
  /** Pinned regression snapshot - update only for an intentional parser change. */
  expectedSlurLegatoCount: number;
}> = [
  { name: 'chase-setsuna-yuki', load: () => loadXml('chase-setsuna-yuki.musicxml'), expectedSlurLegatoCount: 0 },
  { name: 'constant-moderato', load: () => loadXml('constant-moderato.musicxml'), expectedSlurLegatoCount: 0 },
  { name: 'morns-like-these', load: () => loadXml('morns-like-these-honkai-star-rail.musicxml'), expectedSlurLegatoCount: 0 },
  { name: 'playright-fanfare', load: () => loadXml('playright-fanfare.musicxml'), expectedSlurLegatoCount: 0 },
  { name: 'hoyo-mix', load: () => loadXml('if-i-can-stop-one-heart-from-breaking-hoyo-mix.musicxml'), expectedSlurLegatoCount: 5 },
  { name: 'glimpse-of-us', load: () => loadMxl('glimpse-of-us-joji.mxl'), expectedSlurLegatoCount: 0 },
  { name: 'kyrie-eleison', load: () => loadMxl('kyrie-eleison.mxl'), expectedSlurLegatoCount: 0 },
  { name: 'river-flows-in-you', load: () => loadMxl('river-flows-in-you.mxl'), expectedSlurLegatoCount: 2 },
  { name: 'tetoris', load: () => loadMxl('tetoris.mxl'), expectedSlurLegatoCount: 48 },
  { name: 'unwelcome-school', load: () => loadMxl('unwelcome-school.mxl'), expectedSlurLegatoCount: 62 },
];

const ZERO_SLUR_FIXTURES = new Set([
  'chase-setsuna-yuki',
  'constant-moderato',
  'morns-like-these',
  'playright-fanfare',
  'glimpse-of-us',
  'kyrie-eleison',
]);

describe('slur pairing - real fixtures', () => {
  for (const fixture of REAL_FIXTURES) {
    it(`${fixture.name}: pins slurLegatoNext count and zero slur warnings`, async () => {
      const xml = await fixture.load();
      const result = parseMusicXmlToScript(xml);
      const slurWarnings = result.warnings.filter((w) => w.toLowerCase().includes('slur'));

      expect(slurWarnings).toEqual([]);
      expect(countSlurLegatoNotes(result)).toBe(fixture.expectedSlurLegatoCount);

      // Explicit negative control (not just "count is 0"): iterate every note.
      if (ZERO_SLUR_FIXTURES.has(fixture.name)) {
        expect(everyNoteLacksSlurFlag(result.script)).toBe(true);
      }
    });
  }

  it('river-flows-in-you: m23 three-simultaneous-slur-numbers resolves to a boolean union, not triple-marking', async () => {
    const { script } = parseMusicXmlToScript(await loadMxl('river-flows-in-you.mxl'));
    const m23Notes = notesAtMeasure(script, 23);

    // Raw XML: <slur type="start" number="1"/><slur type="start" number="2"/>
    // <slur type="start" number="3"/> all on one E4, matched by three stops
    // on the next E4. A chord sibling (A4) rides along by document-order
    // position on both the start and stop chord, per the chord-sibling rule.
    expect(flaggedPitches(m23Notes)).toEqual(['A4', 'E4']);
    // Union, not 3x: exactly 2 notes flagged, not 6 (2 notes x 3 numbers).
    expect(m23Notes.filter((n) => n.slurLegatoNext === true)).toHaveLength(2);
  });

  it('river-flows-in-you: 7 grace-tagged slur notes and 1 grace-to-grace slur parse without error', async () => {
    const { script, warnings } = parseMusicXmlToScript(await loadMxl('river-flows-in-you.mxl'));
    const slurWarnings = warnings.filter((w) => w.toLowerCase().includes('slur'));
    expect(slurWarnings).toEqual([]);

    // Every grace-carried slur in this fixture has its stop on the very next
    // main note (the one the grace itself rides on) or on another grace -
    // both delegate to an empty or single-member range, contributing 0
    // flags. m9 (grace-to-grace, A4->C5) and m10 (grace-into-same-main-note,
    // B5) are representative instances, spot-checked here.
    const m9Notes = notesAtMeasure(script, 9);
    const m10Notes = notesAtMeasure(script, 10);
    expect(m9Notes.every((note) => note.slurLegatoNext !== true)).toBe(true);
    expect(m10Notes.every((note) => note.slurLegatoNext !== true)).toBe(true);

    // Grace notes themselves never carry the flag - GraceNoteInfo has no such field.
    const graceCount = script.reduce((sum, step) => sum + (step.graceBefore?.length ?? 0), 0);
    expect(graceCount).toBeGreaterThan(0);
  });

  it('unwelcome-school: first-ending-adjacent-to-repeat slurs (m24-25, m60-61) pair structurally correctly', async () => {
    const { script } = parseMusicXmlToScript(await loadMxl('unwelcome-school.mxl'));

    // Each measure holds three (m24/m60) or four (m25/m61) independent
    // start-chord/stop-chord slur pairs (anchor note + its chord sibling),
    // verified directly against the raw XML: e.g. m24's first pair is
    // A4(start, chord sibling A5) -> A4(stop) - the anchor and its sibling
    // both connect legato into the repeated A4/A5 that follows, matching the
    // documented chord-sibling-follows-anchor rule.
    for (const measureNumber of [24, 60]) {
      const notes = notesAtMeasure(script, measureNumber);
      expect(flaggedPitches(notes)).toEqual(['A4', 'A5', 'B4', 'B5', 'C5', 'C6']);
    }
    for (const measureNumber of [25, 61]) {
      const notes = notesAtMeasure(script, measureNumber);
      // Four pairs (C, D, F, D again) - key signature sharps C/D; D5/D6 legitimately repeats.
      expect(flaggedPitches(notes)).toEqual([
        'C#5',
        'C#6',
        'D#5',
        'D#6',
        'D5',
        'D6',
        'F5',
        'F6',
      ]);
    }
  });
});

describe('slur pairing - synthetic edge cases', () => {
  it('dangling slur start: warns, no flag set, no crash', () => {
    const { script, warnings } = parseMusicXmlToScript(DANGLING_SLUR_START_MUSICXML);
    const slurWarnings = warnings.filter((w) => w.toLowerCase().includes('slur'));

    expect(slurWarnings).toHaveLength(1);
    expect(slurWarnings[0]).toMatch(/no matching stop/);
    expect(everyNoteLacksSlurFlag(script)).toBe(true);
  });

  it('slur stop on a tie-merged note: flag resolves to the merged ScriptNote, no phantom entry', () => {
    const { script, warnings } = parseMusicXmlToScript(SLUR_STOP_ON_TIE_MERGED_NOTE_MUSICXML);
    const slurWarnings = warnings.filter((w) => w.toLowerCase().includes('slur'));
    expect(slurWarnings).toEqual([]);

    const notes = script.flatMap((step) => step.notes);
    // 2 ScriptNotes total (X and the merged A+B), never 3 - no phantom entry for B.
    expect(notes).toHaveLength(2);

    const x = notes.find((n) => n.pitch === 'D4');
    const merged = notes.find((n) => n.pitch === 'C4');
    expect(x?.slurLegatoNext).toBe(true);
    expect(merged?.slurLegatoNext).not.toBe(true);
    // Merged duration = A's 480 + B's 240 (tie merge succeeded independently of slur bookkeeping).
    expect(merged?.durationDivisions).toBe(720);
  });

  it('multi-voice: simultaneous same-numbered slurs in RH/LH do not cross-contaminate', () => {
    const { script, warnings } = parseMusicXmlToScript(MULTI_VOICE_SLURS_MUSICXML);
    const slurWarnings = warnings.filter((w) => w.toLowerCase().includes('slur'));
    expect(slurWarnings).toEqual([]);

    const notes = script.flatMap((step) => step.notes);
    const c5 = notes.find((n) => n.pitch === 'C5' && n.hand === 'R');
    const d5 = notes.find((n) => n.pitch === 'D5' && n.hand === 'R');
    const c3 = notes.find((n) => n.pitch === 'C3' && n.hand === 'L');
    const d3 = notes.find((n) => n.pitch === 'D3' && n.hand === 'L');

    expect(c5?.slurLegatoNext).toBe(true);
    expect(d5?.slurLegatoNext).not.toBe(true);
    expect(c3?.slurLegatoNext).toBe(true);
    expect(d3?.slurLegatoNext).not.toBe(true);
  });

  it('grace-to-grace slur: empty main-note range, no crash', () => {
    const { script, warnings } = parseMusicXmlToScript(GRACE_TO_GRACE_SLUR_MUSICXML);
    const slurWarnings = warnings.filter((w) => w.toLowerCase().includes('slur'));
    expect(slurWarnings).toEqual([]);

    expect(script).toHaveLength(1);
    expect(script[0].graceBefore).toHaveLength(2);
    expect(everyNoteLacksSlurFlag(script)).toBe(true);
  });

  it('grace-into-main slur: main notes X..Y-1 pattern (X legato, Y not)', () => {
    const { script, warnings } = parseMusicXmlToScript(GRACE_INTO_MAIN_SLUR_MUSICXML);
    const slurWarnings = warnings.filter((w) => w.toLowerCase().includes('slur'));
    expect(slurWarnings).toEqual([]);

    const notes = script.flatMap((step) => step.notes);
    const x = notes.find((n) => n.pitch === 'A4');
    const y = notes.find((n) => n.pitch === 'B4');
    expect(x?.slurLegatoNext).toBe(true);
    expect(y?.slurLegatoNext).not.toBe(true);
    expect(script[0].graceBefore).toHaveLength(1);
  });
});

describe('slur capture does not perturb parse-time timeline bookkeeping', () => {
  for (const fixture of REAL_FIXTURES) {
    it(`${fixture.name}: stripping slur tags produces an identical script except for slurLegatoNext`, async () => {
      const xml = await fixture.load();
      const withSlurs = parseMusicXmlToScript(xml);
      const withoutSlurs = parseMusicXmlToScript(stripSlurTags(xml));

      expect(withoutSlurs.scoreTiming).toEqual(withSlurs.scoreTiming);
      expect(withoutSlurs.playbackOrder).toEqual(withSlurs.playbackOrder);
      expect(withoutSlurFlag(withoutSlurs.script)).toEqual(withoutSlurFlag(withSlurs.script));
    });
  }

  for (const fixture of [
    { name: 'dangling-slur-start', xml: DANGLING_SLUR_START_MUSICXML },
    { name: 'slur-stop-on-tie-merged-note', xml: SLUR_STOP_ON_TIE_MERGED_NOTE_MUSICXML },
    { name: 'multi-voice-slurs', xml: MULTI_VOICE_SLURS_MUSICXML },
    { name: 'grace-to-grace-slur', xml: GRACE_TO_GRACE_SLUR_MUSICXML },
    { name: 'grace-into-main-slur', xml: GRACE_INTO_MAIN_SLUR_MUSICXML },
  ]) {
    it(`${fixture.name}: stripping slur tags produces an identical script except for slurLegatoNext`, () => {
      const withSlurs = parseMusicXmlToScript(fixture.xml);
      const withoutSlurs = parseMusicXmlToScript(stripSlurTags(fixture.xml));

      expect(withoutSlurs.scoreTiming).toEqual(withSlurs.scoreTiming);
      expect(withoutSlurFlag(withoutSlurs.script)).toEqual(withoutSlurFlag(withSlurs.script));
    });
  }
});
