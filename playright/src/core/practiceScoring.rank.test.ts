import { describe, expect, it } from 'vitest';
import {
  PRACTICE_RANK_TIERS,
  practiceAccuracyPercent,
  practiceRank,
  practiceRankForAccuracy,
} from './practiceScoring.ts';

describe('practice rank tiers', () => {
  // Each pair sums to 100 so the accuracy percentage is exact, letting the
  // boundary itself be asserted rather than a value near it.
  const boundaries: Array<[correct: number, wrong: number, percent: number, rank: string]> = [
    [100, 0, 100, 'SS'],
    [99, 1, 99, 'S'],
    [95, 5, 95, 'S'],
    [94, 6, 94, 'A'],
    [90, 10, 90, 'A'],
    [89, 11, 89, 'B'],
    [80, 20, 80, 'B'],
    [79, 21, 79, 'C'],
    [70, 30, 70, 'C'],
    [69, 31, 69, 'D'],
    [60, 40, 60, 'D'],
    [59, 41, 59, 'F'],
    [1, 99, 1, 'F'],
    [0, 100, 0, 'F'],
  ];

  it.each(boundaries)(
    '%i correct / %i wrong = %i%% ranks %s',
    (correct, wrong, percent, rank) => {
      expect(practiceAccuracyPercent(correct, wrong)).toBe(percent);
      expect(practiceRank(correct, wrong)).toBe(rank);
    },
  );

  it('awards SS only for a flawless run', () => {
    // 99.9% floors to 99, so a single wrong note can never reach SS however
    // long the piece is.
    expect(practiceAccuracyPercent(999, 1)).toBe(99);
    expect(practiceRank(999, 1)).toBe('S');
    expect(practiceRank(1000, 0)).toBe('SS');
  });

  it('floors rather than rounds, so the shown number and the rank always agree', () => {
    // 94.9% must not display as 95% next to rank A.
    expect(practiceAccuracyPercent(949, 51)).toBe(94);
    expect(practiceRank(949, 51)).toBe('A');
  });

  it('returns null when nothing has been attempted', () => {
    expect(practiceAccuracyPercent(0, 0)).toBeNull();
    expect(practiceRank(0, 0)).toBeNull();
  });

  it('covers every percentage with a descending, gapless tier table', () => {
    const mins = PRACTICE_RANK_TIERS.map((tier) => tier.minAccuracy);
    expect(mins).toEqual([...mins].sort((a, b) => b - a));
    expect(mins.at(-1)).toBe(0);

    for (let percent = 0; percent <= 100; percent += 1) {
      expect(practiceRankForAccuracy(percent)).toBeTruthy();
    }
  });
});
