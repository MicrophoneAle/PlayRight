export interface KeyboardShortcut {
  keys: string;
  description: string;
}

export function getKeyboardShortcuts(
  shiftModeLabel: string,
): KeyboardShortcut[] {
  return [
    { keys: 'Enter', description: 'Start practice' },
    { keys: 'Space', description: 'Pause / resume' },
    { keys: 'X', description: 'Stop and return to start' },
    { keys: 'Z', description: 'Toggle header' },
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
