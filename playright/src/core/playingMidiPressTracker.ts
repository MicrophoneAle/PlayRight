import type { PlayingPlaybackNote } from '../types/index.ts';

/** Tracks active playback key presses by unique id so repeated pitches stay independent. */
export class PlayingMidiPressTracker {
  private activePressIds = new Set<number>();
  private pressIdToNote = new Map<number, PlayingPlaybackNote>();
  private nextPressId = 0;
  /** pressIds released before their (possibly deferred) visual press ever fired. */
  private releasedPressIds = new Set<number>();

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
    this.releasedPressIds.add(pressId);
  }

  /** True once this pressId has gone through release(), via any path (direct, overdue sweep, or tie-end releaseMatching). */
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
    this.nextPressId = 0;
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
