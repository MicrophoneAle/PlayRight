/**
 * Thorough beam-vs-opt validation for phrases that now route to beam under
 * PHRASE_EXACT_HISTORY_MAX_R / MAX_LEN. Brute force on every R<=4 fixture
 * phrase with len<=7 (tractable); exact DP as proxy for len 8–40.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMusicXmlToScript } from './parser/index.ts';
import {
  countRecurringPitches,
  extractHandTimelines,
  noteFingerCost,
  phraseStartCost,
  REPEAT_PITCH_FINGER_MISMATCH,
  REPEAT_PITCH_MAX_ONSET_GAP_DIVISIONS,
  REPEAT_PITCH_RUN_MAX_LENGTH,
  RETURNING_PITCH_FINGER_MISMATCH,
  segmentIntoPhrases,
  solvePhraseWithMode,
  transitionCost,
  type NoteEvent,
} from './fingeringPredictor.ts';
import type { Finger, Hand } from '../types/index.ts';

function loadXml(name: string): string {
  return readFileSync(new URL(`../assets/${name}`, import.meta.url), 'utf8');
}

async function loadMxl(name: string): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const buffer = readFileSync(new URL(`../assets/${name}`, import.meta.url));
  const archive = await JSZip.loadAsync(buffer);
  const scoreXml = await archive.file('score.xml')?.async('string');
  if (!scoreXml) throw new Error(`${name} missing score.xml`);
  return scoreXml;
}

function groupReps(phrase: NoteEvent[], hand: Hand): NoteEvent[] {
  const groups = new Map<string, NoteEvent[]>();
  const order: string[] = [];
  for (const note of phrase) {
    const key =
      note.kind === 'grace'
        ? `g:${note.stepIndex}:${note.graceIndex}`
        : `m:${note.stepIndex}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(note);
  }
  return order.map((key) => {
    const g = [...groups.get(key)!].sort((a, b) => a.midi - b.midi);
    return g[hand === 'R' ? g.length - 1 : 0];
  });
}

function shortSamePitchFollow(
  notes: NoteEvent[],
  index: number,
  gap: number,
): { active: boolean; anchorIndex: number | null } {
  if (index === 0) return { active: false, anchorIndex: null };
  const current = notes[index];
  for (let i = index - 1; i >= 0; i -= 1) {
    const previous = notes[i];
    if (previous.midi !== current.midi) continue;
    const onsetGap = current.onset - previous.onset;
    if (onsetGap > 0 && onsetGap <= gap) {
      let contiguous = true;
      for (let j = i + 1; j < index; j += 1) {
        if (notes[j].midi !== current.midi) {
          contiguous = false;
          break;
        }
      }
      if (contiguous) return { active: true, anchorIndex: i };
    }
    break;
  }
  return { active: false, anchorIndex: null };
}

function samePitchRunLength(
  notes: NoteEvent[],
  index: number,
  gap: number,
): number {
  let run = 1;
  let cursor = index;
  while (cursor > 0) {
    const follow = shortSamePitchFollow(notes, cursor, gap);
    if (!follow.active || follow.anchorIndex === null) break;
    run += 1;
    cursor = follow.anchorIndex;
  }
  return run;
}

function pathCost(notes: NoteEvent[], hand: Hand, fingers: Finger[]): number {
  const gap = REPEAT_PITCH_MAX_ONSET_GAP_DIVISIONS;
  let cost = 0;
  const firstFingerByMidi = new Map<number, Finger>();
  for (let index = 0; index < notes.length; index += 1) {
    const note = notes[index];
    const finger = fingers[index];
    const local = noteFingerCost(hand, finger, note.midi);
    const repeatFollow = shortSamePitchFollow(notes, index, gap);
    const inShortRepeatRun =
      repeatFollow.active &&
      repeatFollow.anchorIndex !== null &&
      note.authoredFinger === null &&
      samePitchRunLength(notes, index, gap) <= REPEAT_PITCH_RUN_MAX_LENGTH;

    if (index === 0) {
      cost += local + phraseStartCost(hand, finger, note, notes);
    } else {
      cost +=
        local +
        transitionCost(
          hand,
          fingers[index - 1],
          notes[index - 1].midi,
          finger,
          note.midi,
        );
      if (
        inShortRepeatRun &&
        fingers[repeatFollow.anchorIndex!] !== finger
      ) {
        cost += REPEAT_PITCH_FINGER_MISMATCH;
      }
      if (
        note.authoredFinger === null &&
        firstFingerByMidi.has(note.midi) &&
        firstFingerByMidi.get(note.midi) !== finger &&
        !repeatFollow.active
      ) {
        cost += RETURNING_PITCH_FINGER_MISMATCH;
      }
    }
    if (!firstFingerByMidi.has(note.midi)) {
      firstFingerByMidi.set(note.midi, finger);
    }
  }
  return cost;
}

function* allFingerings(n: number): Generator<Finger[]> {
  const cur = Array.from({ length: n }, () => 1 as Finger);
  while (true) {
    yield cur.slice() as Finger[];
    let i = n - 1;
    while (i >= 0 && cur[i] === 5) {
      cur[i] = 1;
      i -= 1;
    }
    if (i < 0) return;
    cur[i] = (cur[i] + 1) as Finger;
  }
}

const FIXTURES = [
  { label: 'chase-setsuna-yuki', load: () => loadXml('chase-setsuna-yuki.musicxml') },
  {
    label: 'if-i-can-stop-one-heart',
    load: () => loadXml('if-i-can-stop-one-heart-from-breaking-hoyo-mix.musicxml'),
  },
  { label: 'tetoris', load: () => loadMxl('tetoris.mxl') },
  { label: 'constant-moderato', load: () => loadXml('constant-moderato.musicxml') },
  { label: 'morns-like-these', load: () => loadXml('morns-like-these-honkai-star-rail.musicxml') },
  { label: 'unwelcome-school', load: () => loadMxl('unwelcome-school.mxl') },
  { label: 'glimpse-of-us-joji', load: () => loadMxl('glimpse-of-us-joji.mxl') },
  { label: 'river-flows-in-you', load: () => loadMxl('river-flows-in-you.mxl') },
];

describe('beam search vs optimum (R<=4 fixture phrases)', () => {
  it('matches brute force on every tractable R<=4 len<=7 phrase', async () => {
    const cases: Array<{ hand: Hand; notes: NoteEvent[]; dq: number }> = [];

    for (const fixture of FIXTURES) {
      const xml = await fixture.load();
      const { script, scoreTiming } = parseMusicXmlToScript(xml);
      const timelines = extractHandTimelines(script);
      const dq = scoreTiming.divisionsPerQuarter;
      for (const hand of ['L', 'R'] as Hand[]) {
        for (const phrase of segmentIntoPhrases(timelines[hand], dq)) {
          const notes = groupReps(phrase, hand);
          if (notes.length === 0 || notes.length > 7) continue;
          if (notes.some((n) => n.authoredFinger !== null)) continue;
          const r = countRecurringPitches(notes);
          if (r < 1 || r > 4) continue;
          cases.push({ hand, notes, dq });
        }
      }
    }

    let matched = 0;
    let maxGap = 0;
    for (const c of cases) {
      const beam = solvePhraseWithMode('beam', c.notes, c.hand, c.dq, 0);
      const beamCost = pathCost(c.notes, c.hand, beam);
      let bestCost = Infinity;
      for (const fingers of allFingerings(c.notes.length)) {
        const cost = pathCost(c.notes, c.hand, fingers);
        if (cost < bestCost) bestCost = cost;
      }
      const gap = beamCost - bestCost;
      if (gap <= 1e-6) matched += 1;
      else if (gap > maxGap) maxGap = gap;
    }

    expect(cases.length).toBeGreaterThan(50);
    expect(matched).toBe(cases.length);
    expect(maxGap).toBe(0);
  }, 300_000);

  it('matches exact DP cost on R<=4 len 8–40 phrases (allow rare gaps)', async () => {
    const cases: Array<{ hand: Hand; notes: NoteEvent[]; dq: number }> = [];

    for (const fixture of FIXTURES) {
      const xml = await fixture.load();
      const { script, scoreTiming } = parseMusicXmlToScript(xml);
      const timelines = extractHandTimelines(script);
      const dq = scoreTiming.divisionsPerQuarter;
      for (const hand of ['L', 'R'] as Hand[]) {
        for (const phrase of segmentIntoPhrases(timelines[hand], dq)) {
          const notes = groupReps(phrase, hand);
          if (notes.length < 8 || notes.length > 40) continue;
          if (notes.some((n) => n.authoredFinger !== null)) continue;
          const r = countRecurringPitches(notes);
          if (r < 1 || r > 4) continue;
          cases.push({ hand, notes, dq });
        }
      }
    }

    let matched = 0;
    let maxGap = 0;
    for (const c of cases) {
      const beam = solvePhraseWithMode('beam', c.notes, c.hand, c.dq, 0);
      const exact = solvePhraseWithMode('exact', c.notes, c.hand, c.dq, 0);
      const gap =
        pathCost(c.notes, c.hand, beam) - pathCost(c.notes, c.hand, exact);
      if (gap <= 1e-6) matched += 1;
      else if (gap > maxGap) maxGap = gap;
    }

    expect(cases.length).toBeGreaterThan(40);
    // Beam is not nested-perfect on longer phrases; keep a soft floor so
    // regressions that collapse match rate are caught.
    expect(matched / cases.length).toBeGreaterThanOrEqual(0.9);
    expect(maxGap).toBeLessThan(1000);
  }, 300_000);
});
