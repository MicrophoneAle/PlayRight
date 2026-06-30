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

/** Absolute-reach mapping: max finger stretch for one scope (up to 17 semitones). */
export function extendedFingerGap(distanceSemitones: number): number {
  const distance = Math.abs(distanceSemitones);
  if (distance <= 4) {
    return 1;
  }
  if (distance <= 8) {
    return 2;
  }
  if (distance <= 12) {
    return 3;
  }
  return 4;
}

/** Direction reversals allowed before a scope is treated as a turning figure, not a run. */
export const MAX_RUN_DIRECTION_CHANGES = 1;

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

function isBlackKey(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(midi % 12);
}

function gapsForPitches(
  pitches: number[],
  gapFn: (distance: number) => number,
): number[] {
  const gaps: number[] = [];
  for (let index = 1; index < pitches.length; index += 1) {
    const distance = Math.abs(pitches[index] - pitches[index - 1]);
    gaps.push(Math.max(1, gapFn(distance)));
  }
  return gaps;
}

function gapSpan(gaps: number[]): number {
  return gaps.reduce((sum, gap) => sum + gap, 0);
}

/**
 * Count sign changes between consecutive non-zero lead intervals. Reuses the
 * same signed-interval view as isMelodicRunContinuation.
 */
function countDirectionChanges(groups: OnsetGroup[], hand: Hand): number {
  if (groups.length < 2) {
    return 0;
  }

  const leads = groups.map((group) => leadMidi(group, hand));
  let directionChanges = 0;
  let previousDirection = 0;

  for (let index = 1; index < leads.length; index += 1) {
    const interval = leads[index] - leads[index - 1];
    if (interval === 0) {
      continue;
    }

    const direction = Math.sign(interval);
    if (previousDirection !== 0 && direction !== previousDirection) {
      directionChanges += 1;
    }
    previousDirection = direction;
  }

  return directionChanges;
}

/**
 * True when the scope is a travelling run (scale or wide arpeggio), not a
 * turning-around figure. Requires at most MAX_RUN_DIRECTION_CHANGES direction
 * reversals, then either a majority of steps are stepwise (<= CROSS_MAX_STEP_SEMITONES,
 * the same threshold as isMelodicRunContinuation) or the widened stretch layout
 * cannot fit five fingers (hand must travel). Leap-heavy figures that still fit
 * one static centered hand position stay static.
 */
