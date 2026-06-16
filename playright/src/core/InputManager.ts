import type { AudioEngine } from './AudioEngine.ts';

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
    'Quote',
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
    Quote: 'BracketLeft',
  };

  const isBlack = (m: number) => [1, 3, 6, 8, 10].includes(m % 12);

  let whiteIndex = 0;
  for (let midi = scopeStart; midi <= scopeStart + 13; midi += 1) {
    if (!isBlack(midi)) {
      if (whiteIndex < whitePhysicals.length) {
        map[whitePhysicals[whiteIndex]] = midi;
      }
      whiteIndex += 1;
    }
  }

  for (let midi = scopeStart; midi <= scopeStart + 13; midi += 1) {
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

  const finalMap: Record<string, number> = {};
  for (const key in map) {
    if (map[key] >= scopeStart && map[key] < scopeStart + 13) {
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
  private initialized = false;

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const midiPitch = this.resolveMidiPitch(event.code);
    if (midiPitch === undefined) {
      return;
    }

    event.preventDefault();

    if (this.activePhysicalKeys.has(event.code)) {
      return;
    }

    void this.ensureInitialized();

    this.activePhysicalKeys.add(event.code);
    this.audioEngine.triggerNoteOn(midiPitch);
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
    this.audioEngine.triggerNoteOff(midiPitch);
  };

  constructor(audioEngine: AudioEngine, getScopeStart: () => number = () => 60) {
    this.audioEngine = audioEngine;
    this.getScopeStart = getScopeStart;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.activePhysicalKeys.clear();
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.audioEngine.init();
    this.initialized = true;
  }

  private resolveMidiPitch(keyCode: string): number | undefined {
    const keyMap = getDynamicKeyMap(this.getScopeStart());
    return keyMap[keyCode];
  }
}
