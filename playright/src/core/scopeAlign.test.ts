import { beforeEach, describe, expect, it } from 'vitest';
import { alignScopeToMidis } from './scopeAlign.ts';
import {
  getEffectiveKeyMap,
  getExtensionMidis,
  getScopeKeyMap,
  midisFitScopeKeyMap,
} from './InputManager.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

function noteUsesExtensionKey(scopeStart: number, midi: number): boolean {
  return getExtensionMidis(getEffectiveKeyMap(scopeStart, 0)).has(midi);
}

describe('alignScopeToMidis', () => {
  beforeEach(() => {
    useEngineStore.setState({ scopeStartMidi: 60, scopeTranspose: 0 });
  });

  it('keeps scope when notes fit the core without using extension keys', () => {
    alignScopeToMidis([60, 64, 76]);

    expect(useEngineStore.getState().scopeStartMidi).toBe(60);
    for (const midi of [60, 64, 76]) {
      expect(noteUsesExtensionKey(60, midi)).toBe(false);
    }
  });

  it('re-centers notes from extension keys into the core when possible', () => {
    alignScopeToMidis([59]);

    expect(useEngineStore.getState().scopeStartMidi).toBe(59);
    expect(noteUsesExtensionKey(59, 59)).toBe(false);
  });

  it('re-centers low notes into the core instead of leaving them on Shift or Tab', () => {
    alignScopeToMidis([58]);

    const scopeStart = useEngineStore.getState().scopeStartMidi;
    expect(noteUsesExtensionKey(scopeStart, 58)).toBe(false);
  });

  it('uses extension keys when the interval is wider than the core', () => {
    alignScopeToMidis([60, 78]);

    expect(useEngineStore.getState().scopeStartMidi).toBe(60);
    expect(midisFitScopeKeyMap([60, 78], 60, 0)).toBe(true);
    expect(noteUsesExtensionKey(60, 78)).toBe(true);
  });

  it('moves the scope when practice notes sit above the current Semicolon anchor', () => {
    alignScopeToMidis([88]);

    const scopeStart = useEngineStore.getState().scopeStartMidi;
    expect(midisFitScopeKeyMap([88], scopeStart, 0)).toBe(true);
    expect(Object.values(getScopeKeyMap(scopeStart, 0))).toContain(88);
  });

  it('aligns scope so every note in an interval maps to a physical key', () => {
    alignScopeToMidis([78, 81]);

    const scopeStart = useEngineStore.getState().scopeStartMidi;
    expect(midisFitScopeKeyMap([78, 81], scopeStart, 0)).toBe(true);
  });
});
