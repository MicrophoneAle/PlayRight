import type { Finger, Hand } from '../types/index.ts';

export interface FingerMapping {
  hand: Hand;
  finger: Finger;
}

export const TWO_HAND_KEY_MAP: Readonly<Record<string, FingerMapping>> = {
  q: { hand: 'L', finger: 5 },
  w: { hand: 'L', finger: 4 },
  e: { hand: 'L', finger: 3 },
  r: { hand: 'L', finger: 2 },
  v: { hand: 'L', finger: 1 },
  n: { hand: 'R', finger: 1 },
  i: { hand: 'R', finger: 2 },
  o: { hand: 'R', finger: 3 },
  p: { hand: 'R', finger: 4 },
  '[': { hand: 'R', finger: 5 },
};

export function getFingerMapping(key: string): FingerMapping | null {
  return TWO_HAND_KEY_MAP[key.toLowerCase()] ?? null;
}
