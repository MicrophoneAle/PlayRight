import {
  CORE_BLACK_PHYSICALS,
  CORE_WHITE_PHYSICALS,
  getEffectiveKeyMap,
  midisFitScopeKeyMap,
  PIANO_END_MIDI,
  PIANO_START_MIDI,
  SCOPE_SIZE,
} from './InputManager.ts';
import { useEngineStore } from '../store/useEngineStore.ts';
import type { Finger, Hand, ScriptNote } from '../types/index.ts';

const MAX_SCOPE_START = PIANO_END_MIDI - (SCOPE_SIZE - 1);
const CENTER_OFFSET = Math.floor((SCOPE_SIZE - 1) / 2);

/**
 * How far the visible scope should extend below/above a note so an octave (and
 * similar) leap on the same finger does not force a rescope.
 *
 * Right-hand fingers: 1 (thumb) stretches upward, 5 (pinky) stretches downward.
 * Left hand mirrors (LH 1 ↔ RH 5, LH 5 ↔ RH 1). Every case spans exactly
 * SCOPE_SIZE - 1 (= 16) semitones so the reach fills one core window.
 */
export function fingerReachSemitones(
  hand: Hand,
  finger: Finger,
): { down: number; up: number } {
  const rightHandFinger =
    hand === 'R' ? finger : ((6 - finger) as Finger);

  switch (rightHandFinger) {
    case 5:
      return { down: 16, up: 0 };
    case 4:
      return { down: 11, up: 5 };
    case 3:
      return { down: 8, up: 8 };
    case 2:
      return { down: 5, up: 11 };
    case 1:
      return { down: 0, up: 16 };
  }
}

function playingHandOf(note: Pick<ScriptNote, 'hand' | 'playingHand'>): Hand {
  return note.playingHand ?? note.hand;
}

/** True when `midi` lies in the finger-reach window around `anchorMidi`. */
export function midiInFingerReach(
  midi: number,
  anchorMidi: number,
  hand: Hand,
  finger: Finger,
): boolean {
  const { down, up } = fingerReachSemitones(hand, finger);
  return midi >= anchorMidi - down && midi <= anchorMidi + up;
}

/**
 * True when every target note sits inside some same-hand anchor note's
 * finger-reach window. Used so e.g. RH 5 → RH 5 an octave down keeps scope.
 */
export function notesCoveredByFingerReach(
  notes: readonly ScriptNote[],
  anchors: readonly ScriptNote[],
): boolean {
  if (notes.length === 0) {
    return true;
  }
  if (anchors.length === 0) {
    return false;
  }

  return notes.every((note) =>
    anchors.some((anchor) => {
      if (anchor.finger == null) {
        return false;
      }
      if (playingHandOf(note) !== playingHandOf(anchor)) {
        return false;
      }
      return midiInFingerReach(
        note.midi,
        anchor.midi,
        playingHandOf(anchor),
        anchor.finger,
      );
    }),
  );
}

/** Ideal scopeStart so [midi - down, midi + up] fills the core window. */
export function idealScopeStartForFinger(
  midi: number,
  hand: Hand,
  finger: Finger,
): number {
  const { down } = fingerReachSemitones(hand, finger);
  const idealStart = midi - down;
  return Math.max(PIANO_START_MIDI, Math.min(idealStart, MAX_SCOPE_START));
}

function getCoreKeyMidis(scopeStart: number, transpose: number): Set<number> {
  const map = getEffectiveKeyMap(scopeStart, transpose);
  const midis = new Set<number>();

  for (const code of CORE_WHITE_PHYSICALS) {
    const midi = map[code];
    if (midi !== undefined) {
      midis.add(midi);
    }
  }

  for (const code of CORE_BLACK_PHYSICALS) {
    const midi = map[code];
    if (midi !== undefined) {
      midis.add(midi);
    }
  }

  return midis;
}

function midisFitCoreKeys(
  midis: number[],
  scopeStart: number,
  transpose: number,
): boolean {
  const coreMidis = getCoreKeyMidis(scopeStart, transpose);
  return midis.every((midi) => coreMidis.has(midi));
}

function findBestCoreScopeStart(
  midis: number[],
  currentScopeStart: number,
  transpose: number,
): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;

  for (let start = PIANO_START_MIDI; start <= MAX_SCOPE_START; start += 1) {
    if (!midisFitCoreKeys(midis, start, transpose)) {
      continue;
    }

    const distance = Math.abs(start - currentScopeStart);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = start;
    }
  }

  return best;
}

function findBestScopeStartForKeyMap(
  midis: number[],
  currentScopeStart: number,
  transpose: number,
): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;

  for (let start = PIANO_START_MIDI; start <= MAX_SCOPE_START; start += 1) {
    if (!midisFitScopeKeyMap(midis, start, transpose)) {
      continue;
    }

    const distance = Math.abs(start - currentScopeStart);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = start;
    }
  }

  return best;
}

