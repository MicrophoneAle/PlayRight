import { useLayoutEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEngineStore } from '../store/useEngineStore.ts';

interface ModalOverlayProps {
  /** Backdrop classes (position, z-index, tint, layout). */
  className: string;
  onBackdropClick: () => void;
  children: ReactNode;
}

/**
 * Full-screen modal backdrop, portaled to <body>. While mounted it registers a
 * blocking overlay in the store, which suppresses every app-level keyboard
 * input path via selectInputBlocked. Every modal must render through this so it
 * is gated by construction (enforced by modalOverlay.guard.test.ts).
 *
 * Layout effect, not a plain effect: the gate must be up before the browser can
 * deliver another keydown after the overlay paints.
 */
export function ModalOverlay({ className, onBackdropClick, children }: ModalOverlayProps) {
  useLayoutEffect(() => useEngineStore.getState().actions.acquireBlockingOverlay(), []);

  return createPortal(
    <div className={className} onClick={onBackdropClick} role="presentation">
      {children}
    </div>,
    document.body,
  );
}
