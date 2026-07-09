export function getScoreLibraryGridColumns(containerWidth: number): number {
  return containerWidth >= 520 ? 2 : 1;
}

export function moveScoreLibraryGridFocus(
  current: number,
  direction: 'up' | 'down' | 'left' | 'right',
  total: number,
  columns: number,
): number {
  if (total === 0) {
    return 0;
  }

  const row = Math.floor(current / columns);
  const col = current % columns;

  switch (direction) {
    case 'down': {
      const nextIndex = (row + 1) * columns + col;
      return nextIndex < total ? nextIndex : current;
    }
    case 'up': {
      if (row === 0) {
        return current;
      }

      return (row - 1) * columns + col;
    }
    case 'right': {
      if (col >= columns - 1) {
        return current;
      }

      const nextIndex = current + 1;
      return Math.floor(nextIndex / columns) === row ? nextIndex : current;
    }
    case 'left': {
      if (col === 0) {
        return current;
      }

      return current - 1;
    }
  }
}
