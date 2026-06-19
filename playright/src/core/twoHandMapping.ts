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

/** Physical key codes for layouts where event.key is unreliable (e.g. BracketLeft). */
export const TWO_HAND_CODE_MAP: Readonly<Record<string, FingerMapping>> = {
  KeyQ: { hand: 'L', finger: 5 },
  KeyW: { hand: 'L', finger: 4 },
  KeyE: { hand: 'L', finger: 3 },
  KeyR: { hand: 'L', finger: 2 },
  KeyV: { hand: 'L', finger: 1 },
  KeyN: { hand: 'R', finger: 1 },
  KeyI: { hand: 'R', finger: 2 },
  KeyO: { hand: 'R', finger: 3 },
  KeyP: { hand: 'R', finger: 4 },
  BracketLeft: { hand: 'R', finger: 5 },
};

export function getFingerMapping(key: string): FingerMapping | null {
  return TWO_HAND_KEY_MAP[key.toLowerCase()] ?? null;
}

export function getFingerMappingFromKeyboard(event: KeyboardEvent): FingerMapping | null {
  return (
    getFingerMapping(event.key) ?? TWO_HAND_CODE_MAP[event.code] ?? null
  );
}
