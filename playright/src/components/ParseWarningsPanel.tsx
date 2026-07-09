import { AlertTriangle, X } from 'lucide-react';
import { useEngineStore } from '../store/useEngineStore.ts';

/**
 * Non-blocking, dismissible surface for the current piece's parse warnings.
 * Replaces the old alert() popups: warnings stack in one scrollable list and
 * clear automatically when a new piece loads.
 */
export function ParseWarningsPanel() {
  const warnings = useEngineStore((state) => state.parseWarnings);
  const setParseWarnings = useEngineStore((state) => state.actions.setParseWarnings);

  if (warnings.length === 0) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[70] w-full max-w-sm rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
    >
      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
          <AlertTriangle size={15} strokeWidth={2} aria-hidden />
        </span>
        <span className="min-w-0 flex-1 text-sm font-semibold text-zinc-100">
          {warnings.length === 1
            ? 'Score loaded with 1 notice'
            : `Score loaded with ${warnings.length} notices`}
        </span>
        <button
          type="button"
          onClick={() => setParseWarnings([])}
          aria-label="Dismiss warnings"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
        >
          <X size={15} strokeWidth={2} aria-hidden />
        </button>
      </div>
      <ul className="playright-popup-scroll playright-scrollbar max-h-64 space-y-2 px-4 py-3">
        {warnings.map((warning, index) => (
          <li
            key={`${index}-${warning.slice(0, 40)}`}
            className="rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm leading-relaxed text-zinc-300"
          >
            {warning}
          </li>
        ))}
      </ul>
    </div>
  );
}
