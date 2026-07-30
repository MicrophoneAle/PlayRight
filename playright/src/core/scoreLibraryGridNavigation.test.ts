import { describe, expect, it } from 'vitest';
import {
  getScoreLibraryGridColumns,
  moveScoreLibraryGridFocus,
} from './scoreLibraryGridNavigation.ts';

describe('scoreLibraryGridNavigation', () => {
  it('uses one column on narrow containers', () => {
    expect(getScoreLibraryGridColumns(400)).toBe(1);
    expect(getScoreLibraryGridColumns(519)).toBe(1);
    expect(getScoreLibraryGridColumns(520)).toBe(2);
  });

  it('moves down and up within the same column', () => {
    expect(moveScoreLibraryGridFocus(0, 'down', 7, 2)).toBe(2);
    expect(moveScoreLibraryGridFocus(2, 'up', 7, 2)).toBe(0);
    expect(moveScoreLibraryGridFocus(5, 'down', 7, 2)).toBe(5);
  });

  it('moves left and right within the same row', () => {
    expect(moveScoreLibraryGridFocus(0, 'right', 7, 2)).toBe(1);
    expect(moveScoreLibraryGridFocus(1, 'left', 7, 2)).toBe(0);
    expect(moveScoreLibraryGridFocus(1, 'right', 7, 2)).toBe(1);
  });

  it('never moves right onto the empty cell of an odd final row', () => {
    // 5 entries over 2 columns: rows [0,1], [2,3], [4]. Index 4 is alone.
    // Previously this returned 5 - out of range - which the panel's focus
    // clamp then silently swallowed, so the key press looked like a no-op.
    expect(moveScoreLibraryGridFocus(4, 'right', 5, 2)).toBe(4);
    expect(moveScoreLibraryGridFocus(4, 'left', 5, 2)).toBe(4);
  });

  it('never returns an out-of-range index for any direction or start', () => {
    for (const total of [1, 2, 3, 5, 8]) {
      for (const columns of [1, 2]) {
        for (let index = 0; index < total; index += 1) {
          for (const direction of ['up', 'down', 'left', 'right'] as const) {
            const next = moveScoreLibraryGridFocus(index, direction, total, columns);
            expect(next).toBeGreaterThanOrEqual(0);
            expect(next).toBeLessThan(total);
          }
        }
      }
    }
  });

  it('computes columns per section, so an odd public count does not shift them', () => {
    // Public = 3 (rows [0,1], [2]); personal = 2 (row [3,4]).
    // Flat indices put 3 in column 1, but it renders in the personal grid's
    // column 0 - so right/left were dead for the whole personal section.
    const sections = [
      { start: 0, length: 3 },
      { start: 3, length: 2 },
    ];

    expect(moveScoreLibraryGridFocus(3, 'right', 5, 2, sections)).toBe(4);
    expect(moveScoreLibraryGridFocus(4, 'left', 5, 2, sections)).toBe(3);
    expect(moveScoreLibraryGridFocus(3, 'left', 5, 2, sections)).toBe(3);
    expect(moveScoreLibraryGridFocus(4, 'right', 5, 2, sections)).toBe(4);
  });

  it('moves vertically across the section boundary keeping the column', () => {
    const sections = [
      { start: 0, length: 4 },
      { start: 4, length: 2 },
    ];

    // Public last row [2,3] -> personal first row [4,5].
    expect(moveScoreLibraryGridFocus(2, 'down', 6, 2, sections)).toBe(4);
    expect(moveScoreLibraryGridFocus(3, 'down', 6, 2, sections)).toBe(5);
    expect(moveScoreLibraryGridFocus(4, 'up', 6, 2, sections)).toBe(2);
    expect(moveScoreLibraryGridFocus(5, 'up', 6, 2, sections)).toBe(3);
    // Nothing above the first section or below the last.
    expect(moveScoreLibraryGridFocus(0, 'up', 6, 2, sections)).toBe(0);
    expect(moveScoreLibraryGridFocus(5, 'down', 6, 2, sections)).toBe(5);
  });

  it('clamps into a shorter neighbouring section instead of an empty cell', () => {
    const sections = [
      { start: 0, length: 2 },
      { start: 2, length: 1 },
    ];

    // Personal has a single entry: descending from either public column lands on it.
    expect(moveScoreLibraryGridFocus(0, 'down', 3, 2, sections)).toBe(2);
    expect(moveScoreLibraryGridFocus(1, 'down', 3, 2, sections)).toBe(2);
  });

  it('advances continuously to the end and back, across the section boundary', () => {
    // Long enough to scroll: 9 public + 6 personal over 2 columns.
    const sections = [
      { start: 0, length: 9 },
      { start: 9, length: 6 },
    ];
    const total = 15;
    const columns = 2;

    // Repeated ArrowDown must keep advancing - never stall, never go backwards -
    // until it reaches the last reachable row.
    const visited: number[] = [0];
    let index = 0;
    for (let press = 0; press < 20; press += 1) {
      const next = moveScoreLibraryGridFocus(index, 'down', total, columns, sections);
      if (next === index) {
        break;
      }
      expect(next).toBeGreaterThan(index);
      index = next;
      visited.push(index);
    }

    // It must have crossed out of the public section into the personal one.
    expect(visited.some((i) => i < 9)).toBe(true);
    expect(visited.some((i) => i >= 9)).toBe(true);
    expect(index).toBeGreaterThanOrEqual(9);

    // And walking back up must retrace to the top without stalling.
    const back: number[] = [index];
    for (let press = 0; press < 20; press += 1) {
      const previous = moveScoreLibraryGridFocus(index, 'up', total, columns, sections);
      if (previous === index) {
        break;
      }
      expect(previous).toBeLessThan(index);
      index = previous;
      back.push(index);
    }
    expect(index).toBe(0);
    expect(back.some((i) => i >= 9)).toBe(true);
    expect(back.some((i) => i < 9)).toBe(true);
  });

  it('single-column layout still steps linearly and never sideways', () => {
    expect(moveScoreLibraryGridFocus(0, 'down', 3, 1)).toBe(1);
    expect(moveScoreLibraryGridFocus(1, 'up', 3, 1)).toBe(0);
    expect(moveScoreLibraryGridFocus(1, 'right', 3, 1)).toBe(1);
    expect(moveScoreLibraryGridFocus(1, 'left', 3, 1)).toBe(1);
  });
});
