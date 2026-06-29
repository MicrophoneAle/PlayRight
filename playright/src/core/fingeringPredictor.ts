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

/** Major tenth (17 semitones). A scope wider than this starts a new placement. */
export const MAX_HAND_SPAN_SEMITONES = 17;

/** Five fingers span four gaps. */
export const MAX_FINGER_SPAN = 4;

/** Comfort scope: up to a tenth (10 semitones). */
export const COMFORT_SPAN_SEMITONES = 10;

export type SpanMode = 'close' | 'wide';

/** Comfort mapping for compact scopes (≤10 semitones). */
export function comfortFingerGap(distanceSemitones: number): number {
  const distance = Math.abs(distanceSemitones);
  if (distance <= 3) {
    return 1;
  }
  if (distance <= 5) {
    return 2;
  }
  if (distance <= 8) {
    return 3;
  }
  return 4;
}

/** Extended mapping for returning pitches or scopes between a tenth and a major tenth. */
export function extendedFingerGap(distanceSemitones: number): number {
  const distance = Math.abs(distanceSemitones);
  if (distance <= 4) {
    return 1;
  }
  if (distance <= 8) {
    return 2;
  }
  if (distance <= 11) {
    return 3;
  }
  return 4;
}

/**
 * Finger gap from semitone distance. Uses comfort mapping by default; extended
 * when the pitch was played before in this hand timeline or the scope is wide.
 */
export function fingerGapForInterval(
  intervalSemitones: number,
  mode: SpanMode,
  useExtended = false,
): number {
  const distance = Math.abs(intervalSemitones);
  if (distance === 0) {
    return 0;
  }

  if (useExtended || mode === 'wide') {
    return extendedFingerGap(distance);
  }

  return comfortFingerGap(distance);
}

/** Wide when the scope stretches past a tenth but stays within a major tenth. */
export function spanModeForRange(rangeSemitones: number, spanScale = 1): SpanMode {
  return rangeSemitones <= COMFORT_SPAN_SEMITONES * spanScale ? 'close' : 'wide';
}

/** A crossing (thumb-under / finger-over) only happens on a step this small. */
export const CROSS_MAX_STEP_SEMITONES = 2;

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
      groups.push({ stepIndex: event.stepIndex, onset: event.onset, events: [event] });
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

/** Lowest note leads the right hand, highest leads the left. */
function leadMidi(group: OnsetGroup, hand: Hand): number {
  return hand === 'R' ? group.events[0].midi : group.events[group.events.length - 1].midi;
}

function fingerMoveSign(hand: Hand, pitchStep: number): number {
  const sign = pitchStep > 0 ? 1 : pitchStep < 0 ? -1 : 0;
  return hand === 'R' ? sign : -sign;
}

function clampFinger(value: number): Finger {
  return Math.min(5, Math.max(1, value)) as Finger;
}

function avoidRepeat(previous: Finger, candidate: Finger): Finger {
  if (candidate !== previous) {
    return candidate;
  }
  if (candidate < 5) {
    return (candidate + 1) as Finger;
  }
  return (candidate - 1) as Finger;
}

function sameDirectionStepsAhead(leads: number[], fromIndex: number, dir: number): number {
  let count = 0;
  for (let index = fromIndex; index + 1 < leads.length; index += 1) {
    const step = leads[index + 1] - leads[index];
    if (Math.sign(step) === dir && Math.abs(step) <= CROSS_MAX_STEP_SEMITONES) {
      count += 1;
    } else {
      break;
    }
  }
  return count;
}

interface RelativeWalk {
  relByEvent: Map<NoteEvent, number>;
  relMin: number;
  relMax: number;
  minMidi: number;
  maxMidi: number;
}

/**
 * Interval-gap walk with comfort mapping by default and extended mapping for
 * pitches that recur within the hand timeline.
 */
function walkRelative(
  groups: OnsetGroup[],
  hand: Hand,
  mode: SpanMode,
  seenMidis: Set<number>,
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
    seenMidis.add(event.midi);
  };

  const relForMelodic = (midi: number): number => {
    if (relByMidi.has(midi)) {
      return relByMidi.get(midi)!;
    }
    if (lastMidi === null) {
      return 0;
    }
    const useExtended = seenMidis.has(midi);
    const gap = Math.max(
      1,
      fingerGapForInterval(midi - lastMidi, mode, useExtended),
    );
    return lastRel + fingerMoveSign(hand, midi - lastMidi) * gap;
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
        const useExtended = seenMidis.has(event.midi);
        const gap = Math.max(
          1,
          fingerGapForInterval(event.midi - prevMidi, mode, useExtended),
        );
        const rel = prevRel + sign * gap;
        record(event, rel);
        prevMidi = event.midi;
        prevRel = rel;
      }
    }

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

