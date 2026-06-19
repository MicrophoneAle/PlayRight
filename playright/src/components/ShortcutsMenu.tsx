import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  const panelRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    right: number;
  } | null>(null);
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
      const target = event.target as Node;
      if (
        menuRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }

      onClose();
    };

    window.addEventListener('click', handleOutsideClick);

    return () => {
      window.removeEventListener('click', handleOutsideClick);
    };
  }, [isOpen, onClose]);

  useLayoutEffect(() => {
    if (!isOpen || !menuRef.current) {
      setMenuPosition(null);
      return;
    }

    const updatePosition = () => {
      if (!menuRef.current) {
        return;
      }

      const rect = menuRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen]);

  const panel =
    isOpen && menuPosition ? (
      <div
        ref={panelRef}
        className="fixed z-[200] w-72 rounded-lg border border-zinc-700 p-3 shadow-2xl"
        style={{
          top: menuPosition.top,
          right: menuPosition.right,
          backgroundColor: '#09090b',
        }}
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
    ) : null;

  return (
    <>
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
      </div>
      {panel ? createPortal(panel, document.body) : null}
    </>
  );
};
