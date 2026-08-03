import { describe, expect, it } from 'vitest';
import {
  buildPracticeVisualIndex,
  countMatchedPracticeNotes,
  findCursorOffsetForStep,
  findSequentialStepMatch,
  graceHighlightNotes,
  isGraceOnlyAttackGNotes,
  measureListIndexForStep,
  measureNumberMatchesStep,
  practiceNotesFullyMatched,
  resetSheetMusicPlaybackVisualCache,
  syncSheetMusicPlaybackVisuals,
  type CursorKeySnapshot,
  type PracticeVisualIndex,
} from './sheetMusicPracticeSync.ts';
import type { PlaybackScript, ScriptNote, StepOrder } from '../types/index.ts';
import type { GraphicalNote, Note, OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

function snapshot(
  keys: Array<[number, 'L' | 'R']>,
): CursorKeySnapshot {
  return {
    attackKeys: new Set(keys.map(([midi, hand]) => `${midi}:${hand}`)),
  };
}

function mockGraphicalNote(
  midi: number,
  staffId: number,
  options: { isGrace?: boolean } = {},
): GraphicalNote {
  return {
    sourceNote: {
      isRest: () => false,
      IsGraceNote: options.isGrace === true,
      Pitch: { getHalfTone: () => midi - 12 },
      ParentStaff: { Id: staffId },
    },
  } as GraphicalNote;
}

function mockOsmdForNotes(notes: GraphicalNote[]): OpenSheetMusicDisplay {
  return {
    EngravingRules: {
      GNote: (note: Note) =>
        notes.find((gNote) => gNote.sourceNote === note) ?? null,
    },
  } as OpenSheetMusicDisplay;
}

function mockCursorSnapshot(options: {
  measureNumber: number;
  measureListIndex: number;
  midi: number;
  staffId?: number;
}) {
  const gNote = mockGraphicalNote(options.midi, options.staffId ?? 1);
  return {
    cursorIndex: 0,
    attackKeys: new Set([`${options.midi}:R`]),
    attackGNotes: [gNote],
    allGNotes: [gNote],
    measureNumber: options.measureNumber,
    measureListIndex: options.measureListIndex,
  };
}

describe('findCursorOffsetForStep', () => {
  it('finds the first matching cursor snapshot from searchStart', () => {
    const snapshots = [
      snapshot([[60, 'R']]),
      snapshot([[62, 'R']]),
      snapshot([[64, 'R']]),
    ];

    expect(
      findCursorOffsetForStep(snapshots, 0, new Set(['60:R'])),
    ).toBe(0);
    expect(
      findCursorOffsetForStep(snapshots, 1, new Set(['64:R'])),
    ).toBe(2);
  });

  it('returns -1 when no later snapshot contains every expected key', () => {
    const snapshots = [
      snapshot([[60, 'R']]),
      snapshot([[62, 'R']]),
    ];

    expect(
      findCursorOffsetForStep(snapshots, 0, new Set(['72:R'])),
    ).toBe(-1);
  });

  it('does not exhaust later steps when an intermediate step has no match', () => {
    const snapshots = [
      snapshot([[60, 'R']]),
      snapshot([[62, 'R']]),
      snapshot([[64, 'R']]),
      snapshot([[65, 'R']]),
    ];

    let searchStart = 0;

    const step0 = findCursorOffsetForStep(
      snapshots,
      searchStart,
      new Set(['60:R']),
    );
    expect(step0).toBe(0);
    searchStart = step0 + 1;

    const step1 = findCursorOffsetForStep(
      snapshots,
      searchStart,
      new Set(['72:R']),
    );
    expect(step1).toBe(-1);

    const step2 = findCursorOffsetForStep(
      snapshots,
      searchStart,
      new Set(['64:R']),
    );
    expect(step2).toBe(2);
  });

  it('returns the next sequential match even when duplicate keys appear later', () => {
    const snapshots = [
      snapshot([[63, 'L'], [70, 'R']]),
      snapshot([[63, 'L'], [70, 'R']]),
      snapshot([[63, 'L'], [70, 'R']]),
    ];

    expect(
      findCursorOffsetForStep(
        snapshots,
        0,
        new Set(['63:L', '70:R']),
      ),
    ).toBe(0);

    expect(
      findCursorOffsetForStep(
        snapshots,
        1,
        new Set(['63:L', '70:R']),
      ),
    ).toBe(1);
  });
});

describe('measureNumberMatchesStep', () => {
  it('matches OSMD MeasureNumberXML to the script measure number directly', () => {
    expect(measureNumberMatchesStep(1, 1)).toBe(true);
    expect(measureNumberMatchesStep(10, 10)).toBe(true);
    expect(measureNumberMatchesStep(11, 11)).toBe(true);
    expect(measureNumberMatchesStep(10, 30)).toBe(false);
  });

  it('matches pickup measures numbered 0 without index arithmetic', () => {
    expect(measureNumberMatchesStep(0, 0)).toBe(true);
    expect(measureNumberMatchesStep(0, 1)).toBe(false);
    expect(measureNumberMatchesStep(1, 0)).toBe(false);
  });
});

describe('measureListIndexForStep', () => {
  it('resolves score order from snapshots rather than XML number minus one', () => {
    const snapshots = [
      { measureNumber: 0, measureListIndex: 0 },
      { measureNumber: 10, measureListIndex: 1 },
      { measureNumber: 11, measureListIndex: 2 },
    ];

    expect(measureListIndexForStep(snapshots, 0)).toBe(0);
    expect(measureListIndexForStep(snapshots, 10)).toBe(1);
    expect(measureListIndexForStep(snapshots, 11)).toBe(2);
    expect(measureListIndexForStep(snapshots, 1)).toBeNull();
  });
});

describe('findSequentialStepMatch', () => {
  const c4: ScriptNote = { pitch: 'C4', midi: 60, hand: 'R', finger: null };

  it('prefers the measure-aligned match instead of an earlier duplicate pitch', () => {
    const earlier = mockCursorSnapshot({
      measureNumber: 1,
      measureListIndex: 0,
      midi: 60,
    });
    const later = mockCursorSnapshot({
      measureNumber: 10,
      measureListIndex: 1,
      midi: 60,
    });
    later.cursorIndex = 1;
    const snapshots = [earlier, later];
    const osmd = mockOsmdForNotes([earlier.attackGNotes[0], later.attackGNotes[0]]);

    const match = findSequentialStepMatch(osmd, snapshots, 0, [c4], 10);

    expect(match).toMatchObject({ offset: 1, endIdx: 1 });
  });

  it('does not fall back to a wrong-measure match after the target measure ends', () => {
    const measureOne = mockCursorSnapshot({
      measureNumber: 1,
      measureListIndex: 0,
      midi: 60,
    });
    const measureTwo = mockCursorSnapshot({
      measureNumber: 2,
      measureListIndex: 1,
      midi: 62,
    });
    measureTwo.cursorIndex = 1;
    const snapshots = [measureOne, measureTwo];
    const osmd = mockOsmdForNotes([
      measureOne.attackGNotes[0],
      measureTwo.attackGNotes[0],
    ]);

    const match = findSequentialStepMatch(osmd, snapshots, 1, [c4], 2);

    expect(match).toBeNull();
  });
});

describe('isGraceOnlyAttackGNotes', () => {
  it('returns true when every attack note under the cursor is grace', () => {
    expect(
      isGraceOnlyAttackGNotes([mockGraphicalNote(60, 1, { isGrace: true })]),
    ).toBe(true);
  });

  it('returns false when a main note attack is present', () => {
    expect(
      isGraceOnlyAttackGNotes([
        mockGraphicalNote(60, 1, { isGrace: true }),
        mockGraphicalNote(62, 1),
      ]),
    ).toBe(false);
  });
});

describe('grace-free cursor offset alignment', () => {
  it('keeps the first script step at offset 0 when a grace note precedes the main attack', () => {
    const grace = mockGraphicalNote(60, 1, { isGrace: true });
    const main = mockGraphicalNote(62, 1);
    const snapshots = [
      {
        cursorIndex: 0,
        attackKeys: new Set(['62:R']),
        attackGNotes: [main],
        allGNotes: [main],
        measureNumber: 1,
        measureListIndex: 0,
      },
    ];
    const d4: ScriptNote = { pitch: 'D4', midi: 62, hand: 'R', finger: null };
    const osmd = mockOsmdForNotes([main]);

    expect(isGraceOnlyAttackGNotes([grace])).toBe(true);
    expect(
      findSequentialStepMatch(osmd, snapshots, 0, [d4], 1),
    ).toMatchObject({ offset: 0 });
  });
});

interface MockCursorPosition {
  gNotes: GraphicalNote[];
  measureNumber: number;
  measureListIndex: number;
}

function mockOsmdWithCursorWalk(
  positions: MockCursorPosition[],
  allNotes: GraphicalNote[],
): OpenSheetMusicDisplay {
  let idx = 0;
  const cursor = {
    reset: () => {
      idx = 0;
    },
    next: () => {
      idx += 1;
    },
    update: () => {},
    hide: () => {},
    GNotesUnderCursor: () => positions[idx]?.gNotes ?? [],
    get Iterator() {
      return {
        EndReached: idx >= positions.length,
        CurrentMeasure: {
          MeasureNumberXML: positions[idx]?.measureNumber ?? 0,
          measureListIndex: positions[idx]?.measureListIndex ?? 0,
        },
        CurrentMeasureIndex: positions[idx]?.measureListIndex ?? 0,
      };
    },
  };

  return {
    cursor,
    EngravingRules: {
      GNote: (note: Note) =>
        allNotes.find((gNote) => gNote.sourceNote === note) ?? null,
    },
  } as unknown as OpenSheetMusicDisplay;
}

describe('grace notehead highlighting', () => {
  // Mirrors morns measure 5: E5 acciaccatura before an F#5+B4 attack.
  const graceStep: StepOrder = {
    order: 1,
    onset: 4,
    measureNumber: 5,
    notes: [
      { pitch: 'F#5', midi: 78, hand: 'R', finger: null },
      { pitch: 'B4', midi: 71, hand: 'R', finger: null },
    ],
    graceBefore: [{ midi: 76, pitch: 'E5', hand: 'R', kind: 'acciaccatura' }],
  };

  it('matches grace engraving to graceBefore by midi and notated hand', () => {
    const graceGNote = mockGraphicalNote(76, 1, { isGrace: true });
    const wrongPitch = mockGraphicalNote(77, 1, { isGrace: true });
    const wrongHand = mockGraphicalNote(76, 2, { isGrace: true });

    expect(
      graceHighlightNotes(graceStep, [graceGNote, wrongPitch, wrongHand]),
    ).toEqual([graceGNote]);
    expect(
      graceHighlightNotes({ ...graceStep, graceBefore: undefined }, [graceGNote]),
    ).toEqual([]);
    expect(graceHighlightNotes(graceStep, [])).toEqual([]);
  });

  it('keeps cursor offsets grace-free while adding the grace to the step highlight', () => {
    const c4 = mockGraphicalNote(60, 1);
    const graceE5 = mockGraphicalNote(76, 1, { isGrace: true });
    const fSharp5 = mockGraphicalNote(78, 1);
    const b4 = mockGraphicalNote(71, 1);
    const g5 = mockGraphicalNote(79, 1);
    const allNotes = [c4, graceE5, fSharp5, b4, g5];

    const script: PlaybackScript = [
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: null }],
      },
      graceStep,
      {
        order: 2,
        onset: 8,
        measureNumber: 6,
        notes: [{ pitch: 'G5', midi: 79, hand: 'R', finger: null }],
      },
    ];

    // The grace-only position between the m1 attack and the m5 chord is
    // skipped as a cursor position and carried into the m5 snapshot's engraving.
    const positions: MockCursorPosition[] = [
      { gNotes: [c4], measureNumber: 1, measureListIndex: 0 },
      { gNotes: [graceE5], measureNumber: 5, measureListIndex: 4 },
      { gNotes: [fSharp5, b4], measureNumber: 5, measureListIndex: 4 },
      { gNotes: [g5], measureNumber: 6, measureListIndex: 5 },
    ];

    const osmd = mockOsmdWithCursorWalk(positions, allNotes);
    const index = buildPracticeVisualIndex(osmd, script, 'two-hand', 'R');

    // Offsets count only non-grace positions, with no double-count and no skipped step.
    expect(index.stepCursorOffsets).toEqual([0, 1, 2]);

    // The grace notehead is highlighted alongside the step's main notes.
    expect(index.stepGraphicalNotes[1]).toContain(graceE5);
    expect(index.stepGraphicalNotes[1]).toContain(fSharp5);
    expect(index.stepGraphicalNotes[1]).toContain(b4);

    // Steps without graceBefore never pick up grace engraving.
    expect(index.stepGraphicalNotes[0]).toEqual([c4]);
    expect(index.stepGraphicalNotes[2]).toEqual([g5]);
  });

  it('produces identical cursor offsets when graceBefore metadata is absent', () => {
    const c4 = mockGraphicalNote(60, 1);
    const graceE5 = mockGraphicalNote(76, 1, { isGrace: true });
    const fSharp5 = mockGraphicalNote(78, 1);
    const b4 = mockGraphicalNote(71, 1);
    const g5 = mockGraphicalNote(79, 1);
    const allNotes = [c4, graceE5, fSharp5, b4, g5];

    const strippedGraceStep: StepOrder = {
      order: graceStep.order,
      onset: graceStep.onset,
      measureNumber: graceStep.measureNumber,
      notes: graceStep.notes,
    };
    const script: PlaybackScript = [
      {
        order: 0,
        onset: 0,
        measureNumber: 1,
        notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: null }],
      },
      strippedGraceStep,
      {
        order: 2,
        onset: 8,
        measureNumber: 6,
        notes: [{ pitch: 'G5', midi: 79, hand: 'R', finger: null }],
      },
    ];

    const positions: MockCursorPosition[] = [
      { gNotes: [c4], measureNumber: 1, measureListIndex: 0 },
      { gNotes: [graceE5], measureNumber: 5, measureListIndex: 4 },
      { gNotes: [fSharp5, b4], measureNumber: 5, measureListIndex: 4 },
      { gNotes: [g5], measureNumber: 6, measureListIndex: 5 },
    ];

    const osmd = mockOsmdWithCursorWalk(positions, allNotes);
    const index = buildPracticeVisualIndex(osmd, script, 'two-hand', 'R');

    expect(index.stepCursorOffsets).toEqual([0, 1, 2]);
    expect(index.stepGraphicalNotes[1]).not.toContain(graceE5);
  });
});

