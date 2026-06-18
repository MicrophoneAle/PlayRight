import type {
  GraphicalNote,
  Note,
  OpenSheetMusicDisplay,
} from 'opensheetmusicdisplay';
import { getPracticeNotes } from './practiceSteps.ts';
import type { EngineMode, Hand, PlaybackScript } from '../types/index.ts';

const HIGHLIGHT_COLOR = '#10b981';
const DEFAULT_NOTE_COLOR = '#000000';

const HIGHLIGHT_OPTIONS = {
  applyToNoteheads: true,
  applyToStem: true,
  applyToFlag: true,
  applyToBeams: true,
  applyToTies: true,
} as const;

function osmdNoteMidi(note: Note): number {
  return note.Pitch.getHalfTone() + 12;
}

function osmdNoteHand(note: Note): Hand {
  return note.ParentStaff.Id === 2 ? 'L' : 'R';
}

function noteKey(midi: number, hand: Hand): string {
  return `${midi}:${hand}`;
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

function cursorKeysAtPosition(osmd: OpenSheetMusicDisplay): Set<string> {
  const keys = new Set<string>();
  for (const note of osmd.cursor.NotesUnderCursor()) {
    if (note.isRest()) {
      continue;
    }
    keys.add(noteKey(osmdNoteMidi(note), osmdNoteHand(note)));
  }
  return keys;
}

function stepMatchesCursor(
  expected: Set<string>,
  atCursor: Set<string>,
): boolean {
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

/** Map each script step index to a cursor position (number of next() calls from reset). */
export function buildStepCursorOffsets(
  osmd: OpenSheetMusicDisplay,
  script: PlaybackScript,
  engineMode: EngineMode,
  activeHand: Hand,
): number[] {
  const cursor = osmd.cursor;
  const offsets = new Array<number>(script.length).fill(0);

  cursor.reset();
  let position = 0;
  let safety = 200_000;

  for (let stepIndex = 0; stepIndex < script.length; stepIndex += 1) {
    const expected = practiceKeysForStep(
      script,
      stepIndex,
      engineMode,
      activeHand,
    );

    if (expected.size === 0) {
      offsets[stepIndex] = position;
      continue;
    }

    let matched = false;

    while (safety > 0) {
      safety -= 1;

      if (stepMatchesCursor(expected, cursorKeysAtPosition(osmd))) {
        offsets[stepIndex] = position;
        matched = true;
        cursor.next();
        position += 1;
        break;
      }

      cursor.next();
      position += 1;
    }

    if (!matched) {
      offsets[stepIndex] = offsets[stepIndex - 1] ?? 0;
    }
  }

  cursor.reset();
  return offsets;
}

function moveCursorToOffset(
  osmd: OpenSheetMusicDisplay,
  offset: number,
): void {
  const cursor = osmd.cursor;
  cursor.reset();
  for (let i = 0; i < offset; i += 1) {
    cursor.next();
  }
  cursor.update();
}

function filterGraphicalNotes(
  gNotes: GraphicalNote[],
  expectedMidiNotes: number[],
  engineMode: EngineMode,
  activeHand: Hand,
): GraphicalNote[] {
  const expected = new Set(expectedMidiNotes);

  return gNotes.filter((gNote) => {
    const source = gNote.sourceNote;
    if (source.isRest()) {
      return false;
    }

    if (!expected.has(osmdNoteMidi(source))) {
      return false;
    }

    if (engineMode === 'one-hand' && osmdNoteHand(source) !== activeHand) {
      return false;
    }

    return true;
  });
}

function resetGraphicalNotes(notes: GraphicalNote[]): void {
  for (const gNote of notes) {
    gNote.setColor(DEFAULT_NOTE_COLOR, HIGHLIGHT_OPTIONS);
  }
}

function highlightGraphicalNotes(notes: GraphicalNote[]): void {
  for (const gNote of notes) {
    gNote.setColor(HIGHLIGHT_COLOR, HIGHLIGHT_OPTIONS);
  }
}

export function syncSheetMusicPracticeVisuals(
  osmd: OpenSheetMusicDisplay,
  options: {
    script: PlaybackScript;
    stepIndex: number;
    stepCursorOffsets: number[];
    expectedMidiNotes: number[];
    engineMode: EngineMode;
    activeHand: Hand;
    container: HTMLElement;
    highlightedNotes: GraphicalNote[];
  },
): GraphicalNote[] {
  const {
    script,
    stepIndex,
    stepCursorOffsets,
    expectedMidiNotes,
    engineMode,
    activeHand,
    container,
    highlightedNotes,
  } = options;

  resetGraphicalNotes(highlightedNotes);

  const cursor = osmd.cursor;
  if (!cursor) {
    return [];
  }

  if (!script[stepIndex] || expectedMidiNotes.length === 0) {
    cursor.hide();
    return [];
  }

  const offset = stepCursorOffsets[stepIndex] ?? 0;
  moveCursorToOffset(osmd, offset);
  cursor.show();

  const toHighlight = filterGraphicalNotes(
    cursor.GNotesUnderCursor(),
    expectedMidiNotes,
    engineMode,
    activeHand,
  );
  highlightGraphicalNotes(toHighlight);

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

  return toHighlight;
}
