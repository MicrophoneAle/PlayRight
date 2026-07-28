import type { AudioEngine } from './AudioEngine.ts';
import { playbackEngine } from './PlaybackEngine.ts';

/**
 * Recovery for the two ways a backgrounded tab breaks play mode.
 *
 * 1. Throttled transport clock. Tone drives Transport from a setTimeout chain
 *    inside a Web Worker. Browsers clamp background timers (~1s hidden, and
 *    far harder after a few minutes hidden), so on return the worker delivers
 *    one late batch covering the whole elapsed range. PlaybackEngine's rolling
 *    window can end up writing an entire window of events behind the transport,
 *    where Tone's exact-tick dispatch strands them permanently.
 * 2. Suspended AudioContext. Some browsers suspend (or "interrupt") the context
 *    for a hidden tab or under memory pressure. That freezes currentTime, which
 *    stops Tone's clock, which stops every transport callback - including the
 *    ones that would have lazily resumed the context.
 *
 * This is deliberately separate from sessionLifecycle.ts. That module handles
 * pagehide/pageshow (real navigation and bfcache restore) and TEARS DOWN the
 * session. visibilitychange is a different event with no overlap, and a tab
 * switch must never stop playback - so this path only resumes and resyncs.
 */
export function startAudioContextRecovery(audioEngine: AudioEngine): () => void {
  const handleVisibilityChange = () => {
    if (document.visibilityState !== 'visible') {
      return;
    }

    void audioEngine.resumeContext().then(() => {
      // Runs whether or not the context was suspended: the throttled-clock
      // case (1) leaves the context running and still needs the resync.
      playbackEngine.resyncAfterInterruption();
    });
  };

  const handleContextStateChange = () => {
    if (!audioEngine.isContextSuspended) {
      return;
    }

    // Only attempt an unprompted resume while the tab is actually visible.
    // Resuming a hidden tab's context is usually rejected, and would fight the
    // browser's power management for no benefit.
    if (document.visibilityState !== 'visible') {
      return;
    }

    void audioEngine.resumeContext().then(() => {
      playbackEngine.resyncAfterInterruption();
    });
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  const offContextStateChange = audioEngine.onContextStateChange(
    handleContextStateChange,
  );

  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    offContextStateChange();
  };
}
