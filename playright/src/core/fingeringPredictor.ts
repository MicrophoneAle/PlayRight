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

/** How far ahead to look when deciding crossings and pin direction. */
export const FINGER_LOOKAHEAD = 8;

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

/** Lowest note leads the right hand, highest leads the left (the note nearest the thumb side). */
function leadMidi(group: OnsetGroup, hand: Hand): number {
  return hand === 'R' ? group.events[0].midi : group.events[group.events.length - 1].midi;
}

/** Finger moves the same direction as pitch for the right hand, opposite for the left. */
function fingerMoveSign(hand: Hand, pitchStep: number): number {
  const sign = pitchStep > 0 ? 1 : pitchStep < 0 ? -1 : 0;
  return hand === 'R' ? sign : -sign;
}

function clampFinger(value: number): Finger {
  return Math.min(5, Math.max(1, value)) as Finger;
}

/** Bump a finger off a collision with the previous one, staying in range. */
function avoidRepeat(previous: Finger, candidate: Finger): Finger {
  if (candidate !== previous) {
    return candidate;
  }
  if (candidate < 5) {
    return (candidate + 1) as Finger;
  }
  return (candidate - 1) as Finger;
}

/** Number of consecutive small steps from fromIndex that continue in direction dir. */
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

export function segmentIntoPlacements(
  groups: OnsetGroup[],
  hand: Hand,
  spanScale: number,
): OnsetGroup[][] {
  const maxJump = MAX_HAND_SPAN_SEMITONES * spanScale;
  const placements: OnsetGroup[][] = [];
  let current: OnsetGroup[] = [];

  for (const group of groups) {
    if (current.length === 0) {
      current = [group];
      continue;
    }

    const previousLead = leadMidi(current[current.length - 1], hand);
    if (Math.abs(leadMidi(group, hand) - previousLead) > maxJump) {
      placements.push(current);
      current = [group];
    } else {
      current.push(group);
    }
  }

  if (current.length > 0) {
    placements.push(current);
  }

  return placements;
}

interface StaticWalk {
  relByMidi: Map<number, number>;
  relMin: number;
  relMax: number;
}

/** Relative finger per distinct pitch from the gap walk; rel rises toward the pinky end. */
function staticRelWalk(leads: number[], hand: Hand, mode: SpanMode): StaticWalk {
  const relByMidi = new Map<number, number>();
  let relMin = 0;
  let relMax = 0;
  let lastMidi: number | null = null;
  let lastRel = 0;

  for (const midi of leads) {
    let rel: number;
    if (relByMidi.has(midi)) {
      rel = relByMidi.get(midi)!;
    } else if (lastMidi === null) {
      rel = 0;
    } else {
      const gap = Math.max(1, fingerGapForInterval(midi - lastMidi, mode));
      rel = lastRel + fingerMoveSign(hand, midi - lastMidi) * gap;
      relByMidi.set(midi, rel);
    }
    relByMidi.set(midi, rel);
    relMin = Math.min(relMin, rel);
    relMax = Math.max(relMax, rel);
    lastMidi = midi;
    lastRel = rel;
  }

  return { relByMidi, relMin, relMax };
}

/** Spread chord members inward from the lead to distinct fingers. */
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
        fingerGapForInterval(ascending[index].midi - ascending[index - 1].midi, mode),
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
      fingerGapForInterval(ascending[index + 1].midi - ascending[index].midi, mode),
    );
    const finger = clampFinger(prev + gap);
    out.set(ascending[index], finger > prev ? finger : null);
    prev = finger;
  }
}

/** Standalone chord: pin the pinky to the hand's extreme pitch (high RH, low LH). */
function spreadStandaloneChord(
  group: OnsetGroup,
  hand: Hand,
  mode: SpanMode,
  out: Map<NoteEvent, Finger | null>,
): void {
  const ascending = group.events;
  const pinky = 5 as Finger;

  if (hand === 'R') {
    const top = ascending.length - 1;
    out.set(ascending[top], pinky);
    let prev: Finger = pinky;
    for (let index = top - 1; index >= 0; index -= 1) {
      const gap = Math.max(
        1,
        fingerGapForInterval(ascending[index + 1].midi - ascending[index].midi, mode),
      );
      const finger = clampFinger(prev - gap);
      out.set(ascending[index], finger < prev ? finger : null);
      prev = finger;
    }
    return;
  }

  out.set(ascending[0], pinky);
  let prev: Finger = pinky;
  for (let index = 1; index < ascending.length; index += 1) {
    const gap = Math.max(
      1,
      fingerGapForInterval(ascending[index].midi - ascending[index - 1].midi, mode),
    );
    const finger = clampFinger(prev - gap);
    out.set(ascending[index], finger < prev ? finger : null);
    prev = finger;
  }
}

