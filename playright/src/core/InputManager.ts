import type { AudioEngine } from './AudioEngine.ts';
import { practiceEngine } from './PracticeEngine.ts';
import { useEngineStore } from '../store/useEngineStore.ts';
import {
  getFingerMappingFromKeyboard,
  type FingerMapping,
} from './twoHandMapping.ts';

export const SCOPE_SIZE = 17;
/** Semitones below scopeStart shown in the display window (Shift through Tab). */
export const LOW_EXTENSION_OFFSET = 3;
/** Fallback Tab slot when not derived from Caps Lock. */
export const TAB_SLOT_OFFSET = 2;
/** Semitones above scopeEnd reserved for Quote (white). */
export const HIGH_EXTENSION_OFFSET = 1;
/** Semitones above scopeEnd reserved for ] (black). */
export const HIGH_BRACKET_OFFSET = 2;
/** Chromatic span from Shift through ]: 17 core + 3 low + 2 high. */
export const FULL_SCOPE_SIZE =
  SCOPE_SIZE + LOW_EXTENSION_OFFSET + HIGH_BRACKET_OFFSET;
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
  'ShiftLeft',
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
    code === 'ShiftLeft' ||
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

function findBlackLeftOf(midi: number): number | null {
  for (let prev = midi - 1; prev >= PIANO_START_MIDI; prev -= 1) {
    if (isBlackKey(prev)) {
      return prev;
    }
  }

  return null;
}

function findWhiteLeftOf(midi: number): number | null {
  for (let prev = midi - 1; prev >= PIANO_START_MIDI; prev -= 1) {
    if (!isBlackKey(prev)) {
      return prev;
    }
  }

  return null;
}

function findNextWhite(midi: number): number | null {
  for (let candidate = midi; candidate <= PIANO_END_MIDI; candidate += 1) {
    if (!isBlackKey(candidate)) {
      return candidate;
    }
  }

  return null;
}

function assignShiftLeft(map: Record<string, number>): void {
  if (map.CapsLock === undefined) {
    return;
  }

  const shiftMidi = findWhiteLeftOf(map.CapsLock);
  if (shiftMidi !== null) {
    map.ShiftLeft = shiftMidi;
  }
}

function assignLowExtensions(map: Record<string, number>, scopeStart: number): void {
  if (map.KeyA === undefined) {
    return;
  }

  const capsSeed =
    scopeStart - 1 >= PIANO_START_MIDI &&
    scopeStart - 1 < map.KeyA &&
    !isBlackKey(scopeStart - 1)
      ? scopeStart - 1
      : undefined;

  if (capsSeed !== undefined) {
    map.CapsLock = capsSeed;

    const qMidi = getBlackBetween(capsSeed, map.KeyA);
    if (qMidi !== null) {
      map.KeyQ = qMidi;

      const tabMidi = findBlackLeftOf(capsSeed);
      if (tabMidi !== null && tabMidi !== map.KeyQ) {
        map.Tab = tabMidi;
      }
    } else {
      const tabMidi = findBlackLeftOf(map.KeyA);
      if (tabMidi !== null && tabMidi < map.KeyA) {
        map.Tab = tabMidi;
      }
    }

    assignShiftLeft(map);
  } else {
    const qMidi = findBlackLeftOf(map.KeyA);
    if (qMidi === null) {
      return;
    }

    map.KeyQ = qMidi;

    const capsMidi = findWhiteLeftOf(qMidi);
    if (capsMidi !== null) {
      map.CapsLock = capsMidi;
    }

    if (map.CapsLock !== undefined) {
      const tabMidi = findBlackLeftOf(map.CapsLock);
      if (tabMidi !== null && tabMidi !== map.KeyQ) {
        map.Tab = tabMidi;
      }
    }

    assignShiftLeft(map);
  }

  const tabSlot = scopeStart - TAB_SLOT_OFFSET;
  if (
    map.Tab === undefined &&
    tabSlot >= PIANO_START_MIDI &&
    isBlackKey(tabSlot) &&
    tabSlot < (map.CapsLock ?? map.KeyA) &&
    tabSlot !== map.KeyQ
  ) {
    map.Tab = tabSlot;
  }
}

