import type { AudioEngine } from './AudioEngine.ts';
import { practiceEngine } from './PracticeEngine.ts';
import { useEngineStore } from '../store/useEngineStore.ts';
import {
  getFingerMappingFromKeyboard,
  type FingerMapping,
} from './twoHandMapping.ts';

export const SCOPE_SIZE = 18;
export const PIANO_START_MIDI = 21;
export const PIANO_END_MIDI = 108;

const isBlackKey = (midi: number): boolean =>
  [1, 3, 6, 8, 10].includes(midi % 12);

function findFirstBlackInScope(scopeStart: number): number | null {
  for (let midi = scopeStart; midi < scopeStart + SCOPE_SIZE; midi += 1) {
    if (isBlackKey(midi)) {
      return midi;
    }
  }

  return null;
}

function findLastBlackInScope(scopeStart: number): number | null {
  for (let midi = scopeStart + SCOPE_SIZE - 1; midi >= scopeStart; midi -= 1) {
    if (isBlackKey(midi)) {
      return midi;
    }
  }

  return null;
}

function findRightmostScopeWhiteMidi(
  map: Record<string, number>,
  scopeStart: number,
): number | null {
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
  const scopeEnd = scopeStart + SCOPE_SIZE - 1;
  let rightmost: number | null = null;

  for (const code of whitePhysicals) {
    const midi = map[code];
    if (
      midi !== undefined &&
      midi >= scopeStart &&
      midi <= scopeEnd &&
      (rightmost === null || midi > rightmost)
    ) {
      rightmost = midi;
    }
  }

  return rightmost;
}

function findNextWhiteAbove(midi: number): number | null {
  for (let next = midi + 1; next <= PIANO_END_MIDI; next += 1) {
    if (!isBlackKey(next)) {
      return next;
    }
  }

  return null;
}

function findPreviousWhiteBelow(midi: number): number | null {
  for (let prev = midi - 1; prev >= PIANO_START_MIDI; prev -= 1) {
    if (!isBlackKey(prev)) {
      return prev;
    }
  }

  return null;
}

function findPreviousBlackBelow(midi: number): number | null {
  for (let prev = midi - 1; prev >= PIANO_START_MIDI; prev -= 1) {
    if (isBlackKey(prev)) {
      return prev;
    }
  }

  return null;
}

function findNextBlackAbove(midi: number): number | null {
  for (let next = midi + 1; next <= PIANO_END_MIDI; next += 1) {
    if (isBlackKey(next)) {
      return next;
    }
  }

  return null;
}

function assignEndpointBlack(
  map: Record<string, number>,
  code: string,
  midi: number,
): void {
  if (map[code] === midi) {
    return;
  }

  delete map[code];
  for (const [existingCode, existingMidi] of Object.entries(map)) {
    if (existingMidi === midi) {
      delete map[existingCode];
    }
  }

  map[code] = midi;
}

