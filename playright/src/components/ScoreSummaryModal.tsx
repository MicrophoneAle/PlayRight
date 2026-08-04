import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  practiceAccuracyPercent,
  practiceRank,
  type PracticeRank,
  type PracticeScoringSummary,
} from '../core/practiceScoring.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

/**
 * Mounts only while open, so the panel can assume an open, finalized summary
 * and needs no reset-on-open effect (same shape as KeyBindingsEditor).
 */
export function ScoreSummaryModal() {
  const isOpen = useEngineStore((state) => state.scoreSummaryOpen);
  const summary = useEngineStore((state) => state.practiceSummary);
  return isOpen && summary ? <ScoreSummaryPanel summary={summary} /> : null;
}

/**
 * Tier colors run warm-to-cool-to-alarm so the rank reads before the letter
 * does. Ranks are looked up here only; the thresholds themselves live in
 * PRACTICE_RANK_TIERS.
 */
const RANK_COLORS: Record<PracticeRank, string> = {
  SS: 'text-amber-300',
  S: 'text-violet-300',
  A: 'text-emerald-300',
  B: 'text-sky-300',
  C: 'text-zinc-100',
  D: 'text-zinc-400',
  F: 'text-rose-400',
};

const RANK_RULES: Record<PracticeRank, string> = {
  SS: 'bg-amber-300/50',
  S: 'bg-violet-300/50',
  A: 'bg-emerald-300/50',
  B: 'bg-sky-300/50',
  C: 'bg-zinc-100/40',
  D: 'bg-zinc-400/40',
  F: 'bg-rose-400/50',
};

function ScoreSummaryPanel({ summary }: { summary: PracticeScoringSummary }) {
  const setScoreSummaryOpen = useEngineStore(
    (state) => state.actions.setScoreSummaryOpen,
  );
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setScoreSummaryOpen(false);
  }, [setScoreSummaryOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [close]);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // Computed from raw counts at display time - never read off a stored value.
  const accuracy = practiceAccuracyPercent(summary.correctNotes, summary.wrongNotes);
  const rank = summary.navigated
    ? null
    : practiceRank(summary.correctNotes, summary.wrongNotes);

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center overflow-y-auto bg-black/70 p-4"
      onClick={close}
      role="presentation"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="my-auto flex w-full max-w-sm flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl outline-none"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="score-summary-title"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          <h2
            id="score-summary-title"
            className="truncate text-sm font-semibold text-zinc-100"
          >
            Piece complete
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close run summary"
            className="shrink-0 rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>

        <div className="flex flex-col items-center px-4 pb-1 pt-6">
          {rank ? (
            <p
              data-testid="score-summary-rank"
              className={`text-7xl font-semibold leading-none tracking-tighter ${RANK_COLORS[rank]}`}
            >
              {rank}
            </p>
          ) : (
            <p
              data-testid="score-summary-rank"
              className="text-3xl font-semibold leading-none tracking-tight text-zinc-400"
            >
              Unranked
            </p>
          )}

          <span
            className={`mt-4 h-px w-16 ${rank ? RANK_RULES[rank] : 'bg-zinc-700'}`}
            aria-hidden
          />

          <p className="mt-4 text-sm tabular-nums text-zinc-300">
            <span data-testid="score-summary-accuracy" className="font-semibold text-zinc-100">
              {accuracy ?? 0}%
            </span>{' '}
            accurate
          </p>

          {summary.navigated ? (
            <p className="mt-2 max-w-[16rem] text-center text-xs leading-snug text-zinc-500">
              Ranking is off for runs where you seeked. Play the piece straight
              through to earn a rank.
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-3 gap-px border-t border-zinc-800 bg-zinc-800 px-px pt-px">
          <Stat label="Correct" value={summary.correctNotes} testId="score-summary-correct" />
          <Stat label="Wrong" value={summary.wrongNotes} testId="score-summary-wrong" />
          <Stat
            label="Best streak"
            value={summary.longestStreak}
            testId="score-summary-streak"
          />
        </div>

        <div className="flex shrink-0 justify-end border-t border-zinc-800 px-4 py-3">
          <button
            type="button"
            onClick={close}
            className="rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Stat({
  label,
  value,
  testId,
}: {
  label: string;
  value: number;
  testId: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 bg-zinc-950 px-2 py-3">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">
        {label}
      </span>
      <span data-testid={testId} className="text-lg font-semibold tabular-nums text-zinc-100">
        {value}
      </span>
    </div>
  );
}
