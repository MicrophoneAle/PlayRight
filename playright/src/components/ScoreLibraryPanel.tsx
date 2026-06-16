import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { fetchScoreLibrary, type LibraryEntry } from '../core/scoreLibrary.ts';

interface ScoreLibraryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
}

function formatCreatedAt(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return createdAt;
  }

  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function ScoreLibraryPanel({ isOpen, onClose, onSelect }: ScoreLibraryPanelProps) {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFetchFailed(false);
    setEntries([]);

    fetchScoreLibrary().then((data) => {
      if (cancelled) {
        return;
      }

      if (data === null) {
        setFetchFailed(true);
        setEntries([]);
      } else {
        setEntries(data);
      }

      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const handleSelect = (id: string) => {
    onSelect(id);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[min(32rem,80vh)] w-full max-w-md flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="score-library-title"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 id="score-library-title" className="text-sm font-semibold text-zinc-100">
            Saved Scores
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close library"
            className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? (
            <p className="px-2 py-6 text-center text-sm text-zinc-500">Loading scores…</p>
          ) : fetchFailed ? (
            <p className="px-2 py-6 text-center text-sm text-zinc-500">
              Could not load saved scores.
            </p>
          ) : entries.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-zinc-500">No saved scores yet</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(entry.id)}
                    className="flex w-full flex-col gap-0.5 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-zinc-800"
                  >
                    <span className="truncate text-sm font-medium text-zinc-100">
                      {entry.title}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {formatCreatedAt(entry.created_at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
