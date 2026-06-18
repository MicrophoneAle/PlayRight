import type {
  GraphicalNote,
  Note,
  OpenSheetMusicDisplay,
} from 'opensheetmusicdisplay';
import { getPracticeNotes } from './practiceSteps.ts';
import type { EngineMode, Hand, PlaybackScript, ScriptNote } from '../types/index.ts';
import type { SheetScrollMode } from '../store/useEngineStore.ts';

const HIGHLIGHT_COLOR = '#10b981';
const DEFAULT_NOTE_COLOR = '#000000';

/** Color note engraving only — avoids fingerings (separate staff labels). */
const NOTE_HIGHLIGHT_OPTIONS = {
  applyToNoteheads: true,
  applyToStem: true,
  applyToFlag: true,
  applyToBeams: true,
  applyToTies: true,
  applyToModifiers: true,
  applyToLedgerLines: true,
  applyToSlurs: false,
  applyToLyrics: false,
} as const;

export interface PracticeVisualIndex {
  stepCursorOffsets: number[];
  stepGraphicalNotes: GraphicalNote[][];
}

interface CursorSnapshot {
  cursorIndex: number;
  attackKeys: Set<string>;
  attackGNotes: GraphicalNote[];
}

function osmdNoteMidi(note: Note): number {
  return note.Pitch.getHalfTone() + 12;
}

function osmdNoteHand(note: Note): Hand {
  return note.ParentStaff.Id === 2 ? 'L' : 'R';
}

function noteKey(midi: number, hand: Hand): string {
  return `${midi}:${hand}`;
}

function isTieContinuation(note: Note): boolean {
  const tie = note.NoteTie;
  if (!tie) {
    return false;
  }

  return tie.StartNote !== note;
}

function practiceKeysForStep(
  script: PlaybackScript,
  stepIndex: number,
  engineMode: EngineMode,
  activeHand: Hand,
): Set<string> {
  const keys = new Set<string>();
  const step = script[stepIndex];
  if (!step) {
    return keys;
  }

  for (const practiceNote of getPracticeNotes(step, engineMode, activeHand)) {
    keys.add(noteKey(practiceNote.midi, practiceNote.hand));
  }

  return keys;
}

function keysFromAttackGNotes(gNotes: GraphicalNote[]): Set<string> {
  const keys = new Set<string>();
  for (const gNote of gNotes) {
    const source = gNote.sourceNote;
    if (source.isRest() || isTieContinuation(source)) {
      continue;
    }
    keys.add(noteKey(osmdNoteMidi(source), osmdNoteHand(source)));
  }
  return keys;
}

function stepMatchesKeys(expected: Set<string>, atCursor: Set<string>): boolean {
  if (expected.size === 0) {
    return false;
  }

  for (const key of expected) {
    if (!atCursor.has(key)) {
      return false;
    }
  }

  return true;
}

function graphicalNoteFromSource(
  osmd: OpenSheetMusicDisplay,
  note: Note,
): GraphicalNote | null {
  try {
    return osmd.EngravingRules.GNote(note);
  } catch {
    return null;
  }
}

function noteMatchesPractice(
  note: Note,
  practiceNotes: ScriptNote[],
): boolean {
  if (note.isRest()) {
    return false;
  }

  const midi = osmdNoteMidi(note);
  const hand = osmdNoteHand(note);
  return practiceNotes.some(
    (practiceNote) => practiceNote.midi === midi && practiceNote.hand === hand,
  );
}

function collectGraphicalNotesWithTies(
  osmd: OpenSheetMusicDisplay,
  attackGNotes: GraphicalNote[],
  practiceNotes: ScriptNote[],
): GraphicalNote[] {
  const results: GraphicalNote[] = [];
  const seen = new Set<Note>();

  for (const attackGNote of attackGNotes) {
    const source = attackGNote.sourceNote;
    if (!noteMatchesPractice(source, practiceNotes)) {
      continue;
    }

    const tie = source.NoteTie;
    const tiedSources = tie ? tie.Notes : [source];

    for (const tiedNote of tiedSources) {
      if (seen.has(tiedNote) || !noteMatchesPractice(tiedNote, practiceNotes)) {
        continue;
      }

      const gNote = graphicalNoteFromSource(osmd, tiedNote);
      if (!gNote) {
        continue;
      }

      seen.add(tiedNote);
      results.push(gNote);
    }
  }

  return results;
}

