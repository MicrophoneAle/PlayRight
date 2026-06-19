import {
  getDynamicKeyMap,
  PIANO_END_MIDI,
  PIANO_START_MIDI,
  SCOPE_SIZE,
} from './InputManager.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

const MAX_SCOPE_START = PIANO_END_MIDI - (SCOPE_SIZE - 1);

export function isMidiInScope(midi: number, scopeStart: number): boolean {
  return midi >= scopeStart && midi <= scopeStart + SCOPE_SIZE - 1;
}

function midisFitCoreAnchors(midis: number[], scopeStart: number): boolean {
  const map = getDynamicKeyMap(scopeStart);
  if (map.KeyA === undefined || map.Semicolon === undefined) {
    return false;
  }

  return midis.every(
    (midi) => midi >= map.KeyA! && midi <= map.Semicolon!,
  );
}

function midisFitFullKeyMap(midis: number[], scopeStart: number): boolean {
  const map = getDynamicKeyMap(scopeStart);
  const values = Object.values(map);
  if (values.length === 0) {
    return false;
  }

  const minMidi = Math.min(...values);
  const maxMidi = Math.max(...values);

  return midis.every((midi) => midi >= minMidi && midi <= maxMidi);
}

function findBestScopeStart(
  midis: number[],
  currentScopeStart: number,
  preferCore: boolean,
): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;

  for (let start = PIANO_START_MIDI; start <= MAX_SCOPE_START; start += 1) {
    const fits = preferCore
      ? midisFitCoreAnchors(midis, start)
      : midisFitFullKeyMap(midis, start);

    if (!fits) {
      continue;
    }

    const distance = Math.abs(start - currentScopeStart);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = start;
    }
  }

  return best;
}

export function alignScopeToMidis(midis: Iterable<number>): void {
  const midiList = [...midis];
  if (midiList.length === 0) {
    return;
  }

  const currentScopeStart = useEngineStore.getState().scopeStartMidi;

  if (midisFitCoreAnchors(midiList, currentScopeStart)) {
    return;
  }

  const coreScopeStart = findBestScopeStart(
    midiList,
    currentScopeStart,
    true,
  );
  if (coreScopeStart !== null) {
    if (coreScopeStart !== currentScopeStart) {
      useEngineStore.getState().actions.setScopeStart(coreScopeStart);
    }
    return;
  }

  const fullScopeStart = findBestScopeStart(
    midiList,
    currentScopeStart,
    false,
  );
  if (fullScopeStart !== null && fullScopeStart !== currentScopeStart) {
    useEngineStore.getState().actions.setScopeStart(fullScopeStart);
  }
}
