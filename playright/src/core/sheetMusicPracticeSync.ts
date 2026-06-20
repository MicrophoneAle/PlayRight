import type {
  GraphicalNote,
  Note,
  OpenSheetMusicDisplay,
} from 'opensheetmusicdisplay';
import { getPracticeNotes } from './practiceSteps.ts';
import type { EngineMode, Hand, PlaybackScript, PlayingPlaybackNote, ScriptNote } from '../types/index.ts';
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

export interface PracticeScrollState {
  systemKey: string | null;
  lineScrollTop: number | null;
}

export interface PracticeVisualIndex {
  stepCursorOffsets: number[];
  stepGraphicalNotes: GraphicalNote[][];
}

interface CursorSnapshot {
  cursorIndex: number;
  attackKeys: Set<string>;
  attackGNotes: GraphicalNote[];
}

export interface CursorKeySnapshot {
  attackKeys: Set<string>;
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

function practiceKeysFromNotes(notes: ScriptNote[]): Set<string> {
  const keys = new Set<string>();
  for (const note of notes) {
    keys.add(noteKey(note.midi, note.hand));
  }
  return keys;
}

function attackGNotesUnderCursor(cursor: OpenSheetMusicDisplay['cursor']): GraphicalNote[] {
  if (!cursor) {
    return [];
  }

  return cursor.GNotesUnderCursor().filter(
    (gNote) =>
      !gNote.sourceNote.isRest() && !isTieContinuation(gNote.sourceNote),
  );
}

/** Find the next cursor snapshot whose attack keys contain every expected practice note. */
export function findCursorOffsetForStep(
  snapshots: readonly CursorKeySnapshot[],
  searchStart: number,
  expected: Set<string>,
): number {
  if (expected.size === 0) {
    return -1;
  }

  for (let cursorIdx = searchStart; cursorIdx < snapshots.length; cursorIdx += 1) {
    if (stepMatchesKeys(expected, snapshots[cursorIdx].attackKeys)) {
      return cursorIdx;
    }
  }

  return -1;
}

function matchStepAtSnapshot(
  osmd: OpenSheetMusicDisplay,
  snapshot: CursorSnapshot,
  practiceNotes: ScriptNote[],
  expected: Set<string>,
): GraphicalNote[] | null {
  if (!stepMatchesKeys(expected, snapshot.attackKeys)) {
    return null;
  }

  const collected = collectGraphicalNotesWithTies(
    osmd,
    snapshot.attackGNotes,
    practiceNotes,
  );

  if (!practiceNotesFullyMatched(practiceNotes, collected)) {
    return null;
  }

  return collected;
}

function findSequentialStepMatch(
  osmd: OpenSheetMusicDisplay,
  snapshots: CursorSnapshot[],
  searchStart: number,
  practiceNotes: ScriptNote[],
  expected: Set<string>,
): { offset: number; notes: GraphicalNote[] } | null {
  for (let cursorIdx = searchStart; cursorIdx < snapshots.length; cursorIdx += 1) {
    const notes = matchStepAtSnapshot(
      osmd,
      snapshots[cursorIdx],
      practiceNotes,
      expected,
    );

    if (notes) {
      return { offset: cursorIdx, notes };
    }
  }

  return null;
}

function resolveStepGraphicalNotes(
  osmd: OpenSheetMusicDisplay,
  visualIndex: PracticeVisualIndex,
  stepIndex: number,
  practiceNotes: ScriptNote[],
  cursorOffsetRef: { current: number },
): GraphicalNote[] {
  const indexed = visualIndex.stepGraphicalNotes[stepIndex] ?? [];
  if (indexed.length > 0) {
    return indexed;
  }

  if (practiceNotes.length === 0) {
    return [];
  }

  const expected = practiceKeysFromNotes(practiceNotes);
  const startOffset = Math.max(0, visualIndex.stepCursorOffsets[stepIndex] ?? 0);
  const cursor = osmd.cursor;
  if (!cursor) {
    return [];
  }

  cursor.reset();
  for (let i = 0; i < startOffset; i += 1) {
    cursor.next();
  }

  const maxScan = 512;
  for (let scanned = 0; scanned < maxScan; scanned += 1) {
    const attackGNotes = attackGNotesUnderCursor(cursor);
    const snapshot: CursorSnapshot = {
      cursorIndex: startOffset + scanned,
      attackKeys: keysFromAttackGNotes(cursor.GNotesUnderCursor()),
      attackGNotes,
    };
    const notes = matchStepAtSnapshot(osmd, snapshot, practiceNotes, expected);

    if (notes) {
      const matchedOffset = startOffset + scanned;
      cursorOffsetRef.current = matchedOffset;
      return notes;
    }

    if (cursor.Iterator?.EndReached) {
      break;
    }

    cursor.next();
  }

  cursor.reset();
  for (let i = 0; i < startOffset; i += 1) {
    cursor.next();
  }
  cursorOffsetRef.current = startOffset;

  const fallback = collectGraphicalNotesWithTies(
    osmd,
    attackGNotesUnderCursor(cursor),
    practiceNotes,
  );

  return practiceNotesFullyMatched(practiceNotes, fallback) ? fallback : [];
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

function noteMatchesPracticeNote(note: Note, practiceNote: ScriptNote): boolean {
  if (note.isRest()) {
    return false;
  }

  return (
    osmdNoteMidi(note) === practiceNote.midi &&
    osmdNoteHand(note) === practiceNote.hand
  );
}

/** True when every script note is represented in the collected engraving (ties may add extra segments). */
export function practiceNotesFullyMatched(
  practiceNotes: ScriptNote[],
  collected: GraphicalNote[],
): boolean {
  return practiceNotes.every((practiceNote) =>
    collected.some((gNote) =>
      noteMatchesPracticeNote(gNote.sourceNote, practiceNote),
    ),
  );
}

function noteMatchesPractice(
  note: Note,
  practiceNotes: ScriptNote[],
): boolean {
  return practiceNotes.some((practiceNote) =>
    noteMatchesPracticeNote(note, practiceNote),
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

  let searchStart = 0;
  let lastMatchedOffset = 0;

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
      stepCursorOffsets[stepIndex] = lastMatchedOffset;
      continue;
    }

    const match = findSequentialStepMatch(
      osmd,
      snapshots,
      searchStart,
      practiceNotes,
      expected,
    );

    if (match) {
      stepCursorOffsets[stepIndex] = match.offset;
      lastMatchedOffset = match.offset;
      searchStart = match.offset + 1;
      stepGraphicalNotes[stepIndex] = match.notes;
      continue;
    }

    stepCursorOffsets[stepIndex] = lastMatchedOffset;
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
  getStemSVG?: () => HTMLElement;
  getFlagSVG?: () => HTMLElement;
  getTieSVGs?: () => HTMLElement[];
  getLedgerLineSVGs?: () => HTMLElement[];
  getBeamSVGs?: () => HTMLElement[];
}

function includeGraphicalNoteEngravingBounds(
  gNote: GraphicalNote,
  includeBounds: (element: Element | null | undefined) => void,
): void {
  const vfNote = gNote as VexFlowGraphicNote;

  includeBounds(
    typeof vfNote.getVFNoteSVG === 'function' ? vfNote.getVFNoteSVG() : null,
  );

  if (typeof vfNote.getStemSVG === 'function') {
    includeBounds(vfNote.getStemSVG());
  }

  if (typeof vfNote.getFlagSVG === 'function') {
    includeBounds(vfNote.getFlagSVG());
  }

  const includeElements = (elements: HTMLElement[] | undefined): void => {
    if (!elements) {
      return;
    }

    for (const element of elements) {
      includeBounds(element);
    }
  };

  if (typeof vfNote.getTieSVGs === 'function') {
    includeElements(vfNote.getTieSVGs());
  }

  if (typeof vfNote.getLedgerLineSVGs === 'function') {
    includeElements(vfNote.getLedgerLineSVGs());
  }

  if (typeof vfNote.getBeamSVGs === 'function') {
    includeElements(vfNote.getBeamSVGs());
  }
}

function graphicalNoteOwnsElement(
  gNote: GraphicalNote,
  element: Element,
): boolean {
  let owns = false;

  includeGraphicalNoteEngravingBounds(gNote, (part) => {
    if (part && (part === element || part.contains(element))) {
      owns = true;
    }
  });

  return owns;
}

function resolveStepFromElementsAtPoint(
  visualIndex: PracticeVisualIndex,
  clientX: number,
  clientY: number,
  container: HTMLElement | null | undefined,
): number | null {
  const elements = document.elementsFromPoint(clientX, clientY);

  for (const element of elements) {
    if (container && !container.contains(element)) {
      continue;
    }

    for (
      let stepIndex = 0;
      stepIndex < visualIndex.stepGraphicalNotes.length;
      stepIndex += 1
    ) {
      const gNotes = visualIndex.stepGraphicalNotes[stepIndex];
      if (gNotes.length === 0) {
        continue;
      }

      for (const gNote of gNotes) {
        if (graphicalNoteOwnsElement(gNote, element)) {
          return stepIndex;
        }
      }
    }
  }

  return null;
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

function getMusicSystemKey(gNote: GraphicalNote): string | null {
  const parentStaffEntry = gNote.parentVoiceEntry?.parentStaffEntry;
  const parentMeasure = parentStaffEntry?.parentMeasure as
    | { ParentMusicSystem?: { Id: number; Parent?: { PageNumber: number } } }
    | undefined;
  const musicSystem = parentMeasure?.ParentMusicSystem;

  if (musicSystem) {
    const pageNumber = musicSystem.Parent?.PageNumber ?? 0;
    return `sys-p${pageNumber}-id${musicSystem.Id}`;
  }

  const staves = getStavesForMusicSystem(gNote);
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

function getMusicSystemFromNote(gNote: GraphicalNote): {
  StaffLines: unknown[];
} | null {
  const parentMeasure = gNote.parentVoiceEntry?.parentStaffEntry
    ?.parentMeasure as
    | { ParentMusicSystem?: { StaffLines: unknown[] } }
    | undefined;
  return parentMeasure?.ParentMusicSystem ?? null;
}

/** All vf-staves in the note's music system (grand staff when applicable). */
function getStavesForMusicSystem(gNote: GraphicalNote): Element[] {
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

  const musicSystem = getMusicSystemFromNote(gNote);
  const expectedCount = musicSystem?.StaffLines?.length ?? 0;

  let node: Element | null = stave.parentElement;
  let tightestMatch: Element[] | null = null;

  while (node && !node.matches('svg')) {
    const found = [...node.querySelectorAll('.vf-stave')];
    if (!found.includes(stave)) {
      node = node.parentElement;
      continue;
    }

    if (expectedCount > 0 && found.length === expectedCount) {
      return found;
    }

    if (found.length >= 2) {
      if (!tightestMatch || found.length < tightestMatch.length) {
        tightestMatch = found;
      }
    }

    if (tightestMatch && found.length > tightestMatch.length + 2) {
      break;
    }

    node = node.parentElement;
  }

  if (tightestMatch && tightestMatch.length >= 2) {
    return tightestMatch;
  }

  return getGrandStaffStavesNear(stave);
}

function getGrandStaffStavesNear(stave: Element): Element[] {
  const svg = stave.closest('svg');
  if (!svg) {
    return [stave];
  }

  const staveRect = stave.getBoundingClientRect();
  const anchorX = (staveRect.left + staveRect.right) / 2;

  const paired = [...svg.querySelectorAll('.vf-stave')].filter((candidate) => {
    const rect = candidate.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return false;
    }

    const candidateX = (rect.left + rect.right) / 2;
    if (Math.abs(candidateX - anchorX) > 120) {
      return false;
    }

    return Math.abs(rect.top - staveRect.top) < 220;
  });

  return paired.length > 0 ? paired : [stave];
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
  const staves = getStavesForMusicSystem(gNote);
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
  if (notes.length === 0) {
    return null;
  }

  return getMusicSystemBounds(notes[0]);
}

function getGraphicalNotesBounds(notes: GraphicalNote[]): DOMRect | null {
  let bounds: DOMRect | null = null;

  const includeBounds = (element: Element | null | undefined): void => {
    if (!element) {
      return;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return;
    }

    bounds = bounds ? unionRects(bounds, rect) : rect;
  };

  for (const gNote of notes) {
    includeGraphicalNoteEngravingBounds(gNote, includeBounds);
  }

  return bounds;
}

function pointInRect(x: number, y: number, rect: DOMRect): boolean {
  return (
    x >= rect.left &&
    x <= rect.right &&
    y >= rect.top &&
    y <= rect.bottom
  );
}

function inflateRect(rect: DOMRect, padding: number): DOMRect {
  return new DOMRect(
    rect.left - padding,
    rect.top - padding,
    rect.width + padding * 2,
    rect.height + padding * 2,
  );
}

function distanceToRect(x: number, y: number, rect: DOMRect): number {
  const dx = Math.max(rect.left - x, 0, x - rect.right);
  const dy = Math.max(rect.top - y, 0, y - rect.bottom);
  return Math.hypot(dx, dy);
}

const NOTE_HIT_MIN_SIZE_PX = 20;
const NOTE_HIT_PADDING_PX = 12;
const NOTE_HIT_MAX_DISTANCE_PX = 56;

function hitBoundsForGraphicalNote(gNote: GraphicalNote): DOMRect | null {
  const bounds = getGraphicalNotesBounds([gNote]);
  if (!bounds) {
    return null;
  }

  let rect = bounds;
  if (rect.width < NOTE_HIT_MIN_SIZE_PX || rect.height < NOTE_HIT_MIN_SIZE_PX) {
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const width = Math.max(rect.width, NOTE_HIT_MIN_SIZE_PX);
    const height = Math.max(rect.height, NOTE_HIT_MIN_SIZE_PX);
    rect = new DOMRect(
      centerX - width / 2,
      centerY - height / 2,
      width,
      height,
    );
  }

  return inflateRect(rect, NOTE_HIT_PADDING_PX);
}

/** Resolve a sheet pointer position to a practice step using the visual index. */
export function resolveStepIndexFromPointer(
  visualIndex: PracticeVisualIndex | null,
  clientX: number,
  clientY: number,
  container?: HTMLElement | null,
): number | null {
  if (!visualIndex) {
    return null;
  }

  const elementMatch = resolveStepFromElementsAtPoint(
    visualIndex,
    clientX,
    clientY,
    container,
  );
  if (elementMatch !== null) {
    return elementMatch;
  }

  let matchedStep: number | null = null;
  let matchedArea = Infinity;
  let nearestStep: number | null = null;
  let nearestDistance = Infinity;

  for (
    let stepIndex = 0;
    stepIndex < visualIndex.stepGraphicalNotes.length;
    stepIndex += 1
  ) {
    const gNotes = visualIndex.stepGraphicalNotes[stepIndex];
    if (gNotes.length === 0) {
      continue;
    }

    for (const gNote of gNotes) {
      const hitBounds = hitBoundsForGraphicalNote(gNote);
      if (!hitBounds) {
        continue;
      }

      if (pointInRect(clientX, clientY, hitBounds)) {
        const area = hitBounds.width * hitBounds.height;
        if (area < matchedArea) {
          matchedArea = area;
          matchedStep = stepIndex;
        }
        continue;
      }

      const distance = distanceToRect(clientX, clientY, hitBounds);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestStep = stepIndex;
      }
    }
  }

  if (matchedStep !== null) {
    return matchedStep;
  }

  if (nearestStep !== null && nearestDistance <= NOTE_HIT_MAX_DISTANCE_PX) {
    return nearestStep;
  }

  return null;
}

/** Hands whose notes contribute to line scroll extent for the current engine mode. */
function getHandsForLineExtent(
  engineMode: EngineMode,
  activeHand: Hand,
): readonly Hand[] | null {
  if (engineMode === 'two-hand') {
    return ['L', 'R'];
  }

  if (engineMode === 'one-hand') {
    return [activeHand];
  }

  return null;
}

function collectLineHandGraphicalNotes(
  visualIndex: PracticeVisualIndex,
  systemKey: string,
  activeHand: Hand,
  engineMode: EngineMode,
): GraphicalNote[] {
  const handsInPlay = getHandsForLineExtent(engineMode, activeHand);
  const results: GraphicalNote[] = [];

  for (const gNotes of visualIndex.stepGraphicalNotes) {
    if (gNotes.length === 0) {
      continue;
    }

    if (getNotesSystemKey(gNotes) !== systemKey) {
      continue;
    }

    for (const gNote of gNotes) {
      if (handsInPlay !== null) {
        const hand = osmdNoteHand(gNote.sourceNote);
        if (!handsInPlay.includes(hand)) {
          continue;
        }
      }

      results.push(gNote);
    }
  }

  return results;
}

function computeLineAnchorScrollTop(
  container: HTMLElement,
  scrollTop: number,
  systemTop: number,
  systemBottom: number,
  handExtentBounds: DOMRect | null,
  viewportHeight: number,
  padding: number,
  maxScrollTop: number,
): number {
  const minScrollForSystemBottom = Math.max(
    0,
    systemBottom - viewportHeight + padding,
  );
  const maxScrollForSystemTop = Math.max(0, systemTop - padding);

  if (!handExtentBounds) {
    return Math.min(maxScrollTop, maxScrollForSystemTop);
  }

  const containerRect = container.getBoundingClientRect();
  const extentTop =
    handExtentBounds.top - containerRect.top + scrollTop;

  const target = Math.max(
    minScrollForSystemBottom,
    Math.min(maxScrollForSystemTop, extentTop - padding),
  );

  return Math.min(maxScrollTop, Math.max(0, target));
}

function isVerticallyInView(
  top: number,
  bottom: number,
  scrollTop: number,
  viewportHeight: number,
  padding: number,
): boolean {
  const visibleTop = top - scrollTop;
  const visibleBottom = bottom - scrollTop;
  return visibleTop >= padding && visibleBottom <= viewportHeight - padding;
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

function scrollContainerForPractice(
  container: HTMLElement,
  notes: GraphicalNote[],
  scrollState: { current: PracticeScrollState },
  scrollMode: SheetScrollMode,
  visualIndex: PracticeVisualIndex,
  activeHand: Hand,
  engineMode: EngineMode,
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
  const viewportHeight = container.clientHeight;
  const scrollTop = container.scrollTop;
  const maxScrollTop = Math.max(
    0,
    container.scrollHeight - viewportHeight,
  );

  const systemTop = systemRect.top - containerRect.top + scrollTop;
  const systemBottom = systemTop + systemRect.height;
  const fullSystemFits = systemRect.height <= viewportHeight - 2 * padding;

  const lineHandNotes = collectLineHandGraphicalNotes(
    visualIndex,
    systemKey,
    activeHand,
    engineMode,
  );
  const lineHandExtentBounds = getGraphicalNotesBounds(lineHandNotes);

  const anchorForLine = () =>
    computeLineAnchorScrollTop(
      container,
      scrollTop,
      systemTop,
      systemBottom,
      lineHandExtentBounds,
      viewportHeight,
      padding,
      maxScrollTop,
    );

  const previousSystemKey = scrollState.current.systemKey;
  const isNewStaffLine =
    previousSystemKey !== null && systemKey !== previousSystemKey;
  const needsAnchor = previousSystemKey === null;

  if (isNewStaffLine || needsAnchor) {
    const target = anchorForLine();
    scrollState.current = { systemKey, lineScrollTop: target };
    if (Math.abs(target - scrollTop) >= 1) {
      animateScrollTop(container, target, scrollMode);
    }
    return;
  }

  scrollState.current.systemKey = systemKey;

  if (fullSystemFits) {
    const anchor = scrollState.current.lineScrollTop;
    if (anchor !== null && Math.abs(scrollTop - anchor) >= 1) {
      animateScrollTop(container, anchor, scrollMode);
    }
    return;
  }

  if (!lineHandExtentBounds) {
    return;
  }

  const extentTop =
    lineHandExtentBounds.top - containerRect.top + scrollTop;
  const extentBottom =
    lineHandExtentBounds.bottom - containerRect.top + scrollTop;

  if (
    isVerticallyInView(
      extentTop,
      extentBottom,
      scrollTop,
      viewportHeight,
      padding,
    )
  ) {
    return;
  }

  let target = scrollTop;
  const visibleTop = extentTop - scrollTop;
  const visibleBottom = extentBottom - scrollTop;

  if (visibleTop < padding) {
    target = Math.max(0, extentTop - padding);
  } else if (visibleBottom > viewportHeight - padding) {
    target = Math.min(maxScrollTop, extentBottom - viewportHeight + padding);
  }

  const maxScrollForSystemTop = Math.max(0, systemTop - padding);
  const minScrollForSystemBottom = Math.max(
    0,
    systemBottom - viewportHeight + padding,
  );
  target = Math.min(target, maxScrollForSystemTop);
  target = Math.max(target, minScrollForSystemBottom);
  target = Math.min(target, maxScrollTop);

  if (Math.abs(target - scrollTop) < 1) {
    return;
  }

  animateScrollTop(container, target, scrollMode);
}

/** Highlight all notes currently sounding during play mode (matches keyboard duration). */
export function syncSheetMusicPlaybackVisuals(
  osmd: OpenSheetMusicDisplay,
  options: {
    visualIndex: PracticeVisualIndex | null;
    scrollStepIndex: number;
    activeNotes: PlayingPlaybackNote[];
    container: HTMLElement;
    highlightedNotes: GraphicalNote[];
    cursorOffsetRef: { current: number };
    scrollStateRef: { current: PracticeScrollState };
    scrollMode: SheetScrollMode;
    activeHand: Hand;
    engineMode: EngineMode;
  },
): GraphicalNote[] {
  const {
    visualIndex,
    scrollStepIndex,
    activeNotes,
    container,
    highlightedNotes,
    cursorOffsetRef,
    scrollStateRef,
    scrollMode,
    activeHand,
    engineMode,
  } = options;

  resetGraphicalNotes(highlightedNotes);

  const cursor = osmd.cursor;
  if (!cursor || !visualIndex) {
    cursorOffsetRef.current = -1;
    cursor?.hide();
    return [];
  }

  const offset = visualIndex.stepCursorOffsets[scrollStepIndex] ?? 0;
  moveCursorToOffset(osmd, offset, cursorOffsetRef);
  cursor.hide();

  if (activeNotes.length === 0) {
    return [];
  }

  const seen = new Set<GraphicalNote>();
  const toHighlight: GraphicalNote[] = [];

  for (const press of activeNotes) {
    const gNotes = visualIndex.stepGraphicalNotes[press.stepIndex] ?? [];
    for (const gNote of gNotes) {
      const source = gNote.sourceNote;
      if (source.isRest()) {
        continue;
      }

      const midi = osmdNoteMidi(source);
      const hand = osmdNoteHand(source);
      if (midi === press.midi && hand === press.hand && !seen.has(gNote)) {
        seen.add(gNote);
        toHighlight.push(gNote);
      }
    }
  }

  if (toHighlight.length === 0) {
    return [];
  }

  highlightGraphicalNotes(toHighlight);

  const scrollStepNotes = visualIndex.stepGraphicalNotes[scrollStepIndex] ?? [];
  const scrollNotes = scrollStepNotes.length > 0 ? scrollStepNotes : toHighlight;
  scrollContainerForPractice(
    container,
    scrollNotes,
    scrollStateRef,
    scrollMode,
    visualIndex,
    activeHand,
    engineMode,
  );

  return toHighlight;
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
    scrollStateRef: { current: PracticeScrollState };
    scrollMode: SheetScrollMode;
    activeHand: Hand;
    engineMode: EngineMode;
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
    activeHand,
    engineMode,
  } = options;

  resetGraphicalNotes(highlightedNotes);

  const cursor = osmd.cursor;
  if (!cursor || !visualIndex || expectedMidiNotes.length === 0) {
    cursorOffsetRef.current = -1;
    cursor?.hide();
    return [];
  }

  const offset = visualIndex.stepCursorOffsets[stepIndex] ?? 0;
  moveCursorToOffset(osmd, offset, cursorOffsetRef);
  cursor.hide();

  const toHighlight = resolveStepGraphicalNotes(
    osmd,
    visualIndex,
    stepIndex,
    practiceNotes,
    cursorOffsetRef,
  );

  if (toHighlight.length === 0) {
    cursor.hide();
    return [];
  }

  highlightGraphicalNotes(toHighlight);
  scrollContainerForPractice(
    container,
    toHighlight,
    scrollStateRef,
    scrollMode,
    visualIndex as PracticeVisualIndex,
    activeHand,
    engineMode,
  );

  return toHighlight;
}
