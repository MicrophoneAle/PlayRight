import type { ShiftMode } from '../store/useEngineStore.ts';

export const SHIFT_MODE_ORDER: readonly ShiftMode[] = [
  'semitone',
  'octave',
  'full-range',
];

export const SHIFT_MODE_LABELS: Record<ShiftMode, string> = {
  semitone: 'Single Note',
  octave: 'Octave',
  'full-range': 'Full Range',
};

export function cycleShiftMode(
  current: ShiftMode,
  direction: 'up' | 'down',
): ShiftMode {
  const index = SHIFT_MODE_ORDER.indexOf(current);
  if (index === -1) {
    return SHIFT_MODE_ORDER[0];
  }

  const offset = direction === 'up' ? 1 : -1;
  const nextIndex =
    (index + offset + SHIFT_MODE_ORDER.length) % SHIFT_MODE_ORDER.length;
  return SHIFT_MODE_ORDER[nextIndex];
}
