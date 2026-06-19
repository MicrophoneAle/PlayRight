export type Hand = 'L' | 'R';

export type Finger = 1 | 2 | 3 | 4 | 5;

export interface ScriptNote {
  pitch: string;
  midi: number;
  hand: Hand;
  finger: Finger | null;
  fingerSource?: 'score' | 'predicted' | 'manual';
  /** Note length in MusicXML divisions, when present in the score. */
  durationDivisions?: number;
  /** True when this note ties into the next note of the same pitch (no release gap). */
  tiedToNext?: boolean;
}

export interface ScoreTiming {
  divisionsPerQuarter: number;
  tempoBpm: number;
}

export interface ParseMusicXmlResult {
  script: PlaybackScript;
  scoreTiming: ScoreTiming;
}

export interface StepOrder {
  order: number;
  /** MusicXML division time from the start of the part. */
  onset: number;
  notes: ScriptNote[];
}

export type PlaybackScript = StepOrder[];

export type EngineMode = 'one-hand' | 'two-hand';

/** A note currently sounding during play mode playback. */
export interface PlayingPlaybackNote {
  pressId: number;
  stepIndex: number;
  midi: number;
  hand: Hand;
}

/** Stable key for a note in manual fingering overrides: stepIndex:hand:midi */
export type ManualFingeringKey = `${number}:${Hand}:${number}`;

export type ManualFingeringMap = Partial<Record<ManualFingeringKey, Finger>>;

export function fingeringKey(
  stepIndex: number,
  hand: Hand,
  midi: number,
): ManualFingeringKey {
  return `${stepIndex}:${hand}:${midi}`;
}

export function isFinger(value: number): value is Finger {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}
