import type { AudioEngine } from './AudioEngine.ts';
import { practiceEngine } from './PracticeEngine.ts';
import { useEngineStore } from '../store/useEngineStore.ts';
import {
  getFingerMappingFromKeyboard,
  type FingerMapping,
} from './twoHandMapping.ts';

export const SCOPE_SIZE = 17;
/** Chromatic span from Tab through ] when all extension keys are present. */
export const FULL_SCOPE_SIZE = 21;
export const PIANO_START_MIDI = 21;
export const PIANO_END_MIDI = 108;

export const CORE_WHITE_PHYSICALS = [
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
] as const;

export const CORE_BLACK_PHYSICALS = [
  'KeyQ',
  'KeyW',
  'KeyE',
  'KeyR',
  'KeyT',
  'KeyY',
  'KeyU',
  'KeyI',
  'KeyO',
  'KeyP',
  'BracketLeft',
] as const;

export const EXTENSION_PHYSICALS = [
  'Tab',
  'CapsLock',
  'Quote',
  'BracketRight',
] as const;

/** Blacks that sit between two mapped whites in keyboard order. */
const BLACKS_BETWEEN_WHITES: ReadonlyArray<{
  code: (typeof CORE_BLACK_PHYSICALS)[number];
  left: string;
  right: string;
}> = [
  { code: 'KeyQ', left: 'CapsLock', right: 'KeyA' },
  { code: 'KeyW', left: 'KeyA', right: 'KeyS' },
  { code: 'KeyE', left: 'KeyS', right: 'KeyD' },
  { code: 'KeyR', left: 'KeyD', right: 'KeyF' },
  { code: 'KeyT', left: 'KeyF', right: 'KeyG' },
  { code: 'KeyY', left: 'KeyG', right: 'KeyH' },
  { code: 'KeyU', left: 'KeyH', right: 'KeyJ' },
  { code: 'KeyI', left: 'KeyJ', right: 'KeyK' },
  { code: 'KeyO', left: 'KeyK', right: 'KeyL' },
  { code: 'KeyP', left: 'KeyL', right: 'Semicolon' },
  { code: 'BracketLeft', left: 'Semicolon', right: 'Quote' },
];

const isBlackKey = (midi: number): boolean =>
  [1, 3, 6, 8, 10].includes(midi % 12);

export function isBlackKeyMidi(midi: number): boolean {
  return isBlackKey(midi);
}

export function isWhiteRowCode(code: string): boolean {
  return (
    (CORE_WHITE_PHYSICALS as readonly string[]).includes(code) ||
    code === 'CapsLock' ||
    code === 'Quote'
  );
}

export function isBlackRowCode(code: string): boolean {
  return (
    (CORE_BLACK_PHYSICALS as readonly string[]).includes(code) ||
    code === 'Tab' ||
    code === 'BracketRight'
  );
}

function getBlackBetween(leftWhite: number, rightWhite: number): number | null {
  for (let midi = leftWhite + 1; midi < rightWhite; midi += 1) {
    if (isBlackKey(midi)) {
      return midi;
    }
  }

  return null;
}

function getBlacksInScope(scopeStart: number, scopeEnd: number): number[] {
  const blacks: number[] = [];

  for (let midi = scopeStart; midi <= scopeEnd; midi += 1) {
    if (isBlackKey(midi)) {
      blacks.push(midi);
    }
  }

  return blacks;
}

export function getCoreAnchorMidis(
  scopeStart: number,
): {
  lowWhite: number | undefined;
  highWhite: number | undefined;
  lowBlack: number | undefined;
  highBlack: number | undefined;
} {
  const map = getDynamicKeyMap(scopeStart);

  return {
    lowWhite: map.KeyA,
    highWhite: map.Semicolon,
    lowBlack: map.KeyQ,
    highBlack: map.BracketLeft,
  };
}

