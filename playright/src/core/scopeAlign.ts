import {
  CORE_BLACK_PHYSICALS,
  CORE_WHITE_PHYSICALS,
  getEffectiveKeyMap,
  midisFitScopeKeyMap,
  PIANO_END_MIDI,
  PIANO_START_MIDI,
  SCOPE_SIZE,
} from './InputManager.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

const MAX_SCOPE_START = PIANO_END_MIDI - (SCOPE_SIZE - 1);

function getCoreKeyMidis(scopeStart: number, transpose: number): Set<number> {
  const map = getEffectiveKeyMap(scopeStart, transpose);
  const midis = new Set<number>();

  for (const code of CORE_WHITE_PHYSICALS) {
    const midi = map[code];
    if (midi !== undefined) {
      midis.add(midi);
    }
  }

  for (const code of CORE_BLACK_PHYSICALS) {
    const midi = map[code];
    if (midi !== undefined) {
      midis.add(midi);
    }
  }

  return midis;
}

function midisFitCoreKeys(
  midis: number[],
  scopeStart: number,
  transpose: number,
): boolean {
  const coreMidis = getCoreKeyMidis(scopeStart, transpose);
  return midis.every((midi) => coreMidis.has(midi));
}

function findBestCoreScopeStart(
  midis: number[],
  currentScopeStart: number,
  transpose: number,
): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;

  for (let start = PIANO_START_MIDI; start <= MAX_SCOPE_START; start += 1) {
    if (!midisFitCoreKeys(midis, start, transpose)) {
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

  if (midisFitCoreKeys(midiList, scopeStartMidi, scopeTranspose)) {
    return;
  }

  const coreScopeStart = findBestCoreScopeStart(
    midiList,
    scopeStartMidi,
    scopeTranspose,
  );
  if (coreScopeStart !== null) {
    if (coreScopeStart !== scopeStartMidi) {
      useEngineStore.getState().actions.setScopeStart(coreScopeStart);
    }
    return;
  }

  if (midisFitScopeKeyMap(midiList, scopeStartMidi, scopeTranspose)) {
    return;
  }

  const keyMapScopeStart = findBestScopeStartForKeyMap(
    midiList,
    scopeStartMidi,
    scopeTranspose,
  );
  if (keyMapScopeStart !== null && keyMapScopeStart !== scopeStartMidi) {
    useEngineStore.getState().actions.setScopeStart(keyMapScopeStart);
  }
}
