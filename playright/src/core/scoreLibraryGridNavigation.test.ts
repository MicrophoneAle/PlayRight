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
});