function walkCursorSnapshots(osmd: OpenSheetMusicDisplay): CursorSnapshot[] {
  const cursor = osmd.cursor;
  const snapshots: CursorSnapshot[] = [];

  cursor.reset();

  for (let cursorIndex = 0; cursorIndex < 200_000; cursorIndex += 1) {
    const gNotes = cursor.GNotesUnderCursor();
    const attackGNotes = gNotes.filter(
      (gNote) =>
        !gNote.sourceNote.isRest() && !isTieContinuation(gNote.sourceNote),
    );

    snapshots.push({
      cursorIndex,
      attackKeys: keysFromAttackGNotes(gNotes),
      attackGNotes,
    });

    const iterator = cursor.Iterator;
    if (iterator?.EndReached) {
      break;
    }

    cursor.next();
  }

  cursor.reset();
  return snapshots;
}

/** Build a practice-step index in a single cursor pass (linear time). */
export function buildPracticeVisualIndex(
  osmd: OpenSheetMusicDisplay,
  script: PlaybackScript,
  engineMode: EngineMode,
  activeHand: Hand,
): PracticeVisualIndex {
  const snapshots = walkCursorSnapshots(osmd);
  const stepCursorOffsets = new Array<number>(script.length).fill(0);
  const stepGraphicalNotes: GraphicalNote[][] = script.map(() => []);

  let snapshotIndex = 0;
  let lastCursorOffset = 0;

  for (let stepIndex = 0; stepIndex < script.length; stepIndex += 1) {
    const expected = practiceKeysForStep(
      script,
      stepIndex,
      engineMode,
      activeHand,
    );
    const practiceNotes = getPracticeNotes(
      script[stepIndex],
      engineMode,
      activeHand,
    );

    if (expected.size === 0) {
      stepCursorOffsets[stepIndex] = lastCursorOffset;
      continue;
    }

    let matched = false;

    while (snapshotIndex < snapshots.length) {
      const snapshot = snapshots[snapshotIndex];
      snapshotIndex += 1;

      if (!stepMatchesKeys(expected, snapshot.attackKeys)) {
        continue;
      }

      stepCursorOffsets[stepIndex] = snapshot.cursorIndex;
      lastCursorOffset = snapshot.cursorIndex;
      stepGraphicalNotes[stepIndex] = collectGraphicalNotesWithTies(
        osmd,
        snapshot.attackGNotes,
        practiceNotes,
      );
      matched = true;
      break;
    }

    if (!matched) {
      stepCursorOffsets[stepIndex] = lastCursorOffset;
    }
  }

  osmd.cursor.reset();
  return { stepCursorOffsets, stepGraphicalNotes };
}

function moveCursorToOffset(
  osmd: OpenSheetMusicDisplay,
  offset: number,
  lastOffsetRef: { current: number },
): void {
  const cursor = osmd.cursor;

  if (lastOffsetRef.current < 0 || offset < lastOffsetRef.current) {
    cursor.reset();
    for (let i = 0; i < offset; i += 1) {
      cursor.next();
    }
  } else {
    for (let i = lastOffsetRef.current; i < offset; i += 1) {
      cursor.next();
    }
  }

  lastOffsetRef.current = offset;
  cursor.update();
}

function resetGraphicalNotes(notes: GraphicalNote[]): void {
  for (const gNote of notes) {
    gNote.setColor(DEFAULT_NOTE_COLOR, NOTE_HIGHLIGHT_OPTIONS);
  }
}

