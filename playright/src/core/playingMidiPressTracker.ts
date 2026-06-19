/** Tracks active playback key presses by unique id so repeated pitches stay independent. */
export class PlayingMidiPressTracker {
  private activePressIds = new Set<number>();
  private pressIdToMidi = new Map<number, number>();
  private nextPressId = 0;

  allocatePressId(): number {
    const pressId = this.nextPressId;
    this.nextPressId += 1;
    return pressId;
  }

  press(midi: number, pressId: number): void {
    this.pressIdToMidi.set(pressId, midi);
    this.activePressIds.add(pressId);
  }

  release(pressId: number): void {
    this.activePressIds.delete(pressId);
    this.pressIdToMidi.delete(pressId);
  }

  activeMidis(): number[] {
    return [...this.activePressIds]
      .map((pressId) => this.pressIdToMidi.get(pressId))
      .filter((midi): midi is number => midi !== undefined)
      .sort((a, b) => a - b);
  }

  clear(): void {
    this.activePressIds.clear();
    this.pressIdToMidi.clear();
  }
}
