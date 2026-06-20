import { beforeEach, describe, expect, it } from 'vitest';
import { alignScopeToMidis } from './scopeAlign.ts';
import {
  getDynamicKeyMap,
  getScopeKeyMap,
  midisFitScopeKeyMap,
} from './InputManager.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

describe('alignScopeToMidis', () => {
  beforeEach(() => {
    useEngineStore.setState({ scopeStartMidi: 60, scopeTranspose: 0 });
  });

  it('keeps the current scope when notes fit between A and ;', () => {
    alignScopeToMidis([60, 64, 76]);

    expect(useEngineStore.getState().scopeStartMidi).toBe(60);
  });

  it('prefers the core A through ; window before using extensions', () => {
    alignScopeToMidis([64, 67]);

    const map = getDynamicKeyMap(useEngineStore.getState().scopeStartMidi);
    expect(map.KeyA).toBeLessThanOrEqual(64);
    expect(map.Semicolon).toBeGreaterThanOrEqual(67);
  });

  it('expands to include extensions only when notes fall outside the core window', () => {
    alignScopeToMidis([58]);

    const map = getDynamicKeyMap(useEngineStore.getState().scopeStartMidi);
    const values = Object.values(map);
    expect(values.length).toBeGreaterThan(0);
    expect(Math.min(...values)).toBeLessThanOrEqual(58);
  });

  it('keeps scope when notes fit the display window even outside A through ;', () => {
    alignScopeToMidis([60, 78]);

    expect(useEngineStore.getState().scopeStartMidi).toBe(60);
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
