import { SCOPE_SIZE } from './InputManager.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

const START_MIDI = 21;
const END_MIDI = 108;

export function alignScopeToMidis(midis: Iterable<number>): void {
  const midiList = [...midis];
  if (midiList.length === 0) {
    return;
  }

  const minMidi = Math.min(...midiList);
  const maxMidi = Math.max(...midiList);
  const maxScopeStart = END_MIDI - (SCOPE_SIZE - 1);

  let scopeStart = minMidi;
  if (scopeStart + SCOPE_SIZE - 1 < maxMidi) {
    scopeStart = maxMidi - (SCOPE_SIZE - 1);
  }

  scopeStart = Math.max(START_MIDI, Math.min(scopeStart, maxScopeStart));
  useEngineStore.getState().actions.setScopeStart(scopeStart);
}
