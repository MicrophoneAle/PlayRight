import type {
  Finger,
  Hand,
  ManualFingeringMap,
  PlaybackScript,
  ScriptNote,
} from '../types/index.ts';
import { fingeringKey } from '../types/index.ts';

export interface NoteEvent {
  stepIndex: number;
  midi: number;
  authoredFinger: Finger | null;
  /** MusicXML division onset of this note's step (from StepOrder.onset). */
  onset: number;
}

export function extractHandTimelines(
  script: PlaybackScript,
): Record<Hand, NoteEvent[]> {
  const timelines: Record<Hand, NoteEvent[]> = { L: [], R: [] };

  script.forEach((step, stepIndex) => {
    for (const note of step.notes) {
      const authoredFinger =
        note.fingerSource === 'score' || note.fingerSource === 'manual'
          ? note.finger
          : null;

      timelines[note.hand].push({
        stepIndex,
        midi: note.midi,
        authoredFinger,
        onset: step.onset,
      });
    }
  });

  const compareEvents = (left: NoteEvent, right: NoteEvent): number =>
    left.stepIndex - right.stepIndex || left.midi - right.midi;

  timelines.L.sort(compareEvents);
  timelines.R.sort(compareEvents);

  return timelines;
}

/**
 * Split a hand timeline into phrases on a sustained gap (a rest of at least a
 * quarter note when divisions=480). Spatial splitting is handled by hand
 * positions, not here.
 */
export const PHRASE_MIN_ONSET_GAP_DIVISIONS = 480;

/** Major tenth. A hand position wider than this must split into a new position. */
export const MAX_HAND_SPAN_SEMITONES = 16;

export type SpanMode = 'close' | 'wide';

interface ReachBucket {
  maxOffset: number;
  finger: Finger;
}

/** Close comfort table: compact positions up to a tenth, fingers held tight. */
const CLOSE_REACH: ReadonlyArray<ReachBucket> = [
  { maxOffset: 0, finger: 1 },
  { maxOffset: 3, finger: 2 },
  { maxOffset: 5, finger: 3 },
  { maxOffset: 8, finger: 4 },
  { maxOffset: 10, finger: 5 },
];

/** Wide comfort table: stretched positions (11 to 16 semitones). */
const WIDE_REACH: ReadonlyArray<ReachBucket> = [
  { maxOffset: 0, finger: 1 },
  { maxOffset: 4, finger: 2 },
  { maxOffset: 8, finger: 3 },
  { maxOffset: 11, finger: 4 },
  { maxOffset: 16, finger: 5 },
];

function reachTable(mode: SpanMode): ReadonlyArray<ReachBucket> {
  return mode === 'close' ? CLOSE_REACH : WIDE_REACH;
}

/**
 * Finger for a note's semitone offset from the position anchor (thumb).
 * offset is always non-negative. Offsets past the table clamp to the pinky,
 * which only happens for very large hands spanning beyond a tenth.
 */
export function fingerForOffset(offset: number, mode: SpanMode): Finger | null {
  if (offset < 0) {
    return null;
  }

  for (const bucket of reachTable(mode)) {
    if (offset <= bucket.maxOffset) {
      return bucket.finger;
    }
  }

  return 5;
}

/** Close when a position is compact, wide when stretched, null when too wide for one hand. */
export function spanModeForRange(
  rangeSemitones: number,
  spanScale = 1,
): SpanMode | null {
  if (rangeSemitones <= 10 * spanScale) {
    return 'close';
  }

  if (rangeSemitones <= MAX_HAND_SPAN_SEMITONES * spanScale) {
    return 'wide';
  }

  return null;
}

/** RH measures up from the lowest note, LH measures down from the highest. */
export function offsetForHand(midi: number, anchorMidi: number, hand: Hand): number {
  return hand === 'R' ? midi - anchorMidi : anchorMidi - midi;
}

/** Distinct, monotonic fingers for a simultaneous chord within a position. */
export function assignChordFingersInPosition(
  chordMidisAscending: number[],
  anchorMidi: number,
  hand: Hand,
  mode: SpanMode,
): (Finger | null)[] {
  const indices = chordMidisAscending.map((_, index) => index);
  const order = hand === 'R' ? indices : [...indices].reverse();
  const result = new Array<Finger | null>(chordMidisAscending.length).fill(null);
  let minNextFinger = 1;

  for (const index of order) {
    const midi = chordMidisAscending[index];
    const base = fingerForOffset(offsetForHand(midi, anchorMidi, hand), mode);
    let finger = base ?? minNextFinger;

    if (finger < minNextFinger) {
      finger = minNextFinger as Finger;
    }

    if (finger > 5) {
      result[index] = null;
      continue;
    }

    result[index] = finger as Finger;
    minNextFinger = finger + 1;
  }

  return result;
}

