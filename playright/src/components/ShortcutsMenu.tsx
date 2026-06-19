import { useEffect, useRef } from 'react';
import { Keyboard } from 'lucide-react';
import { getKeyboardShortcuts } from '../core/keyboardShortcuts.ts';
import { SHIFT_MODE_LABELS } from '../core/shiftMode.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

interface ShortcutsMenuProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

export function ShortcutsMenu({
  isOpen,
  onToggle,
  onClose,
}: ShortcutsMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const shiftMode = useEngineStore((state) => state.shiftMode);
  const engineMode = useEngineStore((state) => state.engineMode);
  const shortcuts = getKeyboardShortcuts(
    SHIFT_MODE_LABELS[shiftMode],
    engineMode,
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleOutsideClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    window.addEventListener('click', handleOutsideClick);

    return () => {
      window.removeEventListener('click', handleOutsideClick);
    };
  }, [isOpen, onClose]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label="Keyboard shortcuts"
        className={`inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
          isOpen
            ? 'border-zinc-600 bg-zinc-800 text-zinc-100'
            : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100'
        }`}
      >
        <Keyboard size={15} strokeWidth={2} aria-hidden />
      </button>

      {isOpen ? (
        <div
          className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">
            Shortcuts
          </p>
          <ul className="flex flex-col gap-2.5">
            {shortcuts.map((shortcut) => (
              <li
                key={`${shortcut.keys}-${shortcut.description}`}
                className="flex items-start justify-between gap-4 text-xs"
              >
                <span className="shrink-0 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-zinc-200">
                  {shortcut.keys}
                </span>
                <span className="text-right text-zinc-400">
                  {shortcut.description}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
