import type {
  GraphicalNote,
  Note,
  OpenSheetMusicDisplay,
} from 'opensheetmusicdisplay';
import { getPracticeNotes } from './practiceSteps.ts';
import type {
  EngineMode,
  Hand,
  PlaybackScript,
  PlayingPlaybackNote,
  ScriptNote,
  StepOrder,
} from '../types/index.ts';
import type { SheetScrollMode } from '../store/useEngineStore.ts';

const HIGHLIGHT_COLOR = '#10b981';
const DEFAULT_NOTE_COLOR = '#000000';

/**
 * Some OSMD DOM operations (cursor positioning, note coloring) can throw if a
 * re-render replaced the underlying SVG while a stale GraphicalNote/cursor
 * reference from before that render is still in use - e.g. a resize-observer
 * re-render firing mid-playback. Swallow and log once rather than aborting
 * the whole highlight/scroll tick; the visual index rebuild (see safeRender
 * in SheetMusicDisplay.tsx) supplies fresh references on the next tick.
 */
function safeOsmdCall(label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    // Permanent guard, not open investigation scaffolding: the stale-node/
    // resize/fermata-freeze bug this protects against is fixed (checkpoint
    // 55d3c82, regression coverage in constant-moderato-fermata.test.ts).
    // The [DIAG:staleNode] label stays so a browser console dump still
    // identifies exactly which wrapped OSMD call hit a stale reference.
    console.warn(`[DIAG:staleNode] ${label} failed (stale OSMD reference, skipped):`, err);
  }
}

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
  /** Line we most recently switched away from (flap guard). */
  previousSystemKey?: string | null;
  /** performance.now() of the last line switch (flap guard). */
  switchedAt?: number;
}

export interface PracticeVisualIndex {
  stepCursorOffsets: number[];
  stepGraphicalNotes: GraphicalNote[][];
  stepMeasureNumbers: number[];
}

interface CursorSnapshot {
  cursorIndex: number;
  attackKeys: Set<string>;
  attackGNotes: GraphicalNote[];
  allGNotes: GraphicalNote[];
  measureNumber: number;
  measureListIndex: number;
  /**
   * Grace noteheads engraved immediately before this position's attack.
   * Grace-only cursor positions stay skipped (the script gives them no step,
   * so counting them would desync every stepCursorOffset); their engraving is
   * carried onto the following real snapshot for highlighting instead.
   */
  graceGNotes?: GraphicalNote[];
}

interface OsmdSourceMeasure {
  MeasureNumberXML?: number;
  MeasureNumber?: number;
  measureListIndex?: number;
}

export interface CursorKeySnapshot {
  attackKeys: Set<string>;
}