function groupConsecutiveOnsets(events: NoteEvent[]): NoteEvent[][] {
  if (events.length === 0) {
    return [];
  }

  const groups: NoteEvent[][] = [[events[0]]];

  for (let index = 1; index < events.length; index += 1) {
    const event = events[index];
    const current = groups[groups.length - 1];

    if (event.stepIndex === current[0].stepIndex) {
      current.push(event);
    } else {
      groups.push([event]);
    }
  }

  return groups;
}

export function segmentIntoPhrases(timeline: NoteEvent[]): NoteEvent[][] {
  if (timeline.length === 0) {
    return [];
  }

  const onsetGroups = groupConsecutiveOnsets(timeline);
  const phrases: NoteEvent[][] = [];
  let current: NoteEvent[][] = [onsetGroups[0]];

  for (let index = 1; index < onsetGroups.length; index += 1) {
    const gap = onsetGroups[index][0].onset - onsetGroups[index - 1][0].onset;

    if (gap >= PHRASE_MIN_ONSET_GAP_DIVISIONS) {
      phrases.push(current.flat());
      current = [onsetGroups[index]];
    } else {
      current.push(onsetGroups[index]);
    }
  }

  phrases.push(current.flat());
  return phrases;
}

export interface HandPosition {
  events: NoteEvent[];
  minMidi: number;
  maxMidi: number;
}

/**
 * Greedily build hand positions within a phrase. Extend the current position
 * while its pitch range stays within the hand span. A new position is a scope
 * shift, so shifts happen only when the next note cannot be reached.
 */
export function buildHandPositions(
  phrase: NoteEvent[],
  spanScale = 1,
): HandPosition[] {
  const onsetGroups = groupConsecutiveOnsets(phrase);
  if (onsetGroups.length === 0) {
    return [];
  }

  const maxSpan = MAX_HAND_SPAN_SEMITONES * spanScale;
  const positions: HandPosition[] = [];
  let events: NoteEvent[] = [];
  let minMidi = Infinity;
  let maxMidi = -Infinity;

  const flush = (): void => {
    if (events.length > 0) {
      positions.push({ events, minMidi, maxMidi });
    }
  };

  for (const group of onsetGroups) {
    const groupMin = Math.min(...group.map((event) => event.midi));
    const groupMax = Math.max(...group.map((event) => event.midi));
    const nextMin = Math.min(minMidi, groupMin);
    const nextMax = Math.max(maxMidi, groupMax);

    if (events.length > 0 && nextMax - nextMin > maxSpan) {
      flush();
      events = [...group];
      minMidi = groupMin;
      maxMidi = groupMax;
    } else {
      events.push(...group);
      minMidi = nextMin;
      maxMidi = nextMax;
    }
  }

  flush();
  return positions;
}

/** Finger every note of one hand's timeline using anchored positions. */
export function fingerTimeline(
  events: NoteEvent[],
  hand: Hand,
  spanScale = 1,
): (Finger | null)[] {
  const fingers: (Finger | null)[] = [];

  for (const phrase of segmentIntoPhrases(events)) {
    for (const position of buildHandPositions(phrase, spanScale)) {
      const range = position.maxMidi - position.minMidi;
      const mode = spanModeForRange(range, spanScale) ?? 'wide';
      const anchor = hand === 'R' ? position.minMidi : position.maxMidi;

      for (const group of groupConsecutiveOnsets(position.events)) {
        if (group.length === 1) {
          const finger = fingerForOffset(
            offsetForHand(group[0].midi, anchor, hand),
            mode,
          );
          if (finger === null) {
            console.warn(
              '[fingeringPredictor] offset out of reach inside a finalized position',
              { midi: group[0].midi, anchor, hand, range },
            );
          }
          fingers.push(finger ?? 5);
          continue;
        }

        const ascending = [...group].sort((left, right) => left.midi - right.midi);
        const chordFingers = assignChordFingersInPosition(
          ascending.map((event) => event.midi),
          anchor,
          hand,
          mode,
        );

        for (const finger of chordFingers) {
          fingers.push(finger);
        }
      }
    }
  }

  return fingers;
}