function highlightGraphicalNotes(notes: GraphicalNote[]): void {
  for (const gNote of notes) {
    gNote.setColor(HIGHLIGHT_COLOR, NOTE_HIGHLIGHT_OPTIONS);
  }
}

interface VexFlowGraphicNote extends GraphicalNote {
  getVFNoteSVG?: () => HTMLElement;
  getTieSVGs?: () => HTMLElement[];
}

function unionRects(a: DOMRect, b: DOMRect): DOMRect {
  const top = Math.min(a.top, b.top);
  const left = Math.min(a.left, b.left);
  const bottom = Math.max(a.bottom, b.bottom);
  const right = Math.max(a.right, b.right);
  return new DOMRect(left, top, right - left, bottom - top);
}

function parseSvgTranslateY(element: Element): number | null {
  const transform = element.getAttribute('transform');
  if (!transform) {
    return null;
  }

  const match = transform.match(
    /translate\(\s*[-\d.eE+]+\s*,\s*([-\d.eE+]+)\s*\)/,
  );
  return match ? parseFloat(match[1]) : null;
}

function getTopStavesForNote(gNote: GraphicalNote): Element[] {
  const vfNote = gNote as VexFlowGraphicNote;
  const noteElement =
    typeof vfNote.getVFNoteSVG === 'function' ? vfNote.getVFNoteSVG() : null;
  if (!noteElement) {
    return [];
  }

  const stave = noteElement.closest('.vf-stave');
  if (!stave) {
    return [];
  }

  const parent = stave.parentElement;
  return parent ? [...parent.querySelectorAll('.vf-stave')] : [stave];
}

/** Stable staff-system id (SVG y), unchanged by container scroll. */
function getMusicSystemKey(gNote: GraphicalNote): string | null {
  const staves = getTopStavesForNote(gNote);
  if (staves.length === 0) {
    return null;
  }

  const topStave = staves[0];
  const translateY = parseSvgTranslateY(topStave);
  if (translateY !== null) {
    return `sys-y-${Math.round(translateY)}`;
  }

  const staveId = topStave.getAttribute('id');
  return staveId ? `sys-id-${staveId}` : null;
}

function getNotesSystemKey(notes: GraphicalNote[]): string | null {
  for (const gNote of notes) {
    const key = getMusicSystemKey(gNote);
    if (key) {
      return key;
    }
  }

  return null;
}

/** Grand-staff system bounds (both staves) for a graphical note. */
function getMusicSystemBounds(gNote: GraphicalNote): DOMRect | null {
  const staves = getTopStavesForNote(gNote);
  if (staves.length === 0) {
    const vfNote = gNote as VexFlowGraphicNote;
    const noteElement =
      typeof vfNote.getVFNoteSVG === 'function' ? vfNote.getVFNoteSVG() : null;
    return noteElement ? noteElement.getBoundingClientRect() : null;
  }

  if (staves.length === 1) {
    return staves[0].getBoundingClientRect();
  }

  return staves.reduce<DOMRect | null>((bounds, staveElement) => {
    const rect = staveElement.getBoundingClientRect();
    return bounds ? unionRects(bounds, rect) : rect;
  }, null);
}

function getNotesSystemBounds(notes: GraphicalNote[]): DOMRect | null {
  let bounds: DOMRect | null = null;

  for (const gNote of notes) {
    const systemBounds = getMusicSystemBounds(gNote);
    if (!systemBounds) {
      continue;
    }

    bounds = bounds ? unionRects(bounds, systemBounds) : systemBounds;
  }

  return bounds;
}

const activeScrollAnimations = new WeakMap<HTMLElement, number>();

