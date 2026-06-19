import {
  PIANO_END_MIDI,
  PIANO_START_MIDI,
  SCOPE_SIZE,
} from './InputManager.ts';
import type { ShiftMode } from '../store/useEngineStore.ts';

const MAX_SCOPE_START = PIANO_END_MIDI - (SCOPE_SIZE - 1);

function getShiftAmount(mode: ShiftMode): number {
  switch (mode) {
    case 'octave':
      return 12;
    case 'semitone':
      return 1;
    case 'full-range':
      return SCOPE_SIZE;
  }
}

export function shiftScopeStart(
  scopeStartMidi: number,
  direction: 'up' | 'down',
  shiftMode: ShiftMode,
): number {
  const shiftAmount = getShiftAmount(shiftMode);
  if (direction === 'up') {
    return Math.min(scopeStartMidi + shiftAmount, MAX_SCOPE_START);
  }

  return Math.max(scopeStartMidi - shiftAmount, PIANO_START_MIDI);
}
