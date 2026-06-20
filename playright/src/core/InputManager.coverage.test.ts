import { describe, expect, it } from 'vitest';
import {
  expectedMidisMissingPhysicalKey,
  expectedMidisOutsideDisplayScope,
  getScopeKeyMap,
  midisFitScopeKeyMap,
} from './InputManager.ts';

describe('one-hand expected note coverage', () => {
  it('preserves every distinct midi in expected notes for an interval step', () => {
    const expected = [66, 69];
    expect(new Set(expected)).toEqual(new Set([66, 69]));
  });

  it('detects expected midis outside the 22-note display window', () => {
    const outside = expectedMidisOutsideDisplayScope([60, 81], 60);
    expect(outside).toEqual([81]);
  });

  it('assigns a physical key to both notes when scope fits an interval', () => {
    const scopeStart = 63;
    expect(midisFitScopeKeyMap([78, 81], scopeStart, 0)).toBe(true);

    const keyMap = getScopeKeyMap(scopeStart, 0);
    expect(Object.values(keyMap)).toContain(78);
    expect(Object.values(keyMap)).toContain(81);
  });

  it('reports in-window midis that still lack a physical key assignment', () => {
    const scopeStart = 60;
    const keyMap = getScopeKeyMap(scopeStart, 0);
    const mappedMidis = new Set(Object.values(keyMap));
    const inWindowWithoutKey = expectedMidisMissingPhysicalKey([60, 64], scopeStart, 0);

    for (const midi of inWindowWithoutKey) {
      expect(mappedMidis.has(midi)).toBe(false);
    }
  });
});
