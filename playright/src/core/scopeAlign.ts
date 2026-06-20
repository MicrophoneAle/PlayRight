import {
  getDisplayScopeMidiBounds,
  getDynamicKeyMap,
  PIANO_END_MIDI,
  PIANO_START_MIDI,
  SCOPE_SIZE,
} from './InputManager.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

const MAX_SCOPE_START = PIANO_END_MIDI - (SCOPE_SIZE - 1);

function midisFitCoreAnchors(midis: number[], scopeStart: number): boolean {
  const map = getDynamicKeyMap(scopeStart);
  if (map.KeyA === undefined || map.Semicolon === undefined) {
    return false;
  }

  return midis.every(
    (midi) => midi >= map.KeyA! && midi <= map.Semicolon!,
  );
}

function midisFitDisplayScope(midis: number[], scopeStart: number): boolean {
  const { min, max } = getDisplayScopeMidiBounds(scopeStart);
  return midis.every((midi) => midi >= min && midi <= max);
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
      : midisFitDisplayScope(midis, start);

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

  if (midisFitDisplayScope(midiList, currentScopeStart)) {
    return;
  }

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

  const displayScopeStart = findBestScopeStart(
    midiList,
    currentScopeStart,
    false,
  );
  if (displayScopeStart !== null && displayScopeStart !== currentScopeStart) {
    useEngineStore.getState().actions.setScopeStart(displayScopeStart);
  }
}
