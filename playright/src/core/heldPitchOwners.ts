import type { FingerMapping } from './twoHandMapping.ts';

type Hold = { midi: number; pressIds: number[] };

/**
 * Who is holding each live keypress voice, keyed by owner (the physical key
 * that started it). Several owners can hold one pitch - a unison between the
 * hands, a finger substitution, a cross-hand assignment onto a pitch the other
 * hand already holds. AudioEngine.noteOff is pitch-wide (the Sampler stops
 * every voice of that pitch), so callers must only release the voice when its
 * LAST owner lets go, as a piano key keeps sounding while any finger still
 * holds it down.
 *
 * Bookkeeping only: attacking and releasing audio stays with each engine,
 * because practice re-strikes a held pitch and program mode does not.
 */
export class HeldPitchOwners {
  private holds = new Map<string, Hold>();

  hold(owner: string, midi: number, pressIds: number[] = []): void {
    this.holds.set(owner, { midi, pressIds });
  }

  get(owner: string): Hold | undefined {
    return this.holds.get(owner);
  }

  /**
   * Drop `owner`'s hold. Returns it with `pitchFree` true when no other owner
   * still holds that pitch (the caller should now release the voice), or null
   * when `owner` held nothing.
   */
  release(owner: string): (Hold & { pitchFree: boolean }) | null {
    const hold = this.holds.get(owner);
    if (hold === undefined) {
      return null;
    }

    this.holds.delete(owner);
    return { ...hold, pitchFree: !this.isHeld(hold.midi) };
  }

  isHeld(midi: number): boolean {
    for (const hold of this.holds.values()) {
      if (hold.midi === midi) {
        return true;
      }
    }

    return false;
  }

  clear(): void {
    this.holds.clear();
  }
}

/**
 * Owner key for a two-hand finger key. A FingerMapping is the physical key
 * slot that was pressed (bindings are unique per slot), and `hand` is the
 * physical hand even on a crossover - so this names exactly one held key.
 */
export function fingerOwner(mapping: FingerMapping): string {
  return `${mapping.hand}:${mapping.finger}`;
}