function preferredScopeStartFromNotes(
  notes: readonly ScriptNote[],
  fallbackCenterMidis: number[],
): number {
  const fingered = notes.filter(
    (note): note is ScriptNote & { finger: Finger } => note.finger != null,
  );

  if (fingered.length === 1) {
    return idealScopeStartForFinger(
      fingered[0].midi,
      playingHandOf(fingered[0]),
      fingered[0].finger,
    );
  }

  if (fingered.length > 1) {
    // Prefer a start that keeps every fingered note inside its own reach
    // window relative to the placed scope's implied anchor geometry: use the
    // average of per-note ideals, then clamp.
    const sum = fingered.reduce(
      (total, note) =>
        total +
        idealScopeStartForFinger(note.midi, playingHandOf(note), note.finger),
      0,
    );
    return Math.max(
      PIANO_START_MIDI,
      Math.min(Math.round(sum / fingered.length), MAX_SCOPE_START),
    );
  }

  const spanCenter = Math.round(
    (Math.min(...fallbackCenterMidis) + Math.max(...fallbackCenterMidis)) / 2,
  );
  return Math.max(
    PIANO_START_MIDI,
    Math.min(spanCenter - CENTER_OFFSET, MAX_SCOPE_START),
  );
}

/**
 * Place the scope so the first step's notes sit in a finger-aware window
 * (or near the middle of the core row when unfingered). Falls back to
 * {@link alignScopeToMidis} when the span cannot fit on core keys.
 */
export function centerScopeOnMidis(midis: Iterable<number>): void {
  centerScopeOnPracticeNotes(
    [...midis].map((midi) => ({
      pitch: '',
      midi,
      hand: 'R' as const,
      finger: null,
    })),
  );
}

export function centerScopeOnPracticeNotes(notes: readonly ScriptNote[]): void {
  const midiList = notes.map((note) => note.midi);
  if (midiList.length === 0) {
    return;
  }

  const { scopeTranspose } = useEngineStore.getState();
  const preferredStart = preferredScopeStartFromNotes(notes, midiList);

  if (midisFitCoreKeys(midiList, preferredStart, scopeTranspose)) {
    useEngineStore.getState().actions.setScopeStart(preferredStart);
    return;
  }

  const coreScopeStart = findBestCoreScopeStart(
    midiList,
    preferredStart,
    scopeTranspose,
  );
  if (coreScopeStart !== null) {
    useEngineStore.getState().actions.setScopeStart(coreScopeStart);
    return;
  }

  alignScopeToMidis(midiList);
}

export function alignScopeToMidis(midis: Iterable<number>): void {
  alignScopeToPracticeNotes(
    [...midis].map((midi) => ({
      pitch: '',
      midi,
      hand: 'R' as const,
      finger: null,
    })),
  );
}

/**
 * Keep scope whenever notes are already playable (core or extensions).
 * Scope shifts are reserved for drastic cases: notes that do not fit the
 * current key map at all. When a move is required, choose the nearest fitting
 * start from the current scope — never a finger-preferred re-center.
 *
 * `anchors` are retained for API compatibility and for
 * {@link notesCoveredByFingerReach} callers/tests; playability alone decides
 * whether to keep.
 */
export function alignScopeToPracticeNotes(
  notes: readonly ScriptNote[],
  _anchors: readonly ScriptNote[] = [],
): void {
  const midiList = notes.map((note) => note.midi);
  if (midiList.length === 0) {
    return;
  }

  const { scopeStartMidi, scopeTranspose } = useEngineStore.getState();

  // Already playable → never shift for "better" centering (including pulling
  // extension notes into the core). Octave leaps that stay on the key map
  // must keep the prior placement.
  if (midisFitScopeKeyMap(midiList, scopeStartMidi, scopeTranspose)) {
    return;
  }

  // Drastic: notes are unreachable on the current map. Nearest core fit from
  // the current start, then nearest full key-map fit.
  const coreScopeStart = findBestCoreScopeStart(
    midiList,
    scopeStartMidi,
    scopeTranspose,
  );
  if (coreScopeStart !== null) {
    if (coreScopeStart !== scopeStartMidi) {
      useEngineStore.getState().actions.setScopeStart(coreScopeStart);
    }
    return;
  }

  const keyMapScopeStart = findBestScopeStartForKeyMap(
    midiList,
    scopeStartMidi,
    scopeTranspose,
  );
  if (keyMapScopeStart !== null && keyMapScopeStart !== scopeStartMidi) {
    useEngineStore.getState().actions.setScopeStart(keyMapScopeStart);
  }
}
