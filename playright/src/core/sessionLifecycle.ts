import {
  disposeFingeringModel,
  initFingeringModel,
  wasFingeringModelInitialized,
} from './aiFingeringInference.ts';
import { isMlFingeringEnabled } from './fingeringMlConfig.ts';
import { fingeringProgramEngine } from './FingeringProgramEngine.ts';
import { playbackEngine } from './PlaybackEngine.ts';
import { practiceEngine } from './PracticeEngine.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

/** Stop audio/practice engines and clear transient runtime flags. */
export function resetRuntimeSession(): void {
  practiceEngine.stop();
  playbackEngine.stop();
  fingeringProgramEngine.stop();

  const { actions } = useEngineStore.getState();
  actions.setPracticeActive(false);
  actions.setHasPracticeStarted(false);
  actions.setPlaybackActive(false);
  actions.setPlaybackFinished(false);
  actions.setPlaybackPaused(false);
  actions.setExpectedNotes([]);
  actions.setPlayingMidiNotes([]);
  actions.setPlayingPlaybackNotes([]);
}

/** Tear down ONNX and engines when the tab is hidden or closed. */
export function resetSessionOnPageHide(): void {
  resetRuntimeSession();
  void disposeFingeringModel();
}

/**
 * After a bfcache restore, clear stale runtime state. Re-init ONNX only when
 * ML was already loaded earlier in this page lifetime — never eagerly fetch
 * WASM/model for a session that never used auto-fingering.
 */
export async function restoreSessionAfterPageShow(
  persisted: boolean,
): Promise<void> {
  if (!persisted) {
    return;
  }

  const shouldRestoreMl =
    wasFingeringModelInitialized() && isMlFingeringEnabled();

  resetRuntimeSession();
  await disposeFingeringModel();

  if (!shouldRestoreMl) {
    return;
  }

  try {
    await initFingeringModel();
  } catch {
    console.warn(
      'AI Fingering Model failed to load, falling back to rule-based engine',
    );
  }
}
