import type {
  Finger,
  Hand,
  ManualFingeringMap,
  ManualHandOverrideMap,
  PlaybackScript,
  ScriptNote,
} from '../types/index.ts';
import { fingeringKey, manualHandOverrideKey } from '../types/index.ts';

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

/**
 * Widest reach, in semitones from the bottom anchor, that the comfort table covers
 * comfortably (a tenth). Also used as the span threshold above which a held hand
 * position is considered "wide" for reseat decisions.
 */
export const COMFORT_SPAN_SEMITONES = 10;

/** Alias: a scope whose lead span exceeds this is a wide hand position. */
export const WIDE_SPAN_SEMITONES = COMFORT_SPAN_SEMITONES;

/**
 * Minimum number of onset groups the current scope must contain while its lead
 * span stays above WIDE_SPAN_SEMITONES before a contour reseat may fire.
 */
export const SUSTAINED_WIDE_GROUPS = 4;

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
  if (distance <= 11) {
    return 3;
  }
  // An octave (12) and beyond reaches the pinky (gap 4 from the thumb).
  return 4;
}

/** Direction reversals allowed before a scope is treated as a turning figure, not a run. */
export const MAX_RUN_DIRECTION_CHANGES = 1;

/** A crossing (thumb-under / finger-over) only happens on a step this small. */
export const CROSS_MAX_STEP_SEMITONES = 2;

/**
 * A contour reseat only fires when the reversal step exceeds stepwise motion
 * (same threshold as run-crossing: turns at a leap, not a semitone wiggle).
 */
export const RESEAT_MIN_REVERSAL_SEMITONES = CROSS_MAX_STEP_SEMITONES + 1;

/**
 * A melodic leap of an octave or more makes the hand jump to a new register. If the
 * music then stays in the new register (the old one does not return within the
 * lookahead window), the hand has genuinely reseated and the scope should split at
 * the leap rather than holding one wide position across both registers.
 */
export const LEAP_RESEAT_SEMITONES = 12;

/** How many groups ahead to scan for the old register returning after a leap. */
export const RESEAT_LOOKAHEAD_GROUPS = 8;

/**
 * A leap only reseats when the new register is SUSTAINED: at least this many groups
 * (counting the leap target) stay in it before the old register returns. A single
 * trailing high note is a reach within the position, not a reseat.
 */
export const MIN_SUSTAINED_REGISTER_GROUPS = 3;

/** An octave or wider between two consecutive lead notes is always fingered 1–5. */
export const OCTAVE_SEMITONES = 12;

/**
 * A recurring pedal note anchors the thumb only when it sits within this reach of
 * the scope's lowest pitch (a perfect fifth). A frequent note higher than this is a
 * held melody note, not a bass pedal, so the hand centers on it instead.
 */
export const PEDAL_ANCHOR_MAX_HEIGHT = 7;

/** A pedal must recur at least this many times to anchor the thumb. */
export const PEDAL_MIN_COUNT = 2;

/** A bass pedal must be at least this many times as frequent as any other pitch. */
export const PEDAL_DOMINANCE_RATIO = 2;

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

/**
 * The pedal pitch a wide turning scope rests the thumb on: the most frequently
 * played pitch, tie-broken toward the bottom of the hand (RH lowest, LH highest)
 * so a rare lower/upper neighbour does not steal the thumb from the home note.
 */
function scopePedalMidi(groups: OnsetGroup[], hand: Hand): number {
  const counts = new Map<number, number>();
  for (const group of groups) {
    for (const event of group.events) {
      counts.set(event.midi, (counts.get(event.midi) ?? 0) + 1);
    }
  }

  let pedal = Infinity;
  let bestCount = -1;
  for (const [midi, count] of counts) {
    const ties = count === bestCount;
    const closerToBottom = hand === 'R' ? midi < pedal : midi > pedal;
    if (count > bestCount || (ties && closerToBottom)) {
      pedal = midi;
      bestCount = count;
    }
  }
  return pedal;
}

