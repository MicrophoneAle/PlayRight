import { beforeEach, describe, expect, it } from 'vitest';
import { alignScopeToMidis } from './scopeAlign.ts';
import { getDynamicKeyMap } from './InputManager.ts';
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
});
