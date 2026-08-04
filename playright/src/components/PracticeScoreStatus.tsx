import { practiceAccuracyPercent } from '../core/practiceScoring.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

/**
 * Live accuracy readout, appended to the step line during practice.
 *
 * Its own component purely for subscription isolation: it selects the two
 * running counters and nothing else, so a press updates this text without
 * re-rendering the Dashboard (and therefore without touching the lazily
 * mounted sheet subtree). Both counters are plain numbers written
 * synchronously by recordPracticeAttempt, so this reaches the DOM on the same
 * discrete-event flush as the step counter's own currentStepIndex write.
 *
 * Deliberately free of transitions, animation, and anything that reads layout:
 * these values change on every keypress, which is more often than the step
 * counter, and per-frame paint cost is this app's known performance ceiling.
 */
export function PracticeScoreStatus() {
  const correctNotes = useEngineStore((state) => state.practiceCorrectNotes);
  const wrongNotes = useEngineStore((state) => state.practiceWrongNotes);

  const accuracy = practiceAccuracyPercent(correctNotes, wrongNotes);
  if (accuracy === null) {
    return null;
  }

  return (
    <>
      {' · '}
      <span data-testid="practice-accuracy" className="tabular-nums text-zinc-200">
        {accuracy}% accurate
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
