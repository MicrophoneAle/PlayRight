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

  const compare = (left: NoteEvent, right: NoteEvent): number =>
    left.stepIndex - right.stepIndex || left.midi - right.midi;

  timelines.L.sort(compare);
  timelines.R.sort(compare);

  return timelines;
}

/** Split a hand timeline into phrases on a sustained gap (a quarter rest at divisions=480). */
export const PHRASE_MIN_ONSET_GAP_DIVISIONS = 480;

/** Major tenth. A position's pitch range may not exceed this. */
export const MAX_HAND_SPAN_SEMITONES = 16;

/** Five fingers span four gaps. */
export const MAX_FINGER_SPAN = 4;

export type SpanMode = 'close' | 'wide';

/** Consecutive pitch interval (semitones) to the number of fingers between the two notes. */
export function fingerGapForInterval(
  intervalSemitones: number,
  mode: SpanMode,
): number {
  const distance = Math.abs(intervalSemitones);
  if (distance === 0) {
    return 0;
  }

  if (mode === 'close') {
    if (distance <= 3) return 1;
    if (distance <= 5) return 2;
    if (distance <= 8) return 3;
    return 4;
  }

  if (distance <= 4) return 1;
  if (distance <= 8) return 2;
  if (distance <= 11) return 3;
  return 4;
}

/** Close for compact positions (range up to a tenth), wide when stretched. */
export function spanModeForRange(rangeSemitones: number, spanScale = 1): SpanMode {
  return rangeSemitones <= 10 * spanScale ? 'close' : 'wide';
}

/** RH: ascending pitch raises the finger number; LH mirrors it. */
function fingerDirection(hand: Hand, fromMidi: number, toMidi: number): number {
  if (toMidi === fromMidi) {
    return 0;
  }

  const ascending = toMidi > fromMidi;
  const fingerRises = hand === 'R' ? ascending : !ascending;
  return fingerRises ? 1 : -1;
}

interface OnsetGroup {
  stepIndex: number;
  onset: number;
  /** Ascending by midi. */
  events: NoteEvent[];
}

function groupOnsets(events: NoteEvent[]): OnsetGroup[] {
  const groups: OnsetGroup[] = [];

  for (const event of events) {
    const last = groups[groups.length - 1];
    if (last && last.stepIndex === event.stepIndex) {
      last.events.push(event);
    } else {
      groups.push({
        stepIndex: event.stepIndex,
        onset: event.onset,
        events: [event],
      });
    }
  }

  for (const group of groups) {
    group.events.sort((left, right) => left.midi - right.midi);
  }

  return groups;
}

export function segmentIntoPhrases(timeline: NoteEvent[]): NoteEvent[][] {
  if (timeline.length === 0) {
    return [];
  }

  const groups = groupOnsets(timeline);
  const phrases: NoteEvent[][] = [];
  let current: OnsetGroup[] = [groups[0]];

  for (let index = 1; index < groups.length; index += 1) {
    const gap = groups[index].onset - groups[index - 1].onset;

    if (gap >= PHRASE_MIN_ONSET_GAP_DIVISIONS) {
      phrases.push(current.flatMap((group) => group.events));
      current = [groups[index]];
    } else {
      current.push(groups[index]);
    }
  }

  phrases.push(current.flatMap((group) => group.events));
  return phrases;
}

interface RelativeWalk {
  relByEvent: Map<NoteEvent, number>;
  relMin: number;
  relMax: number;
  minMidi: number;
  maxMidi: number;
}

/**
 * Assign a relative finger to every note by walking the interval gaps. The walk
 * starts at 0, moves by the finger gap in the pitch direction, and reuses a
 * pitch's earlier relative finger when it recurs so returns stay consistent.
 * Chords spread their members upward in pitch by interval, in the hand's finger
 * direction, so members never collide.
 */
