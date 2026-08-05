import type { PlayingPlaybackNote } from '../types/index.ts';

/** Tracks active playback key presses by unique id so repeated pitches stay independent. */
export class PlayingMidiPressTracker {
  private activePressIds = new Set<number>();
  private pressIdToNote = new Map<number, PlayingPlaybackNote>();
  /**
   * Monotonic for the lifetime of the tracker - deliberately NOT reset by
   * clear().
   *
   * pause() clears the tracker but intentionally leaves the Transport's
   * scheduled release events in place (a mid-piece pause resumes in place, so
   * it must not throw its schedule away). Restarting ids at 0 therefore handed
   * freshly allocated presses the same ids as those still-pending releases:
   * the stale callback would mark the new id released, wasReleased() would
   * return true for it, and deferRepeatedPress would silently drop the press -
   * corrupting keyboard highlights a little more with every pause cycle.
   */
  private nextPressId = 0;
  /**
   * pressIds released before their deferred visual press fired, kept ONLY for
   * ids currently inside a deferral window (see beginDeferredPress). Recording
   * every release instead grew without bound for the length of a run (~1200
   * entries on a 198s piece) to answer a question that is live for ~40ms.
   */
  private releasedPressIds = new Set<number>();
  /** pressIds whose visual press is currently deferred and not yet resolved. */
  private deferredPressIds = new Set<number>();

  allocatePressId(): number {
    const pressId = this.nextPressId;
    this.nextPressId += 1;
    return pressId;
  }

  press(note: PlayingPlaybackNote): void {
    this.pressIdToNote.set(note.pressId, note);
    this.activePressIds.add(note.pressId);
  }

  release(pressId: number): void {
    this.activePressIds.delete(pressId);
    this.pressIdToNote.delete(pressId);
    if (this.deferredPressIds.has(pressId)) {
      this.releasedPressIds.add(pressId);
    }
  }

  /**
   * Open a deferral window for a pressId whose visual press is delayed. From
   * here until endDeferredPress, a release on this id is remembered so the
   * deferred press can be cancelled. Without the window the release would land
   * with no highlight to clear, and the late press would light a key that has
   * no release event left to ever turn it back off.
   */
  beginDeferredPress(pressId: number): void {
    this.deferredPressIds.add(pressId);
  }

  /** Close the window (the deferred press fired, was skipped, or was cancelled). */
  endDeferredPress(pressId: number): void {
    this.deferredPressIds.delete(pressId);
    this.releasedPressIds.delete(pressId);
  }

  /** True when this pressId was released during its deferral window, via any path (direct, overdue sweep, or tie-end releaseMatching). */
  wasReleased(pressId: number): boolean {
    return this.releasedPressIds.has(pressId);
  }

  activeNotes(): PlayingPlaybackNote[] {
    return [...this.activePressIds]
      .map((pressId) => this.pressIdToNote.get(pressId))
      .filter((note): note is PlayingPlaybackNote => note !== undefined)
      .sort((left, right) => {
        if (left.stepIndex !== right.stepIndex) {
          return left.stepIndex - right.stepIndex;
        }

        if (left.midi !== right.midi) {
          return left.midi - right.midi;
        }

        return left.hand.localeCompare(right.hand);
      });
  }

  activeMidis(): number[] {
    return this.activeNotes()
      .map((note) => note.midi)
      .sort((a, b) => a - b);
  }

  clear(): void {
    this.activePressIds.clear();
    this.pressIdToNote.clear();
    this.releasedPressIds.clear();
    this.deferredPressIds.clear();
    // nextPressId is NOT reset here - see the field comment.
  }

  releaseMatching(
    predicate: (note: PlayingPlaybackNote) => boolean,
  ): boolean {
    let changed = false;

    for (const pressId of [...this.activePressIds]) {
      const note = this.pressIdToNote.get(pressId);
      if (note !== undefined && predicate(note)) {
        this.release(pressId);
        changed = true;
      }
    }

    return changed;
  }
}