/**
 * True when the scope rests on a recurring bass pedal: the most-frequent pitch
 * repeats (>= PEDAL_MIN_COUNT), is strictly the most frequent, and sits within a
 * fifth (PEDAL_ANCHOR_MAX_HEIGHT) of the scope's lowest pitch — i.e. it is low
 * enough to be a thumb anchor. A frequent note higher than that is a held melody
 * note and the hand centers on it instead, so this returns false.
 */
function hasLowDominantPedal(groups: OnsetGroup[], hand: Hand): boolean {
  const counts = new Map<number, number>();
  for (const group of groups) {
    for (const event of group.events) {
      counts.set(event.midi, (counts.get(event.midi) ?? 0) + 1);
    }
  }
  if (counts.size === 0) {
    return false;
  }

  const pedal = scopePedalMidi(groups, hand);
  const pedalCount = counts.get(pedal) ?? 0;
  if (pedalCount < PEDAL_MIN_COUNT) {
    return false;
  }

  // The pedal must DOMINATE: at least twice as frequent as any other pitch. A
  // wandering melody whose most-common note merely edges out its neighbours is
  // not a bass pedal and should center instead.
  let secondCount = 0;
  for (const [midi, count] of counts) {
    if (midi !== pedal) {
      secondCount = Math.max(secondCount, count);
    }
  }
  if (pedalCount < PEDAL_DOMINANCE_RATIO * secondCount) {
    return false;
  }

  const extreme = hand === 'R'
    ? Math.min(...counts.keys())
    : Math.max(...counts.keys());

  if (pedal !== extreme) {
    const extremeCount = counts.get(extreme) ?? 0;
    // A single low pickup below the dominant melody band should not force reach
    // anchoring; center the band instead when stretch fits.
    if (extremeCount < PEDAL_MIN_COUNT) {
      return false;
    }
    if (pedalCount < PEDAL_DOMINANCE_RATIO * extremeCount) {
      return false;
    }
    return Math.abs(pedal - extreme) <= PEDAL_ANCHOR_MAX_HEIGHT;
  }

  return true;
}

/**
 * BASELINE finger per pitch for a wide turning scope: the thumb sits on the pedal
 * pitch, pitches at or below the pedal (RH; above for LH) take the thumb, and
 * pitches reaching away from the pedal take the finger at their reach distance via
 * the comfort or stretch table (chosen per scope from the scope's maximum reach
 * from its bottom anchor). This is only the resting hand shape; the contour walk
 * (contourReachFingers) turns it into the final per-occurrence fingers.
 */
function reachAnchoredFingers(
  pitches: number[],
  hand: Hand,
  anchorMidi: number,
): Map<number, number> {
  const result = new Map<number, number>();
  if (pitches.length === 0) {
    return result;
  }

  const bottomAnchor = pitches[0];
  const maxReach = pitches.reduce(
    (max, midi) => Math.max(max, Math.abs(midi - bottomAnchor)),
    0,
  );
  const gapFn = maxReach <= COMFORT_SPAN_SEMITONES ? comfortFingerGap : extendedFingerGap;

  for (const midi of pitches) {
    const reach = hand === 'R' ? midi - anchorMidi : anchorMidi - midi;
    const finger = reach <= 0 ? 1 : clampFinger(1 + gapFn(Math.abs(reach)));
    result.set(midi, finger);
  }
  return result;
}

interface ContourWalkResult {
  fingerByLeadEvent: Map<NoteEvent, Finger>;
  /** When the pinky cannot move up further, split the scope before this group index. */
  resplitBeforeIndex: number | null;
}

/**
 * Per-occurrence contour walk for the reach path. Priority order:
 * 1) Consecutive octave+ leaps are always thumb-to-pinky (1–5 ascending RH).
 * 2) Consecutive different pitches never share a finger (except the pedal pitch
 *    itself always stays on the thumb; repeated pitches keep their finger).
 *    Thumb+pivot on descending; pinky+up requests a scope resplit.
 * 3) Baseline + monotonic contour for everything else.
 */
