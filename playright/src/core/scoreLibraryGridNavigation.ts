export function getScoreLibraryGridColumns(containerWidth: number): number {
  return containerWidth >= 520 ? 2 : 1;
}

/**
 * A contiguous run of entries rendered as its own independent grid. The panel
 * renders "Public" and "Your scores" as two separate `<ul>` grids, so column
 * position must be computed relative to each section's own start - a flat
 * index over the combined list puts entries in the wrong column whenever the
 * preceding section has an odd length.
 */
export interface ScoreLibraryGridSection {
  start: number;
  length: number;
}

function resolveSections(
  total: number,
  sections?: readonly ScoreLibraryGridSection[],
): ScoreLibraryGridSection[] {
  const resolved = (sections ?? []).filter((section) => section.length > 0);
  return resolved.length > 0 ? resolved : [{ start: 0, length: total }];
}

export function moveScoreLibraryGridFocus(
  current: number,
  direction: 'up' | 'down' | 'left' | 'right',
  total: number,
  columns: number,
  sections?: readonly ScoreLibraryGridSection[],
): number {
  if (total === 0) {
    return 0;
  }

  const resolved = resolveSections(total, sections);
  const sectionIndex = resolved.findIndex(
    (section) => current >= section.start && current < section.start + section.length,
  );
  if (sectionIndex === -1) {
    return current;
  }

  const section = resolved[sectionIndex];
  const local = current - section.start;
  const row = Math.floor(local / columns);
  const col = local % columns;

  switch (direction) {
    case 'right': {
      if (col >= columns - 1) {
        return current;
      }

      const nextLocal = local + 1;
      // Guard the odd final row: the cell to the right may not exist.
      if (nextLocal >= section.length || Math.floor(nextLocal / columns) !== row) {
        return current;
      }

      return section.start + nextLocal;
    }
    case 'left': {
      if (col === 0) {
        return current;
      }

      return section.start + local - 1;
    }
    case 'down': {
      const nextLocal = (row + 1) * columns + col;
      if (nextLocal < section.length) {
        return section.start + nextLocal;
      }

      // Past the last row: continue into the next section's first row, keeping
      // the column where one exists.
      const nextSection = resolved[sectionIndex + 1];
      if (!nextSection) {
        return current;
      }

      return nextSection.start + Math.min(col, nextSection.length - 1);
    }
    case 'up': {
      if (row > 0) {
        return section.start + (row - 1) * columns + col;
      }

      const previousSection = resolved[sectionIndex - 1];
      if (!previousSection) {
        return current;
      }

      const previousRows = Math.ceil(previousSection.length / columns);
      const target = Math.min(
        (previousRows - 1) * columns + col,
        previousSection.length - 1,
      );
      return previousSection.start + target;
    }
  }
}
