import { writeFileSync } from 'node:fs';
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
import { simulatePlaybackAttackSchedule } from './playbackScheduleSimulation.ts';
import { parseMusicXmlToScript } from './parser/index.ts';
import { useEngineStore } from '../store/useEngineStore.ts';
import type { ParseMusicXmlResult } from '../types/index.ts';

/**
 * R1 gate: PlaybackEngine schedules PlaybackOrder entries (repeat unrolling)
 * through a mocked Tone transport, replayed end to end.
 *
 * The replay deliberately watches for the failure modes this project has
 * actually hit live: a scheduleOnce callback throw wedging the transport
 * queue, fractional ticks stranding events forever (the fermata freeze), and
 * events left uncleared. Those are asserted explicitly on every replay via
 * MockTransport.diagnostics — not assumed.
 */

const here = new URL('.', import.meta.url).pathname;
void here;

interface AttackRecord {
  tick: number;
  stepIndex: number;
  /** Global dispatch order across all observed callbacks. */
  seq: number;
}

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
  attacks: AttackRecord[];
  audio: AudioRecord[];
  boundaries: BoundaryRecord[];
  consoleErrors: unknown[][];
}

function parseTickDuration(duration: string | number): number {
  if (typeof duration === 'number') {
    return duration;
  }
  return Number.parseFloat(duration.replace(/i$/, ''));
}

async function replayScore(
  parseResult: Pick<ParseMusicXmlResult, 'script' | 'scoreTiming' | 'playbackOrder'>,
  options: { audioThrows?: boolean } = {},
): Promise<ReplayResult> {
  const transport = getCurrentMockTransport();
  const attacks: AttackRecord[] = [];
  const audio: AudioRecord[] = [];
  const boundaries: BoundaryRecord[] = [];
  const consoleErrors: unknown[][] = [];
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
      if (options.audioThrows) {
        throw new Error('injected audio failure');
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
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    consoleErrors.push(args);
  });

  let recording = false;
  const visualSpy = vi.spyOn(
    engine as unknown as { applyStepVisual: (stepIndex: number) => void },
    'applyStepVisual',
  );
  visualSpy.mockImplementation(function (this: unknown, stepIndex: number) {
    if (recording) {
      dispatchSeq += 1;
      attacks.push({ tick: transport.ticks, stepIndex, seq: dispatchSeq });
    }
    // Reproduce the store side effect the real method performs.
    const { script, actions } = useEngineStore.getState();
    if (script && stepIndex >= 0 && stepIndex < script.length) {
      actions.setStepIndex(stepIndex);
    }
  });

  try {
    await engine.play();
    recording = true;
    transport.run();
  } finally {
    debugSpy.mockRestore();
    errorSpy.mockRestore();
    visualSpy.mockRestore();
  }

  return { transport, attacks, audio, boundaries, consoleErrors };
}

function measureRange(start: number, end: number): number[] {
  const result: number[] = [];
  for (let measure = start; measure <= end; measure += 1) {
    result.push(measure);
  }
  return result;
}

const UNWELCOME_EXPECTED_MEASURE_WALK = [
  ...measureRange(1, 16),
  ...measureRange(9, 15),
  ...measureRange(17, 25),
  ...measureRange(18, 22),
  ...measureRange(26, 36),
  ...measureRange(29, 35),
  ...measureRange(37, 61),
  ...measureRange(54, 58),
  ...measureRange(62, 66),
];

/** Minimal one-part score: three measures of quarter notes, C4 D4 E4 F4 per bar. */
function buildTinyScoreXml(options: { malformedRepeat: boolean }): string {
  const measureNotes = (pitches: string[]): string =>
    pitches
      .map(
        (step) => `
        <note>
          <pitch><step>${step}</step><octave>4</octave></pitch>
          <duration>1</duration>
          <voice>1</voice>
          <type>quarter</type>
          <staff>1</staff>
        </note>`,
      )
      .join('');

  // The malformed variant opens a volta that never closes: R0's resolver must
  // refuse to unroll it and fall back to the identity mapping with a warning.
  const malformedBarlines = options.malformedRepeat
    ? {
        m2Left: '<barline location="left"><ending number="1" type="start"/></barline>',
        m2Right: '<barline location="right"><repeat direction="backward"/></barline>',
      }
    : { m2Left: '', m2Right: '' };

  return `<?xml version="1.0" encoding="UTF-8"?>
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
      ${measureNotes(['C', 'D', 'E', 'F'])}
    </measure>
    <measure number="2">
      ${malformedBarlines.m2Left}
      ${measureNotes(['G', 'A', 'B', 'C'])}
      ${malformedBarlines.m2Right}
    </measure>
    <measure number="3">
      ${measureNotes(['D', 'E', 'F', 'G'])}
    </measure>
  </part>
</score-partwise>`;
}