function animateScrollTop(
  container: HTMLElement,
  targetScrollTop: number,
  scrollMode: SheetScrollMode,
): void {
  const existing = activeScrollAnimations.get(container);
  if (existing !== undefined) {
    cancelAnimationFrame(existing);
    activeScrollAnimations.delete(container);
  }

  const clampedTarget = Math.max(0, targetScrollTop);

  if (scrollMode === 'instant') {
    container.scrollTop = clampedTarget;
    return;
  }

  const startScrollTop = container.scrollTop;
  const distance = clampedTarget - startScrollTop;

  if (Math.abs(distance) < 1) {
    container.scrollTop = clampedTarget;
    return;
  }

  const duration = Math.min(700, Math.max(280, Math.abs(distance) * 0.75));
  const startTime = performance.now();

  const tick = (now: number) => {
    const progress = Math.min(1, (now - startTime) / duration);
    const eased = 1 - (1 - progress) ** 3;
    container.scrollTop = startScrollTop + distance * eased;

    if (progress < 1) {
      const frame = requestAnimationFrame(tick);
      activeScrollAnimations.set(container, frame);
    } else {
      activeScrollAnimations.delete(container);
    }
  };

  const frame = requestAnimationFrame(tick);
  activeScrollAnimations.set(container, frame);
}

function scrollContainerToMusicSystem(
  container: HTMLElement,
  notes: GraphicalNote[],
  scrollState: { current: { systemKey: string | null } },
  scrollMode: SheetScrollMode,
): void {
  const padding = 12;
  const systemKey = getNotesSystemKey(notes);
  if (!systemKey) {
    return;
  }

  const systemRect = getNotesSystemBounds(notes);
  if (!systemRect) {
    return;
  }

  const containerRect = container.getBoundingClientRect();
  const systemTop =
    systemRect.top - containerRect.top + container.scrollTop;

  const previousSystemKey = scrollState.current.systemKey;
  const isNewStaffLine =
    previousSystemKey !== null && systemKey !== previousSystemKey;

  scrollState.current.systemKey = systemKey;

  if (!isNewStaffLine) {
    return;
  }

  const targetScrollTop = Math.max(0, systemTop - padding);
  animateScrollTop(container, targetScrollTop, scrollMode);
}

export function syncSheetMusicPracticeVisuals(
  osmd: OpenSheetMusicDisplay,
  options: {
    stepIndex: number;
    visualIndex: PracticeVisualIndex | null;
    expectedMidiNotes: number[];
    practiceNotes: ScriptNote[];
    container: HTMLElement;
    highlightedNotes: GraphicalNote[];
    cursorOffsetRef: { current: number };
    scrollStateRef: { current: { systemKey: string | null } };
    scrollMode: SheetScrollMode;
  },
): GraphicalNote[] {
  const {
    stepIndex,
    visualIndex,
    expectedMidiNotes,
    practiceNotes,
    container,
    highlightedNotes,
    cursorOffsetRef,
    scrollStateRef,
    scrollMode,
  } = options;

  resetGraphicalNotes(highlightedNotes);

  const cursor = osmd.cursor;
  if (!cursor || !visualIndex || expectedMidiNotes.length === 0) {
    cursorOffsetRef.current = -1;
    cursor?.hide();
    return [];
  }

  const toHighlightFromIndex = visualIndex.stepGraphicalNotes[stepIndex] ?? [];
  const offset = visualIndex.stepCursorOffsets[stepIndex] ?? 0;
  moveCursorToOffset(osmd, offset, cursorOffsetRef);
  cursor.hide();

  let toHighlight = toHighlightFromIndex;
  if (toHighlight.length === 0 && practiceNotes.length > 0) {
    const attackGNotes = cursor
      .GNotesUnderCursor()
      .filter(
        (gNote) =>
          !gNote.sourceNote.isRest() && !isTieContinuation(gNote.sourceNote),
      );
    toHighlight = collectGraphicalNotesWithTies(
      osmd,
      attackGNotes,
      practiceNotes,
    );
  }

  if (toHighlight.length === 0) {
    cursor.hide();
    return [];
  }

  highlightGraphicalNotes(toHighlight);
  scrollContainerToMusicSystem(container, toHighlight, scrollStateRef, scrollMode);

  return toHighlight;
}
