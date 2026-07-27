import type { Finger, Hand } from '../types/index.ts';

export interface FingerMapping {
  hand: Hand;
  finger: Finger;
}

/** Stable id for a remappable two-hand finger slot (`L:5`, `R:1`, …). */
export type FingerSlotId = `${Hand}:${Finger}`;

export interface BoundPhysicalKey {
  /** Normalized `event.key` (lowercase letter, or `[`). */
  key: string;
  /** Physical `event.code` (KeyQ, BracketLeft, …). */
  code: string;
}

export type TwoHandKeyBindings = Record<FingerSlotId, BoundPhysicalKey>;

export const TWO_HAND_KEY_BINDINGS_STORAGE_KEY = 'playright-two-hand-key-bindings';

export const TWO_HAND_FINGER_SLOTS: readonly FingerSlotId[] = [
  'L:5',
  'L:4',
  'L:3',
  'L:2',
  'L:1',
  'R:1',
  'R:2',
  'R:3',
  'R:4',
  'R:5',
] as const;

/** Default layout: Q W E R V (LH 5→1) and N I O P [ (RH 1→5). */
export const DEFAULT_TWO_HAND_KEY_BINDINGS: TwoHandKeyBindings = {
  'L:5': { key: 'q', code: 'KeyQ' },
  'L:4': { key: 'w', code: 'KeyW' },
  'L:3': { key: 'e', code: 'KeyE' },
  'L:2': { key: 'r', code: 'KeyR' },
  'L:1': { key: 'v', code: 'KeyV' },
  'R:1': { key: 'n', code: 'KeyN' },
  'R:2': { key: 'i', code: 'KeyI' },
  'R:3': { key: 'o', code: 'KeyO' },
  'R:4': { key: 'p', code: 'KeyP' },
  'R:5': { key: '[', code: 'BracketLeft' },
};

/** @deprecated Prefer building maps from active bindings; kept for default snapshots. */
export const TWO_HAND_KEY_MAP: Readonly<Record<string, FingerMapping>> =
  buildKeyMapFromBindings(DEFAULT_TWO_HAND_KEY_BINDINGS);

/** @deprecated Prefer building maps from active bindings. */
export const TWO_HAND_CODE_MAP: Readonly<Record<string, FingerMapping>> =
  buildCodeMapFromBindings(DEFAULT_TWO_HAND_KEY_BINDINGS);

export function parseFingerSlotId(slot: FingerSlotId): FingerMapping {
  const [hand, fingerText] = slot.split(':') as [Hand, string];
  return { hand, finger: Number(fingerText) as Finger };
}

export function fingerSlotId(hand: Hand, finger: Finger): FingerSlotId {
  return `${hand}:${finger}`;
}

export function cloneTwoHandKeyBindings(
  bindings: TwoHandKeyBindings,
): TwoHandKeyBindings {
  const next = {} as TwoHandKeyBindings;
  for (const slot of TWO_HAND_FINGER_SLOTS) {
    next[slot] = { ...bindings[slot] };
  }
  return next;
}

export function buildKeyMapFromBindings(
  bindings: TwoHandKeyBindings,
): Record<string, FingerMapping> {
  const map: Record<string, FingerMapping> = {};
  for (const slot of TWO_HAND_FINGER_SLOTS) {
    map[bindings[slot].key] = parseFingerSlotId(slot);
  }
  return map;
}

export function buildCodeMapFromBindings(
  bindings: TwoHandKeyBindings,
): Record<string, FingerMapping> {
  const map: Record<string, FingerMapping> = {};
  for (const slot of TWO_HAND_FINGER_SLOTS) {
    map[bindings[slot].code] = parseFingerSlotId(slot);
  }
  return map;
}

export function buildFingerToPhysicalKeyMap(
  bindings: TwoHandKeyBindings = DEFAULT_TWO_HAND_KEY_BINDINGS,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const slot of TWO_HAND_FINGER_SLOTS) {
    map.set(slot, bindings[slot].key);
  }
  return map;
}

export function getFingerMapping(
  key: string,
  bindings: TwoHandKeyBindings = DEFAULT_TWO_HAND_KEY_BINDINGS,
): FingerMapping | null {
  return buildKeyMapFromBindings(bindings)[key.toLowerCase()] ?? null;
}

export function getFingerMappingFromKeyboard(
  event: KeyboardEvent,
  bindings: TwoHandKeyBindings = DEFAULT_TWO_HAND_KEY_BINDINGS,
): FingerMapping | null {
  const keyMap = buildKeyMapFromBindings(bindings);
  const codeMap = buildCodeMapFromBindings(bindings);
  return keyMap[event.key.toLowerCase()] ?? codeMap[event.code] ?? null;
}

export function formatBoundKeyLabel(bound: BoundPhysicalKey): string {
  if (bound.key === '[') {
    return '[';
  }
  return bound.key.toUpperCase();
}

export function formatFingerSlotLabel(slot: FingerSlotId): string {
  const { hand, finger } = parseFingerSlotId(slot);
  return `${hand === 'L' ? 'Left' : 'Right'} hand · finger ${finger}`;
}

