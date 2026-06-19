import type { AudioEngine } from './AudioEngine.ts';
import { practiceEngine } from './PracticeEngine.ts';
import { useEngineStore } from '../store/useEngineStore.ts';
import {
  getFingerMappingFromKeyboard,
  type FingerMapping,
} from './twoHandMapping.ts';

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

export interface InputManagerOptions {
  onFingerPress?: (mapping: FingerMapping) => void;
}

export class InputManager {
  private readonly audioEngine: AudioEngine;
  private readonly getScopeStart: () => number;
  private readonly onFingerPress?: (mapping: FingerMapping) => void;
  private readonly activePhysicalKeys = new Set<string>();
  private cachedScopeStart: number | null = null;
  private cachedKeyMap: Record<string, number> = {};

  private isScopeShiftKey(event: KeyboardEvent): boolean {
    return (
      event.key === 'ArrowRight' ||
      event.code === 'Digit2' ||
      event.key === 'ArrowLeft' ||
      event.code === 'Digit1' ||
      event.key === 'ArrowUp' ||
      event.code === 'Digit3'
    );
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (useEngineStore.getState().engineMode === 'two-hand') {
      if (event.repeat) {
        return;
      }

      const mapping = getFingerMappingFromKeyboard(event);
      if (mapping !== null) {
        if (this.activePhysicalKeys.has(event.code)) {
          return;
        }

        this.activePhysicalKeys.add(event.code);
        void this.audioEngine.warm();
        this.onFingerPress?.(mapping);
        event.preventDefault();
        return;
      }

      if (this.isOneHandNoteKeyCode(event.code)) {
        event.preventDefault();
        return;
      }

      if (this.isScopeShiftKey(event)) {
        event.preventDefault();
        return;
      }
    }

    const midiPitch = this.resolveMidiPitch(event.code);
    if (midiPitch === undefined) {
      return;
    }

    if (this.activePhysicalKeys.has(event.code)) {
      return;
    }

    this.activePhysicalKeys.add(event.code);
    void this.audioEngine.warm();
    practiceEngine.handleNoteOn(midiPitch);

    event.preventDefault();
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (useEngineStore.getState().engineMode === 'two-hand') {
      const mapping = getFingerMappingFromKeyboard(event);
      if (mapping !== null) {
        if (this.activePhysicalKeys.has(event.code)) {
          this.activePhysicalKeys.delete(event.code);
        }

        event.preventDefault();
        return;
      }

      if (this.isOneHandNoteKeyCode(event.code)) {
        event.preventDefault();
        return;
      }
    }

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

  constructor(
    audioEngine: AudioEngine,
    getScopeStart: () => number = () => 60,
    options: InputManagerOptions = {},
  ) {
    this.audioEngine = audioEngine;
    this.getScopeStart = getScopeStart;
    this.onFingerPress = options.onFingerPress;
    practiceEngine.attachAudioEngine(audioEngine);
    window.addEventListener('keydown', this.handleKeyDown, { capture: true });
    window.addEventListener('keyup', this.handleKeyUp, { capture: true });
  }

  destroy(): void {
    window.removeEventListener('keydown', this.handleKeyDown, { capture: true });
    window.removeEventListener('keyup', this.handleKeyUp, { capture: true });
    this.activePhysicalKeys.clear();
  }

  private isOneHandNoteKeyCode(keyCode: string): boolean {
    return this.resolveMidiPitch(keyCode) !== undefined;
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
