import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Keyboard, RotateCcw, X } from 'lucide-react';
import {
  DEFAULT_TWO_HAND_KEY_BINDINGS,
  TWO_HAND_FINGER_SLOTS,
  cloneTwoHandKeyBindings,
  formatBoundKeyLabel,
  formatFingerSlotLabel,
  parseFingerSlotId,
  physicalKeyFromKeyboardEvent,
  rebindFingerSlot,
  twoHandKeyBindingsEqual,
  type FingerSlotId,
  type TwoHandKeyBindings,
} from '../core/twoHandMapping.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

export function KeyBindingsEditor() {
  const isOpen = useEngineStore((state) => state.keyBindingEditorOpen);
  const storedBindings = useEngineStore((state) => state.twoHandKeyBindings);
  const setKeyBindingEditorOpen = useEngineStore(
    (state) => state.actions.setKeyBindingEditorOpen,
  );
  const setTwoHandKeyBindings = useEngineStore(
    (state) => state.actions.setTwoHandKeyBindings,
  );

  const [draft, setDraft] = useState<TwoHandKeyBindings>(() =>
    cloneTwoHandKeyBindings(storedBindings),
  );
  const [listeningSlot, setListeningSlot] = useState<FingerSlotId | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const isDirty = useMemo(
    () => !twoHandKeyBindingsEqual(draft, storedBindings),
    [draft, storedBindings],
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setDraft(cloneTwoHandKeyBindings(storedBindings));
    setListeningSlot(null);
    setStatusMessage(null);
  }, [isOpen, storedBindings]);

  const closeWithoutSaving = useCallback(() => {
    setListeningSlot(null);
    setStatusMessage(null);
    setKeyBindingEditorOpen(false);
  }, [setKeyBindingEditorOpen]);

  const saveAndClose = useCallback(() => {
    setTwoHandKeyBindings(draft);
    setListeningSlot(null);
    setStatusMessage(null);
    setKeyBindingEditorOpen(false);
  }, [draft, setKeyBindingEditorOpen, setTwoHandKeyBindings]);

  const resetDraftToDefaults = useCallback(() => {
    setDraft(cloneTwoHandKeyBindings(DEFAULT_TWO_HAND_KEY_BINDINGS));
    setListeningSlot(null);
    setStatusMessage('Draft restored to defaults — Save to apply.');
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeWithoutSaving();
        return;
      }

      if (!listeningSlot) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (event.repeat) {
        return;
      }

      const bound = physicalKeyFromKeyboardEvent(event);
      if (!bound) {
        setStatusMessage('That key cannot be bound. Try a letter or symbol key.');
        return;
      }

      const result = rebindFingerSlot(draft, listeningSlot, bound);
      if (!result.ok) {
        if (result.reason === 'same-slot') {
          setStatusMessage('Already assigned to this finger.');
        }
        setListeningSlot(null);
        return;
      }

      setDraft(result.bindings);
      setListeningSlot(null);

      if (result.swappedWith) {
        setStatusMessage(
          `Swapped with ${formatFingerSlotLabel(result.swappedWith)}.`,
        );
      } else {
        setStatusMessage(
          `Bound ${formatBoundKeyLabel(bound)} to ${formatFingerSlotLabel(listeningSlot)}.`,
        );
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [closeWithoutSaving, draft, isOpen, listeningSlot]);

  useEffect(() => {
    if (isOpen) {
      panelRef.current?.focus();
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const leftSlots = TWO_HAND_FINGER_SLOTS.filter(
    (slot) => parseFingerSlotId(slot).hand === 'L',
  );
  const rightSlots = TWO_HAND_FINGER_SLOTS.filter(
    (slot) => parseFingerSlotId(slot).hand === 'R',
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center overflow-y-auto bg-black/70 p-4"
      onClick={closeWithoutSaving}
      role="presentation"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="my-auto flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl outline-none"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="key-bindings-title"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          <div className="min-w-0">
            <h2
              id="key-bindings-title"
              className="truncate text-sm font-semibold text-zinc-100"
            >
              Two-hand key bindings
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Click a finger, then press the key you want. Conflicts swap.
            </p>
          </div>
          <button
            type="button"
            onClick={closeWithoutSaving}
            aria-label="Close key bindings"
            className="shrink-0 rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>

        <div className="playright-popup-scroll playright-scrollbar flex min-h-0 flex-1 flex-col gap-4 px-4 py-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <BindingColumn
              title="Left hand"
              slots={leftSlots}
              draft={draft}
              listeningSlot={listeningSlot}
              onSelect={setListeningSlot}
            />
            <BindingColumn
              title="Right hand"
              slots={rightSlots}
              draft={draft}
              listeningSlot={listeningSlot}
              onSelect={setListeningSlot}
            />
          </div>

          <p
            className={`min-h-[1.25rem] text-xs ${
              listeningSlot ? 'text-violet-300' : 'text-zinc-500'
            }`}
            role="status"
            aria-live="polite"
          >
            {listeningSlot
              ? `Listening for ${formatFingerSlotLabel(listeningSlot)}…`
              : statusMessage}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-zinc-800 px-4 py-3">
          <button
            type="button"
            onClick={resetDraftToDefaults}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <RotateCcw size={14} strokeWidth={2} aria-hidden />
            Reset to defaults
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={closeWithoutSaving}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveAndClose}
              disabled={!isDirty}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Keyboard size={14} strokeWidth={2} aria-hidden />
              Save
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function BindingColumn({
  title,
  slots,
  draft,
  listeningSlot,
  onSelect,
}: {
  title: string;
  slots: readonly FingerSlotId[];
  draft: TwoHandKeyBindings;
  listeningSlot: FingerSlotId | null;
  onSelect: (slot: FingerSlotId) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-violet-400">
        {title}
      </p>
      <ul className="flex flex-col gap-1.5">
        {slots.map((slot) => {
          const { finger } = parseFingerSlotId(slot);
          const listening = listeningSlot === slot;
          return (
            <li key={slot}>
              <button
                type="button"
                onClick={() => onSelect(slot)}
                aria-pressed={listening}
                className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                  listening
                    ? 'border-violet-500 bg-violet-600/15 text-violet-100'
                    : 'border-zinc-800 bg-zinc-900/80 text-zinc-200 hover:border-zinc-600 hover:bg-zinc-900'
                }`}
              >
                <span className="text-sm text-zinc-400">Finger {finger}</span>
                <span
                  className={`min-w-[2.25rem] rounded-md border px-2 py-0.5 text-center font-mono text-sm font-semibold ${
                    listening
                      ? 'border-violet-400/60 bg-violet-500/20 text-violet-100'
                      : 'border-zinc-700 bg-zinc-950 text-zinc-100'
                  }`}
                >
                  {formatBoundKeyLabel(draft[slot])}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