function contourReachFingers(
  groups: OnsetGroup[],
  hand: Hand,
  anchorMidi: number,
  baselineByMidi: Map<number, number>,
): ContourWalkResult {
  const fingerByLeadEvent = new Map<NoteEvent, Finger>();
  let resplitBeforeIndex: number | null = null;

  const isPedalPitch = (midi: number): boolean => midi === anchorMidi;

  let prevMidi: number | null = null;
  let prevFinger: Finger = 1;
  let prevPrevFinger: Finger | null = null;

  const chooseThumbPivot = (pitchDir: number): Finger => {
    const candidates: Finger[] = pitchDir > 0 ? [2, 3] : [3, 2];
    for (const candidate of candidates) {
      if (prevPrevFinger === null || candidate !== prevPrevFinger) {
        return candidate;
      }
    }
    return 2;
  };

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    const lead = hand === 'R' ? group.events[0] : group.events[group.events.length - 1];
    const midi = lead.midi;
    const baseline = clampFinger(baselineByMidi.get(midi) ?? 1);

    let finger: Finger;

    if (prevMidi === null) {
      finger = isPedalPitch(midi) ? 1 : baseline;
    } else if (midi === prevMidi) {
      finger = prevFinger;
    } else if (
      Math.abs(midi - prevMidi) >= OCTAVE_SEMITONES
    ) {
      // Rule 1: consecutive octave or wider is always thumb-to-pinky.
      const ascending = fingerMoveSign(hand, midi - prevMidi) > 0;
      finger = ascending ? 5 : 1;
    } else if (isPedalPitch(midi)) {
      finger = 1;
    } else {
      const pitchDir = fingerMoveSign(hand, midi - prevMidi);

      if (prevFinger === 1 && pitchDir !== 0) {
        const inBassZone = hand === 'R' ? midi <= anchorMidi : midi >= anchorMidi;
        const descending = hand === 'R' ? pitchDir < 0 : pitchDir > 0;
        if (descending && inBassZone) {
          // Adjacent low notes under the pedal share the thumb.
          finger = 1;
        } else if (descending) {
          finger = chooseThumbPivot(pitchDir);
        } else {
          const raw = Math.max(baseline, prevFinger + 1);
          finger = clampFinger(Math.max(2, raw));
        }
      } else if (prevFinger === 5) {
        const needsResplit = hand === 'R' ? pitchDir > 0 : pitchDir < 0;
        if (needsResplit) {
          resplitBeforeIndex = groupIndex;
          break;
        }
        const raw = Math.min(baseline, prevFinger - 1);
        finger = clampFinger(Math.max(2, raw));
      } else {
        const raw =
          pitchDir > 0
            ? Math.max(baseline, prevFinger + 1)
            : Math.min(baseline, prevFinger - 1);
        finger = clampFinger(Math.max(2, raw));
      }

      if (finger === prevFinger) {
        const allowBassThumbShare =
          prevFinger === 1 &&
          (hand === 'R' ? midi <= anchorMidi : midi >= anchorMidi) &&
          (hand === 'R' ? pitchDir < 0 : pitchDir > 0);
        if (allowBassThumbShare) {
          finger = 1;
        } else if (prevFinger === 1) {
          finger = chooseThumbPivot(pitchDir);
        } else if (prevFinger === 5 && (hand === 'R' ? pitchDir > 0 : pitchDir < 0)) {
          resplitBeforeIndex = groupIndex;
          break;
        } else {
          const nudged =
            pitchDir > 0 ? clampFinger(prevFinger + 1) : clampFinger(prevFinger - 1);
          finger = clampFinger(Math.max(2, nudged));
        }
      }
    }

    fingerByLeadEvent.set(lead, finger);
    prevPrevFinger = prevMidi === null ? null : prevFinger;
    prevMidi = midi;
    prevFinger = finger;
  }

  return { fingerByLeadEvent, resplitBeforeIndex };
}

