import {
  practiceAccuracyPercent,
  practiceRankForAccuracy,
} from '../core/practiceScoring.ts';
import { RANK_COLORS } from './practiceRankStyles.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

/**
 * Live accuracy and rank readout, appended to the step line during practice.
 *
 * Its own component purely for subscription isolation: it selects the two
 * running counters plus two session-lifetime flags and nothing else, so a
 * press updates this text without re-rendering the Dashboard (and therefore
 * without touching the lazily mounted sheet subtree). Only the two counters
 * change on a press; scoringEnabled and practiceNavigated change at most once
 * per session. Both counters are plain numbers written synchronously by
 * recordPracticeAttempt, so this reaches the DOM on the same discrete-event
 * flush as the step counter's own currentStepIndex write.
 *
 * The rank is arithmetic on the two counters via the same floored accuracy the
 * modal reads, so the live rank and the final rank can never disagree for the
 * same counts. It is shown from the very first note with no minimum note count
 * and no smoothing: early swings (3/4 reading 75% and ranking C) are the true
 * numbers, and damping them would put the live rank out of step with the
 * modal's.
 *
 * Deliberately free of transitions, animation, and anything that reads layout:
 * these values change on every keypress, which is more often than the step
 * counter, and per-frame paint cost is this app's known performance ceiling.
 */
export function PracticeScoreStatus() {
  const scoringEnabled = useEngineStore((state) => state.scoringEnabled);
  const navigated = useEngineStore((state) => state.practiceNavigated);
  const correctNotes = useEngineStore((state) => state.practiceCorrectNotes);
  const wrongNotes = useEngineStore((state) => state.practiceWrongNotes);

  const accuracy = practiceAccuracyPercent(correctNotes, wrongNotes);
  // Before the first note there is no 0/0 accuracy to rank, so the whole
  // readout stays hidden rather than showing a placeholder rank - an F on an
  // untouched run would be actively misleading.
  if (!scoringEnabled || accuracy === null) {
    return null;
  }

  const rank = navigated ? null : practiceRankForAccuracy(accuracy);

  return (
    <>
      {' · '}
      <span data-testid="practice-accuracy" className="tabular-nums text-zinc-200">
        {accuracy}% accurate
      </span>
      {' · '}
      <span
        data-testid="practice-rank"
        aria-label={rank ? `Rank ${rank}` : 'Unranked'}
        className={rank ? `font-semibold ${RANK_COLORS[rank]}` : 'text-zinc-500'}
      >
        {rank ?? 'Unranked'}
      </span>
      {wrongNotes > 0 ? (
        <span data-testid="practice-wrong-count" className="tabular-nums text-rose-300">
          {' · '}
          {wrongNotes} wrong
        </span>
      ) : null}
    </>
  );
}
