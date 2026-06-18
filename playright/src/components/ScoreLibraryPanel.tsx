import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, X } from 'lucide-react';
import {
  deleteScoreFromLibrary,
  fetchScoreLibrary,
  type LibraryEntry,
} from '../core/scoreLibrary.ts';
import { isSupabaseConfigured } from '../core/supabaseClient.ts';

interface ScoreLibraryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  canDelete: boolean;
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

export function ScoreLibraryPanel({
  isOpen,
  onClose,
  onSelect,
  canDelete,
}: ScoreLibraryPanelProps) {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setFetchFailed(false);
    setNotConfigured(false);

    if (!isSupabaseConfigured()) {
      setNotConfigured(true);
      setEntries([]);
      setLoading(false);
      return;
    }

    const data = await fetchScoreLibrary();
    if (data === null) {
      setFetchFailed(true);
      setEntries([]);
    } else {
      setEntries(data);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    void loadEntries();
  }, [isOpen, loadEntries]);

  if (!isOpen) {
    return null;
  }

  const handleSelect = (id: string) => {
    onSelect(id);
    onClose();
  };

  const handleDelete = async (entry: LibraryEntry) => {
    if (!canDelete) {
      return;
    }

    const confirmed = window.confirm(
      `Delete "${entry.title}" from your library? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }

    setDeletingId(entry.id);
    const deleted = await deleteScoreFromLibrary(entry.id);
    setDeletingId(null);

    if (!deleted) {
      alert('Failed to delete this score. Check your connection and try again.');
      return;
    }

    setEntries((previous) => previous.filter((item) => item.id !== entry.id));
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="my-auto flex max-h-[min(32rem,calc(100vh-2rem))] w-full max-w-md flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
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
          ) : notConfigured ? (
            <p className="px-2 py-6 text-center text-sm text-zinc-500">
              Score library is not configured. Add VITE_SUPABASE_URL and
              VITE_SUPABASE_ANON_KEY to your deployment environment.
            </p>
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
                  <div className="flex items-stretch gap-1 rounded-md transition-colors hover:bg-zinc-800">
                    <button
                      type="button"
                      onClick={() => handleSelect(entry.id)}
                      className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2.5 text-left"
                    >
                      <span className="truncate text-sm font-medium text-zinc-100">
                        {entry.title}
                      </span>
                      <span className="text-xs text-zinc-500">
                        {formatCreatedAt(entry.created_at)}
                      </span>
                    </button>
                    {canDelete ? (
                      <button
                        type="button"
                        onClick={() => void handleDelete(entry)}
                        disabled={deletingId === entry.id}
                        aria-label={`Delete ${entry.title}`}
                        className="shrink-0 rounded-md px-3 text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Trash2 size={15} strokeWidth={2} aria-hidden />
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