function buildPositions(
  phrase: NoteEvent[],
  hand: Hand,
  spanScale: number,
  seenMidis: Set<number>,
): HandPosition[] {
  const groups = groupOnsets(phrase);
  const positions: HandPosition[] = [];
  let current: OnsetGroup[] = [];

  const fits = (candidate: OnsetGroup[]): boolean => {
    const walk = walkRelative(candidate, hand, 'close', seenMidis);
    const pitchRange = walk.maxMidi - walk.minMidi;
    return pitchRange <= MAX_HAND_SPAN_SEMITONES * spanScale;
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

/** Pin the scope extreme to the pinky: highest RH / lowest LH → finger 5 (`]` / `q`). */
function absoluteFromWalk(walk: RelativeWalk, hand: Hand): Map<NoteEvent, Finger> {
  const result = new Map<NoteEvent, Finger>();

  let pinRel = walk.relMax;
  for (const [event, rel] of walk.relByEvent) {
    if (hand === 'R' && event.midi === walk.maxMidi) {
      pinRel = rel;
      break;
    }
    if (hand === 'L' && event.midi === walk.minMidi) {
      pinRel = rel;
      break;
    }
  }

  const offset = 5 - pinRel;
  for (const [event, rel] of walk.relByEvent) {
    result.set(event, clampFinger(rel + offset));
  }

  return result;
}

function assignTraversePlacement(
  placement: OnsetGroup[],
  hand: Hand,
  out: Map<NoteEvent, Finger | null>,
  startFinger?: Finger,
): void {
  const leads = placement.map((group) => leadMidi(group, hand));
  const pitchDir = Math.sign(leads[leads.length - 1] - leads[0]) || 1;
  const fingerUpRun = (hand === 'R') === (pitchDir > 0);
  const earlyFrom: Finger = fingerUpRun ? 3 : 1;
  const earlyTo: Finger = fingerUpRun ? 1 : 3;

  let finger: Finger = startFinger ?? (fingerUpRun ? 1 : 5);
  spreadChordFromLead(placement[0], hand, 'wide', finger, out);

  for (let index = 1; index < leads.length; index += 1) {
    const interval = leads[index] - leads[index - 1];
    const stepDir = Math.sign(interval);
    const absInterval = Math.abs(interval);
    const previous = finger;

    if (interval === 0) {
      // keep finger
    } else if (
      absInterval <= CROSS_MAX_STEP_SEMITONES &&
      stepDir === pitchDir &&
      finger === earlyFrom &&
      sameDirectionStepsAhead(leads, index, pitchDir) >= 2
    ) {
      finger = earlyTo;
    } else {
      const gap = Math.max(1, fingerGapForInterval(interval, 'wide', true));
      const candidate = finger + fingerMoveSign(hand, interval) * gap;
      if (candidate > 5) {
        finger = 1;
      } else if (candidate < 1) {
        finger = 3;
      } else {
        finger = candidate as Finger;
      }
    }

    if (interval !== 0) {
      finger = avoidRepeat(previous, finger);
    }

    spreadChordFromLead(placement[index], hand, 'wide', finger, out);
  }
}

function spreadChordFromLead(
  group: OnsetGroup,
  hand: Hand,
  mode: SpanMode,
  leadFinger: Finger,
  out: Map<NoteEvent, Finger | null>,
): void {
  const ascending = group.events;
  if (hand === 'R') {
    out.set(ascending[0], leadFinger);
    let prev = leadFinger;
    for (let index = 1; index < ascending.length; index += 1) {
      const gap = Math.max(
        1,
        fingerGapForInterval(ascending[index].midi - ascending[index - 1].midi, mode, true),
      );
      const finger = clampFinger(prev + gap);
      out.set(ascending[index], finger > prev ? finger : null);
      prev = finger;
    }
    return;
  }

  const top = ascending.length - 1;
  out.set(ascending[top], leadFinger);
  let prev = leadFinger;
  for (let index = top - 1; index >= 0; index -= 1) {
    const gap = Math.max(
      1,
      fingerGapForInterval(ascending[index + 1].midi - ascending[index].midi, mode, true),
    );
    const finger = clampFinger(prev + gap);
    out.set(ascending[index], finger > prev ? finger : null);
    prev = finger;
  }
}

function assignPosition(
  position: HandPosition,
  hand: Hand,
  spanScale: number,
  seenMidis: Set<number>,
): Map<NoteEvent, Finger | null> {
  const range = position.maxMidi - position.minMidi;
  const mode = spanModeForRange(range, spanScale);
  const walk = walkRelative(position.groups, hand, mode, seenMidis);
  const fingerByEvent = new Map<NoteEvent, Finger | null>();

  if (walk.relMax - walk.relMin <= MAX_FINGER_SPAN) {
    for (const [event, finger] of absoluteFromWalk(walk, hand)) {
      fingerByEvent.set(event, finger);
    }
    return fingerByEvent;
  }

  const projected = absoluteFromWalk(walk, hand);
  const leadEvent =
    hand === 'R'
      ? position.groups[0].events[0]
      : position.groups[0].events[position.groups[0].events.length - 1];
  const startFinger = projected.get(leadEvent);

  // A traverse moves the hand along the keyboard (thumb crossings), so the
  // scope extreme is NOT pinned to the pinky here — that bulk shift would
  // clamp most of a long melody onto finger 5.
  assignTraversePlacement(position.groups, hand, fingerByEvent, startFinger);
  return fingerByEvent;
}

/** Finger every note of one hand's timeline, returned aligned to the input order. */
export function fingerTimeline(
  events: NoteEvent[],
  hand: Hand,
  spanScale = 1,
): (Finger | null)[] {
  const fingerByEvent = new Map<NoteEvent, Finger | null>();
  const seenMidis = new Set<number>();

  for (const phrase of segmentIntoPhrases(events)) {
    for (const position of buildPositions(phrase, hand, spanScale, seenMidis)) {
      for (const [event, finger] of assignPosition(position, hand, spanScale, seenMidis)) {
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
