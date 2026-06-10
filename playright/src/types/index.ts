export type Hand = 'L' | 'R';

export type Finger = 1 | 2 | 3 | 4 | 5;

export interface ScriptNote {
  pitch: string;
  midi: number;
  hand: Hand;
  finger: Finger;
}

export interface StepOrder {
  order: number;
  notes: ScriptNote[];
}

export type PlaybackScript = StepOrder[];

export type EngineMode = 'default' | 'one-hand' | 'two-hand';