const BLOCKED_REBIND_CODES = new Set([
  'Escape',
  'Enter',
  'NumpadEnter',
  'Space',
  'Tab',
  'Backspace',
  'Delete',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'MetaLeft',
  'MetaRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'ShiftLeft',
  'ShiftRight',
  'CapsLock',
]);

/**
 * Normalize a KeyboardEvent into a bindable physical key, or null if the key
 * is unsuitable (modifiers, navigation, empty).
 */
export function physicalKeyFromKeyboardEvent(
  event: KeyboardEvent,
): BoundPhysicalKey | null {
  if (BLOCKED_REBIND_CODES.has(event.code)) {
    return null;
  }

  if (event.key === 'Dead' || event.key === 'Unidentified') {
    return null;
  }

  if (event.key.length === 1) {
    return {
      key: event.key.toLowerCase(),
      code: event.code,
    };
  }

  // Rare printable-ish codes without a single-char key (keep bracket via key).
  return null;
}

export type RebindResult =
  | { ok: true; bindings: TwoHandKeyBindings; swappedWith: FingerSlotId | null }
  | { ok: false; reason: 'blocked' | 'same-slot' };

/**
 * Assign `bound` to `slot`. If another slot already uses that physical key,
 * swap the two bindings so every slot stays assigned (standard rebind UX).
 */
export function rebindFingerSlot(
  bindings: TwoHandKeyBindings,
  slot: FingerSlotId,
  bound: BoundPhysicalKey,
): RebindResult {
  const current = bindings[slot];
  if (current.key === bound.key && current.code === bound.code) {
    return { ok: false, reason: 'same-slot' };
  }

  const conflictSlot = TWO_HAND_FINGER_SLOTS.find(
    (candidate) =>
      candidate !== slot &&
      (bindings[candidate].key === bound.key ||
        bindings[candidate].code === bound.code),
  );

  const next = cloneTwoHandKeyBindings(bindings);
  if (conflictSlot) {
    next[conflictSlot] = { ...current };
    next[slot] = { ...bound };
    return { ok: true, bindings: next, swappedWith: conflictSlot };
  }

  next[slot] = { ...bound };
  return { ok: true, bindings: next, swappedWith: null };
}

function isBoundPhysicalKey(value: unknown): value is BoundPhysicalKey {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.key === 'string' && typeof record.code === 'string';
}

export function normalizeTwoHandKeyBindings(
  value: unknown,
): TwoHandKeyBindings {
  if (!value || typeof value !== 'object') {
    return cloneTwoHandKeyBindings(DEFAULT_TWO_HAND_KEY_BINDINGS);
  }

  const raw = value as Record<string, unknown>;
  const next = cloneTwoHandKeyBindings(DEFAULT_TWO_HAND_KEY_BINDINGS);

  for (const slot of TWO_HAND_FINGER_SLOTS) {
    if (isBoundPhysicalKey(raw[slot])) {
      next[slot] = {
        key: raw[slot].key.toLowerCase(),
        code: raw[slot].code,
      };
    }
  }

  // Drop duplicate physical keys by preferring earlier slots, restoring defaults
  // for later collisions so every slot remains unique.
  const seenKeys = new Set<string>();
  const seenCodes = new Set<string>();
  for (const slot of TWO_HAND_FINGER_SLOTS) {
    const bound = next[slot];
    if (seenKeys.has(bound.key) || seenCodes.has(bound.code)) {
      next[slot] = { ...DEFAULT_TWO_HAND_KEY_BINDINGS[slot] };
    }
    seenKeys.add(next[slot].key);
    seenCodes.add(next[slot].code);
  }

  return next;
}

export function readTwoHandKeyBindingsFromStorage(
  storage: Storage | null = typeof window !== 'undefined'
    ? window.localStorage
    : null,
): TwoHandKeyBindings {
  if (!storage) {
    return cloneTwoHandKeyBindings(DEFAULT_TWO_HAND_KEY_BINDINGS);
  }

  try {
    const raw = storage.getItem(TWO_HAND_KEY_BINDINGS_STORAGE_KEY);
    if (!raw) {
      return cloneTwoHandKeyBindings(DEFAULT_TWO_HAND_KEY_BINDINGS);
    }
    return normalizeTwoHandKeyBindings(JSON.parse(raw));
  } catch {
    return cloneTwoHandKeyBindings(DEFAULT_TWO_HAND_KEY_BINDINGS);
  }
}

export function writeTwoHandKeyBindingsToStorage(
  bindings: TwoHandKeyBindings,
  storage: Storage | null = typeof window !== 'undefined'
    ? window.localStorage
    : null,
): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      TWO_HAND_KEY_BINDINGS_STORAGE_KEY,
      JSON.stringify(bindings),
    );
  } catch {
    // Private mode / quota — bindings still apply for this session.
  }
}

export function twoHandKeyBindingsEqual(
  left: TwoHandKeyBindings,
  right: TwoHandKeyBindings,
): boolean {
  return TWO_HAND_FINGER_SLOTS.every(
    (slot) =>
      left[slot].key === right[slot].key && left[slot].code === right[slot].code,
  );
}