/** Standalone chord fingering: the chord is treated as its own position. */
export function assignChordFingers(
  chord: NoteEvent[],
  hand: Hand,
  spanScale = 1,
): (Finger | null)[] {
  if (chord.length === 0) {
    return [];
  }

  if (chord.length === 1) {
    return [chord[0].authoredFinger];
  }

  const indexed = chord
    .map((event, index) => ({ event, index }))
    .sort((left, right) => left.event.midi - right.event.midi);
  const ascendingMidis = indexed.map((entry) => entry.event.midi);
  const range = ascendingMidis[ascendingMidis.length - 1] - ascendingMidis[0];
  const mode = spanModeForRange(range, spanScale) ?? 'wide';
  const anchor = hand === 'R' ? ascendingMidis[0] : ascendingMidis[ascendingMidis.length - 1];
  const ascendingFingers = assignChordFingersInPosition(
    ascendingMidis,
    anchor,
    hand,
    mode,
  );

  const result = new Array<Finger | null>(chord.length).fill(null);
  indexed.forEach((entry, sortedPosition) => {
    result[entry.index] = ascendingFingers[sortedPosition];
  });

  return result;
}

const HANDS: Hand[] = ['L', 'R'];

function isFingeringAnchor(note: ScriptNote): boolean {
  return note.fingerSource === 'score' || note.fingerSource === 'manual';
}

function predictFingersForHand(
  script: PlaybackScript,
  hand: Hand,
  spanScale: number,
): (Finger | null)[] {
  return fingerTimeline(extractHandTimelines(script)[hand], hand, spanScale);
}

export interface PredictFingeringOptions {
  spanScale?: number;
}

export function predictFingering(
  script: PlaybackScript,
  options: PredictFingeringOptions = {},
): PlaybackScript {
  const spanScale = options.spanScale ?? 1;
  const fingersByHand: Record<Hand, (Finger | null)[]> = {
    L: predictFingersForHand(script, 'L', spanScale),
    R: predictFingersForHand(script, 'R', spanScale),
  };
  const cursor: Record<Hand, number> = { L: 0, R: 0 };

  return script.map((step) => {
    const noteUpdates = new Map<number, ScriptNote>();

    for (const hand of HANDS) {
      const indexedNotes = step.notes
        .map((note, index) => ({ note, index }))
        .filter(({ note }) => note.hand === hand)
        .sort((left, right) => left.note.midi - right.note.midi);

      for (const { note, index } of indexedNotes) {
        const predicted = fingersByHand[hand][cursor[hand]];
        cursor[hand] += 1;

        if (isFingeringAnchor(note)) {
          noteUpdates.set(index, { ...note });
        } else if (predicted === null) {
          noteUpdates.set(index, {
            pitch: note.pitch,
            midi: note.midi,
            hand: note.hand,
            finger: null,
          });
        } else {
          noteUpdates.set(index, {
            ...note,
            finger: predicted,
            fingerSource: 'predicted',
          });
        }
      }
    }

    return {
      ...step,
      notes: step.notes.map(
        (note, index) => noteUpdates.get(index) ?? { ...note },
      ),
    };
  });
}

export function applyManualFingerings(
  script: PlaybackScript,
  overrides: ManualFingeringMap,
): PlaybackScript {
  if (Object.keys(overrides).length === 0) {
    return script;
  }

  return script.map((step) => ({
    ...step,
    notes: step.notes.map((note) => {
      const finger = overrides[fingeringKey(step.onset, note.hand, note.midi)];
      if (finger === undefined) {
        return note;
      }

      return {
        ...note,
        finger,
        fingerSource: 'manual' as const,
      };
    }),
  }));
}

export function extractManualFingerings(
  script: PlaybackScript,
): ManualFingeringMap {
  const overrides: ManualFingeringMap = {};

  for (const step of script) {
    for (const note of step.notes) {
      if (note.fingerSource === 'manual' && note.finger !== null) {
        overrides[fingeringKey(step.onset, note.hand, note.midi)] = note.finger;
      }
    }
  }

  return overrides;
}

export function stripPredictedFingers(script: PlaybackScript): PlaybackScript {
  return script.map((step) => ({
    ...step,
    notes: step.notes.map((note) => {
      if (note.fingerSource !== 'predicted') {
        return note;
      }

      return {
        pitch: note.pitch,
        midi: note.midi,
        hand: note.hand,
        finger: null,
      };
    }),
  }));
}

export function applyFingeringSettings(
  script: PlaybackScript,
  autoFingering: boolean,
  spanScale: number,
): PlaybackScript {
  return autoFingering
    ? predictFingering(script, { spanScale })
    : stripPredictedFingers(script);
}

export function prepareScriptWithFingering(
  script: PlaybackScript,
  manualFingerings: ManualFingeringMap,
  autoFingering: boolean,
  spanScale: number,
): PlaybackScript {
  const withManual = applyManualFingerings(script, manualFingerings);

  return applyFingeringSettings(withManual, autoFingering, spanScale);
}
