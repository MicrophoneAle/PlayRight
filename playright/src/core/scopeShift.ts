import {
  FULL_SCOPE_SIZE,
  PIANO_END_MIDI,
  PIANO_START_MIDI,
  SCOPE_SIZE,
} from './InputManager.ts';
import type { ShiftMode } from '../store/useEngineStore.ts';

function getMaxScopeStart(): number {
  return PIANO_END_MIDI - (SCOPE_SIZE - 1);
}

function getShiftAmount(mode: ShiftMode): number {
  switch (mode) {
    case 'octave':
      return 12;
    case 'semitone':
      return 1;
    case 'full-range':
      return FULL_SCOPE_SIZE;
  }
}

export function shiftScopeStart(
  scopeStartMidi: number,
  direction: 'up' | 'down',
  shiftMode: ShiftMode,
): number {
  const shiftAmount = getShiftAmount(shiftMode);
  const maxScopeStart = getMaxScopeStart();

  if (direction === 'up') {
    return Math.min(scopeStartMidi + shiftAmount, maxScopeStart);
  }

  return Math.max(scopeStartMidi - shiftAmount, PIANO_START_MIDI);
}
