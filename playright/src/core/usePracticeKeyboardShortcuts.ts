import { useEffect } from 'react';
import { practiceEngine } from './PracticeEngine.ts';
import { playbackEngine } from './PlaybackEngine.ts';
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

      if (state.fingeringMode === 'program') {
        return;
      }

      if (event.code === 'KeyC') {
        event.preventDefault();
        state.actions.toggleScoreLibrary();
        return;
      }

      if (state.playMode) {
        switch (event.code) {
          case 'Enter':
          case 'NumpadEnter': {
            if (!state.script) {
              return;
            }

            event.preventDefault();
            if (state.isPlaybackActive && state.isPlaybackPaused) {
              playbackEngine.resume();
            } else if (!state.isPlaybackActive || state.isPlaybackPaused) {
              void playbackEngine.play();
            }
            return;
          }
          case 'Space': {
            if (!state.script || !state.isPlaybackActive) {
              return;
            }

            event.preventDefault();
            if (state.isPlaybackPaused) {
              playbackEngine.resume();
            } else {
              playbackEngine.pause();
            }
            return;
          }
          case 'KeyX': {
            if (!state.script || !state.isPlaybackActive) {
              return;
            }

            event.preventDefault();
            playbackEngine.stop();
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
      }

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
