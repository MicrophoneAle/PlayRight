import {
  DEFAULT_TWO_HAND_KEY_BINDINGS,
  TWO_HAND_FINGER_SLOTS,
  formatBoundKeyLabel,
  parseFingerSlotId,
  type TwoHandKeyBindings,
} from './twoHandMapping.ts';
import type { EngineMode, Hand } from '../types/index.ts';

export interface KeyboardShortcut {
  keys: string;
  description: string;
}

const GLOBAL_SHORTCUTS: KeyboardShortcut[] = [
  { keys: 'Enter', description: 'Start practice' },
  { keys: 'Space', description: 'Pause / Resume' },
  { keys: 'X', description: 'Stop and return to start' },
  { keys: 'Z', description: 'Toggle header' },
  { keys: 'C', description: 'Open saved scores' },
];

function fingerShortcutsForHand(
  hand: Hand,
  bindings: TwoHandKeyBindings,
): KeyboardShortcut {
  const slots = TWO_HAND_FINGER_SLOTS.filter(
    (slot) => parseFingerSlotId(slot).hand === hand,
  ).sort((left, right) => {
    const leftFinger = parseFingerSlotId(left).finger;
    const rightFinger = parseFingerSlotId(right).finger;
    return hand === 'L' ? rightFinger - leftFinger : leftFinger - rightFinger;
  });

  const handLabel = hand === 'L' ? 'Left hand' : 'Right hand';

  return {
    keys: slots
      .map((slot) => formatBoundKeyLabel(bindings[slot]))
      .join(' '),
    description: `${handLabel} fingers ${slots
      .map((slot) => parseFingerSlotId(slot).finger)
      .join(' ')}`,
  };
}

function getTwoHandFingerShortcuts(
  bindings: TwoHandKeyBindings,
): KeyboardShortcut[] {
  return [
    fingerShortcutsForHand('L', bindings),
    fingerShortcutsForHand('R', bindings),
  ];
}

export function getKeyboardShortcuts(
  shiftModeLabel: string,
  engineMode: EngineMode,
  bindings: TwoHandKeyBindings = DEFAULT_TWO_HAND_KEY_BINDINGS,
): KeyboardShortcut[] {
  if (engineMode === 'two-hand') {
    return [...GLOBAL_SHORTCUTS, ...getTwoHandFingerShortcuts(bindings)];
  }

  return [
    ...GLOBAL_SHORTCUTS,
    { keys: 'A – ;', description: 'White keys in scope' },
    { keys: 'Q – [', description: 'Black keys in scope' },
    { keys: '⇧ / ⇪ / ↹ / \' / ]', description: 'Extension keys' },
    { keys: '← or 1', description: 'Move scope down' },
    { keys: '→ or 2', description: 'Move scope up' },
    {
      keys: '↑ or 3',
      description: `Cycle shift distance (${shiftModeLabel})`,
    },
  ];
}
