export interface KeyboardShortcut {
  keys: string;
  description: string;
}

export function getKeyboardShortcuts(
  shiftModeLabel: string,
): KeyboardShortcut[] {
  return [
    { keys: 'A – ;', description: 'White keys in scope' },
    { keys: 'Q – P, [', description: 'Black keys in scope' },
    { keys: '← or 1', description: 'Move scope down' },
    { keys: '→ or 2', description: 'Move scope up' },
    {
      keys: '↑ or 3',
      description: `Cycle shift distance (${shiftModeLabel})`,
    },
  ];
}
