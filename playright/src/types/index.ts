export type Hand = 'L' | 'R';

export type Finger = 1 | 2 | 3 | 4 | 5;

export interface ScriptNote {
  pitch: string;
  midi: number;
  hand: Hand;
  finger: Finger | null;
  fingerSource?: 'score' | 'predicted' | 'manual';
}

export interface StepOrder {
  order: number;
  /** MusicXML division time from the start of the part. */
  onset: number;
  notes: ScriptNote[];
}

export type PlaybackScript = StepOrder[];

export type EngineMode = 'default' | 'one-hand' | 'two-hand';

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
