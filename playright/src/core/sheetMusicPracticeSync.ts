import type {
  GraphicalNote,
  Note,
  OpenSheetMusicDisplay,
} from 'opensheetmusicdisplay';
import { getPracticeNotes } from './practiceSteps.ts';
import type { EngineMode, Hand, PlaybackScript, ScriptNote } from '../types/index.ts';

const HIGHLIGHT_COLOR = '#10b981';

export interface HighlightSnapshot {
  element: Element;
  fill: string;
  stroke: string;
}

interface VexFlowGraphicNote extends GraphicalNote {
  getNoteheadSVGs?: () => HTMLElement[];
  getStemSVG?: () => HTMLElement;
  getTieSVGs?: () => HTMLElement[];
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

function collectHighlightElements(gNote: GraphicalNote): HTMLElement[] {
  const vfNote = gNote as VexFlowGraphicNote;
  const elements: HTMLElement[] = [];

  if (typeof vfNote.getNoteheadSVGs === 'function') {
    elements.push(...vfNote.getNoteheadSVGs());
  }

  if (typeof vfNote.getStemSVG === 'function') {
    const stem = vfNote.getStemSVG();
    if (stem) {
      elements.push(stem);
    }
  }

  if (typeof vfNote.getTieSVGs === 'function') {
    elements.push(...vfNote.getTieSVGs());
  }

  return elements;
}

function readSvgColor(element: HTMLElement, property: 'fill' | 'stroke'): string {
  return element.style[property] || element.getAttribute(property) || '';
}

function restoreHighlightedElements(snapshots: HighlightSnapshot[]): void {
  for (const snapshot of snapshots) {
    const element = snapshot.element as HTMLElement;
    if (snapshot.fill) {
      element.style.fill = snapshot.fill;
    } else {
      element.style.removeProperty('fill');
    }

    if (snapshot.stroke) {
      element.style.stroke = snapshot.stroke;
    } else {
      element.style.removeProperty('stroke');
    }
  }
}

function highlightGraphicalNotes(notes: GraphicalNote[]): HighlightSnapshot[] {
  const snapshots: HighlightSnapshot[] = [];

  for (const gNote of notes) {
    for (const element of collectHighlightElements(gNote)) {
      snapshots.push({
        element,
        fill: readSvgColor(element, 'fill'),
        stroke: readSvgColor(element, 'stroke'),
      });
      element.style.fill = HIGHLIGHT_COLOR;
      element.style.stroke = HIGHLIGHT_COLOR;
    }
  }

  return snapshots;
}

export function syncSheetMusicPracticeVisuals(
  osmd: OpenSheetMusicDisplay,
  options: {
    stepIndex: number;
    visualIndex: PracticeVisualIndex | null;
    expectedMidiNotes: number[];
    practiceNotes: ScriptNote[];
    container: HTMLElement;
    highlightedElements: HighlightSnapshot[];
    cursorOffsetRef: { current: number };
  },
): HighlightSnapshot[] {
  const {
    stepIndex,
    visualIndex,
    expectedMidiNotes,
    practiceNotes,
    container,
    highlightedElements,
    cursorOffsetRef,
  } = options;

  restoreHighlightedElements(highlightedElements);

  const cursor = osmd.cursor;
  if (!cursor || !visualIndex || expectedMidiNotes.length === 0) {
    cursorOffsetRef.current = -1;
    cursor?.hide();
    return [];
  }

  const toHighlightFromIndex = visualIndex.stepGraphicalNotes[stepIndex] ?? [];
  const offset = visualIndex.stepCursorOffsets[stepIndex] ?? 0;
  moveCursorToOffset(osmd, offset, cursorOffsetRef);
  cursor.show();

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

  const nextHighlights = highlightGraphicalNotes(toHighlight);

  const cursorElement = cursor.cursorElement;
  if (cursorElement) {
    const containerRect = container.getBoundingClientRect();
    const cursorRect = cursorElement.getBoundingClientRect();
    if (
      cursorRect.top < containerRect.top ||
      cursorRect.bottom > containerRect.bottom
    ) {
      cursorElement.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  return nextHighlights;
}