describe('R1 PlaybackEngine over PlaybackOrder: unwelcome-school replay', () => {
  beforeEach(() => {
    resetMockTransport();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('replays the full unrolled schedule; attacks match PlaybackOrder exactly', async () => {
    const parsed = await loadUnwelcomeSchoolScript();
    const { script, scoreTiming, playbackOrder } = parsed;
    const dpq = scoreTiming.divisionsPerQuarter;
    const ppq = 480;
    const ticksPerDivision = ppq / dpq;

    const replay = await replayScore(parsed);
    const { transport, attacks, audio, boundaries } = replay;

    // ---- Gate: attack sequence == R0 PlaybackOrder, with logical times ----
    expect(attacks.length).toBe(playbackOrder.length);
    for (let k = 0; k < playbackOrder.length; k += 1) {
      expect(attacks[k].stepIndex).toBe(playbackOrder[k].stepIndex);
      // unwelcome-school has no fermatas, so the unrolled attack time IS the
      // playbackOnset (asserted in quarters via the tick clock).
      expect(attacks[k].tick).toBe(
        Math.round(playbackOrder[k].playbackOnset * ticksPerDivision),
      );
    }

    // Ticks strictly increase across the whole unrolled schedule.
    for (let k = 1; k < attacks.length; k += 1) {
      expect(attacks[k].tick).toBeGreaterThan(attacks[k - 1].tick);
    }

    // Measure walk (collapsed) equals the hand-derived R0 gate table.
    const measureWalk: number[] = [];
    for (const attack of attacks) {
      const measureNumber = script[attack.stepIndex].measureNumber;
      if (measureWalk[measureWalk.length - 1] !== measureNumber) {
        measureWalk.push(measureNumber);
      }
    }
    expect(measureWalk).toEqual(UNWELCOME_EXPECTED_MEASURE_WALK);

    // ---- Jump boundaries: 8 discontinuities, release-all at each ----
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

    // At an equal tick the release-all must DISPATCH before the post-jump
    // attack (insertion order), so it can never cut the incoming notes.
    for (const boundary of boundaries) {
      const sameTickAttack = attacks.find((attack) => attack.tick === boundary.tick);
      expect(sameTickAttack).toBeDefined();
      expect(boundary.seq).toBeLessThan(sameTickAttack!.seq);
    }

    // Nothing keeps sounding across a jump: every audio note attacked before
    // a boundary is released (attack + duration) strictly before it.
    for (const boundaryTick of boundaryTicks) {
      for (const record of audio) {
        if (record.tick < boundaryTick) {
          expect(record.tick + record.durationTicks).toBeLessThan(boundaryTick);
        }
      }
    }

    // ---- Explicitly checked failure modes (mocked-transport evidence) ----
    // (1) No callback threw out of the transport queue (wedge mode).
    expect(transport.diagnostics.uncaughtCallbackErrors).toEqual([]);
    // (2) No fractional/NaN scheduleOnce ticks (the fermata-freeze mode).
    expect(transport.diagnostics.invalidTimes).toEqual([]);
    // (3) The replay terminated instead of hanging.
    expect(transport.diagnostics.iterationLimitHit).toBe(false);
    // (4) No event left neither fired nor cleared (orphan mode).
    expect(transport.pendingEvents()).toEqual([]);
    // (5) Playback completed and parked cleanly.
    expect(transport.state).toBe('paused');
    expect(useEngineStore.getState().isPlaybackFinished).toBe(true);
    // (6) No engine error path was taken during a clean replay.
    expect(replay.consoleErrors).toEqual([]);

    // ---- Text trace: full event log + boundary windows ----
    // Equal-tick events sort by observed dispatch order (seq); computed
    // audio releases carry no dispatch seq and sort after at their tick.
    const traceEvents = [
      ...attacks.map((attack) => ({
        tick: attack.tick,
        seq: attack.seq,
        type: 'attack' as const,
        detail: `step ${attack.stepIndex} m${script[attack.stepIndex].measureNumber} pass ${
          playbackOrder[attacks.indexOf(attack)].passIndex
        } q=${(attack.tick / ppq).toFixed(3)}`,
      })),
      ...audio.map((record) => ({
        tick: record.tick,
        seq: record.seq,
        type: 'audio' as const,
        detail: `midi ${record.midi} dur ${record.durationTicks.toFixed(1)}t`,
      })),
      ...audio.map((record) => ({
        tick: record.tick + record.durationTicks,
        seq: Number.MAX_SAFE_INTEGER,
        type: 'audio-release' as const,
        detail: `midi ${record.midi}`,
      })),
      ...boundaries.map((boundary) => ({
        tick: boundary.tick,
        seq: boundary.seq,
        type: 'jump-boundary-release-all' as const,
        detail: '',
      })),
    ].sort((left, right) => left.tick - right.tick || left.seq - right.seq);

    const lines = traceEvents.map(
      (event) => `${String(event.tick).padStart(7)}t ${event.type.padEnd(24)} ${event.detail}`,
    );
    const traceOut = process.env.REPLAY_TRACE_OUT;
    if (traceOut) {
      writeFileSync(traceOut, lines.join('\n'));
    }

    for (const boundaryTick of boundaryTicks) {
      const windowLines = lines.filter((line) => {
        const tick = Number.parseInt(line, 10);
        return tick >= boundaryTick - 300 && tick <= boundaryTick + 120;
      });
      console.log(`--- jump boundary @ ${boundaryTick}t (q=${boundaryTick / ppq}) ---`);
      for (const line of windowLines) console.log(line);
    }
  }, 30000);

  it('contains an injected callback throw at every attack without wedging the queue', async () => {
    const parsed = await loadUnwelcomeSchoolScript();
    const replay = await replayScore(parsed, { audioThrows: true });

    // The engine's try/catch pattern must swallow every injected failure:
    // nothing escapes into the transport queue, and the schedule still runs
    // to completion (this is the wedge scenario checked deliberately).
    expect(replay.transport.diagnostics.uncaughtCallbackErrors).toEqual([]);
    expect(replay.transport.diagnostics.iterationLimitHit).toBe(false);
    expect(replay.transport.pendingEvents()).toEqual([]);
    expect(replay.attacks.length).toBe(parsed.playbackOrder.length);
    expect(useEngineStore.getState().isPlaybackFinished).toBe(true);
    // The failures were reported (not silently ignored) via the error path.
    expect(replay.consoleErrors.length).toBeGreaterThan(0);
  }, 30000);
});

describe('R1 identity property: non-repeat fixtures schedule exactly as before', () => {
  beforeEach(() => {
    resetMockTransport();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const IDENTITY_FIXTURES: Array<[string, string]> = [
    ['constant-moderato (fermatas)', '../assets/constant-moderato.musicxml'],
    ['chase-setsuna-yuki', '../assets/chase-setsuna-yuki.musicxml'],
  ];

  for (const [name, assetPath] of IDENTITY_FIXTURES) {
    it(`${name}: engine attacks equal the pre-R1 document-order reference`, async () => {
      const { readFileSync } = await import('node:fs');
      const xml = readFileSync(new URL(assetPath, import.meta.url), 'utf8');
      const parsed = parseMusicXmlToScript(xml);

      const replay = await replayScore(parsed);

      // simulatePlaybackAttackSchedule is the untouched pre-R1 mirror of
      // document-order scheduling; with the identity mapping the entry-based
      // engine must reproduce it tick for tick, with no special-casing.
      const reference = simulatePlaybackAttackSchedule(
        parsed.script,
        parsed.scoreTiming.divisionsPerQuarter,
      );
      expect(replay.attacks.map((attack) => attack.stepIndex)).toEqual(
        reference.map((record) => record.stepIndex),
      );
      expect(replay.attacks.map((attack) => attack.tick)).toEqual(
        reference.map((record) => record.scheduledTick),
      );

      // No jump machinery may activate on an identity order.
      expect(replay.boundaries).toEqual([]);
      expect(replay.transport.diagnostics.uncaughtCallbackErrors).toEqual([]);
      expect(replay.transport.diagnostics.invalidTimes).toEqual([]);
      expect(replay.transport.pendingEvents()).toEqual([]);
      expect(replay.consoleErrors).toEqual([]);
    }, 30000);
  }
});

describe('R1 identity-fallback safety net: malformed repeat markup', () => {
  beforeEach(() => {
    resetMockTransport();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('unmatched ending falls back to identity and schedules byte-identically to the clean twin', async () => {
    const malformed = parseMusicXmlToScript(buildTinyScoreXml({ malformedRepeat: true }));
    const clean = parseMusicXmlToScript(buildTinyScoreXml({ malformedRepeat: false }));

    // R0's resolver refused the malformed markup and fell back to identity.
    expect(
      malformed.warnings.some((warning) =>
        warning.includes('falls back to document order'),
      ),
    ).toBe(true);
    expect(malformed.playbackOrder).toEqual(
      malformed.script.map((step, stepIndex) => ({
        stepIndex,
        playbackOnset: step.onset,
        passIndex: 0,
      })),
    );

    const malformedReplay = await replayScore(malformed);
    resetMockTransport();
    const cleanReplay = await replayScore(clean);

    // The scheduling trace must be byte-identical: the fallback is
    // load-bearing at R1, not just at parse time.
    expect(JSON.stringify(malformedReplay.attacks)).toBe(
      JSON.stringify(cleanReplay.attacks),
    );
    expect(JSON.stringify(malformedReplay.audio)).toBe(
      JSON.stringify(cleanReplay.audio),
    );
    expect(malformedReplay.boundaries).toEqual([]);
    expect(malformedReplay.transport.diagnostics.uncaughtCallbackErrors).toEqual([]);
    expect(malformedReplay.transport.pendingEvents()).toEqual([]);

    console.log(
      '[fallback] malformed vs clean attack trace:',
      JSON.stringify(malformedReplay.attacks),
    );
  });
});