function findNextWhiteAbove(midi: number): number | null {
  for (let next = midi + 1; next <= PIANO_END_MIDI; next += 1) {
    if (!isBlackKey(next)) {
      return next;
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

function shiftAlongRow(midi: number, steps: number, wantBlack: boolean): number | null {
  if (steps === 0) {
    return midi;
  }

  const direction = steps > 0 ? 1 : -1;
  let remaining = Math.abs(steps);
  let current = midi;

  while (remaining > 0) {
    current += direction;

    if (current < PIANO_START_MIDI || current > PIANO_END_MIDI) {
      return null;
    }

    if (isBlackKey(current) === wantBlack) {
      remaining -= 1;
    }
  }

  return current;
}

export function isMidiInCoreScope(midi: number, scopeStart: number): boolean {
  return midi >= scopeStart && midi <= scopeStart + SCOPE_SIZE - 1;
}

export function getFullScopeMidiBounds(
  keyMap: Record<string, number>,
): { min: number; max: number } | null {
  const values = Object.values(keyMap);
  if (values.length === 0) {
    return null;
  }

  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

export function isMidiInFullScope(
  midi: number,
  keyMap: Record<string, number>,
): boolean {
  const bounds = getFullScopeMidiBounds(keyMap);
  if (bounds === null) {
    return false;
  }

  return midi >= bounds.min && midi <= bounds.max;
}

export function getExtensionMidis(
  keyMap: Record<string, number>,
): Set<number> {
  const midis = new Set<number>();

  for (const code of EXTENSION_PHYSICALS) {
    const midi = keyMap[code];
    if (midi !== undefined) {
      midis.add(midi);
    }
  }

  return midis;
}

export function getDynamicKeyMap(scopeStart: number): Record<string, number> {
  const scopeEnd = scopeStart + SCOPE_SIZE - 1;
  const map: Record<string, number> = {};

  const whitesInScope: number[] = [];

  for (let midi = scopeStart; midi <= scopeEnd; midi += 1) {
    if (!isBlackKey(midi)) {
      whitesInScope.push(midi);
    }
  }

  CORE_WHITE_PHYSICALS.forEach((code, index) => {
    if (index < whitesInScope.length) {
      map[code] = whitesInScope[index];
    }
  });

  if (map.KeyA === undefined) {
    return map;
  }

  const lowWhite = findPreviousWhiteBelow(map.KeyA);
  if (lowWhite !== null) {
    map.CapsLock = lowWhite;
  }

  if (map.CapsLock !== undefined) {
    const tabBlack = findPreviousBlackBelow(map.CapsLock);
    if (tabBlack !== null) {
      map.Tab = tabBlack;
    }
  } else {
    const tabBlack = findPreviousBlackBelow(map.KeyA);
    if (tabBlack !== null) {
      map.Tab = tabBlack;
    }
  }

  if (map.Semicolon !== undefined) {
    const highWhite = findNextWhiteAbove(map.Semicolon);
    if (highWhite !== null && highWhite <= PIANO_END_MIDI) {
      map.Quote = highWhite;
    }
  }

  for (const { code, left, right } of BLACKS_BETWEEN_WHITES) {
    const leftMidi = map[left];
    const rightMidi = map[right];

    if (leftMidi === undefined || rightMidi === undefined) {
      continue;
    }

    const blackMidi = getBlackBetween(leftMidi, rightMidi);
    if (blackMidi !== null) {
      map[code] = blackMidi;
    }
  }

  if (map.BracketLeft === undefined && map.Semicolon !== undefined) {
    const blacksInScope = getBlacksInScope(scopeStart, scopeEnd);
    if (blacksInScope.length > 0) {
      map.BracketLeft = blacksInScope[blacksInScope.length - 1];
    }
  }

  if (map.BracketLeft !== undefined) {
    const highBlack = findNextBlackAbove(map.BracketLeft);
    if (highBlack !== null && highBlack <= PIANO_END_MIDI) {
      map.BracketRight = highBlack;
    }
  }

  return map;
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
    const shiftedMidi = isWhiteRowCode(code)
      ? shiftAlongRow(midi, transpose, false)
      : shiftAlongRow(midi, transpose, true);

    if (
      shiftedMidi !== null &&
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

export function getLabelForKeyMapMidi(
  midi: number,
  onBlackPianoKey: boolean,
  keyMap: Record<string, number>,
): string | undefined {
  for (const [code, mappedMidi] of Object.entries(keyMap)) {
    if (mappedMidi !== midi) {
      continue;
    }

    if (onBlackPianoKey && isBlackRowCode(code)) {
      return formatKeyCode(code);
    }

    if (!onBlackPianoKey && isWhiteRowCode(code)) {
      return formatKeyCode(code);
    }
  }

  return undefined;
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
