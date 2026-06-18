import { useEffect } from 'react';
import { practiceEngine } from './PracticeEngine.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function usePracticeKeyboardShortcuts(): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isEditableTarget(event.target)) {
        return;
      }

      const state = useEngineStore.getState();

      switch (event.code) {
        case 'Enter':
        case 'NumpadEnter': {
          if (!state.script || state.isPracticeActive) {
            return;
          }

          event.preventDefault();
          practiceEngine.start();
          return;
        }
        case 'Space': {
          if (!state.script || !state.hasPracticeStarted) {
            return;
          }

          event.preventDefault();
          if (state.isPracticeActive) {
            practiceEngine.pause();
          } else {
            practiceEngine.start();
          }
          return;
        }
        case 'KeyX': {
          if (!state.script || !state.hasPracticeStarted) {
            return;
          }

          event.preventDefault();
          practiceEngine.stop();
          return;
        }
        case 'KeyZ': {
          event.preventDefault();
          state.actions.toggleHeaderCollapsed();
          return;
        }
        default:
          return;
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, []);
}
