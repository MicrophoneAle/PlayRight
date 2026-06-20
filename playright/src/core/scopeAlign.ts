import {
  getDisplayScopeMidiBounds,
  getDynamicKeyMap,
  midisFitScopeKeyMap,
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

function findBestScopeStartForKeyMap(
  midis: number[],
  currentScopeStart: number,
  transpose: number,
): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;

  for (let start = PIANO_START_MIDI; start <= MAX_SCOPE_START; start += 1) {
    if (!midisFitScopeKeyMap(midis, start, transpose)) {
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

  const { scopeStartMidi, scopeTranspose } = useEngineStore.getState();

  if (midisFitScopeKeyMap(midiList, scopeStartMidi, scopeTranspose)) {
    return;
  }

  const keyMapScopeStart = findBestScopeStartForKeyMap(
    midiList,
    scopeStartMidi,
    scopeTranspose,
  );
  if (keyMapScopeStart !== null) {
    if (keyMapScopeStart !== scopeStartMidi) {
      useEngineStore.getState().actions.setScopeStart(keyMapScopeStart);
    }
    return;
  }

  if (midisFitDisplayScope(midiList, scopeStartMidi)) {
    return;
  }

  if (midisFitCoreAnchors(midiList, scopeStartMidi)) {
    return;
  }

  const coreScopeStart = findBestScopeStart(
    midiList,
    scopeStartMidi,
    true,
  );
  if (coreScopeStart !== null) {
    if (coreScopeStart !== scopeStartMidi) {
      useEngineStore.getState().actions.setScopeStart(coreScopeStart);
    }
    return;
  }

  const displayScopeStart = findBestScopeStart(
    midiList,
    scopeStartMidi,
    false,
  );
  if (displayScopeStart !== null && displayScopeStart !== scopeStartMidi) {
    useEngineStore.getState().actions.setScopeStart(displayScopeStart);
  }
}