/** Which gap table a reach-anchored scope selected (null when not on that path). */
export function reachTableForScope(
  groups: OnsetGroup[],
  hand: Hand,
): 'comfort' | 'stretch' | null {
  const pitches = distinctPitchesFromAnchor(groups, hand);
  if (pitches.length === 0) {
    return null;
  }

  const comfortGaps = gapsForPitches(pitches, comfortFingerGap);
  const comfortFits = gapSpan(comfortGaps) <= MAX_FINGER_SPAN;
  const stretch = distributeScope(pitches, extendedFingerGap);

  if (isSustainedRun(groups, hand, stretch.fits)) {
    return null;
  }
  if (comfortFits || stretch.fits) {
    return null;
  }

  const maxReach = pitches.reduce(
    (max, midi) => Math.max(max, Math.abs(midi - pitches[0])),
    0,
  );
  return maxReach <= COMFORT_SPAN_SEMITONES ? 'comfort' : 'stretch';
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
  /**
   * Per-occurrence fingers for the reach path's lead events (contour-monotonic).
   * Absent on the comfort-centered, stretch-centered, and traverse branches, which
   * remain per-midi.
   */
  fingerByLeadEvent?: Map<NoteEvent, Finger>;
  /** Pinky-rescope split point within this scope (reach path only). */
  resplitBeforeIndex?: number | null;
}

/**
 * Shape-first scope walk:
 * - RUN (monotonic scale / travelling arpeggio) -> traverse with crossings.
 * - STATIC turning figure that fits a distinct-per-finger layout -> comfort,
 *   then widened stretch, both centered.
 * - STATIC turning figure with more distinct pitches than five fingers can hold
 *   one-per-finger -> reach-anchored fixed wide hand (finger reuse), NOT traverse.
 * Only a genuine monotonic run traverses; the distinct-pitch count never does.
 */