export function getDynamicKeyMap(scopeStart: number): Record<string, number> {
  const map: Record<string, number> = {};
  const scopeEnd = scopeStart + SCOPE_SIZE - 1;

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

  let whiteIndex = 0;
  for (let midi = scopeStart; midi < scopeStart + SCOPE_SIZE; midi += 1) {
    if (!isBlackKey(midi)) {
      if (whiteIndex < whitePhysicals.length) {
        map[whitePhysicals[whiteIndex]] = midi;
      }
      whiteIndex += 1;
    }
  }

  for (let midi = scopeStart; midi < scopeStart + SCOPE_SIZE; midi += 1) {
    if (isBlackKey(midi)) {
      const rightWhiteMidi = midi + 1;
      const rightWhitePhysical = Object.keys(map).find(
        (key) => map[key] === rightWhiteMidi,
      );
      if (rightWhitePhysical && topLeftMap[rightWhitePhysical]) {
        map[topLeftMap[rightWhitePhysical]] = midi;
      }
    }
  }

  const firstBlackInScope = findFirstBlackInScope(scopeStart);
  if (firstBlackInScope !== null) {
    assignEndpointBlack(map, 'KeyQ', firstBlackInScope);
  }

  const lastBlackInScope = findLastBlackInScope(scopeStart);
  if (lastBlackInScope !== null) {
    assignEndpointBlack(map, 'BracketLeft', lastBlackInScope);
  }

  const lowBlackExtensionMidi =
    map.KeyA !== undefined ? findPreviousBlackBelow(map.KeyA) : null;
  if (
    lowBlackExtensionMidi !== null &&
    !Object.values(map).includes(lowBlackExtensionMidi)
  ) {
    map.Tab = lowBlackExtensionMidi;
  }

  const lowWhiteExtensionMidi =
    map.KeyA !== undefined ? findPreviousWhiteBelow(map.KeyA) : null;
  if (
    lowWhiteExtensionMidi !== null &&
    !Object.values(map).includes(lowWhiteExtensionMidi)
  ) {
    map.CapsLock = lowWhiteExtensionMidi;
  }

  const highWhiteExtensionMidi = (() => {
    const anchorMidi =
      map.Semicolon ??
      findRightmostScopeWhiteMidi(map, scopeStart);
    if (anchorMidi === null) {
      return null;
    }

    return findNextWhiteAbove(anchorMidi);
  })();
  if (
    highWhiteExtensionMidi !== null &&
    !Object.values(map).includes(highWhiteExtensionMidi)
  ) {
    map.Quote = highWhiteExtensionMidi;
  }

  const highBlackExtensionMidi =
    map.Quote !== undefined ? findNextBlackAbove(map.Quote) : null;
  if (
    highBlackExtensionMidi !== null &&
    !Object.values(map).includes(highBlackExtensionMidi)
  ) {
    map.BracketRight = highBlackExtensionMidi;
  }

  const finalMap: Record<string, number> = {};
  for (const key in map) {
    const midi = map[key];
    const inScope = midi >= scopeStart && midi <= scopeEnd;
    const isExtension =
      midi === lowBlackExtensionMidi ||
      midi === highBlackExtensionMidi ||
      midi === highWhiteExtensionMidi ||
      midi === lowWhiteExtensionMidi;

    if (inScope || isExtension) {
      finalMap[key] = midi;
    }
  }

  return finalMap;
}

export function getEffectiveKeyMap(
  scopeStart: number,
  transpose = 0,
): Record<string, number> {
  const base = getDynamicKeyMap(scopeStart);
  if (transpose === 0) {
    return base;
  }

  const effective: Record<string, number> = {};
  for (const [code, midi] of Object.entries(base)) {
    const shiftedMidi = midi + transpose;
    if (
      shiftedMidi >= PIANO_START_MIDI &&
      shiftedMidi <= PIANO_END_MIDI
    ) {
      effective[code] = shiftedMidi;
    }
  }

  return effective;
}

export function normalizeScopePosition(
  scopeStart: number,
  transpose: number,
): { scopeStartMidi: number; scopeTranspose: number } {
  const maxScopeStart = PIANO_END_MIDI - (SCOPE_SIZE - 1);
  let start = scopeStart;
  let offset = transpose;

  for (let attempt = 0; attempt < 200; attempt += 1) {
    const map = getEffectiveKeyMap(start, offset);
    const midis = Object.values(map);
    if (midis.length === 0) {
      break;
    }

    const maxMidi = Math.max(...midis);
    const minMidi = Math.min(...midis);

    if (maxMidi > PIANO_END_MIDI && start < maxScopeStart) {
      start += 1;
      offset -= 1;
      continue;
    }

    if (minMidi < PIANO_START_MIDI && start > PIANO_START_MIDI) {
      start -= 1;
      offset += 1;
      continue;
    }

    break;
  }

  return {
    scopeStartMidi: Math.max(PIANO_START_MIDI, Math.min(start, maxScopeStart)),
    scopeTranspose: offset,
  };
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
    Tab: '↹',
    CapsLock: '⇪',
  };

  return symbols[code] ?? code;
}

