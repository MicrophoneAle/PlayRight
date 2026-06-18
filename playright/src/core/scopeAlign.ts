import { SCOPE_SIZE } from './InputManager.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

const START_MIDI = 21;
const END_MIDI = 108;

export function isMidiInScope(midi: number, scopeStart: number): boolean {
  return midi >= scopeStart && midi <= scopeStart + SCOPE_SIZE - 1;
}

function clampScopeStart(scopeStart: number): number {
  const maxScopeStart = END_MIDI - (SCOPE_SIZE - 1);
  return Math.max(START_MIDI, Math.min(scopeStart, maxScopeStart));
}

/** Fit every MIDI in the list inside one scope window. */
function scopeStartForSpan(minMidi: number, maxMidi: number): number {
  let scopeStart = minMidi;
  if (scopeStart + SCOPE_SIZE - 1 < maxMidi) {
    scopeStart = maxMidi - (SCOPE_SIZE - 1);
  }
  return clampScopeStart(scopeStart);
}

export function alignScopeToMidis(midis: Iterable<number>): void {
  const midiList = [...midis];
  if (midiList.length === 0) {
    return;
  }

  const currentScopeStart = useEngineStore.getState().scopeStartMidi;
  const scopeEnd = currentScopeStart + SCOPE_SIZE - 1;
  const allInScope = midiList.every((midi) =>
    isMidiInScope(midi, currentScopeStart),
  );

  if (allInScope) {
    return;
  }

  const minMidi = Math.min(...midiList);
  const maxMidi = Math.max(...midiList);
  const span = maxMidi - minMidi;

  let scopeStart: number;

  if (span >= SCOPE_SIZE) {
    scopeStart = scopeStartForSpan(minMidi, maxMidi);
  } else if (minMidi > scopeEnd) {
    // Entirely above the current range — slide the high edge up to the top note.
    scopeStart = clampScopeStart(maxMidi - (SCOPE_SIZE - 1));
  } else if (maxMidi < currentScopeStart) {
    // Entirely below the current range — slide the low edge down to the bottom note.
    scopeStart = clampScopeStart(minMidi);
  } else {
    // Partial overlap or notes on both sides — fit the full span in the window.
    scopeStart = scopeStartForSpan(minMidi, maxMidi);
  }

  if (scopeStart === currentScopeStart) {
    return;
  }

  useEngineStore.getState().actions.setScopeStart(scopeStart);
}