function assignStaticPlacement(
  placement: OnsetGroup[],
  hand: Hand,
  mode: SpanMode,
  walk: StaticWalk,
  out: Map<NoteEvent, Finger | null>,
): void {
  const leads = placement.map((group) => leadMidi(group, hand));
  const pitchRange = Math.max(...leads) - Math.min(...leads);
  const relSpan = walk.relMax - walk.relMin;
  const compactStatic = pitchRange <= 4 && relSpan <= 2;

  for (const group of placement) {
    const lead = leadMidi(group, hand);
    const rel = walk.relByMidi.get(lead) ?? 0;
    const leadFinger = compactStatic
      ? clampFinger(rel - walk.relMin + 1)
      : clampFinger(rel + (5 - walk.relMax));
    spreadChordFromLead(group, hand, mode, leadFinger, out);
  }
}

function assignTraversePlacement(
  placement: OnsetGroup[],
  hand: Hand,
  out: Map<NoteEvent, Finger | null>,
): void {
  const leads = placement.map((group) => leadMidi(group, hand));
  const pitchDir = Math.sign(leads[leads.length - 1] - leads[0]) || 1;
  const fingerUpRun = (hand === 'R') === (pitchDir > 0);
  const earlyFrom: Finger = fingerUpRun ? 3 : 1;
  const earlyTo: Finger = fingerUpRun ? 1 : 3;

  let finger: Finger = fingerUpRun ? 1 : 5;
  spreadChordFromLead(placement[0], hand, 'wide', finger, out);

  for (let index = 1; index < leads.length; index += 1) {
    const interval = leads[index] - leads[index - 1];
    const stepDir = Math.sign(interval);
    const absInterval = Math.abs(interval);
    const previous = finger;

    if (interval === 0) {
      // repeated pitch keeps its finger
    } else if (
      absInterval <= CROSS_MAX_STEP_SEMITONES &&
      stepDir === pitchDir &&
      finger === earlyFrom &&
      sameDirectionStepsAhead(leads, index, pitchDir) >= 2
    ) {
      finger = earlyTo;
    } else {
      const gap = Math.max(1, fingerGapForInterval(interval, 'wide'));
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

/** Finger every note of one hand's timeline, returned aligned to the input order. */
export function fingerTimeline(
  events: NoteEvent[],
  hand: Hand,
  spanScale = 1,
): (Finger | null)[] {
  const out = new Map<NoteEvent, Finger | null>();

  for (const phrase of segmentIntoPhrases(events)) {
    const groups = groupOnsets(phrase);
    for (const placement of segmentIntoPlacements(groups, hand, spanScale)) {
      const leads = placement.map((group) => leadMidi(group, hand));
      const range = Math.max(...leads) - Math.min(...leads);
      const mode = spanModeForRange(range, spanScale);
      const walk = staticRelWalk(leads, hand, mode);

      if (walk.relMax - walk.relMin <= MAX_FINGER_SPAN) {
        assignStaticPlacement(placement, hand, mode, walk, out);
      } else {
        assignTraversePlacement(placement, hand, out);
      }
    }
  }

  return events.map((event) => out.get(event) ?? null);
}

/** Standalone chord fingering: extreme on the pinky, members inward, distinct. */
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
  const mode = spanModeForRange(range, spanScale);

  const group: OnsetGroup = {
    stepIndex: 0,
    onset: 0,
    events: indexed.map((entry) => ({
      stepIndex: 0,
      onset: 0,
      midi: entry.event.midi,
      authoredFinger: entry.event.authoredFinger,
    })),
  };
  const out = new Map<NoteEvent, Finger | null>();
  spreadStandaloneChord(group, hand, mode, out);

  const result = new Array<Finger | null>(chord.length).fill(null);
  indexed.forEach((entry, sortedPosition) => {
    result[entry.index] = out.get(group.events[sortedPosition]) ?? null;
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
