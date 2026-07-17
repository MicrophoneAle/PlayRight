import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCurrentMockTransport,
  resetMockTransport,
  type MockTransport,
} from './playbackTransportReplay.ts';

vi.mock('tone', async () => {
  const replay = await import('./playbackTransportReplay.ts');
  return {
    getTransport: () => replay.getCurrentMockTransport(),
    getDraw: () => ({ schedule: (callback: () => void) => callback() }),
  };
});

import { PlaybackEngine } from './PlaybackEngine.ts';
import { loadUnwelcomeSchoolScript } from './playbackScheduleSimulation.ts';
import { parseMusicXmlToScript } from './parser/index.ts';
import {
  buildConsecutiveSameNoteKeySet,
  buildFermataPlaybackContext,
  buildFinalNoteKeySet,
  buildPlaybackFermataOffsetsByStep,
  buildStepPlaybackDurationQuarterNotesByStep,
  noteDurationQuarterNotes,
  PLAYBACK_ARTICULATION_GAP_MIN_QUARTERS,
  resolveNotePlaybackDurationQuarterNotes,
  scheduledPlaybackAttackQuarterNotes,
  shouldUnifyStepPlaybackDuration,
  slurLegatoBlockedByImmediateReattack,
} from './playbackTiming.ts';
import { useEngineStore } from '../store/useEngineStore.ts';
import type { ParseMusicXmlResult, PlaybackScript } from '../types/index.ts';

/**
 * S1 schedule-level gates: slur gap suppression exercised through the REAL
 * PlaybackEngine + mocked Tone transport, against the real fixtures the S0
 * proposal reasoned about. Each claim the proposal made ("falls out for
 * free", "the clamp handles it") is asserted against replayed audio events,
 * not against design intent.
 */

const PPQ = 480;
const GRACE_NOTE_DURATION_QUARTERS = 1 / 8;

interface AudioRecord {
  tick: number;
  midi: number;
  durationTicks: number;
  seq: number;
}

interface BoundaryRecord {
  tick: number;
  seq: number;
}

interface ReplayResult {
  transport: MockTransport;
  audio: AudioRecord[];
  boundaries: BoundaryRecord[];
  attackSeqByTick: Map<number, number>;
}

function parseTickDuration(duration: string | number): number {
  if (typeof duration === 'number') {
    return duration;
  }
  return Number.parseFloat(duration.replace(/i$/, ''));
}

async function replayScore(
  parseResult: Pick<ParseMusicXmlResult, 'script' | 'scoreTiming' | 'playbackOrder'>,
): Promise<ReplayResult> {
  const transport = getCurrentMockTransport();
  const audio: AudioRecord[] = [];
  const boundaries: BoundaryRecord[] = [];
  const attackSeqByTick = new Map<number, number>();
  let dispatchSeq = 0;

  useEngineStore.setState({
    script: parseResult.script,
    scoreTiming: parseResult.scoreTiming,
    playbackOrder: parseResult.playbackOrder,
    playMode: true,
    currentStepIndex: 0,
    playingMidiNotes: [],
    playingPlaybackNotes: [],
    isPlaybackActive: false,
    isPlaybackFinished: false,
    isPlaybackPaused: false,
  });

  const engine = new PlaybackEngine();
  engine.attachAudioEngine({
    warm: async () => {},
    init: async () => {},
    scheduleAttackRelease: (midi: number, duration: string | number) => {
      dispatchSeq += 1;
      audio.push({
        tick: transport.ticks,
        midi,
        durationTicks: parseTickDuration(duration),
        seq: dispatchSeq,
      });
      if (!attackSeqByTick.has(transport.ticks)) {
        attackSeqByTick.set(transport.ticks, dispatchSeq);
      }
    },
    releaseAll: () => {},
    noteOff: () => {},
  } as never);

  const debugSpy = vi.spyOn(console, 'debug').mockImplementation((...args) => {
    if (typeof args[0] === 'string' && args[0].startsWith('[DIAG:jump-boundary]')) {
      dispatchSeq += 1;
      boundaries.push({ tick: transport.ticks, seq: dispatchSeq });
    }
  });

  try {
    await engine.play();
    transport.run();
  } finally {
    debugSpy.mockRestore();
  }

  expect(transport.diagnostics.uncaughtCallbackErrors).toEqual([]);
  expect(transport.diagnostics.invalidTimes).toEqual([]);
  expect(transport.diagnostics.iterationLimitHit).toBe(false);

  return { transport, audio, boundaries, attackSeqByTick };
}

