import type { AudioEngine } from './AudioEngine.ts';

export const SCOPE_SIZE = 17;

export function getDynamicKeyMap(scopeStart: number): Record<string, number> {
  const map: Record<string, number> = {};

  const whitePhysicals = [
    'KeyA',
    'KeyS',
    'KeyD',
    'KeyF',
    'KeyG',
    'KeyH',
    'KeyJ',
    'KeyK',
    'KeyL',
    'Semicolon',
  ];

  const topLeftMap: Record<string, string> = {
    KeyA: 'KeyQ',
    KeyS: 'KeyW',
    KeyD: 'KeyE',
    KeyF: 'KeyR',
    KeyG: 'KeyT',
    KeyH: 'KeyY',
    KeyJ: 'KeyU',
    KeyK: 'KeyI',
    KeyL: 'KeyO',
    Semicolon: 'KeyP',
  };

  const isBlack = (m: number) => [1, 3, 6, 8, 10].includes(m % 12);

  let whiteIndex = 0;
  for (let midi = scopeStart; midi <= scopeStart + SCOPE_SIZE; midi += 1) {
    if (!isBlack(midi)) {
      if (whiteIndex < whitePhysicals.length) {
        map[whitePhysicals[whiteIndex]] = midi;
      }
      whiteIndex += 1;
    }
  }

  for (let midi = scopeStart; midi <= scopeStart + SCOPE_SIZE; midi += 1) {
    if (isBlack(midi)) {
      const rightWhiteMidi = midi + 1;
      const rightWhitePhysical = Object.keys(map).find(
        (key) => map[key] === rightWhiteMidi,
      );
      if (rightWhitePhysical && topLeftMap[rightWhitePhysical]) {
        map[topLeftMap[rightWhitePhysical]] = midi;
      }
    }
  }

  const lastMidiInScope = scopeStart + SCOPE_SIZE - 1;
  if (
    isBlack(lastMidiInScope) &&
    !Object.values(map).includes(lastMidiInScope)
  ) {
    map.BracketLeft = lastMidiInScope;
  }

  const finalMap: Record<string, number> = {};
  for (const key in map) {
    if (map[key] >= scopeStart && map[key] < scopeStart + SCOPE_SIZE) {
      finalMap[key] = map[key];
    }
  }

  return finalMap;
}

export function formatKeyCode(code: string): string {
  if (code.startsWith('Key')) {
    return code.replace('Key', '');
  }

  const symbols: Record<string, string> = {
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
  };

  return symbols[code] ?? code;
}

export class InputManager {
  private readonly audioEngine: AudioEngine;
  private readonly getScopeStart: () => number;
  private readonly activePhysicalKeys = new Set<string>();
  private cachedScopeStart: number | null = null;
  private cachedKeyMap: Record<string, number> = {};

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const midiPitch = this.resolveMidiPitch(event.code);
    if (midiPitch === undefined) {
      return;
    }

    event.preventDefault();

    if (this.activePhysicalKeys.has(event.code)) {
      return;
    }

    this.activePhysicalKeys.add(event.code);

    void this.audioEngine.init();
    this.audioEngine.noteOn(midiPitch);
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    const midiPitch = this.resolveMidiPitch(event.code);
    if (midiPitch === undefined) {
      return;
    }

    event.preventDefault();

    if (!this.activePhysicalKeys.has(event.code)) {
      return;
    }

    this.activePhysicalKeys.delete(event.code);
    this.audioEngine.noteOff(midiPitch);
  };

  constructor(audioEngine: AudioEngine, getScopeStart: () => number = () => 60) {
    this.audioEngine = audioEngine;
    this.getScopeStart = getScopeStart;
    window.addEventListener('keydown', this.handleKeyDown, { capture: true });
    window.addEventListener('keyup', this.handleKeyUp, { capture: true });
  }

  destroy(): void {
    window.removeEventListener('keydown', this.handleKeyDown, { capture: true });
    window.removeEventListener('keyup', this.handleKeyUp, { capture: true });
    this.activePhysicalKeys.clear();
  }

  private resolveMidiPitch(keyCode: string): number | undefined {
    const scopeStart = this.getScopeStart();
    if (this.cachedScopeStart !== scopeStart) {
      this.cachedScopeStart = scopeStart;
      this.cachedKeyMap = getDynamicKeyMap(scopeStart);
    }
    return this.cachedKeyMap[keyCode];
  }
}
