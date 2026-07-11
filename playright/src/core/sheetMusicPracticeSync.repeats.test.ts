import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildPracticeVisualIndex,
  moveCursorToOffset,
  resetSheetMusicPlaybackVisualCache,
  syncSheetMusicPlaybackVisuals,
  type PracticeVisualIndex,
} from './sheetMusicPracticeSync.ts';
import { loadUnwelcomeSchoolScript } from './playbackScheduleSimulation.ts';
import type { GraphicalNote, Note, OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type { Hand, PlaybackOrder, PlaybackScript } from '../types/index.ts';

/**
 * R2 mocked-OSMD-cursor harness, run against the REAL unwelcome-school
 * fixture (src/assets/unwelcome-school.mxl) — not a synthetic stand-in.
 *
 * unwelcome-school is the only bundled asset with repeat barlines: four
 * regions with irregular volta shapes (see playback-order.repeats.test.ts for
 * the hand-derived measure walk this mirrors exactly):
 *
 *   region 1: m1-16,  replay m9-15   (ending 1 = m16 only, dropped on replay)
 *   region 2: m17-25, replay m18-22  (3-measure ending block m23-25 dropped)
 *   region 3: m26-36, replay m29-35  (ending 1 = m36 only, dropped on replay)
 *   region 4: m37-61, replay m54-58  (3-measure tail m59-61, NO ending-2
 *             volta marking at all — playback just falls through once)
 *   tail: m62-66
 *
 * script/playbackOrder here are the REAL parser output (625 document steps,
 * 822 unrolled entries, two hands, chords up to 5 notes, zero ties). Only the
 * OSMD cursor object itself is mocked (no live browser in this environment) —
 * every note, measure number, and repeat shape below is real. The walk is
 * built to mirror the REAL playbackOrder position-for-position: this encodes
 * the standing assumption (undocumented and unverifiable without a live OSMD
 * render) that OSMD's own cursor iterator, which executes repeat jumps itself
 * (handleRepetitionsAtMeasureEnd), performs the SAME measure traversal R0's
 * PlaybackOrderResolver computes from the barline markup. Tie-continuation
 * glyphs are not modeled (the fixture has none, so this is not a gap here).
 */

interface WalkPosition {
  measureNumber: number;
  measureListIndex: number;
  gNotes: GraphicalNote[];
}

interface MockOsmdHarness {
  osmd: OpenSheetMusicDisplay;
  cursorCalls: { reset: number; next: number };
  getCursorPosition: () => number;
}

function makeMockOsmd(positions: WalkPosition[]): MockOsmdHarness {
  let position = 0;
  const cursorCalls = { reset: 0, next: 0 };

  const currentPosition = () =>
    positions[Math.min(position, positions.length - 1)];

  const cursor = {
    reset: () => {
      cursorCalls.reset += 1;
      position = 0;
    },
    next: () => {
      cursorCalls.next += 1;
      position += 1;
    },
    GNotesUnderCursor: () => positions[position]?.gNotes ?? [],
    update: () => {},
    hide: () => {},
    Iterator: {
      get EndReached() {
        return position >= positions.length;
      },
      get CurrentMeasure() {
        const current = currentPosition();
        return {
          MeasureNumberXML: current.measureNumber,
          measureListIndex: current.measureListIndex,
        };
      },
      get CurrentMeasureIndex() {
        return currentPosition().measureListIndex;
      },
    },
  };

  const allGNotes = positions.flatMap((walkPosition) => walkPosition.gNotes);
  const maxMeasureListIndex = positions.reduce(
    (max, walkPosition) => Math.max(max, walkPosition.measureListIndex),
    0,
  );
  const sourceMeasures = Array.from(
    { length: maxMeasureListIndex + 1 },
    (_, index) => ({
      MeasureNumberXML: index + 1,
      measureListIndex: index,
    }),
  );

  const osmd = {
    cursor,
    EngravingRules: {
      GNote: (note: Note) =>
        allGNotes.find((gNote) => gNote.sourceNote === note) ?? null,
    },
    Sheet: { SourceMeasures: sourceMeasures },
  } as unknown as OpenSheetMusicDisplay;

  return { osmd, cursorCalls, getCursorPosition: () => position };
}

function mockGraphicalNote(midi: number, hand: Hand): GraphicalNote {
  return {
    sourceNote: {
      isRest: () => false,
      IsGraceNote: false,
      Pitch: { getHalfTone: () => midi - 12 },
      ParentStaff: { Id: hand === 'L' ? 2 : 1 },
    },
  } as GraphicalNote;
}

/** Document-order position of each measure number, assigned on first appearance in the (never-reordered) script. */
function buildMeasureListIndexMap(script: PlaybackScript): Map<number, number> {
  const map = new Map<number, number>();
  for (const step of script) {
    if (!map.has(step.measureNumber)) {
      map.set(step.measureNumber, map.size);
    }
  }
  return map;
}

/** One WalkPosition per REAL playbackOrder entry, built from the fixture's actual notes/measures. */
function buildWalkFromRealPlaybackOrder(
  script: PlaybackScript,
  playbackOrder: PlaybackOrder,
): WalkPosition[] {
  const measureListIndexByMeasure = buildMeasureListIndexMap(script);
  return playbackOrder.map((entry) => {
    const step = script[entry.stepIndex];
    return {
      measureNumber: step.measureNumber,
      measureListIndex: measureListIndexByMeasure.get(step.measureNumber)!,
      gNotes: step.notes.map((note) => mockGraphicalNote(note.midi, note.hand)),
    };
  });
}

interface RepeatRegion {
  label: string;
  firstPassEndMeasure: number;
  replayStartMeasure: number;
}

/** Hand-derived from the real score's barline markup (see file-level doc comment and playback-order.repeats.test.ts). */
const REAL_REPEAT_REGIONS: RepeatRegion[] = [
  { label: 'region 1 (m1-16 -> replay m9-15)', firstPassEndMeasure: 16, replayStartMeasure: 9 },
  { label: 'region 2 (m17-25 -> replay m18-22, discontinue ending)', firstPassEndMeasure: 25, replayStartMeasure: 18 },
  { label: 'region 3 (m26-36 -> replay m29-35)', firstPassEndMeasure: 36, replayStartMeasure: 29 },
  { label: 'region 4 (m37-61 -> replay m54-58, no ending 2)', firstPassEndMeasure: 61, replayStartMeasure: 54 },
];

let realScript: PlaybackScript;
let realPlaybackOrder: PlaybackOrder;

beforeAll(async () => {
  const result = await loadUnwelcomeSchoolScript();
  realScript = result.script;
  realPlaybackOrder = result.playbackOrder;
});

beforeEach(() => {
  resetSheetMusicPlaybackVisualCache();
});

describe('implicit duplicate-pass skipping (named regression guard) — real fixture', () => {
  it('document-order matching scans past OSMD-executed repeat snapshots without consuming a step', () => {
    const walk = buildWalkFromRealPlaybackOrder(realScript, realPlaybackOrder);
    const { osmd } = makeMockOsmd(walk);

    // No playbackOrder passed: identity-order matching must still resolve
    // every one of the 625 real document steps via forward scan through the
    // REAL 822-entry duplicated walk (four irregular volta regions), exactly
    // as it did against the synthetic single-region stand-in.
    const index = buildPracticeVisualIndex(osmd, realScript, 'two-hand', 'R');

    expect(index.stepCursorOffsets).toHaveLength(realScript.length);
    for (let stepIndex = 1; stepIndex < realScript.length; stepIndex += 1) {
      expect(index.stepCursorOffsets[stepIndex]).toBeGreaterThan(
        index.stepCursorOffsets[stepIndex - 1],
      );
    }

    const emptySteps = index.stepGraphicalNotes
      .map((notes, stepIndex) => (notes.length === 0 ? stepIndex : -1))
      .filter((stepIndex) => stepIndex >= 0);
    expect(emptySteps).toEqual([]);
  });
});

describe('per-pass cursor offsets keyed by playback order — real fixture', () => {
  let index: PracticeVisualIndex;

  beforeAll(() => {
    const walk = buildWalkFromRealPlaybackOrder(realScript, realPlaybackOrder);
    const { osmd } = makeMockOsmd(walk);
    index = buildPracticeVisualIndex(
      osmd,
      realScript,
      'two-hand',
      'R',
      realPlaybackOrder,
    );
  });

  it('assigns each (step, pass) its own cursor offset across all 822 real playback-order entries', () => {
    expect(index.orderCursorOffsets).toEqual(
      realPlaybackOrder.map((_, orderIndex) => orderIndex),
    );
    expect(index.playbackOrder).toBe(realPlaybackOrder);

    const rows = realPlaybackOrder.map((entry, orderIndex) => ({
      orderIndex,
      stepIndex: entry.stepIndex,
      passIndex: entry.passIndex,
      measure: realScript[entry.stepIndex].measureNumber,
      cursorOffset: index.orderCursorOffsets[orderIndex],
    }));
    console.log(
      `per-pass stepCursorOffsets (real unwelcome-school fixture, ${rows.length} entries):`,
    );
    console.table(rows);

    // Practice-facing per-step arrays are pass-0 only and identical to the
    // identity build across all 625 real document steps (Q4: practice ignores repeats).
    for (let stepIndex = 1; stepIndex < realScript.length; stepIndex += 1) {
      expect(index.stepCursorOffsets[stepIndex]).toBeGreaterThan(
        index.stepCursorOffsets[stepIndex - 1],
      );
    }
  });

  it.each(REAL_REPEAT_REGIONS)(
    'the repeat back-jump advances the cursor FORWARD through duplicated snapshots: $label',
    ({ firstPassEndMeasure, replayStartMeasure }) => {
      // Last entry of the first pass (the measure immediately before the jump).
      let lastFirstPassEntryIndex = -1;
      for (let i = 0; i < realPlaybackOrder.length; i += 1) {
        if (realScript[realPlaybackOrder[i].stepIndex].measureNumber === firstPassEndMeasure) {
          lastFirstPassEntryIndex = i;
        }
      }
      // First entry of the second pass (passIndex 1) at the replay's start measure.
      const firstSecondPassEntryIndex = realPlaybackOrder.findIndex(
        (entry) =>
          realScript[entry.stepIndex].measureNumber === replayStartMeasure &&
          entry.passIndex === 1,
      );

      expect(lastFirstPassEntryIndex).toBeGreaterThanOrEqual(0);
      expect(firstSecondPassEntryIndex).toBeGreaterThanOrEqual(0);
      // The jump is a direct playback-order adjacency (R0's unrolled sequence
      // has no gap between the pass-1 ending and the pass-2 repeat target).
      expect(firstSecondPassEntryIndex).toBe(lastFirstPassEntryIndex + 1);

      expect(index.orderCursorOffsets[firstSecondPassEntryIndex]).toBeGreaterThan(
        index.orderCursorOffsets[lastFirstPassEntryIndex],
      );
    },
  );
});

describe('moveCursorToOffset — real fixture', () => {
  it('advances forward from the current offset without resetting', () => {
    const walk = buildWalkFromRealPlaybackOrder(realScript, realPlaybackOrder);
    const { osmd, cursorCalls } = makeMockOsmd(walk);
    const lastOffsetRef = { current: -1 };

    moveCursorToOffset(osmd, 100, lastOffsetRef);
    const resetsAfterInitialSeek = cursorCalls.reset;

    moveCursorToOffset(osmd, 150, lastOffsetRef);

    expect(cursorCalls.reset).toBe(resetsAfterInitialSeek);
    expect(lastOffsetRef.current).toBe(150);
  });

  it('handles a target offset smaller than the current one by reset-and-advance', () => {
    const walk = buildWalkFromRealPlaybackOrder(realScript, realPlaybackOrder);
    const { osmd, cursorCalls, getCursorPosition } = makeMockOsmd(walk);
    const lastOffsetRef = { current: -1 };

    moveCursorToOffset(osmd, 200, lastOffsetRef);
    const resetsBeforeBackwardJump = cursorCalls.reset;
    const nextsBeforeBackwardJump = cursorCalls.next;

    moveCursorToOffset(osmd, 40, lastOffsetRef);

    expect(cursorCalls.reset).toBe(resetsBeforeBackwardJump + 1);
    expect(cursorCalls.next).toBe(nextsBeforeBackwardJump + 40);
    expect(getCursorPosition()).toBe(40);
    expect(lastOffsetRef.current).toBe(40);
  });
});

describe('syncSheetMusicPlaybackVisuals with a playback order — real fixture', () => {
  function syncAt(
    harness: MockOsmdHarness,
    index: PracticeVisualIndex,
    scrollStepIndex: number,
    scrollPlaybackOrderIndex: number,
    cursorOffsetRef: { current: number },
  ): void {
    syncSheetMusicPlaybackVisuals(harness.osmd, {
      visualIndex: index,
      scrollStepIndex,
      scrollPlaybackOrderIndex,
      activeNotes: [],
      container: {} as HTMLElement,
      highlightedNotes: [],
      cursorOffsetRef,
      scrollStateRef: { current: { systemKey: null, lineScrollTop: null } },
      scrollMode: 'instant',
      scrollVisualIndex: null,
      activeHand: 'R',
      engineMode: 'two-hand',
    });
  }

  it.each(REAL_REPEAT_REGIONS)(
    'moves the cursor forward with no reset on the repeat back-jump: $label',
    ({ firstPassEndMeasure, replayStartMeasure }) => {
      const walk = buildWalkFromRealPlaybackOrder(realScript, realPlaybackOrder);
      const harness = makeMockOsmd(walk);
      const index = buildPracticeVisualIndex(
        harness.osmd,
        realScript,
        'two-hand',
        'R',
        realPlaybackOrder,
      );
      const cursorOffsetRef = { current: -1 };

      let lastFirstPassEntryIndex = -1;
      for (let i = 0; i < realPlaybackOrder.length; i += 1) {
        if (realScript[realPlaybackOrder[i].stepIndex].measureNumber === firstPassEndMeasure) {
          lastFirstPassEntryIndex = i;
        }
      }
      const firstSecondPassEntryIndex = realPlaybackOrder.findIndex(
        (entry) =>
          realScript[entry.stepIndex].measureNumber === replayStartMeasure &&
          entry.passIndex === 1,
      );

      syncAt(
        harness,
        index,
        realPlaybackOrder[lastFirstPassEntryIndex].stepIndex,
        lastFirstPassEntryIndex,
        cursorOffsetRef,
      );
      const resetsBeforeJump = harness.cursorCalls.reset;

      syncAt(
        harness,
        index,
        realPlaybackOrder[firstSecondPassEntryIndex].stepIndex,
        firstSecondPassEntryIndex,
        cursorOffsetRef,
      );

      expect(cursorOffsetRef.current).toBe(
        index.orderCursorOffsets[firstSecondPassEntryIndex],
      );
      expect(harness.cursorCalls.reset).toBe(resetsBeforeJump);
    },
  );

  it('falls back to the first-pass step offset when the order index disagrees with the step', () => {
    const walk = buildWalkFromRealPlaybackOrder(realScript, realPlaybackOrder);
    const harness = makeMockOsmd(walk);
    const index = buildPracticeVisualIndex(
      harness.osmd,
      realScript,
      'two-hand',
      'R',
      realPlaybackOrder,
    );
    const cursorOffsetRef = { current: -1 };

    // Order position 5 references whatever step sits there — not step 100.
    syncAt(harness, index, 100, 5, cursorOffsetRef);

    expect(cursorOffsetRef.current).toBe(index.stepCursorOffsets[100]);
  });

  it('a genuine backward seek (deep into the piece back to the start) resets and re-advances the cursor', () => {
    const walk = buildWalkFromRealPlaybackOrder(realScript, realPlaybackOrder);
    const harness = makeMockOsmd(walk);
    const index = buildPracticeVisualIndex(
      harness.osmd,
      realScript,
      'two-hand',
      'R',
      realPlaybackOrder,
    );
    const cursorOffsetRef = { current: -1 };

    const lastEntryIndex = realPlaybackOrder.length - 1;
    syncAt(
      harness,
      index,
      realPlaybackOrder[lastEntryIndex].stepIndex,
      lastEntryIndex,
      cursorOffsetRef,
    );
    expect(cursorOffsetRef.current).toBe(index.orderCursorOffsets[lastEntryIndex]);

    const resetsBeforeSeek = harness.cursorCalls.reset;

    syncAt(harness, index, 2, 2, cursorOffsetRef);

    expect(cursorOffsetRef.current).toBe(index.orderCursorOffsets[2]);
    expect(harness.cursorCalls.reset).toBe(resetsBeforeSeek + 1);
  });
});