function chooseScopeWalk(groups: OnsetGroup[], hand: Hand): ScopeWalk {
  const pitches = distinctPitchesFromAnchor(groups, hand);
  const comfortGaps = gapsForPitches(pitches, comfortFingerGap);
  const comfortFits = gapSpan(comfortGaps) <= MAX_FINGER_SPAN;
  const stretch = distributeScope(pitches, extendedFingerGap);

  if (isSustainedRun(groups, hand, stretch.fits)) {
    return { needsTraverse: true, fingerByMidi: stretch.fingerByMidi };
  }

  // A scope resting on a low recurring bass pedal anchors the thumb on that pedal
  // even when it would otherwise fit a centered distinct-per-finger layout, so the
  // pedal stays on finger 1 instead of a rare low neighbour stealing the thumb.
  if (!hasLowDominantPedal(groups, hand)) {
    if (comfortFits) {
      return { needsTraverse: false, fingerByMidi: centeredFingers(pitches, comfortGaps) };
    }

    if (stretch.fits) {
      return { needsTraverse: false, fingerByMidi: stretch.fingerByMidi };
    }
  }

  // Pedal-anchored reach path: more distinct pitches than a distinct-per-finger
  // is capped at 17 semitones by buildPositions (within physical reach) and is not
  // a run: hold a fixed wide hand anchored on the pedal pitch (finger reuse) so the
  // recurring low note keeps the thumb, instead of resetting via traverse.
  const pedal = scopePedalMidi(groups, hand);
  const baselineByMidi = reachAnchoredFingers(pitches, hand, pedal);
  const walk = contourReachFingers(groups, hand, pedal, baselineByMidi);
  return {
    needsTraverse: false,
    fingerByMidi: baselineByMidi,
    fingerByLeadEvent: walk.fingerByLeadEvent,
    resplitBeforeIndex: walk.resplitBeforeIndex,
  };
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

/** Span of the scope's lead-midi line (max lead minus min lead). */
function leadSpanOfGroups(groups: OnsetGroup[], hand: Hand): number {
  if (groups.length === 0) {
    return 0;
  }
  const leads = groups.map((group) => leadMidi(group, hand));
  return Math.max(...leads) - Math.min(...leads);
}

/**
 * True when the incoming group turns the lead contour (local extremum): the signed
 * interval into incoming opposes the signed interval before it. Reuses the same
 * signed-interval view as isMelodicRunContinuation.
 */
function isDirectionReversal(
  current: OnsetGroup[],
  incoming: OnsetGroup,
  hand: Hand,
): boolean {
  if (current.length < 2) {
    return false;
  }

  const prevLead = leadMidi(current[current.length - 2], hand);
  const lastLead = leadMidi(current[current.length - 1], hand);
  const nextLead = leadMidi(incoming, hand);
  const prevInterval = lastLead - prevLead;
  const nextInterval = nextLead - lastLead;

  if (prevInterval === 0 || nextInterval === 0) {
    return false;
  }

  return Math.sign(prevInterval) !== Math.sign(nextInterval);
}

/**
 * True when the scope's lead span has exceeded WIDE_SPAN_SEMITONES for at least
 * `wideHoldGroups` consecutive tail groups (maintained by buildPositions).
 */
function hasSustainedWideSpan(wideHoldGroups: number): boolean {
  return wideHoldGroups >= SUSTAINED_WIDE_GROUPS;
}

/**
 * Reseat when the hand has been held at a wide stretch for a sustained run of
 * notes and the melody turns at a leap (local extremum): close at the extremum,
 * open at the reversal. Never fires mid-stepwise-run, on stepwise wiggles, or on
 * short/narrow scopes.
 */
function isReseatPoint(
  current: OnsetGroup[],
  incoming: OnsetGroup,
  hand: Hand,
  wideHoldGroups: number,
): boolean {
  if (current.length < SUSTAINED_WIDE_GROUPS) {
    return false;
  }

  if (isMelodicRunContinuation(current, incoming, hand)) {
    return false;
  }

  if (!hasSustainedWideSpan(wideHoldGroups)) {
    return false;
  }

  if (!isDirectionReversal(current, incoming, hand)) {
    return false;
  }

  const lastLead = leadMidi(current[current.length - 1], hand);
  const nextLead = leadMidi(incoming, hand);
  return Math.abs(nextLead - lastLead) > RESEAT_MIN_REVERSAL_SEMITONES;
}

/**
 * True when a leap of an octave or more lands in a new register that the music
 * then stays in: scanning RESEAT_LOOKAHEAD_GROUPS ahead, no lead returns to the
 * old register (the prevLead side of the leap's midpoint). A leap whose old
 * register returns soon (e.g. a recurring low pedal under a melody that jumps up
 * and back) is a reach within one hand position, not a reseat.
 */
function isRegisterShiftReseat(
  current: OnsetGroup[],
  groups: OnsetGroup[],
  index: number,
  hand: Hand,
): boolean {
  if (current.length === 0) {
    return false;
  }

  const prevLead = leadMidi(current[current.length - 1], hand);
  const nextLead = leadMidi(groups[index], hand);
  const leap = nextLead - prevLead;
  if (Math.abs(leap) < LEAP_RESEAT_SEMITONES) {
    return false;
  }

  const midpoint = (prevLead + nextLead) / 2;
  const lookEnd = Math.min(groups.length, index + RESEAT_LOOKAHEAD_GROUPS);
  let sustained = 0;
  for (let scan = index; scan < lookEnd; scan += 1) {
    const lead = leadMidi(groups[scan], hand);
    const returnedToOldRegister = leap > 0 ? lead <= midpoint : lead >= midpoint;
    if (returnedToOldRegister) {
      return false;
    }
    sustained += 1;
  }

  // The new register must hold for several notes, not just a single trailing leap.
  return sustained >= MIN_SUSTAINED_REGISTER_GROUPS;
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

  let wideHoldGroups = 0;

  const refreshWideHold = (): void => {
    wideHoldGroups =
      leadSpanOfGroups(current, hand) > WIDE_SPAN_SEMITONES ? wideHoldGroups + 1 : 0;
  };

  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    if (current.length === 0) {
      current = [group];
      wideHoldGroups = 0;
      continue;
    }

    if (fits([...current, group])) {
      if (
        isReseatPoint(current, group, hand, wideHoldGroups) ||
        isRegisterShiftReseat(current, groups, index, hand)
      ) {
        positions.push(finalizePosition(current));
        current = [group];
        wideHoldGroups = 0;
      } else {
        current.push(group);
        refreshWideHold();
      }
      continue;
    }

    // Stepwise scales/arpeggios flow across the hand-span cap so traverse can
    // finger them continuously; only split on a genuine break (leap or turn).
    if (isMelodicRunContinuation(current, group, hand)) {
      current.push(group);
      refreshWideHold();
    } else {
      positions.push(finalizePosition(current));
      current = [group];
      wideHoldGroups = 0;
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
  const { needsTraverse, fingerByMidi, fingerByLeadEvent } = chooseScopeWalk(
    position.groups,
    hand,
  );
  const fingerByEvent = new Map<NoteEvent, Finger | null>();

  for (const group of position.groups) {
    for (const event of group.events) {
      seenMidis.add(event.midi);
    }
  }

  if (!needsTraverse) {
    if (fingerByLeadEvent) {
      // Reach path: per-occurrence lead fingers, chord tones spread from the lead.
      for (const group of position.groups) {
        const lead =
          hand === 'R' ? group.events[0] : group.events[group.events.length - 1];
        const leadFinger =
          fingerByLeadEvent.get(lead) ?? clampFinger(fingerByMidi.get(lead.midi) ?? 1);
        spreadChordFromLead(group, hand, leadFinger, seenMidis, fingerByEvent);
      }
      return fingerByEvent;
    }

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

/**
 * When the reach-path contour walk signals a pinky-rescope, split the position at
 * that group index so the next scope can re-center.
 */
function expandPositionsForReachSplits(
  positions: HandPosition[],
  hand: Hand,
): HandPosition[] {
  const expanded: HandPosition[] = [];

  for (const position of positions) {
    const pitches = distinctPitchesFromAnchor(position.groups, hand);
    const comfortGaps = gapsForPitches(pitches, comfortFingerGap);
    const comfortFits = gapSpan(comfortGaps) <= MAX_FINGER_SPAN;
    const stretch = distributeScope(pitches, extendedFingerGap);

    if (isSustainedRun(position.groups, hand, stretch.fits)) {
      expanded.push(position);
      continue;
    }

    if (!hasLowDominantPedal(position.groups, hand) && (comfortFits || stretch.fits)) {
      expanded.push(position);
      continue;
    }

    const pedal = scopePedalMidi(position.groups, hand);
    const baselineByMidi = reachAnchoredFingers(pitches, hand, pedal);
    const { resplitBeforeIndex } = contourReachFingers(
      position.groups,
      hand,
      pedal,
      baselineByMidi,
    );

    if (
      resplitBeforeIndex !== null &&
      resplitBeforeIndex > 0 &&
      resplitBeforeIndex < position.groups.length
    ) {
      expanded.push(finalizePosition(position.groups.slice(0, resplitBeforeIndex)));
      expanded.push(finalizePosition(position.groups.slice(resplitBeforeIndex)));
    } else {
      expanded.push(position);
    }
  }

  return expanded;
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
    const positions = expandPositionsForReachSplits(
      buildPositions(phrase, hand, spanScale),
      hand,
    );
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

function isFingeringAnchor(note: ScriptNote, overrideScore: boolean): boolean {
  if (note.fingerSource === 'manual') {
    return true;
  }

  return !overrideScore && note.fingerSource === 'score';
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
  /** When true, score-authored fingerings are replaced by prediction; manual always wins. */
  overrideScore?: boolean;
}

export function predictFingering(
  script: PlaybackScript,
  options: PredictFingeringOptions = {},
): PlaybackScript {
  const spanScale = options.spanScale ?? 1;
  const overrideScore = options.overrideScore ?? false;
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

        if (isFingeringAnchor(note, overrideScore)) {
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

export function applyManualHandOverrides(
  script: PlaybackScript,
  overrides: ManualHandOverrideMap,
): PlaybackScript {
  if (Object.keys(overrides).length === 0) {
    return script;
  }

  return script.map((step) => ({
    ...step,
    notes: step.notes.map((note) => {
      const overrideHand = overrides[manualHandOverrideKey(step.onset, note.midi)];
      if (overrideHand === undefined) {
        return note;
      }

      return { ...note, hand: overrideHand };
    }),
  }));
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
  overrideScore = false,
): PlaybackScript {
  return autoFingering
    ? predictFingering(script, { spanScale, overrideScore })
    : stripPredictedFingers(script);
}

export function prepareScriptWithFingering(
  script: PlaybackScript,
  manualFingerings: ManualFingeringMap,
  autoFingering: boolean,
  spanScale: number,
  overrideScore = false,
  manualHandOverrides: ManualHandOverrideMap = {},
): PlaybackScript {
  const withHands = applyManualHandOverrides(script, manualHandOverrides);
  const withManual = applyManualFingerings(withHands, manualFingerings);

  return applyFingeringSettings(withManual, autoFingering, spanScale, overrideScore);
}

export interface FingeringScopeReport {
  phraseIndex: number;
  scopeIndex: number;
  noteCount: number;
  distinctPitchCount: number;
  pitchRangeSemitones: number;
  needsTraverse: boolean;
  isRun: boolean;
  /** Gap table when on the reach-anchored path; null otherwise. */
  reachTable: 'comfort' | 'stretch' | null;
  /** Maximum semitone reach from the scope bottom anchor (pitches[0]). */
  maxReachFromBottom: number;
  fingers: Finger[];
  midis: number[];
}

export interface HandFingeringReport {
  hand: Hand;
  totalNotes: number;
  phraseCount: number;
  scopeCount: number;
  traverseScopeCount: number;
  fingerUsage: Record<Finger, number>;
  thumbShare: number;
  lowThreeShare: number;
  scopes: FingeringScopeReport[];
}

/** Diagnostic report for phrasing, scoping, and fingering on one hand's timeline. */
export function reportHandFingering(
  script: PlaybackScript,
  hand: Hand,
  spanScale = 1,
): HandFingeringReport {
  const events = extractHandTimelines(script)[hand];
  const fingers = fingerTimeline(events, hand, spanScale);
  const fingerByEvent = new Map<NoteEvent, Finger | null>();
  events.forEach((event, index) => {
    fingerByEvent.set(event, fingers[index]);
  });

  const phrases = segmentIntoPhrases(events);
  const scopes: FingeringScopeReport[] = [];

  phrases.forEach((phrase, phraseIndex) => {
    const positions = buildPositions(phrase, hand, spanScale);
    positions.forEach((position, scopeIndex) => {
      const pitches = distinctPitchesFromAnchor(position.groups, hand);
      const stretch = distributeScope(pitches, extendedFingerGap);
      const walk = chooseScopeWalk(position.groups, hand);
      const maxReachFromBottom = pitches.reduce(
        (max, midi) => Math.max(max, Math.abs(midi - pitches[0])),
        0,
      );
      const scopeEvents = position.groups.flatMap((group) => group.events);
      const midis = scopeEvents.map((event) => event.midi);
      const scopeFingers = scopeEvents
        .map((event) => fingerByEvent.get(event))
        .filter((finger): finger is Finger => finger !== null);

      scopes.push({
        phraseIndex,
        scopeIndex,
        noteCount: scopeEvents.length,
        distinctPitchCount: pitches.length,
        pitchRangeSemitones: position.maxMidi - position.minMidi,
        needsTraverse: walk.needsTraverse,
        isRun: isSustainedRun(position.groups, hand, stretch.fits),
        reachTable: reachTableForScope(position.groups, hand),
        maxReachFromBottom,
        fingers: scopeFingers,
        midis,
      });
    });
  });

  const fingerUsage: Record<Finger, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const finger of fingers) {
    if (finger !== null) {
      fingerUsage[finger] += 1;
    }
  }

  const assigned = fingers.filter((finger) => finger !== null).length;
  const lowThree = fingers.filter(
    (finger) => finger === 1 || finger === 2 || finger === 3,
  ).length;

  return {
    hand,
    totalNotes: events.length,
    phraseCount: phrases.length,
    scopeCount: scopes.length,
    traverseScopeCount: scopes.filter((scope) => scope.needsTraverse).length,
    fingerUsage,
    thumbShare: assigned > 0 ? fingerUsage[1] / assigned : 0,
    lowThreeShare: assigned > 0 ? lowThree / assigned : 0,
    scopes,
  };
}
