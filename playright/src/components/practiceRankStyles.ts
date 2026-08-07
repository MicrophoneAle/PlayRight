import type { PracticeRank } from '../core/practiceScoring.ts';

/**
 * Tier colors run warm-to-cool-to-alarm so the rank reads before the letter
 * does. Shared by the live status line and the run-summary modal so the same
 * rank never appears in two different colors. Thresholds themselves live in
 * PRACTICE_RANK_TIERS.
 */
export const RANK_COLORS: Record<PracticeRank, string> = {
  SS: 'text-amber-300',
  S: 'text-violet-300',
  A: 'text-emerald-300',
  B: 'text-sky-300',
  C: 'text-zinc-100',
  D: 'text-zinc-400',
  F: 'text-rose-400',
};

export const RANK_RULES: Record<PracticeRank, string> = {
  SS: 'bg-amber-300/50',
  S: 'bg-violet-300/50',
  A: 'bg-emerald-300/50',
  B: 'bg-sky-300/50',
  C: 'bg-zinc-100/40',
  D: 'bg-zinc-400/40',
  F: 'bg-rose-400/50',
};
