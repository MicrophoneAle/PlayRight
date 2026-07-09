export type Hand = 'L' | 'R';

export type Finger = 1 | 2 | 3 | 4 | 5;

export interface ScriptNote {
  pitch: string;
  midi: number;
  hand: Hand;
  finger: Finger | null;
  /** Physical hand that plays this note (crossovers); defaults to notated hand when unset. */
  playingHand?: Hand;
  fingerSource?: 'score' | 'predicted' | 'manual';
  /** Note length in MusicXML divisions, when present in the score. */
  durationDivisions?: number;
  /** True when this note ties into the next note of the same pitch (no release gap). */
  tiedToNext?: boolean;
  /** True when the score marks a fermata over this note. */
  hasFermata?: boolean;
}

export interface ScoreTiming {
  divisionsPerQuarter: number;
  tempoBpm: number;
  /** Canonical-division cursor after the full score timeline walk (includes rests). */
  totalTimelineDivisions: number;
}

export interface ParseMusicXmlResult {
  script: PlaybackScript;
  scoreTiming: ScoreTiming;
  /** Non-fatal parse notices surfaced to the user after a successful load. */
  warnings: string[];
}

export interface GraceNoteInfo {
  midi: number;
  pitch: string;
  hand: Hand;
  kind: 'acciaccatura' | 'appoggiatura';
  stealTime?: 'previous' | 'following';
  /**
   * Undefined until Phase 2 (DP auto-fingering) or score/manual capture
   * populates it. Practice mode treats an undefined finger as "unfingered":
   * a two-hand grace position requires a finger to be playable and is
   * skipped until one exists (mirrors main-note chord-overflow filtering).
   */
  finger?: Finger;
  fingerSource?: 'score' | 'predicted' | 'manual';
}

export interface StepOrder {
  order: number;
  /** MusicXML division time from the start of the part. */
  onset: number;
  /** MusicXML measure number (1-based) for the step's attack. */
  measureNumber: number;
  notes: ScriptNote[];
  /**
   * Grace note(s) immediately preceding this step's note/chord. Play-mode
   * metadata: scheduled in PlaybackEngine, not fingered in practice/program.
   * Does not advance onset — rides on the main note/chord it precedes.
   */
  graceBefore?: GraceNoteInfo[];
}

export type PlaybackScript = StepOrder[];

/** Practice walk target: main step attack or a grace note preceding that step. */
export type PracticePosition =
  | { kind: 'main'; stepIndex: number }
  | { kind: 'grace'; stepIndex: number; graceIndex: number };

export type EngineMode = 'one-hand' | 'two-hand';

/** A note currently sounding during play mode playback. */
export interface PlayingPlaybackNote {
  pressId: number;
  stepIndex: number;
  midi: number;
  hand: Hand;
}

/**
 * Stable key for manual fingering overrides: onset:hand:midi (MusicXML divisions).
 * Pre-existing saves keyed by step index are not migrated and will not match after re-parse.
 */
export type ManualFingeringKey = `${number}:${Hand}:${number}`;

export interface ManualFingeringAssignment {
  finger: Finger;
  physicalHand: Hand;
}

/** Plain finger = same physical hand as notated; object records a cross-hand assignment. */
export type ManualFingeringValue = Finger | ManualFingeringAssignment;

export type ManualFingeringMap = Partial<Record<ManualFingeringKey, ManualFingeringValue>>;

export function fingeringKey(
  onset: number,
  hand: Hand,
  midi: number,
): ManualFingeringKey {
  return `${onset}:${hand}:${midi}`;
}

/** Program captures fingers; edit reassigns a selected note (including cross-hand). */
export type FingeringMode = 'off' | 'program';

export interface SelectedFingeringNote {
  stepIndex: number;
  onset: number;
  hand: Hand;
  midi: number;
}

export function isFinger(value: number): value is Finger {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

export function resolveManualAssignment(
  onset: number,
  notatedHand: Hand,
  midi: number,
  map: ManualFingeringMap,
): ManualFingeringAssignment | null {
  const raw = map[fingeringKey(onset, notatedHand, midi)];
  if (raw === undefined) {
    return null;
  }

  if (typeof raw === 'number') {
    return { finger: raw, physicalHand: notatedHand };
  }

  return raw;
}
