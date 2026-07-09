import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Download, Trash2, X } from 'lucide-react';
import { downloadMusicXml } from '../core/readScoreFile.ts';
import {
  deleteScoreFromLibrary,
  fetchScoreById,
  fetchScoreLibrary,
  type LibraryEntry,
} from '../core/scoreLibrary.ts';
import { isSupabaseConfigured } from '../core/supabaseClient.ts';

interface ScoreLibraryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  canDelete: boolean;
  userId: string | null;
}

type LibrarySortKey = 'date' | 'name' | 'length';
type SortDirection = 'asc' | 'desc';
type LibrarySortOption = `${LibrarySortKey}-${SortDirection}`;

const LIBRARY_SORT_OPTIONS: Array<{ value: LibrarySortOption; label: string }> = [
  { value: 'date-desc', label: 'Date (newest)' },
  { value: 'date-asc', label: 'Date (oldest)' },
  { value: 'name-asc', label: 'Name' },
  { value: 'length-asc', label: 'Duration (shortest)' },
  { value: 'length-desc', label: 'Duration (longest)' },
];

function libraryLengthSortValue(entry: LibraryEntry): number {
  if (entry.durationSeconds !== null) {
    return entry.durationSeconds;
  }

  if (entry.measureCount !== null) {
    return entry.measureCount;
  }

  return -1;
}

function parseLibrarySortOption(option: LibrarySortOption): {
  sortKey: LibrarySortKey;
  sortDirection: SortDirection;
} {
  const [sortKey, sortDirection] = option.split('-') as [LibrarySortKey, SortDirection];
  return { sortKey, sortDirection };
}

