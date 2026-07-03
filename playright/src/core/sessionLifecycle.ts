import {
  disposeFingeringModel,
  initFingeringModel,
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

/** After a bfcache restore, rebuild ONNX and clear stale in-memory state. */
export async function restoreSessionAfterPageShow(
  persisted: boolean,
): Promise<void> {
  if (!persisted) {
    return;
  }

  resetRuntimeSession();
  await disposeFingeringModel();

  if (!isMlFingeringEnabled()) {
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