/** Document-order timing tables mirroring the engine's pass-invariant duration pipeline. */
function buildDurationTables(script: PlaybackScript, dpq: number) {
  const finalNoteKeys = buildFinalNoteKeySet(script, dpq);
  const fermataContext = buildFermataPlaybackContext(script, dpq);
  const fermataOffsets = buildPlaybackFermataOffsetsByStep(
    script,
    dpq,
    finalNoteKeys,
    fermataContext,
  );
  const consecutiveSameNoteKeys = buildConsecutiveSameNoteKeySet(script, dpq, fermataOffsets);
  const stepDurations = buildStepPlaybackDurationQuarterNotesByStep(
    script,
    dpq,
    finalNoteKeys,
    consecutiveSameNoteKeys,
    fermataContext,
  );
  return { finalNoteKeys, fermataContext, fermataOffsets, consecutiveSameNoteKeys, stepDurations };
}

describe('S1 slur schedule integration', () => {
  beforeEach(() => {
    resetMockTransport();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('unwelcome-school: slurred notes in m24/25/60/61 play full written length through trim+clamp, boundaries hold on every pass', { timeout: 30000 }, async () => {
    const parsed = await loadUnwelcomeSchoolScript();
    const { script, scoreTiming, playbackOrder } = parsed;
    const dpq = scoreTiming.divisionsPerQuarter;
    const ticksPerDivision = PPQ / dpq;
    const tables = buildDurationTables(script, dpq);

    // Sanity: no fermatas in this fixture, so attack tick == playbackOnset.
    expect(tables.fermataContext.carryForwardSteps.size).toBe(0);

    const replay = await replayScore(parsed);
    const { audio, boundaries, attackSeqByTick } = replay;

    // Entry-adjacency boundary quarters, mirroring the engine's derivation.
    const entryAttackQuarters = playbackOrder.map(
      (entry) => entry.playbackOnset / dpq,
    );
    const nextJumpBoundaryQuarters: number[] = new Array(playbackOrder.length).fill(Infinity);
    let upcoming = Infinity;
    for (let k = playbackOrder.length - 1; k >= 0; k -= 1) {
      const next = playbackOrder[k + 1];
      if (next !== undefined && next.stepIndex !== playbackOrder[k].stepIndex + 1) {
        upcoming = entryAttackQuarters[k + 1];
      }
      nextJumpBoundaryQuarters[k] = upcoming;
    }

    let suppressedNotesChecked = 0;
    let immediateBlockedNotesChecked = 0;
    let anyFlaggedAdjacentToBoundary = false;

    for (let entryIndex = 0; entryIndex < playbackOrder.length; entryIndex += 1) {
      const stepIndex = playbackOrder[entryIndex].stepIndex;
      const step = script[stepIndex];
      if (![24, 25, 60, 61].includes(step.measureNumber)) {
        continue;
      }

      const attackQuarters = entryAttackQuarters[entryIndex];
      const attackTick = Math.round(playbackOrder[entryIndex].playbackOnset * ticksPerDivision);

      // Next entry's grace window (the engine trims releases intruding into it).
      const nextEntry = playbackOrder[entryIndex + 1];
      const nextGraceCount =
        nextEntry !== undefined ? (script[nextEntry.stepIndex].graceBefore?.length ?? 0) : 0;
      const nextAttackQuarters =
        nextEntry !== undefined ? entryAttackQuarters[entryIndex + 1] : Infinity;
      const graceWindowStart =
        nextGraceCount > 0
          ? nextAttackQuarters - nextGraceCount * GRACE_NOTE_DURATION_QUARTERS
          : null;

      for (const note of step.notes) {
        if (!note.slurLegatoNext) {
          continue;
        }

        const written = noteDurationQuarterNotes(note.durationDivisions ?? dpq, dpq);
        let expectedQuarters = resolveNotePlaybackDurationQuarterNotes(
          stepIndex,
          note,
          script,
          tables.stepDurations,
          dpq,
          tables.finalNoteKeys,
          tables.consecutiveSameNoteKeys,
          tables.fermataContext,
        );

        // Real-data split in these very measures: the melody-line slurs are
        // same-pitch pairs (A4->A4 etc.) whose next step re-attacks the same
        // key - the immediate-re-strike mask keeps their gap. Their octave
        // doubling chord siblings (A5, B5, C6, ...) are NOT re-attacked at
        // the stop step (the stop chords have no sibling) and get genuine
        // full-length legato. Both semantics are asserted against replayed
        // audio, not just the resolver.
        if (slurLegatoBlockedByImmediateReattack(script, stepIndex, note, dpq)) {
          expect(expectedQuarters).toBeLessThan(written);
          immediateBlockedNotesChecked += 1;
        } else {
          // The point of S1: gap suppressed, full written length.
          expect(expectedQuarters).toBe(written);
          suppressedNotesChecked += 1;
        }

        // Engine order: grace-window trim first, then the jump clamp.
        if (graceWindowStart !== null) {
          const release = attackQuarters + expectedQuarters;
          if (release > graceWindowStart && release <= nextAttackQuarters) {
            expectedQuarters = graceWindowStart - attackQuarters;
          }
        }
        const boundary = nextJumpBoundaryQuarters[entryIndex];
        if (Number.isFinite(boundary)) {
          const maxPlayed =
            boundary - attackQuarters - PLAYBACK_ARTICULATION_GAP_MIN_QUARTERS;
          if (expectedQuarters > maxPlayed) {
            expectedQuarters = Math.max(Math.min(expectedQuarters, maxPlayed), 0.01);
            anyFlaggedAdjacentToBoundary = true;
          }
        }

        const record = audio.find(
          (candidate) => candidate.tick === attackTick && candidate.midi === note.midi,
        );
        expect(record).toBeDefined();
        expect(record!.durationTicks / PPQ).toBeCloseTo(expectedQuarters, 6);
      }
    }

    // 6 flags in m24 + 8 in m25 + 6 in m60 + 8 in m61 (S0 pinned data); the
    // first-ending measures play exactly once each. Both classes must be
    // present or the split assertion above proved nothing.
    expect(suppressedNotesChecked + immediateBlockedNotesChecked).toBe(28);
    expect(suppressedNotesChecked).toBeGreaterThan(0);
    expect(immediateBlockedNotesChecked).toBeGreaterThan(0);
    // Real-data finding (reported, not assumed): unwelcome-school's slurs end
    // one note before the repeat barline, so no FLAGGED note directly abuts a
    // jump boundary here. The synthetic slur-across-jump test below covers
    // that case explicitly.
    expect(anyFlaggedAdjacentToBoundary).toBe(false);

    // R1 gates must still hold with the longer slurred durations: all 8
    // boundaries fire, each release-all dispatches before the post-jump
    // attack at its tick, and no audio release crosses any boundary.
    const boundaryTicks: number[] = [];
    for (let k = 0; k + 1 < playbackOrder.length; k += 1) {
      if (playbackOrder[k + 1].stepIndex !== playbackOrder[k].stepIndex + 1) {
        boundaryTicks.push(
          Math.round(playbackOrder[k + 1].playbackOnset * ticksPerDivision),
        );
      }
    }
    expect(boundaryTicks.length).toBe(8);
    expect(boundaries.map((boundary) => boundary.tick)).toEqual(boundaryTicks);
    for (const boundary of boundaries) {
      const attackSeq = attackSeqByTick.get(boundary.tick);
      expect(attackSeq).toBeDefined();
      expect(boundary.seq).toBeLessThan(attackSeq!);
    }
    const boundaryCrossings = audio.filter((record) =>
      boundaryTicks.some(
        (boundaryTick) =>
          record.tick < boundaryTick && record.tick + record.durationTicks >= boundaryTick,
      ),
    );
    expect(boundaryCrossings).toEqual([]);

    // Pass-invariance: a repeated step (m18-22 / m54-58 regions) sounds each
    // note for the same duration on both passes. Skip entries where the pass
    // adjacency legitimately differs (boundary-adjacent, or grace window of
    // the following entry differs between passes).
    const entriesByStep = new Map<number, number[]>();
    playbackOrder.forEach((entry, entryIndex) => {
      const list = entriesByStep.get(entry.stepIndex) ?? [];
      list.push(entryIndex);
      entriesByStep.set(entry.stepIndex, list);
    });

    const audioByTick = new Map<number, AudioRecord[]>();
    for (const record of audio) {
      const list = audioByTick.get(record.tick) ?? [];
      list.push(record);
      audioByTick.set(record.tick, list);
    }

    let passInvariantComparisons = 0;
    const passInvarianceViolations: string[] = [];
    for (const [stepIndex, entryIndices] of entriesByStep) {
      if (entryIndices.length < 2) {
        continue;
      }
      const adjacencyComparable = entryIndices.every((entryIndex) => {
        if (Number.isFinite(nextJumpBoundaryQuarters[entryIndex])) {
          const boundary = nextJumpBoundaryQuarters[entryIndex];
          // Only exclude when the boundary is close enough to clamp anything.
          const attack = entryAttackQuarters[entryIndex];
          if (boundary - attack < 8) {
            const next = playbackOrder[entryIndex + 1];
            if (next !== undefined && next.stepIndex !== stepIndex + 1) {
              return false;
            }
          }
        }
        const next = playbackOrder[entryIndex + 1];
        const nextGraces =
          next !== undefined ? (script[next.stepIndex].graceBefore?.length ?? 0) : 0;
        return nextGraces === 0;
      });
      if (!adjacencyComparable) {
        continue;
      }

      const durationsPerOccurrence = entryIndices.map((entryIndex) => {
        const attackTick = audioByTick.get(
          Math.round(playbackOrder[entryIndex].playbackOnset * ticksPerDivision),
        );
        return (attackTick ?? [])
          .map((record) => `${record.midi}:${record.durationTicks.toFixed(3)}`)
          .sort()
          .join('|');
      });
      for (let occurrence = 1; occurrence < durationsPerOccurrence.length; occurrence += 1) {
        if (durationsPerOccurrence[occurrence] !== durationsPerOccurrence[0]) {
          passInvarianceViolations.push(
            `step ${stepIndex}: ${durationsPerOccurrence[0]} != ${durationsPerOccurrence[occurrence]}`,
          );
        }
        passInvariantComparisons += 1;
      }
    }
    expect(passInvarianceViolations).toEqual([]);
    expect(passInvariantComparisons).toBeGreaterThan(20);
  });

  it('synthetic slur across a backward jump: clamp caps pass 1, pass 2 connects legato at full length', async () => {
    // m1(C D E F) m2(G A B C5 :|) m3(D E F G). Slur: m2's last note (C5) ->
    // m3's first note (D4) - written across the repeat barline. Unroll:
    // m1 m2 | m1 m2 | m3. On pass 1 the flagged C5 is the last entry before
    // the backward jump; on pass 2 it flows into m3 contiguously.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff>
        <notations><slur type="start" number="1"/></notations>
      </note>
      <barline location="right"><repeat direction="backward"/></barline>
    </measure>
    <measure number="3">
      <note>
        <pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff>
        <notations><slur type="stop" number="1"/></notations>
      </note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;

    const parsed = parseMusicXmlToScript(xml);
    const { script, playbackOrder } = parsed;

    // S0 pairing sanity: exactly one flagged note - m2's C5 - and the stop
    // note (m3's D4) is NOT flagged.
    const flagged = script.flatMap((step) => step.notes.filter((note) => note.slurLegatoNext));
    expect(flagged).toHaveLength(1);
    expect(flagged[0].pitch).toBe('C5');
    // Repeat unrolled: 4+4+4+4+4 entries, C5 played twice.
    expect(playbackOrder).toHaveLength(20);

    const replay = await replayScore(parsed);
    const { audio, boundaries } = replay;

    const c5Records = audio
      .filter((record) => record.midi === 72)
      .sort((left, right) => left.tick - right.tick);
    expect(c5Records).toHaveLength(2);

    // Pass 1 (tick 7q = 3360): boundary at 8q. Full written (1q) would cross
    // it; the clamp must cap at 1 - 0.02 = 0.98q. If the clamp did NOT apply
    // to slur-suppressed durations, this would read 480 ticks and FAIL; if
    // slur suppression did not fire at all, it would read 463.2 and FAIL.
    expect(c5Records[0].tick).toBe(7 * PPQ);
    expect(c5Records[0].durationTicks / PPQ).toBeCloseTo(
      1 - PLAYBACK_ARTICULATION_GAP_MIN_QUARTERS,
      6,
    );

    // Pass 2 (tick 15q): no boundary follows - the slur connects into m3 at
    // the FULL written length. Pre-S1 value was 0.965q (gap) - FAIL if seen.
    expect(c5Records[1].tick).toBe(15 * PPQ);
    expect(c5Records[1].durationTicks / PPQ).toBeCloseTo(1, 6);

    // The boundary release-all fired exactly once, at the jump target attack.
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0].tick).toBe(8 * PPQ);

    // The slur's stop note (m3 first, D4=62) resumes its own gap: 0.965q.
    const d4M3 = audio.find((record) => record.tick === 16 * PPQ && record.midi === 62);
    expect(d4M3).toBeDefined();
    expect(d4M3!.durationTicks / PPQ).toBeCloseTo(0.965, 6);
  });

  it('river-flows-in-you: grace-window trim yields identical durations whether or not the pre-grace note is slurred (real grace data)', async () => {
    async function loadRiverFlows(): Promise<ParseMusicXmlResult> {
      const JSZip = (await import('jszip')).default;
      const buffer = readFileSync(new URL('../assets/river-flows-in-you.mxl', import.meta.url));
      const archive = await JSZip.loadAsync(buffer);
      const scoreXml = await archive.file('score.xml')?.async('string');
      if (!scoreXml) throw new Error('river-flows-in-you.mxl missing score.xml');
      return parseMusicXmlToScript(scoreXml);
    }

    const baseline = await loadRiverFlows();
    const dpq = baseline.scoreTiming.divisionsPerQuarter;
    const tables = buildDurationTables(baseline.script, dpq);

    // Candidates: notes on the step immediately before a graced step whose
    // written end abuts the graced attack (the melodic predecessor the grace
    // steals its time from), on steps without fermata unification.
    interface Candidate {
      stepIndex: number;
      midi: number;
      attackTick: number;
      graceWindowStartQuarters: number;
      attackQuarters: number;
    }
    const candidates: Candidate[] = [];
    for (let stepIndex = 0; stepIndex + 1 < baseline.script.length; stepIndex += 1) {
      const nextStep = baseline.script[stepIndex + 1];
      const graceCount = nextStep.graceBefore?.length ?? 0;
      if (graceCount === 0) {
        continue;
      }
      const step = baseline.script[stepIndex];
      if (shouldUnifyStepPlaybackDuration(step, stepIndex, tables.fermataContext)) {
        continue;
      }
      const attackQuarters = scheduledPlaybackAttackQuarterNotes(
        step.onset,
        dpq,
        tables.fermataOffsets[stepIndex],
      );
      const nextAttackQuarters = scheduledPlaybackAttackQuarterNotes(
        nextStep.onset,
        dpq,
        tables.fermataOffsets[stepIndex + 1],
      );
      const graceWindowStartQuarters =
        nextAttackQuarters - graceCount * GRACE_NOTE_DURATION_QUARTERS;
      if (graceWindowStartQuarters <= attackQuarters) {
        continue;
      }
      for (const note of step.notes) {
        if (note.tiedToNext) {
          continue;
        }
        const written = noteDurationQuarterNotes(note.durationDivisions ?? dpq, dpq);
        // Abutting: written end == graced attack (within epsilon).
        if (Math.abs(attackQuarters + written - nextAttackQuarters) > 1e-6) {
          continue;
        }
        candidates.push({
          stepIndex,
          midi: note.midi,
          attackTick: Math.round(attackQuarters * PPQ),
          graceWindowStartQuarters,
          attackQuarters,
        });
      }
    }
    // The test is meaningless if no real abutting pre-grace notes exist.
    expect(candidates.length).toBeGreaterThan(0);

    const baselineReplay = await replayScore(baseline);

    // Second run: identical score, but every candidate note carries the slur
    // flag (as if a slur connected it into the graced note - the real
    // notation pattern the 7 grace-slur tags in this fixture represent).
    resetMockTransport();
    const flaggedParse = await loadRiverFlows();
    for (const candidate of candidates) {
      for (const note of flaggedParse.script[candidate.stepIndex].notes) {
        if (note.midi === candidate.midi && !note.tiedToNext) {
          note.slurLegatoNext = true;
        }
      }
    }
    const flaggedReplay = await replayScore(flaggedParse);

    let trimmedComparisons = 0;
    for (const candidate of candidates) {
      const baselineRecord = baselineReplay.audio.find(
        (record) => record.tick === candidate.attackTick && record.midi === candidate.midi,
      );
      const flaggedRecord = flaggedReplay.audio.find(
        (record) => record.tick === candidate.attackTick && record.midi === candidate.midi,
      );
      expect(baselineRecord).toBeDefined();
      expect(flaggedRecord).toBeDefined();

      // Both runs must land exactly on the grace window start: the trim caps
      // the un-slurred release (written - gap intrudes into the window since
      // gap < the 0.125q-per-grace window) AND the slurred release (== next
      // attack). If the trim's `release <= nextAttack` boundary condition
      // mishandled the slurred equality case, the flagged run would keep the
      // full written duration and this equality FAILS.
      const expectedTrimmedQuarters =
        candidate.graceWindowStartQuarters - candidate.attackQuarters;
      expect(baselineRecord!.durationTicks / PPQ).toBeCloseTo(expectedTrimmedQuarters, 6);
      expect(flaggedRecord!.durationTicks / PPQ).toBeCloseTo(expectedTrimmedQuarters, 6);
      expect(flaggedRecord!.durationTicks).toBeCloseTo(baselineRecord!.durationTicks, 6);
      trimmedComparisons += 1;
    }
    expect(trimmedComparisons).toBe(candidates.length);
  });
});