function sortLibraryEntries(
  entries: LibraryEntry[],
  sortKey: LibrarySortKey,
  direction: SortDirection,
): LibraryEntry[] {
  const factor = direction === 'asc' ? 1 : -1;

  return [...entries].sort((left, right) => {
    let comparison = 0;

    if (sortKey === 'date') {
      const leftTime = new Date(left.created_at).getTime();
      const rightTime = new Date(right.created_at).getTime();
      comparison = Number.isFinite(leftTime) && Number.isFinite(rightTime)
        ? leftTime - rightTime
        : left.created_at.localeCompare(right.created_at);
    } else if (sortKey === 'name') {
      comparison = left.title.localeCompare(right.title, undefined, {
        sensitivity: 'base',
      });
    } else {
      comparison = libraryLengthSortValue(left) - libraryLengthSortValue(right);
      if (comparison === 0) {
        comparison = left.title.localeCompare(right.title, undefined, {
          sensitivity: 'base',
        });
      }
    }

    if (comparison !== 0) {
      return comparison * factor;
    }

    return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
  });
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
  userId,
}: ScoreLibraryPanelProps) {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LibraryEntry | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [sortOption, setSortOption] = useState<LibrarySortOption>('date-desc');
  const [focusedIndex, setFocusedIndex] = useState(0);
  const entryRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const { sortKey, sortDirection } = parseLibrarySortOption(sortOption);
  const sortedEntries = useMemo(
    () => sortLibraryEntries(entries, sortKey, sortDirection),
    [entries, sortKey, sortDirection],
  );

  useEffect(() => {
    if (!isOpen) {
      setFocusedIndex(0);
      return;
    }

    setFocusedIndex((current) => {
      if (sortedEntries.length === 0) {
        return 0;
      }

      return Math.min(current, sortedEntries.length - 1);
    });
  }, [isOpen, sortedEntries.length, sortOption]);

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

    if (!userId) {
      setEntries([]);
      setLoading(false);
      return;
    }

    const data = await fetchScoreLibrary(userId);
    if (data === null) {
      setFetchFailed(true);
      setEntries([]);
    } else {
      setEntries(data);
    }

    setLoading(false);
  }, [userId]);

  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id);
      onClose();
    },
    [onClose, onSelect],
  );

  useEffect(() => {
    if (!isOpen) {
      setDeleteTarget(null);
      setDeleteError(null);
      setDownloadError(null);
      return;
    }

    void loadEntries();
  }, [isOpen, loadEntries, userId]);

  useEffect(() => {
    if (!deleteTarget) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && deletingId === null) {
        setDeleteTarget(null);
        setDeleteError(null);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [deleteTarget, deletingId]);

  useEffect(() => {
    if (!isOpen || deleteTarget) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLSelectElement) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (sortedEntries.length === 0) {
        return;
      }

      if (
        event.key === 'ArrowDown' ||
        event.key === 'ArrowRight'
      ) {
        event.preventDefault();
        setFocusedIndex((current) =>
          Math.min(sortedEntries.length - 1, current + 1),
        );
        return;
      }

      if (
        event.key === 'ArrowUp' ||
        event.key === 'ArrowLeft'
      ) {
        event.preventDefault();
        setFocusedIndex((current) => Math.max(0, current - 1));
        return;
      }

      if (event.key === 'Enter') {
        const entry = sortedEntries[focusedIndex];
        if (!entry) {
          return;
        }

        event.preventDefault();
        handleSelect(entry.id);
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [handleSelect, isOpen, deleteTarget, focusedIndex, onClose, sortedEntries]);

  useEffect(() => {
    const entry = sortedEntries[focusedIndex];
    if (!entry) {
      return;
    }

    entryRowRefs.current.get(entry.id)?.scrollIntoView({ block: 'nearest' });
  }, [focusedIndex, sortedEntries]);

  const handleDownloadClick = async (entry: LibraryEntry) => {
    if (!userId || downloadingId !== null) {
      return;
    }

    setDownloadingId(entry.id);
    setDownloadError(null);

    const score = await fetchScoreById(entry.id, userId);
    setDownloadingId(null);

    if (!score?.raw_xml) {
      setDownloadError(`Could not download "${entry.title}".`);
      return;
    }

    downloadMusicXml(score.title, score.raw_xml);
  };

  const handleDeleteClick = (entry: LibraryEntry) => {
    if (!canDelete) {
      return;
    }

    setDeleteError(null);
    setDeleteTarget(entry);
  };

  const handleCancelDelete = () => {
    if (deletingId !== null) {
      return;
    }

    setDeleteTarget(null);
    setDeleteError(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || !canDelete || !userId) {
      return;
    }

    setDeletingId(deleteTarget.id);
    setDeleteError(null);
    const result = await deleteScoreFromLibrary(deleteTarget.id, userId);
    setDeletingId(null);

    if (!result.ok) {
      setDeleteError(result.reason);
      return;
    }

    setEntries((previous) =>
      previous.filter((item) => item.id !== deleteTarget.id),
    );
    setDeleteTarget(null);
  };

  const deleteDialog =
    deleteTarget &&
    createPortal(
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
        onClick={handleCancelDelete}
        role="presentation"
      >
        <div
          className="w-full max-w-sm rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="delete-score-title"
          aria-describedby="delete-score-description"
        >
          <div className="border-b border-zinc-800 px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500/15 text-red-400">
                <Trash2 size={16} strokeWidth={2} aria-hidden />
              </div>
              <div className="min-w-0">
                <h3
                  id="delete-score-title"
                  className="text-sm font-semibold text-zinc-100"
                >
                  Delete score?
                </h3>
                <p
                  id="delete-score-description"
                  className="mt-1 text-sm text-zinc-400"
                >
                  <span className="font-medium text-zinc-200">
                    {deleteTarget.title}
                  </span>{' '}
                  will be removed from your library. This cannot be undone.
                </p>
              </div>
            </div>
          </div>

          {deleteError ? (
            <div className="flex items-start gap-2 border-b border-zinc-800 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              <AlertTriangle size={15} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
              <p>{deleteError}</p>
            </div>
          ) : null}

          <div className="flex justify-end gap-2 px-4 py-3">
            <button
              type="button"
              onClick={handleCancelDelete}
              disabled={deletingId !== null}
              className="inline-flex items-center rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleConfirmDelete()}
              disabled={deletingId !== null}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deletingId !== null ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );

  if (!isOpen) {
    return deleteDialog;
  }

  return (
    <>
      {deleteDialog}
      {createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="my-auto flex max-h-[min(32rem,calc(100dvh-2rem))] w-full max-w-2xl flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="score-library-title"
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <h2 id="score-library-title" className="shrink-0 text-sm font-semibold text-zinc-100">
              Saved Scores
            </h2>
            {!loading && !notConfigured && userId && !fetchFailed && entries.length > 0 ? (
              <div className="flex min-w-0 items-center gap-2">
                <label
                  htmlFor="score-library-sort"
                  className="shrink-0 text-xs text-zinc-500"
                >
                  Sort by
                </label>
                <select
                  id="score-library-sort"
                  value={sortOption}
                  onChange={(event) =>
                    setSortOption(event.target.value as LibrarySortOption)
                  }
                  className="w-32 shrink-0 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none transition-colors focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                >
                  {LIBRARY_SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close library"
            className="shrink-0 rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>

        <div className="playright-popup-scroll playright-scrollbar min-h-0 flex-1 p-2">
          {downloadError ? (
            <div className="mb-2 flex items-start gap-2 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
              <AlertTriangle size={15} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
              <p>{downloadError}</p>
            </div>
          ) : null}
          {loading ? (
            <p className="px-2 py-6 text-center text-sm text-zinc-500">Loading scores…</p>
          ) : notConfigured ? (
            <p className="px-2 py-6 text-center text-sm text-zinc-500">
              Score library is not configured. Add VITE_SUPABASE_URL and
              VITE_SUPABASE_ANON_KEY to your deployment environment.
            </p>
          ) : !userId ? (
            <p className="px-2 py-6 text-center text-sm text-zinc-500">
              Sign in to view your saved scores.
            </p>
          ) : fetchFailed ? (
            <p className="px-2 py-6 text-center text-sm text-zinc-500">
              Could not load saved scores.
            </p>
          ) : entries.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-zinc-500">No saved scores yet</p>
          ) : (
            <ul className="grid grid-cols-1 gap-1 min-[520px]:grid-cols-2">
              {sortedEntries.map((entry, index) => (
                <li key={entry.id}>
                  <div
                    ref={(element) => {
                      if (element) {
                        entryRowRefs.current.set(entry.id, element);
                      } else {
                        entryRowRefs.current.delete(entry.id);
                      }
                    }}
                    className={`flex items-stretch gap-1 rounded-md transition-colors ${
                      index === focusedIndex
                        ? 'bg-zinc-800 ring-1 ring-violet-500'
                        : 'hover:bg-zinc-800'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelect(entry.id)}
                      onMouseEnter={() => setFocusedIndex(index)}
                      className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2.5 text-left"
                    >
                      <span className="truncate text-sm font-medium text-zinc-100">
                        {entry.title}
                      </span>
                      <span className="text-xs text-zinc-500">
                        {formatCreatedAt(entry.created_at)}
                      </span>
                    </button>
                    {userId ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDownloadClick(entry);
                        }}
                        disabled={downloadingId === entry.id}
                        aria-label={`Download ${entry.title}`}
                        title="Download MusicXML"
                        className="shrink-0 rounded-md px-3 text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Download size={15} strokeWidth={2} aria-hidden />
                      </button>
                    ) : null}
                    {canDelete ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDeleteClick(entry);
                        }}
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
      )}
    </>
  );
}