function isSustainedRun(
  groups: OnsetGroup[],
  hand: Hand,
  stretchFits: boolean,
): boolean {
  if (groups.length < 2) {
    return false;
  }

  if (countDirectionChanges(groups, hand) > MAX_RUN_DIRECTION_CHANGES) {
    return false;
  }

  const leads = groups.map((group) => leadMidi(group, hand));
  let stepwiseSteps = 0;
  let melodicSteps = 0;

  for (let index = 1; index < leads.length; index += 1) {
    const interval = leads[index] - leads[index - 1];
    if (interval === 0) {
      continue;
    }
    melodicSteps += 1;
    if (Math.abs(interval) <= CROSS_MAX_STEP_SEMITONES) {
      stepwiseSteps += 1;
    }
  }

  if (melodicSteps === 0) {
    return false;
  }

  const predominantlyStepwise = stepwiseSteps * 2 > melodicSteps;
  if (predominantlyStepwise) {
    return true;
  }

  return !stretchFits;
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

/** Comfort-first per-step gap: try comfort, fall back to stretch when comfort overflows. */
function chooseAdaptiveGap(
  intervalSemitones: number,
  lastRel: number,
  relMin: number,
  relMax: number,
  hand: Hand,
  _seenMidis: Set<number>,
  _targetMidi: number,
): number {
  const distance = Math.abs(intervalSemitones);
  for (const gap of [comfortFingerGap(distance), extendedFingerGap(distance)]) {
    const nextRel = lastRel + fingerMoveSign(hand, intervalSemitones) * gap;
    const nextSpan = Math.max(relMax, nextRel) - Math.min(relMin, nextRel);
    if (nextSpan <= MAX_FINGER_SPAN) {
      return Math.max(1, gap);
    }
  }
  return Math.max(1, extendedFingerGap(distance));
}

/** Distinct scope pitches ordered low→high for RH, high→low for LH. */
function distinctPitchesFromAnchor(groups: OnsetGroup[], hand: Hand): number[] {
  const distinct = [
    ...new Set(groups.flatMap((group) => group.events.map((event) => event.midi))),
  ];
  // The first entry is the scope's reach toward the thumb (RH lowest pitch,
  // LH highest); fingers grow from there. Centering decides the actual offset.
  distinct.sort((left, right) => (hand === 'R' ? left - right : right - left));
  return distinct;
}

/**
 * Map gap-spaced pitch slots to absolute fingers by CENTERING the layout in
 * 1..5 instead of pinning the bottom slot to the thumb. With span = total gaps:
 *
 *   offset = 1 + floor((MAX_FINGER_SPAN - span) / 2)   // center the block
 *   then shift minimally so offset..offset+span stays inside 1..5
 *   finger(pitch) = clamp(offset + slot(pitch))
 *
 * A narrow mid-hand scope lands on 2-3-4 (thumb/pinky free at the reaches), a
 * full five-finger spread stays 1-2-3-4-5, and a scope rooted at its lowest note
 * keeps that note on or near the thumb. Spacing is a pure function of pitch, so
 * recurring pitches keep one finger and distinct pitches keep distinct fingers.
 */
function centeredFingers(pitches: number[], gaps: number[]): Map<number, number> {
  const fingerByMidi = new Map<number, number>();
  if (pitches.length === 0) {
    return fingerByMidi;
  }

  const slots: number[] = [0];
  for (let index = 0; index < gaps.length; index += 1) {
    slots.push(slots[index] + gaps[index]);
  }
  const span = slots[slots.length - 1];

  let offset = 1 + Math.floor((MAX_FINGER_SPAN - span) / 2);
  if (offset + span > 5) {
    offset -= offset + span - 5;
  }
  if (offset < 1) {
    offset = 1;
  }

  for (let index = 0; index < pitches.length; index += 1) {
    fingerByMidi.set(pitches[index], clampFinger(offset + slots[index]));
  }
  return fingerByMidi;
}

interface ScopeFingering {
  /** Centered finger per distinct pitch. */
  fingerByMidi: Map<number, number>;
  /** Relative span of the layout (total gaps). */
  span: number;
  /** Whether the layout fits inside five fingers. */
  fits: boolean;
}

/**
 * Space the scope's distinct pitches by the supplied gap table, then center the
 * layout in 1..5. Every gap is at least 1, so two different pitches always
 * receive different finger slots; centeredFingers preserves that separation.
 * When the spaced layout overflows five fingers but the scope has at most five
 * distinct pitches, the widest gaps are compressed toward 1 until it fits.
 * If compression cannot reach MAX_FINGER_SPAN (more than five distinct pitches,
 * or gaps already at 1), fits is false and a static scope falls to traverse.
 */
function distributeScope(
  pitches: number[],
  gapFn: (distance: number) => number,
): ScopeFingering {
  if (pitches.length === 0) {
    return { fingerByMidi: new Map(), span: 0, fits: true };
  }

  const gaps = gapsForPitches(pitches, gapFn);

  let span = gapSpan(gaps);
  // Narrow the widest gaps first; each stays >= 1 so distinct pitches keep
  // distinct fingers.
  while (span > MAX_FINGER_SPAN) {
    let widest = -1;
    for (let index = 0; index < gaps.length; index += 1) {
      if (gaps[index] > 1 && (widest === -1 || gaps[index] > gaps[widest])) {
        widest = index;
      }
    }
    if (widest === -1) {
      break;
    }
    gaps[widest] -= 1;
    span -= 1;
  }

  return { fingerByMidi: centeredFingers(pitches, gaps), span, fits: span <= MAX_FINGER_SPAN };
}

interface ScopeWalk {
  needsTraverse: boolean;
  /** Centered finger per distinct pitch (the static layout, or the traverse seed). */
  fingerByMidi: Map<number, number>;
}

/**
 * Shape-first scope walk:
 * - RUN (monotonic scale / travelling arpeggio) -> traverse with crossings.
 * - STATIC turning figure -> comfort, then widened stretch, both centered.
 * - STATIC that fits neither table -> traverse as a safety net.
 * Distinct-pitch count alone never forces traverse.
 */
function chooseScopeWalk(groups: OnsetGroup[], hand: Hand): ScopeWalk {
  const pitches = distinctPitchesFromAnchor(groups, hand);
  const comfortGaps = gapsForPitches(pitches, comfortFingerGap);
  const comfortFits = gapSpan(comfortGaps) <= MAX_FINGER_SPAN;
  const stretch = distributeScope(pitches, extendedFingerGap);

  if (isSustainedRun(groups, hand, stretch.fits)) {
    return { needsTraverse: true, fingerByMidi: stretch.fingerByMidi };
  }

  if (comfortFits) {
    return { needsTraverse: false, fingerByMidi: centeredFingers(pitches, comfortGaps) };
  }

  if (stretch.fits) {
    return { needsTraverse: false, fingerByMidi: stretch.fingerByMidi };
  }

  return { needsTraverse: true, fingerByMidi: stretch.fingerByMidi };
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

function pitchRangeOfGroups(groups: OnsetGroup[]): number {
  let minMidi = Infinity;
  let maxMidi = -Infinity;

  for (const group of groups) {
    for (const event of group.events) {
      minMidi = Math.min(minMidi, event.midi);
      maxMidi = Math.max(maxMidi, event.midi);
    }
  }

  return maxMidi - minMidi;
}

/**
 * True when the incoming group continues a stepwise run (small same-direction
 * steps) rather than a genuine scope break (leap or direction change).
 */
function isMelodicRunContinuation(
  current: OnsetGroup[],
  incoming: OnsetGroup,
  hand: Hand,
): boolean {
  if (current.length === 0) {
    return false;
  }

  const lastLead = leadMidi(current[current.length - 1], hand);
  const nextLead = leadMidi(incoming, hand);
  const interval = nextLead - lastLead;
  const absInterval = Math.abs(interval);

  if (absInterval > CROSS_MAX_STEP_SEMITONES) {
    return false;
  }

  if (current.length >= 2) {
    const prevLead = leadMidi(current[current.length - 2], hand);
    const prevInterval = lastLead - prevLead;
    if (
      Math.sign(prevInterval) !== 0 &&
      Math.sign(interval) !== 0 &&
      Math.sign(prevInterval) !== Math.sign(interval)
    ) {
      return false;
    }
  }

  return absInterval <= CROSS_MAX_STEP_SEMITONES;
}

function buildPositions(
  phrase: NoteEvent[],
  hand: Hand,
  spanScale: number,
): HandPosition[] {
  const groups = groupOnsets(phrase);
  const positions: HandPosition[] = [];
  let current: OnsetGroup[] = [];
  const maxSpan = MAX_HAND_SPAN_SEMITONES * spanScale;

  const fits = (candidate: OnsetGroup[]): boolean =>
    pitchRangeOfGroups(candidate) <= maxSpan;

  for (const group of groups) {
    if (current.length === 0) {
      current = [group];
      continue;
    }

    if (fits([...current, group])) {
      current.push(group);
      continue;
    }

    // Stepwise scales/arpeggios flow across the hand-span cap so traverse can
    // finger them continuously; only split on a genuine break (leap or turn).
    if (isMelodicRunContinuation(current, group, hand)) {
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

/**
 * Highest finger the chord would reach (unclamped) if its lead note took
 * `leadFinger`. Used to detect when a chord cannot fit under finger 5 from a
 * given lead, mirroring spreadChordFromLead's gap accumulation.
 */
function chordTopFingerFromLead(
  group: OnsetGroup,
  hand: Hand,
  leadFinger: Finger,
  seenMidis: Set<number>,
): number {
  const ascending = group.events;
  if (ascending.length <= 1) {
    return leadFinger;
  }

  let prev: number = leadFinger;
  let top: number = leadFinger;

  if (hand === 'R') {
    for (let index = 1; index < ascending.length; index += 1) {
      const gap = Math.max(
        1,
        chooseAdaptiveGap(
          ascending[index].midi - ascending[index - 1].midi,
          prev,
          0,
          MAX_FINGER_SPAN,
          hand,
          seenMidis,
          ascending[index].midi,
        ),
      );
      prev += gap;
      top = Math.max(top, prev);
    }
    return top;
  }

  for (let index = ascending.length - 2; index >= 0; index -= 1) {
    const gap = Math.max(
      1,
      chooseAdaptiveGap(
        ascending[index + 1].midi - ascending[index].midi,
        prev,
        0,
        MAX_FINGER_SPAN,
        hand,
        seenMidis,
        ascending[index].midi,
      ),
    );
    prev += gap;
    top = Math.max(top, prev);
  }
  return top;
}

/**
 * Lower a chord's lead finger so the whole chord fits under finger 5. Without
 * this, a drifting melodic lead pushes block chords onto the pinky and overflows
 * the upper notes to null (the "RH all on `[`" collapse). Single notes pass
 * through unchanged, preserving the melodic interval fingering.
 */
function fitChordLeadFinger(
  group: OnsetGroup,
  hand: Hand,
  desiredLead: Finger,
  seenMidis: Set<number>,
): Finger {
  if (group.events.length <= 1) {
    return desiredLead;
  }

  const top = chordTopFingerFromLead(group, hand, desiredLead, seenMidis);
  const overflow = top - 5;
  if (overflow <= 0) {
    return desiredLead;
  }

  return clampFinger(desiredLead - overflow);
}

function assignTraversePlacement(
  placement: OnsetGroup[],
  hand: Hand,
  out: Map<NoteEvent, Finger | null>,
  seenMidis: Set<number>,
  startFinger?: Finger,
): void {
  const leads = placement.map((group) => leadMidi(group, hand));
  const pitchDir = Math.sign(leads[leads.length - 1] - leads[0]) || 1;
  const fingerUpRun = (hand === 'R') === (pitchDir > 0);

  const leadFingerByMidi = new Map<number, Finger>();

  let finger: Finger = startFinger ?? (fingerUpRun ? 1 : 5);
  finger = fitChordLeadFinger(placement[0], hand, finger, seenMidis);
  spreadChordFromLead(placement[0], hand, finger, seenMidis, out);
  leadFingerByMidi.set(leads[0], finger);

  for (let index = 1; index < leads.length; index += 1) {
    const interval = leads[index] - leads[index - 1];
    const stepDir = Math.sign(interval);
    const absInterval = Math.abs(interval);
    const previous = finger;
    const reused = leadFingerByMidi.get(leads[index]);
    const stepwise = absInterval <= CROSS_MAX_STEP_SEMITONES;
    const movingInRunDir = stepDir === pitchDir;

    if (reused !== undefined) {
      finger = reused;
    } else if (interval === 0) {
      // keep finger
    } else if (movingInRunDir) {
      const remaining = sameDirectionStepsAhead(leads, index, pitchDir);
      const crossFrom: Finger = fingerUpRun ? (stepwise ? 3 : 4) : 1;
      const crossTo: Finger = fingerUpRun ? 1 : stepwise ? 3 : 4;
      const shouldCross =
        finger === crossFrom &&
        (stepwise ? remaining >= 3 : remaining >= 1 || absInterval > CROSS_MAX_STEP_SEMITONES);

      if (shouldCross) {
        // Prefer not landing the thumb on a black key; allow it when unavoidable.
        if (fingerUpRun && crossTo === 1 && isBlackKey(leads[index]) && stepwise && finger === 3) {
          const gap = Math.max(1, comfortFingerGap(absInterval));
          const candidate = finger + fingerMoveSign(hand, interval) * gap;
          finger = candidate <= 5 ? clampFinger(candidate) : crossTo;
        } else {
          finger = crossTo;
        }
      } else {
        const gap = Math.max(1, comfortFingerGap(absInterval));
        const candidate = finger + fingerMoveSign(hand, interval) * gap;

        if (fingerUpRun && candidate > 5) {
          finger = 1;
        } else if (!fingerUpRun && candidate < 1) {
          finger = stepwise ? 3 : 4;
        } else {
          finger = clampFinger(candidate);
        }
      }
    } else {
      const gap = Math.max(1, comfortFingerGap(absInterval));
      finger = clampFinger(finger + fingerMoveSign(hand, interval) * gap);
    }

    if (interval !== 0 && reused === undefined) {
      finger = avoidRepeat(previous, finger);
    }

    finger = fitChordLeadFinger(placement[index], hand, finger, seenMidis);
    spreadChordFromLead(placement[index], hand, finger, seenMidis, out);
    leadFingerByMidi.set(leads[index], finger);
  }
}

function spreadChordFromLead(
  group: OnsetGroup,
  hand: Hand,
  leadFinger: Finger,
  seenMidis: Set<number>,
  out: Map<NoteEvent, Finger | null>,
): void {
  const ascending = group.events;
  if (hand === 'R') {
    out.set(ascending[0], leadFinger);
    let prev = leadFinger;
    for (let index = 1; index < ascending.length; index += 1) {
      const gap = Math.max(
        1,
        chooseAdaptiveGap(
          ascending[index].midi - ascending[index - 1].midi,
          prev,
          0,
          MAX_FINGER_SPAN,
          hand,
          seenMidis,
          ascending[index].midi,
        ),
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
      chooseAdaptiveGap(
        ascending[index + 1].midi - ascending[index].midi,
        prev,
        0,
        MAX_FINGER_SPAN,
        hand,
        seenMidis,
        ascending[index].midi,
      ),
    );
    const finger = clampFinger(prev + gap);
    out.set(ascending[index], finger > prev ? finger : null);
    prev = finger;
  }
}

function assignPosition(
  position: HandPosition,
  hand: Hand,
  _spanScale: number,
  seenMidis: Set<number>,
  _isNewScope: boolean,
): Map<NoteEvent, Finger | null> {
  const { needsTraverse, fingerByMidi } = chooseScopeWalk(position.groups, hand);
  const fingerByEvent = new Map<NoteEvent, Finger | null>();

  for (const group of position.groups) {
    for (const event of group.events) {
      seenMidis.add(event.midi);
    }
  }

  if (!needsTraverse) {
    for (const group of position.groups) {
      for (const event of group.events) {
        fingerByEvent.set(event, clampFinger(fingerByMidi.get(event.midi) ?? 1));
      }
    }
    return fingerByEvent;
  }

  const firstEvent =
    hand === 'R'
      ? position.groups[0].events[0]
      : position.groups[0].events[position.groups[0].events.length - 1];
  const startFinger = clampFinger(fingerByMidi.get(firstEvent.midi) ?? 1);
  assignTraversePlacement(position.groups, hand, fingerByEvent, seenMidis, startFinger);
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
    const positions = buildPositions(phrase, hand, spanScale);
    for (let positionIndex = 0; positionIndex < positions.length; positionIndex += 1) {
      const position = positions[positionIndex];
      for (const [event, finger] of assignPosition(
        position,
        hand,
        spanScale,
        seenMidis,
        positionIndex > 0,
      )) {
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