function assignHighExtensions(
  map: Record<string, number>,
  scopeEnd: number,
  whitesInScope: number[],
): void {
  if (
    map.Semicolon === undefined &&
    whitesInScope.length >= 9 &&
    map.KeyL !== undefined
  ) {
    const tenthWhite = findNextWhite(whitesInScope[8]! + 1);
    if (
      tenthWhite !== null &&
      tenthWhite <= scopeEnd + HIGH_BRACKET_OFFSET
    ) {
      map.Semicolon = tenthWhite;
    }
  }

  let quoteMidi: number | null = null;

  if (map.Semicolon !== undefined) {
    quoteMidi = findNextWhite(map.Semicolon + 1);
  } else {
    const quoteCandidate = scopeEnd + HIGH_EXTENSION_OFFSET;
    if (quoteCandidate <= PIANO_END_MIDI) {
      quoteMidi = isBlackKey(quoteCandidate)
        ? findNextWhite(quoteCandidate + 1)
        : quoteCandidate;
    }
  }

  if (
    quoteMidi !== null &&
    quoteMidi <= PIANO_END_MIDI &&
    !isBlackKey(quoteMidi) &&
    (map.Semicolon === undefined || quoteMidi > map.Semicolon)
  ) {
    map.Quote = quoteMidi;
  }
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
    lowBlack: map.KeyQ ?? map.Tab,
    highBlack: map.BracketLeft,
  };
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

export function getDisplayScopeMidiBounds(scopeStart: number): {
  min: number;
  max: number;
} {
  const scopeEnd = scopeStart + SCOPE_SIZE - 1;

  return {
    min: Math.max(PIANO_START_MIDI, scopeStart - LOW_EXTENSION_OFFSET),
    max: Math.min(PIANO_END_MIDI, scopeEnd + HIGH_BRACKET_OFFSET),
  };
}

export function isMidiInDisplayScope(
  midi: number,
  scopeStart: number,
): boolean {
  const { min, max } = getDisplayScopeMidiBounds(scopeStart);
  return midi >= min && midi <= max;
}

export function filterKeyMapToDisplayScope(
  keyMap: Record<string, number>,
  scopeStart: number,
): Record<string, number> {
  const { min, max } = getDisplayScopeMidiBounds(scopeStart);
  const filtered: Record<string, number> = {};

  for (const [code, midi] of Object.entries(keyMap)) {
    if (midi >= min && midi <= max) {
      filtered[code] = midi;
    }
  }

  return filtered;
}

export function getScopeKeyMap(
  scopeStart: number,
  transpose = 0,
): Record<string, number> {
  return filterKeyMapToDisplayScope(
    getEffectiveKeyMap(scopeStart, transpose),
    scopeStart,
  );
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

  assignLowExtensions(map, scopeStart);
  assignHighExtensions(map, scopeEnd, whitesInScope);

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

  const bracketSlot = scopeEnd + HIGH_BRACKET_OFFSET;
  if (bracketSlot <= PIANO_END_MIDI && isBlackKey(bracketSlot)) {
    map.BracketRight = bracketSlot;
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
    ShiftLeft: '⇧',
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

  if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
    return keyMap.ShiftLeft;
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
        this.releaseHeldKeys();
        this.cachedScopeStart = null;
        this.cachedTranspose = null;
      }
    });
  }

  private getActiveMidis(): number[] {
    const midis: number[] = [];

    for (const code of this.activePhysicalKeys) {
      const midi = this.cachedKeyMap[code];
      if (midi !== undefined) {
        midis.push(midi);
      }
    }

    return midis;
  }

  private releaseHeldKeys(): void {
    for (const midi of this.getActiveMidis()) {
      practiceEngine.handleNoteOff(midi);
    }

    this.activePhysicalKeys.clear();
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
    const state = useEngineStore.getState();
    if (state.playMode) {
      if (event.repeat) {
        return;
      }

      if (this.isBlockedPracticeKey(event)) {
        event.preventDefault();
      }

      return;
    }

    if (state.engineMode === 'two-hand') {
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
    const state = useEngineStore.getState();
    if (state.playMode) {
      if (this.isBlockedPracticeKey(event)) {
        event.preventDefault();
      }

      return;
    }

    if (state.engineMode === 'two-hand') {
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
    practiceEngine.handleNoteOff(midiPitch);
  };

  private isBlockedPracticeKey(event: KeyboardEvent): boolean {
    if (this.isScopeShiftKey(event)) {
      return true;
    }

    if (useEngineStore.getState().engineMode === 'two-hand') {
      return (
        getFingerMappingFromKeyboard(event) !== null ||
        this.isOneHandNoteKeyCode(event.code)
      );
    }

    return this.resolveMidiPitch(event) !== undefined;
  }

  destroy(): void {
    this.releaseHeldKeys();
    window.removeEventListener('keydown', this.handleKeyDown, { capture: true });
    window.removeEventListener('keyup', this.handleKeyUp, { capture: true });
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
      this.cachedKeyMap = getScopeKeyMap(scopeStart, transpose);
    }

    return resolveNoteMidiFromKeyboard(event, this.cachedKeyMap);
  }
}
