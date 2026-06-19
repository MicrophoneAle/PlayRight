import { describe, expect, it } from 'vitest';
import { getDynamicKeyMap, SCOPE_SIZE } from './InputManager.ts';

describe('getDynamicKeyMap scope endpoints', () => {
  it('maps the lowest in-scope black to Q when scope starts on white', () => {
    const scopeStart = 40;
    const map = getDynamicKeyMap(scopeStart);

    expect(map.KeyA).toBe(40);
    expect(map.KeyQ).toBe(42);
    expect(map.KeyW).toBeUndefined();
  });

  it('maps the highest in-scope black to [ when scope ends on black', () => {
    const scopeStart = 40;
    const map = getDynamicKeyMap(scopeStart);
    const lastMidi = scopeStart + SCOPE_SIZE - 1;

    expect(lastMidi).toBe(57);
    expect(map.BracketLeft).toBe(56);
    expect(map.KeyQ).toBe(42);
  });

  it('keeps Q on the leading black when scope starts on black', () => {
    const scopeStart = 39;
    const map = getDynamicKeyMap(scopeStart);

    expect(map.KeyQ).toBe(39);
  });

  it('adds Tab for the low black extension when in range', () => {
    const scopeStart = 40;
    const map = getDynamicKeyMap(scopeStart);

    expect(map.Tab).toBe(39);
  });

  it("adds ' directly after ; when in range", () => {
    const scopeStart = 40;
    const map = getDynamicKeyMap(scopeStart);

    expect(map.Semicolon).toBe(55);
    expect(map.Quote).toBe(57);
  });

  it("adds ' directly after ; for the default scope position", () => {
    const scopeStart = 60;
    const map = getDynamicKeyMap(scopeStart);

    expect(map.Semicolon).toBe(76);
    expect(map.Quote).toBe(77);
  });

  it('adds ] for the high black extension when in range', () => {
    const scopeStart = 40;
    const map = getDynamicKeyMap(scopeStart);

    expect(map.BracketRight).toBe(58);
  });
});