describe('practiceNotesFullyMatched', () => {
  const tiedScriptNote: ScriptNote = {
    pitch: 'C4',
    midi: 60,
    hand: 'R',
    finger: null,
  };

  it('accepts multiple graphical tie segments for one merged script note', () => {
    const collected = [mockGraphicalNote(60, 1), mockGraphicalNote(60, 1)];

    expect(collected.length).not.toBe(1);
    expect(practiceNotesFullyMatched([tiedScriptNote], collected)).toBe(true);
  });

  it('rejects when a script note is missing from the collected engraving', () => {
    const collected = [mockGraphicalNote(60, 1)];

    expect(
      practiceNotesFullyMatched(
        [
          tiedScriptNote,
          { pitch: 'E4', midi: 64, hand: 'R', finger: null },
        ],
        collected,
      ),
    ).toBe(false);
  });
});

describe('partial highlight selection', () => {
  const c4: ScriptNote = { pitch: 'C4', midi: 60, hand: 'R', finger: null };
  const e4: ScriptNote = { pitch: 'E4', midi: 64, hand: 'R', finger: null };

  it('counts matched notes without requiring a full step match', () => {
    const collected = [mockGraphicalNote(60, 1)];

    expect(countMatchedPracticeNotes([c4, e4], collected)).toBe(1);
    expect(practiceNotesFullyMatched([c4, e4], collected)).toBe(false);
  });

  it('keeps a partial engraving highlightable instead of blanking the whole step', () => {
    const collected = [mockGraphicalNote(60, 1), mockGraphicalNote(60, 1)];

    expect(countMatchedPracticeNotes([c4, e4], collected)).toBe(1);
    expect(collected.length).toBeGreaterThan(0);
    expect(practiceNotesFullyMatched([c4, e4], collected)).toBe(false);
  });
});