function osmdNoteMidi(note: Note): number {
  const halfTone =
    typeof (note as Note & { halfTone?: number }).halfTone === 'number'
      ? (note as Note & { halfTone: number }).halfTone
      : note.Pitch.getHalfTone();
  return halfTone + 12;
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

function osmdMeasureInfoFromCursor(
  cursor: NonNullable<OpenSheetMusicDisplay['cursor']>,
): { measureNumber: number; measureListIndex: number } {
  const measure = cursor.Iterator?.CurrentMeasure as OsmdSourceMeasure | undefined;
  const measureNumber =
    measure?.MeasureNumberXML ?? measure?.MeasureNumber ?? 0;
  const measureListIndex =
    measure?.measureListIndex ?? cursor.Iterator?.CurrentMeasureIndex ?? 0;

  return { measureNumber, measureListIndex };
}

/** True when every attack under the cursor is a grace note (script omits these positions). */
export function isGraceOnlyAttackGNotes(gNotes: GraphicalNote[]): boolean {
  const attackNotes = gNotes.filter(
    (gNote) =>
      !gNote.sourceNote.isRest() && !isTieContinuation(gNote.sourceNote),
  );

  if (attackNotes.length === 0) {
    return false;
  }

  return attackNotes.every((gNote) => gNote.sourceNote.IsGraceNote === true);
}

function isGraceOnlyCursorPosition(
  cursor: NonNullable<OpenSheetMusicDisplay['cursor']>,
): boolean {
  return isGraceOnlyAttackGNotes(cursor.GNotesUnderCursor());
}

function advanceCursorSkippingGrace(
  cursor: NonNullable<OpenSheetMusicDisplay['cursor']>,
): void {
  do {
    cursor.next();
  } while (
    !cursor.Iterator?.EndReached &&
    isGraceOnlyCursorPosition(cursor)
  );
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
): GraphicalNote[] | null {
  const collected = collectGraphicalNotesForStep(
    osmd,
    snapshot.attackGNotes,
    snapshot.allGNotes,
    practiceNotes,
  );

  if (!practiceNotesFullyMatched(practiceNotes, collected)) {
    return null;
  }

  const hasAttackInStep = collected.some(
    (gNote) =>
      !isTieContinuation(gNote.sourceNote) &&
      practiceNotes.some((practiceNote) =>
        noteMatchesPracticeNote(gNote.sourceNote, practiceNote),
      ),
  );

  if (!hasAttackInStep) {
    return null;
  }

  return collected;
}

function matchStepAtSnapshotWithLookahead(
  osmd: OpenSheetMusicDisplay,
  snapshots: CursorSnapshot[],
  startIdx: number,
  practiceNotes: ScriptNote[],
  maxSpan: number,
): { notes: GraphicalNote[]; endIdx: number } | null {
  if (practiceNotes.length <= 1 || startIdx >= snapshots.length) {
    return null;
  }

  const baseMeasureListIndex = snapshots[startIdx].measureListIndex;
  const attackGNotes: GraphicalNote[] = [];
  const allGNotes: GraphicalNote[] = [];
  const seenAttack = new Set<Note>();
  const seenAll = new Set<Note>();

  for (let span = 0; span <= maxSpan; span += 1) {
    const idx = startIdx + span;
    if (idx >= snapshots.length) {
      break;
    }

    if (span > 0 && snapshots[idx].measureListIndex !== baseMeasureListIndex) {
      break;
    }

    for (const gNote of snapshots[idx].attackGNotes) {
      if (!seenAttack.has(gNote.sourceNote)) {
        seenAttack.add(gNote.sourceNote);
        attackGNotes.push(gNote);
      }
    }

    for (const gNote of snapshots[idx].allGNotes) {
      if (!seenAll.has(gNote.sourceNote)) {
        seenAll.add(gNote.sourceNote);
        allGNotes.push(gNote);
      }
    }

    const collected = collectGraphicalNotesForStep(
      osmd,
      attackGNotes,
      allGNotes,
      practiceNotes,
    );

    if (!practiceNotesFullyMatched(practiceNotes, collected)) {
      continue;
    }

    const hasAttack = attackGNotes.some((gNote) =>
      practiceNotes.some((practiceNote) =>
        noteMatchesPracticeNote(gNote.sourceNote, practiceNote),
      ),
    );

    if (hasAttack) {
      return { notes: collected, endIdx: idx };
    }
  }

  return null;
}

/** Compare a script step's MusicXML measure number to OSMD's MeasureNumberXML. */
export function measureNumberMatchesStep(
  osmdMeasureNumber: number,
  stepMeasureNumber: number,
): boolean {
  return osmdMeasureNumber === stepMeasureNumber;
}

export function measureListIndexForStep(
  snapshots: readonly Pick<CursorSnapshot, 'measureNumber' | 'measureListIndex'>[],
  stepMeasureNumber: number,
): number | null {
  for (const snapshot of snapshots) {
    if (snapshot.measureNumber === stepMeasureNumber) {
      return snapshot.measureListIndex;
    }
  }

  return null;
}

function isPastTargetMeasure(
  snapshot: Pick<CursorSnapshot, 'measureListIndex'>,
  targetMeasureListIndex: number | null,
): boolean {
  return (
    targetMeasureListIndex !== null &&
    snapshot.measureListIndex > targetMeasureListIndex
  );
}

export function findSequentialStepMatch(
  osmd: OpenSheetMusicDisplay,
  snapshots: CursorSnapshot[],
  searchStart: number,
  practiceNotes: ScriptNote[],
  stepMeasureNumber: number,
): { offset: number; endIdx: number; notes: GraphicalNote[] } | null {
  const targetMeasureListIndex = measureListIndexForStep(
    snapshots,
    stepMeasureNumber,
  );

  for (let cursorIdx = searchStart; cursorIdx < snapshots.length; cursorIdx += 1) {
    const snapshot = snapshots[cursorIdx];

    if (isPastTargetMeasure(snapshot, targetMeasureListIndex)) {
      break;
    }

    const directMatch = matchStepAtSnapshot(osmd, snapshot, practiceNotes);
    const lookaheadMatch =
      directMatch === null && practiceNotes.length > 1
        ? matchStepAtSnapshotWithLookahead(
            osmd,
            snapshots,
            cursorIdx,
            practiceNotes,
            3,
          )
        : null;

    const notes = directMatch ?? lookaheadMatch?.notes ?? null;
    const endIdx = lookaheadMatch?.endIdx ?? cursorIdx;

    if (!notes) {
      continue;
    }

    if (measureNumberMatchesStep(snapshot.measureNumber, stepMeasureNumber)) {
      return { offset: cursorIdx, endIdx, notes };
    }
  }

  return null;
}

function measureListIndexForStepInOsmd(
  osmd: OpenSheetMusicDisplay,
  stepMeasureNumber: number,
): number | null {
  const measures = (
    osmd as OpenSheetMusicDisplay & {
      Sheet?: { SourceMeasures?: OsmdSourceMeasure[] };
    }
  ).Sheet?.SourceMeasures;

  if (!measures) {
    return null;
  }

  for (const measure of measures) {
    const measureNumber = measure.MeasureNumberXML ?? measure.MeasureNumber ?? 0;
    if (measureNumber === stepMeasureNumber) {
      return measure.measureListIndex ?? null;
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

  const startOffset = Math.max(0, visualIndex.stepCursorOffsets[stepIndex] ?? 0);
  const stepMeasureNumber = visualIndex.stepMeasureNumbers[stepIndex] ?? 1;
  const cursor = osmd.cursor;
  if (!cursor) {
    return [];
  }

  cursor.reset();
  for (let i = 0; i < startOffset; i += 1) {
    advanceCursorSkippingGrace(cursor);
  }

  const targetMeasureListIndex = measureListIndexForStepInOsmd(
    osmd,
    stepMeasureNumber,
  );

  const maxScan = 512;
  let runtimeFallback: GraphicalNote[] = [];
  let runtimeFallbackScore = 0;

  for (let scanned = 0; scanned < maxScan; scanned += 1) {
    const attackGNotes = attackGNotesUnderCursor(cursor);
    const allGNotes = cursor.GNotesUnderCursor();
    const measureInfo = osmdMeasureInfoFromCursor(cursor);
    const snapshot: CursorSnapshot = {
      cursorIndex: startOffset + scanned,
      attackKeys: keysFromAttackGNotes(allGNotes),
      attackGNotes,
      allGNotes,
      measureNumber: measureInfo.measureNumber,
      measureListIndex: measureInfo.measureListIndex,
    };

    if (isPastTargetMeasure(snapshot, targetMeasureListIndex)) {
      break;
    }

    const collected = collectHighlightNotesAtSnapshot(
      osmd,
      snapshot,
      practiceNotes,
    );
    const score = countMatchedPracticeNotes(practiceNotes, collected);
    const inTargetMeasure = measureNumberMatchesStep(
      snapshot.measureNumber,
      stepMeasureNumber,
    );

    if (inTargetMeasure && score > runtimeFallbackScore) {
      runtimeFallbackScore = score;
      runtimeFallback = collected;
    }

    if (score === practiceNotes.length && inTargetMeasure) {
      cursorOffsetRef.current = startOffset + scanned;
      return collected;
    }

    if (cursor.Iterator?.EndReached) {
      break;
    }

    advanceCursorSkippingGrace(cursor);
  }

  if (runtimeFallback.length > 0) {
    return runtimeFallback;
  }

  cursor.reset();
  for (let i = 0; i < startOffset; i += 1) {
    advanceCursorSkippingGrace(cursor);
  }
  cursorOffsetRef.current = startOffset;

  return collectHighlightNotesAtSnapshot(
    osmd,
    {
      cursorIndex: startOffset,
      attackKeys: keysFromAttackGNotes(cursor.GNotesUnderCursor()),
      attackGNotes: attackGNotesUnderCursor(cursor),
      allGNotes: cursor.GNotesUnderCursor(),
      ...osmdMeasureInfoFromCursor(cursor),
    },
    practiceNotes,
  );
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

/** Count how many script notes appear in the collected engraving. */
export function countMatchedPracticeNotes(
  practiceNotes: ScriptNote[],
  collected: GraphicalNote[],
): number {
  return practiceNotes.filter((practiceNote) =>
    collected.some((gNote) =>
      noteMatchesPracticeNote(gNote.sourceNote, practiceNote),
    ),
  ).length;
}

/** True when every script note is represented in the collected engraving (ties may add extra segments). */
export function practiceNotesFullyMatched(
  practiceNotes: ScriptNote[],
  collected: GraphicalNote[],
): boolean {
  return countMatchedPracticeNotes(practiceNotes, collected) === practiceNotes.length;
}

function collectHighlightNotesAtSnapshot(
  osmd: OpenSheetMusicDisplay,
  snapshot: CursorSnapshot,
  practiceNotes: ScriptNote[],
): GraphicalNote[] {
  if (practiceNotes.length === 0) {
    return [];
  }

  const collected = collectGraphicalNotesForStep(
    osmd,
    snapshot.attackGNotes,
    snapshot.allGNotes,
    practiceNotes,
  );

  return countMatchedPracticeNotes(practiceNotes, collected) > 0 ? collected : [];
}

function findBestPartialHighlightInSnapshots(
  osmd: OpenSheetMusicDisplay,
  snapshots: CursorSnapshot[],
  searchStart: number,
  practiceNotes: ScriptNote[],
  stepMeasureNumber: number,
): GraphicalNote[] {
  const targetMeasureListIndex = measureListIndexForStep(
    snapshots,
    stepMeasureNumber,
  );
  let best: GraphicalNote[] = [];
  let bestScore = 0;

  for (let cursorIdx = searchStart; cursorIdx < snapshots.length; cursorIdx += 1) {
    const snapshot = snapshots[cursorIdx];

    if (isPastTargetMeasure(snapshot, targetMeasureListIndex)) {
      break;
    }

    if (!measureNumberMatchesStep(snapshot.measureNumber, stepMeasureNumber)) {
      continue;
    }

    const collected = collectHighlightNotesAtSnapshot(
      osmd,
      snapshot,
      practiceNotes,
    );
    const score = countMatchedPracticeNotes(practiceNotes, collected);

    if (score > bestScore) {
      bestScore = score;
      best = collected;
    }

    if (score === practiceNotes.length) {
      break;
    }
  }

  return best;
}

function noteMatchesPractice(
  note: Note,
  practiceNotes: ScriptNote[],
): boolean {
  return practiceNotes.some((practiceNote) =>
    noteMatchesPracticeNote(note, practiceNote),
  );
}

function collectGraphicalNotesForStep(
  osmd: OpenSheetMusicDisplay,
  attackGNotes: GraphicalNote[],
  allGNotes: GraphicalNote[],
  practiceNotes: ScriptNote[],
): GraphicalNote[] {
  const results: GraphicalNote[] = [];
  const seen = new Set<Note>();

  const addGraphicalNote = (source: Note, preferred?: GraphicalNote): void => {
    if (seen.has(source) || !noteMatchesPractice(source, practiceNotes)) {
      return;
    }

    const gNote =
      (preferred?.sourceNote === source
        ? preferred
        : graphicalNoteFromSource(osmd, source)) ?? preferred;

    if (!gNote) {
      return;
    }

    seen.add(source);
    results.push(gNote);
  };

  for (const attackGNote of attackGNotes) {
    const source = attackGNote.sourceNote;
    const tie = source.NoteTie;
    const tiedSources = tie ? tie.Notes : [source];

    for (const tiedNote of tiedSources) {
      addGraphicalNote(
        tiedNote,
        tiedNote === source ? attackGNote : undefined,
      );
    }
  }

  for (const gNote of allGNotes) {
    const source = gNote.sourceNote;
    if (source.isRest() || !isTieContinuation(source)) {
      continue;
    }

    addGraphicalNote(source, gNote);
  }

  for (const gNote of allGNotes) {
    const source = gNote.sourceNote;
    if (source.isRest() || seen.has(source)) {
      continue;
    }

    if (noteMatchesPractice(source, practiceNotes)) {
      addGraphicalNote(source, gNote);
    }
  }

  return results;
}

function graceGNotesAtCursor(gNotes: GraphicalNote[]): GraphicalNote[] {
  return gNotes.filter(
    (gNote) =>
      !gNote.sourceNote.isRest() && gNote.sourceNote.IsGraceNote === true,
  );
}

/**
 * Grace noteheads belonging to a step's graceBefore metadata, matched against
 * the engraving carried on the step's cursor snapshot (midi + notated hand).
 */
export function graceHighlightNotes(
  step: StepOrder,
  graceGNotes: readonly GraphicalNote[] | undefined,
): GraphicalNote[] {
  const graceBefore = step.graceBefore;
  if (!graceBefore?.length || !graceGNotes?.length) {
    return [];
  }

  return graceGNotes.filter((gNote) => {
    const source = gNote.sourceNote;
    return (
      !source.isRest() &&
      source.IsGraceNote === true &&
      graceBefore.some(
        (grace) =>
          grace.midi === osmdNoteMidi(source) &&
          grace.hand === osmdNoteHand(source),
      )
    );
  });
}

function walkCursorSnapshots(osmd: OpenSheetMusicDisplay): CursorSnapshot[] {
  const cursor = osmd.cursor;
  const snapshots: CursorSnapshot[] = [];
  let pendingGraceGNotes: GraphicalNote[] = [];

  cursor.reset();

  while (!cursor.Iterator?.EndReached) {
    if (isGraceOnlyCursorPosition(cursor)) {
      // Still skipped as a POSITION (no script step exists for it), but the
      // grace engraving rides onto the next real snapshot for highlighting.
      pendingGraceGNotes.push(...graceGNotesAtCursor(cursor.GNotesUnderCursor()));
      cursor.next();
      continue;
    }

    const gNotes = cursor.GNotesUnderCursor();
    const attackGNotes = gNotes.filter(
      (gNote) =>
        !gNote.sourceNote.isRest() && !isTieContinuation(gNote.sourceNote),
    );
    const measureInfo = osmdMeasureInfoFromCursor(cursor);
    // Graces engraved at the same position as their main note (rather than a
    // skipped grace-only position) belong to this snapshot too.
    const graceGNotes = [...pendingGraceGNotes, ...graceGNotesAtCursor(gNotes)];

    snapshots.push({
      cursorIndex: snapshots.length,
      attackKeys: keysFromAttackGNotes(gNotes),
      attackGNotes,
      allGNotes: gNotes,
      measureNumber: measureInfo.measureNumber,
      measureListIndex: measureInfo.measureListIndex,
      ...(graceGNotes.length > 0 ? { graceGNotes } : {}),
    });
    pendingGraceGNotes = [];

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
  const stepMeasureNumbers = script.map((step) => step.measureNumber);

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
      script[stepIndex].measureNumber,
    );

    if (match) {
      stepCursorOffsets[stepIndex] = match.offset;
      lastMatchedOffset = match.offset;
      searchStart = match.endIdx + 1;
      stepGraphicalNotes[stepIndex] = [
        ...graceHighlightNotes(
          script[stepIndex],
          snapshots[match.offset]?.graceGNotes,
        ),
        ...match.notes,
      ];
      continue;
    }

    stepCursorOffsets[stepIndex] = lastMatchedOffset;
    stepGraphicalNotes[stepIndex] = findBestPartialHighlightInSnapshots(
      osmd,
      snapshots,
      searchStart,
      practiceNotes,
      script[stepIndex].measureNumber,
    );
  }

  osmd.cursor.reset();
  return { stepCursorOffsets, stepGraphicalNotes, stepMeasureNumbers };
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
      advanceCursorSkippingGrace(cursor);
    }
  } else {
    for (let i = lastOffsetRef.current; i < offset; i += 1) {
      advanceCursorSkippingGrace(cursor);
    }
  }

  lastOffsetRef.current = offset;
  safeOsmdCall('moveCursorToOffset:cursor.update', () => cursor.update());
}

function resetGraphicalNotes(notes: GraphicalNote[]): void {
  for (const gNote of notes) {
    safeOsmdCall('resetGraphicalNotes:setColor', () =>
      gNote.setColor(DEFAULT_NOTE_COLOR, NOTE_HIGHLIGHT_OPTIONS),
    );
  }
}

function highlightGraphicalNotes(notes: GraphicalNote[]): void {
  for (const gNote of notes) {
    safeOsmdCall('highlightGraphicalNotes:setColor', () =>
      gNote.setColor(HIGHLIGHT_COLOR, NOTE_HIGHLIGHT_OPTIONS),
    );
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

function graphicalNotesOnSystem(
  visualIndex: PracticeVisualIndex,
  systemKey: string,
): GraphicalNote[] {
  const onSystem: GraphicalNote[] = [];

  for (const stepNotes of visualIndex.stepGraphicalNotes) {
    for (const gNote of stepNotes) {
      if (getMusicSystemKey(gNote) === systemKey) {
        onSystem.push(gNote);
      }
    }
  }

  return onSystem;
}

/** Upper stave in a grand-staff system (treble clef). */
function getTrebleStaveTopY(gNote: GraphicalNote): number | null {
  const staves = getStavesForMusicSystem(gNote);
  if (staves.length === 0) {
    return null;
  }

  const sorted = [...staves].sort(
    (left, right) =>
      left.getBoundingClientRect().top - right.getBoundingClientRect().top,
  );

  return sorted[0].getBoundingClientRect().top;
}

/**
 * Top of the line's scroll anchor, in viewport coordinates.
 *
 * The anchor is the highest note anywhere on the line so any note that rises
 * above the treble staff (ledger-line notes) stays visible, with the top
 * (treble) staff line as the floor when nothing rises above it. The bass staff
 * is never used as the anchor: the topmost staff is the baseline and notes can
 * only push the anchor higher, never lower.
 */
function playbackScrollAnchorTop(
  notes: GraphicalNote[],
  scrollVisualIndex: PracticeVisualIndex,
): number | null {
  const systemKey = getNotesSystemKey(notes);
  if (!systemKey) {
    return null;
  }

  // Baseline: the top (treble) staff line of the system.
  const trebleStaveTop = getTrebleStaveTopY(notes[0]);

  // Highest note anywhere on the line (any hand), covering ledger notes that
  // sit above the treble staff so they are not clipped at the top.
  const systemNotes = graphicalNotesOnSystem(scrollVisualIndex, systemKey);
  let highestNoteTop: number | null = null;

  for (const gNote of systemNotes) {
    const source = gNote.sourceNote;
    if (source.isRest() || isTieContinuation(source)) {
      continue;
    }

    const bounds = getGraphicalNotesBounds([gNote]);
    if (!bounds) {
      continue;
    }

    highestNoteTop =
      highestNoteTop === null ? bounds.top : Math.min(highestNoteTop, bounds.top);
  }

  const candidates: number[] = [];
  if (trebleStaveTop !== null) {
    candidates.push(trebleStaveTop);
  }
  if (highestNoteTop !== null) {
    candidates.push(highestNoteTop);
  }

  if (candidates.length === 0) {
    return null;
  }

  // The smallest top wins: a note above the staff lifts the anchor; otherwise
  // the treble staff top is used so we never anchor on the bass staff.
  return Math.min(...candidates);
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

export interface StepPointerResolveOptions {
  /** When false, only direct note-element hits count (no bbox / nearest fallback). */
  allowBoundingBoxFallback?: boolean;
}

/** Resolve a step only when the pointer is over a rendered note element. */
export function resolveStepIndexFromNoteElement(
  visualIndex: PracticeVisualIndex | null,
  clientX: number,
  clientY: number,
  container?: HTMLElement | null,
): number | null {
  if (!visualIndex) {
    return null;
  }

  return resolveStepFromElementsAtPoint(
    visualIndex,
    clientX,
    clientY,
    container,
  );
}

/** Resolve a sheet pointer position to a practice step using the visual index. */
export function resolveStepIndexFromPointer(
  visualIndex: PracticeVisualIndex | null,
  clientX: number,
  clientY: number,
  container?: HTMLElement | null,
  options: StepPointerResolveOptions = {},
): number | null {
  const allowBoundingBoxFallback = options.allowBoundingBoxFallback ?? true;

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

  if (!allowBoundingBoxFallback) {
    return null;
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

interface ScrollAnimation {
  frame: number;
  target: number;
}

const activeScrollAnimations = new WeakMap<HTMLElement, ScrollAnimation>();

function isScrollAnimationActive(container: HTMLElement): boolean {
  return activeScrollAnimations.has(container);
}

/** Same-line drift smaller than this is left alone instead of re-animated. */
const REANCHOR_MIN_DRIFT_PX = 4;

/** After a line switch, ignore bounce-backs to the previous line for this long. */
const LINE_SWITCH_SETTLE_MS = 600;

function animateScrollTop(
  container: HTMLElement,
  targetScrollTop: number,
  scrollMode: SheetScrollMode,
): void {
  const clampedTarget = Math.max(0, targetScrollTop);

  const existing = activeScrollAnimations.get(container);
  if (existing !== undefined) {
    // An animation toward (practically) the same target is already running:
    // let it finish instead of restarting the ease curve. Restarting on every
    // highlight tick is what made line switches crawl and wiggle.
    if (Math.abs(existing.target - clampedTarget) < 1) {
      return;
    }
    cancelAnimationFrame(existing.frame);
    activeScrollAnimations.delete(container);
  }

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
      activeScrollAnimations.set(container, { frame, target: clampedTarget });
    } else {
      activeScrollAnimations.delete(container);
    }
  };

  const frame = requestAnimationFrame(tick);
  activeScrollAnimations.set(container, { frame, target: clampedTarget });
}

/**
 * Grand-staff system bounds (both staves) for a graphical note, with a
 * note-element fallback. Used as a robust fallback anchor when the treble-stave
 * DOM lookup fails, so scrolling never silently stops.
 */
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

function scrollContainerForPlayback(
  container: HTMLElement,
  notes: GraphicalNote[],
  scrollState: { current: PracticeScrollState },
  scrollMode: SheetScrollMode,
  scrollVisualIndex: PracticeVisualIndex,
): void {
  // Buffer above the anchor (highest note / treble staff top) so the top of the
  // line is not flush against the viewport edge.
  const padding = 20;
  const systemKey = getNotesSystemKey(notes);
  if (!systemKey) {
    return;
  }

  // Prefer the treble-anchored top, but fall back to the system bounds (and
  // ultimately the note element) so a failed DOM stave lookup never disables
  // scrolling. Before this fallback existed, a null treble anchor silently
  // stopped scrolling in every mode even though highlighting still worked.
  const anchorTop =
    playbackScrollAnchorTop(notes, scrollVisualIndex) ??
    getNotesSystemBounds(notes)?.top ??
    null;
  if (anchorTop === null) {
    return;
  }

  const containerRect = container.getBoundingClientRect();
  const viewportHeight = container.clientHeight;
  const scrollTop = container.scrollTop;
  const maxScrollTop = Math.max(
    0,
    container.scrollHeight - viewportHeight,
  );

  const lineTop = anchorTop - containerRect.top + scrollTop;
  const currentSystemKey = scrollState.current.systemKey;
  const isNewStaffLine =
    currentSystemKey !== null && systemKey !== currentSystemKey;
  const needsAnchor = currentSystemKey === null;

  if (isNewStaffLine || needsAnchor) {
    // Flap guard: an active bar can briefly resolve its notes back to the
    // line we just scrolled away from (cross-line highlight matching). Do not
    // bounce back within the settle window - the committed line wins.
    const now = performance.now();
    if (
      isNewStaffLine &&
      systemKey === scrollState.current.previousSystemKey &&
      scrollState.current.switchedAt !== undefined &&
      now - scrollState.current.switchedAt < LINE_SWITCH_SETTLE_MS
    ) {
      return;
    }

    const target = Math.min(Math.max(0, lineTop - padding), maxScrollTop);
    scrollState.current = {
      systemKey,
      lineScrollTop: target,
      previousSystemKey: currentSystemKey,
      switchedAt: now,
    };
    if (Math.abs(target - scrollTop) >= 1) {
      animateScrollTop(container, target, scrollMode);
    }
    return;
  }

  // Same line: hold the committed anchor. Skip micro-drift and never restart
  // an in-flight animation toward the same anchor (animateScrollTop dedupes),
  // so a busy bar of highlight ticks cannot make the viewport wiggle.
  const anchor = scrollState.current.lineScrollTop;
  if (
    anchor !== null &&
    Math.abs(scrollTop - anchor) >= REANCHOR_MIN_DRIFT_PX &&
    !isScrollAnimationActive(container)
  ) {
    animateScrollTop(container, anchor, scrollMode);
  }
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
    scrollVisualIndex: PracticeVisualIndex | null;
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
    scrollVisualIndex,
  } = options;

  try {
    resetGraphicalNotes(highlightedNotes);

    const cursor = osmd.cursor;
    if (!cursor || !visualIndex) {
      cursorOffsetRef.current = -1;
      safeOsmdCall('syncSheetMusicPlaybackVisuals:cursor.hide(no-visualIndex)', () =>
        cursor?.hide(),
      );
      return [];
    }

    const offset = visualIndex.stepCursorOffsets[scrollStepIndex] ?? 0;
    moveCursorToOffset(osmd, offset, cursorOffsetRef);
    safeOsmdCall('syncSheetMusicPlaybackVisuals:cursor.hide', () => cursor.hide());

    const seen = new Set<GraphicalNote>();
    const toHighlight: GraphicalNote[] = [];

    for (const press of activeNotes) {
      const gNotes = visualIndex.stepGraphicalNotes[press.stepIndex] ?? [];
      for (const gNote of gNotes) {
        const source = gNote.sourceNote;
        if (source.isRest()) {
          continue;
        }

        // A step's grace noteheads are step-level decorations: they light
        // whenever any of the step's presses (grace or main) is sounding, so
        // the grace stays highlighted alongside its main note instead of
        // flashing for only its own crushed duration.
        if (source.IsGraceNote === true) {
          if (!seen.has(gNote)) {
            seen.add(gNote);
            toHighlight.push(gNote);
          }
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

    if (toHighlight.length > 0) {
      highlightGraphicalNotes(toHighlight);
    }

    // Scroll on the CURRENT step's notes, not the sounding notes. The step index
    // advances to the new system synchronously (applyStepVisual -> setStepIndex)
    // while playingPlaybackNotes is briefly empty (prior step released, next press
    // not yet fired or deferred). Driving the scroll off the step's graphical notes
    // makes the system-boundary scroll fire the instant the step advances, instead
    // of being skipped because nothing is sounding yet. Falls back to the sounding
    // notes only when the step has no matched graphics.
    const scrollStepNotes = visualIndex.stepGraphicalNotes[scrollStepIndex] ?? [];
    const scrollNotes = scrollStepNotes.length > 0 ? scrollStepNotes : toHighlight;
    if (scrollNotes.length > 0 && scrollVisualIndex) {
      scrollContainerForPlayback(
        container,
        scrollNotes,
        scrollStateRef,
        scrollMode,
        scrollVisualIndex,
      );
    }

    return toHighlight;
  } catch (err) {
    // Last-resort safety net: a re-render mid-playback can still race this
    // call. Fail this one tick rather than freezing forever - returning []
    // (instead of leaving highlightedNotesRef pointing at dead references)
    // lets the next tick recover cleanly once the index has rebuilt.
    console.warn('[DIAG:staleNode] syncSheetMusicPlaybackVisuals TOP-LEVEL failure, recovering next tick:', err);
    cursorOffsetRef.current = -1;
    return [];
  }
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
    scrollVisualIndex: PracticeVisualIndex | null;
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
    scrollVisualIndex,
  } = options;

  try {
    resetGraphicalNotes(highlightedNotes);

    const cursor = osmd.cursor;
    if (!cursor || !visualIndex || expectedMidiNotes.length === 0) {
      cursorOffsetRef.current = -1;
      safeOsmdCall('syncSheetMusicPracticeVisuals:cursor.hide(no-visualIndex)', () =>
        cursor?.hide(),
      );
      return [];
    }

    const offset = visualIndex.stepCursorOffsets[stepIndex] ?? 0;
    moveCursorToOffset(osmd, offset, cursorOffsetRef);
    safeOsmdCall('syncSheetMusicPracticeVisuals:cursor.hide', () => cursor.hide());

    const toHighlight = resolveStepGraphicalNotes(
      osmd,
      visualIndex,
      stepIndex,
      practiceNotes,
      cursorOffsetRef,
    );

    if (toHighlight.length === 0) {
      safeOsmdCall('syncSheetMusicPracticeVisuals:cursor.hide(empty-toHighlight)', () =>
        cursor.hide(),
      );
      return [];
    }

    highlightGraphicalNotes(toHighlight);
    if (scrollVisualIndex) {
      scrollContainerForPlayback(
        container,
        toHighlight,
        scrollStateRef,
        scrollMode,
        scrollVisualIndex,
      );
    }

    return toHighlight;
  } catch (err) {
    // Last-resort safety net: a re-render mid-playback can still race this
    // call. Fail this one tick rather than freezing forever - returning []
    // (instead of leaving highlightedNotesRef pointing at dead references)
    // lets the next tick recover cleanly once the index has rebuilt.
    console.warn('[DIAG:staleNode] syncSheetMusicPracticeVisuals TOP-LEVEL failure, recovering next tick:', err);
    cursorOffsetRef.current = -1;
    return [];
  }
}