function walkRelative(
  groups: OnsetGroup[],
  hand: Hand,
  mode: SpanMode,
): RelativeWalk {
  const relByEvent = new Map<NoteEvent, number>();
  const relByMidi = new Map<number, number>();
  let relMin = 0;
  let relMax = 0;
  let minMidi = Infinity;
  let maxMidi = -Infinity;
  let lastMidi: number | null = null;
  let lastRel = 0;

  const record = (event: NoteEvent, rel: number): void => {
    relByEvent.set(event, rel);
    relByMidi.set(event.midi, rel);
    relMin = Math.min(relMin, rel);
    relMax = Math.max(relMax, rel);
    minMidi = Math.min(minMidi, event.midi);
    maxMidi = Math.max(maxMidi, event.midi);
  };

  const relForMelodic = (midi: number): number => {
    if (relByMidi.has(midi)) {
      return relByMidi.get(midi)!;
    }
    if (lastMidi === null) {
      return 0;
    }
    const gap = fingerGapForInterval(midi - lastMidi, mode);
    return lastRel + fingerDirection(hand, lastMidi, midi) * gap;
  };

  for (const group of groups) {
    const base = group.events[0];
    const baseRel = relForMelodic(base.midi);
    record(base, baseRel);

    if (group.events.length > 1) {
      const sign = hand === 'R' ? 1 : -1;
      let prevMidi = base.midi;
      let prevRel = baseRel;

      for (let index = 1; index < group.events.length; index += 1) {
        const event = group.events[index];
        const gap = Math.max(1, fingerGapForInterval(event.midi - prevMidi, mode));
        const rel = prevRel + sign * gap;
        record(event, rel);
        prevMidi = event.midi;
        prevRel = rel;
      }
    }

    // Continue the melodic walk from the group's lowest member.
    lastMidi = base.midi;
    lastRel = baseRel;
  }

  return { relByEvent, relMin, relMax, minMidi, maxMidi };
}

export interface HandPosition {
  groups: OnsetGroup[];
  minMidi: number;
  maxMidi: number;
}

function finalizePosition(groups: OnsetGroup[]): HandPosition {
  let minMidi = Infinity;
  let maxMidi = -Infinity;

  for (const group of groups) {
    for (const event of group.events) {
      minMidi = Math.min(minMidi, event.midi);
      maxMidi = Math.max(maxMidi, event.midi);
    }
  }

  return { groups, minMidi, maxMidi };
}

/**
 * Grow positions greedily. A candidate fits when the interval-gap walk stays
 * within five fingers and the pitch range stays within a tenth. The fit test
 * uses the close table, which has the largest gaps, so a position that fits
 * under it also fits under the wide table chosen at assignment time. A position
 * ends only when the next note cannot be reached, i.e. a scope shift only when
 * forced.
 */
function buildPositions(phrase: NoteEvent[], spanScale: number): HandPosition[] {
  const groups = groupOnsets(phrase);
  const positions: HandPosition[] = [];
  let current: OnsetGroup[] = [];

  const fits = (candidate: OnsetGroup[]): boolean => {
    const walk = walkRelative(candidate, 'R', 'close');
    const fingerSpan = walk.relMax - walk.relMin;
    const pitchRange = walk.maxMidi - walk.minMidi;
    return (
      fingerSpan <= MAX_FINGER_SPAN &&
      pitchRange <= MAX_HAND_SPAN_SEMITONES * spanScale
    );
  };

  for (const group of groups) {
    if (current.length === 0) {
      current = [group];
      continue;
    }

    if (fits([...current, group])) {
      current.push(group);
    } else {
      positions.push(finalizePosition(current));
      current = [group];
    }
  }

  if (current.length > 0) {
    positions.push(finalizePosition(current));
  }

  return positions;
}

function assignPosition(
  position: HandPosition,
  hand: Hand,
  spanScale: number,
): Map<NoteEvent, Finger | null> {
  const range = position.maxMidi - position.minMidi;
  const mode = spanModeForRange(range, spanScale);
  const walk = walkRelative(position.groups, hand, mode);
  const fingerByEvent = new Map<NoteEvent, Finger | null>();

  for (const [event, rel] of walk.relByEvent) {
    const absolute = rel - walk.relMin + 1;
    if (absolute < 1 || absolute > 5) {
      console.warn(
        '[fingeringPredictor] finger out of range in finalized position',
        { midi: event.midi, absolute, hand, range },
      );
      fingerByEvent.set(event, null);
    } else {
      fingerByEvent.set(event, absolute as Finger);
    }
  }

  return fingerByEvent;
}

/** Finger every note of one hand's timeline, returned aligned to the input order. */
export function fingerTimeline(
  events: NoteEvent[],
  hand: Hand,
  spanScale = 1,
): (Finger | null)[] {
  const fingerByEvent = new Map<NoteEvent, Finger | null>();

  for (const phrase of segmentIntoPhrases(events)) {
    for (const position of buildPositions(phrase, spanScale)) {
      for (const [event, finger] of assignPosition(position, hand, spanScale)) {
        fingerByEvent.set(event, finger);
      }
    }
  }

  return events.map((event) => fingerByEvent.get(event) ?? null);
}

/** Standalone chord fingering: the chord is its own single-onset position. */
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

  const events: NoteEvent[] = chord.map((note) => ({
    stepIndex: 0,
    onset: 0,
    midi: note.midi,
    authoredFinger: note.authoredFinger,
  }));

  return fingerTimeline(events, hand, spanScale);
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