export function resolveNoteMidiFromKeyboard(
  event: KeyboardEvent,
  keyMap: Record<string, number>,
): number | undefined {
  const fromCode = keyMap[event.code];
  if (fromCode !== undefined) {
    return fromCode;
  }

  if (event.key === '[' || event.key === '{') {
    return keyMap.BracketLeft;
  }

  if (event.key === ']' || event.key === '}') {
    return keyMap.BracketRight;
  }

  if (event.key === 'Tab') {
    return keyMap.Tab;
  }

  if (event.code === 'CapsLock' || event.key === 'CapsLock') {
    return keyMap.CapsLock;
  }

  if (event.key === "'" || event.key === '"') {
    return keyMap.Quote;
  }

  return undefined;
}

export interface InputManagerOptions {
  onFingerPress?: (mapping: FingerMapping) => void;
  getScopeTranspose?: () => number;
}

export class InputManager {
  private readonly audioEngine: AudioEngine;
  private readonly getScopeStart: () => number;
  private readonly getScopeTranspose: () => number;
  private readonly onFingerPress?: (mapping: FingerMapping) => void;
  private readonly activePhysicalKeys = new Set<string>();
  private cachedScopeStart: number | null = null;
  private cachedTranspose: number | null = null;
  private cachedKeyMap: Record<string, number> = {};

  constructor(
    audioEngine: AudioEngine,
    getScopeStart: () => number = () => 60,
    options: InputManagerOptions = {},
  ) {
    this.audioEngine = audioEngine;
    this.getScopeStart = getScopeStart;
    this.getScopeTranspose = options.getScopeTranspose ?? (() => 0);
    this.onFingerPress = options.onFingerPress;
    practiceEngine.attachAudioEngine(audioEngine);
    window.addEventListener('keydown', this.handleKeyDown, { capture: true });
    window.addEventListener('keyup', this.handleKeyUp, { capture: true });

    useEngineStore.subscribe((state, prevState) => {
      if (
        state.scopeStartMidi !== prevState.scopeStartMidi ||
        state.scopeTranspose !== prevState.scopeTranspose
      ) {
        this.activePhysicalKeys.clear();
        this.cachedScopeStart = null;
        this.cachedTranspose = null;
        return;
      }

      if (
        state.currentStepIndex !== prevState.currentStepIndex &&
        state.isPracticeActive &&
        state.engineMode === 'one-hand'
      ) {
        for (const code of this.activePhysicalKeys) {
          const midi = this.cachedKeyMap[code];
          if (midi !== undefined) {
            practiceEngine.handleNoteOn(midi);
          }
        }
      }
    });
  }

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

    const midiPitch = this.resolveMidiPitch(event);
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

    const midiPitch = this.resolveMidiPitch(event);
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

  destroy(): void {
    window.removeEventListener('keydown', this.handleKeyDown, { capture: true });
    window.removeEventListener('keyup', this.handleKeyUp, { capture: true });
    this.activePhysicalKeys.clear();
  }

  private isOneHandNoteKeyCode(keyCode: string): boolean {
    return this.cachedKeyMap[keyCode] !== undefined;
  }

  private resolveMidiPitch(event: KeyboardEvent): number | undefined {
    const scopeStart = this.getScopeStart();
    const transpose = this.getScopeTranspose();
    if (
      this.cachedScopeStart !== scopeStart ||
      this.cachedTranspose !== transpose
    ) {
      this.cachedScopeStart = scopeStart;
      this.cachedTranspose = transpose;
      this.cachedKeyMap = getEffectiveKeyMap(scopeStart, transpose);
    }

    return resolveNoteMidiFromKeyboard(event, this.cachedKeyMap);
  }
}