/**
 * Play-mode visual memo. Two separate gates share one pass:
 *   - the CONTENT key (playbackVisualKey) guards the highlight diff and must
 *     re-run whenever the sounding set changes, but not merely because a press
 *     was reallocated a new pressId;
 *   - the STEP key guards the scroll, whose anchor check reads
 *     container.scrollTop (a forced layout flush) and depends only on which
 *     step is current.
 * Measured on unwelcome-school, the step gate cut scroll entries from 1809 to
 * 822 (one per playback-order entry) over a full playthrough.
 */
describe('play-mode visual memo', () => {
  const SYSTEM = { Id: 7, Parent: { PageNumber: 1 } };

  function litNote(midi: number, staffId: number): GraphicalNote {
    const gNote = mockGraphicalNote(midi, staffId) as unknown as {
      parentVoiceEntry: unknown;
      color?: string;
      setColor: (color: string) => void;
    };
    gNote.parentVoiceEntry = {
      parentStaffEntry: { parentMeasure: { ParentMusicSystem: SYSTEM } },
    };
    gNote.setColor = (color) => {
      gNote.color = color;
    };
    return gNote as unknown as GraphicalNote;
  }

  /** Container whose scrollTop reads are counted — these are the forced layout flushes. */
  function countingContainer(): { el: HTMLElement; reads: () => number } {
    let reads = 0;
    const el = {
      get scrollTop() {
        reads += 1;
        return 0;
      },
      set scrollTop(_v: number) {},
      clientHeight: 400,
      scrollHeight: 4000,
      getBoundingClientRect: () => ({ top: 0, height: 400 }),
      querySelectorAll: () => [],
    } as unknown as HTMLElement;
    return { el, reads: () => reads };
  }

  interface Press {
    pressId: number;
    stepIndex: number;
    midi: number;
    hand: 'L' | 'R';
  }

  function harness() {
    const noteC = litNote(60, 1);
    const noteE = litNote(64, 1);
    const index = {
      stepGraphicalNotes: [[noteC], [noteC], [noteE]],
      stepCursorOffsets: [0, 1, 2],
      orderCursorOffsets: [],
      playbackOrder: [],
    } as unknown as PracticeVisualIndex;

    const osmd = {
      cursor: {
        hide: () => {},
        reset: () => {},
        next: () => {},
        update: () => {},
        // Empty is grace-free, so advanceCursorSkippingGrace steps exactly once.
        GNotesUnderCursor: () => [],
        Iterator: { EndReached: false },
      },
    } as unknown as OpenSheetMusicDisplay;

    const container = countingContainer();
    const cursorOffsetRef = { current: 0 };
    const scrollStateRef = {
      current: {
        systemKey: 'sys-p1-id7',
        lineScrollTop: 0,
        previousSystemKey: null,
        switchedAt: undefined,
      },
    };
    let highlighted: GraphicalNote[] = [];

    const sync = (scrollStepIndex: number, activeNotes: Press[]) => {
      highlighted = syncSheetMusicPlaybackVisuals(osmd, {
        visualIndex: index,
        scrollStepIndex,
        scrollPlaybackOrderIndex: -1,
        activeNotes,
        container: container.el,
        highlightedNotes: highlighted,
        cursorOffsetRef,
        scrollStateRef: scrollStateRef as never,
        scrollMode: 'instant',
        scrollVisualIndex: index,
        activeHand: 'R',
        engineMode: 'two-hand',
      });
      return highlighted;
    };

    return { sync, container, noteC, noteE, lit: () => highlighted };
  }

  it('ignores pressId churn: the same sounding pitches keep one highlight', () => {
    resetSheetMusicPlaybackVisualCache();
    const h = harness();

    const first = h.sync(0, [{ pressId: 1, stepIndex: 0, midi: 60, hand: 'R' }]);
    expect(first).toEqual([h.noteC]);

    // Same pitch, same step, a different press identity (overlapping hold).
    // The memo must HIT: it returns the previous array by reference rather
    // than rebuilding an equal one, which is how we tell a hit from a miss.
    const second = h.sync(0, [{ pressId: 99, stepIndex: 0, midi: 60, hand: 'R' }]);
    expect(second).toBe(first);
  });

  it('collapses duplicate triples so two presses of one pitch are one key', () => {
    resetSheetMusicPlaybackVisualCache();
    const h = harness();

    const one = h.sync(0, [{ pressId: 1, stepIndex: 0, midi: 60, hand: 'R' }]);
    // Adding a second press of the SAME pitch changes nothing that is painted.
    const two = h.sync(0, [
      { pressId: 1, stepIndex: 0, midi: 60, hand: 'R' },
      { pressId: 2, stepIndex: 0, midi: 60, hand: 'R' },
    ]);
    expect(two).toBe(one);
  });

  it('keeps an overlapping same-pitch hold lit until the LAST press releases', () => {
    resetSheetMusicPlaybackVisualCache();
    const h = harness();

    // Two independent presses of one pitch (the case pressIds exist for).
    h.sync(0, [
      { pressId: 1, stepIndex: 0, midi: 60, hand: 'R' },
      { pressId: 2, stepIndex: 0, midi: 60, hand: 'R' },
    ]);
    expect(h.lit()).toEqual([h.noteC]);

    // First release: the other press still sounds, so the note stays lit.
    h.sync(0, [{ pressId: 2, stepIndex: 0, midi: 60, hand: 'R' }]);
    expect(h.lit()).toEqual([h.noteC]);

    // Last release: the highlight clears.
    h.sync(0, []);
    expect(h.lit()).toEqual([]);
  });

  it('still paints the key lift on a same-pitch re-strike at the next step', () => {
    resetSheetMusicPlaybackVisualCache();
    const h = harness();

    h.sync(0, [{ pressId: 1, stepIndex: 0, midi: 60, hand: 'R' }]);
    expect(h.lit()).toEqual([h.noteC]);

    // Release paints the lift...
    h.sync(0, []);
    expect(h.lit()).toEqual([]);

    // ...then the re-strike of the SAME pitch at the next step re-lights it.
    h.sync(1, [{ pressId: 2, stepIndex: 1, midi: 60, hand: 'R' }]);
    expect(h.lit()).toEqual([h.noteC]);
  });

  it('enters the scroll once per step, not once per press', () => {
    resetSheetMusicPlaybackVisualCache();
    const h = harness();

    h.sync(0, [{ pressId: 1, stepIndex: 0, midi: 60, hand: 'R' }]);
    const afterFirstStep = h.container.reads();
    expect(afterFirstStep).toBeGreaterThan(0);

    // Press traffic within the same step must not re-enter the scroll.
    h.sync(0, []);
    h.sync(0, [{ pressId: 2, stepIndex: 0, midi: 60, hand: 'R' }]);
    h.sync(0, []);
    expect(h.container.reads()).toBe(afterFirstStep);

    // A new step re-enters it exactly once.
    h.sync(2, [{ pressId: 3, stepIndex: 2, midi: 64, hand: 'R' }]);
    expect(h.container.reads()).toBe(afterFirstStep + 1);
  });

  it('re-enters the scroll after the cache is reset (seek / stop / score change)', () => {
    resetSheetMusicPlaybackVisualCache();
    const h = harness();

    h.sync(0, [{ pressId: 1, stepIndex: 0, midi: 60, hand: 'R' }]);
    const before = h.container.reads();

    resetSheetMusicPlaybackVisualCache();
    h.sync(0, [{ pressId: 1, stepIndex: 0, midi: 60, hand: 'R' }]);
    expect(h.container.reads()).toBe(before + 1);
  });
});
