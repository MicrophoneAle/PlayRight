import { TWO_HAND_KEY_MAP } from './twoHandMapping.ts';
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

function formatDisplayKey(key: string): string {
  return key;
}

function fingerShortcutsForHand(hand: Hand): KeyboardShortcut {
  const entries = Object.entries(TWO_HAND_KEY_MAP)
    .filter(([, mapping]) => mapping.hand === hand)
    .sort(([, left], [, right]) =>
      hand === 'L' ? right.finger - left.finger : left.finger - right.finger,
    );

  const handLabel = hand === 'L' ? 'Left hand' : 'Right hand';

  return {
    keys: entries.map(([key]) => formatDisplayKey(key)).join(' '),
    description: `${handLabel} fingers ${entries.map(([, mapping]) => mapping.finger).join(' ')}`,
  };
}

function getTwoHandFingerShortcuts(): KeyboardShortcut[] {
  return [fingerShortcutsForHand('L'), fingerShortcutsForHand('R')];
}

export function getKeyboardShortcuts(
  shiftModeLabel: string,
  engineMode: EngineMode,
): KeyboardShortcut[] {
  if (engineMode === 'two-hand') {
    return [...GLOBAL_SHORTCUTS, ...getTwoHandFingerShortcuts()];
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
