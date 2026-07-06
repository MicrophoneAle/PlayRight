import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngine } from './AudioEngine.ts';
import { InputManager } from './InputManager.ts';
import { practiceEngine } from './PracticeEngine.ts';
import { useEngineStore } from '../store/useEngineStore.ts';
import type { FingerMapping } from './twoHandMapping.ts';

type StubListener = (event: MockKeyboardEvent) => void;

class MockKeyboardEvent {
  readonly type: 'keydown' | 'keyup';
  readonly key: string;
  readonly code: string;
  readonly repeat: boolean;
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  defaultPrevented = false;

  constructor(
    type: 'keydown' | 'keyup',
    init: { key: string; code: string; repeat?: boolean },
  ) {
    this.type = type;
    this.key = init.key;
    this.code = init.code;
    this.repeat = init.repeat ?? false;
    this.bubbles = true;
    this.cancelable = true;
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }
}

function createWindowStub() {
  const listeners = new Map<string, Set<StubListener>>();

  return {
    addEventListener(
      type: string,
      listener: StubListener,
      _options?: boolean | AddEventListenerOptions,
    ): void {
      const bucket = listeners.get(type) ?? new Set<StubListener>();
      bucket.add(listener);
      listeners.set(type, bucket);
    },
    removeEventListener(type: string, listener: StubListener): void {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event: MockKeyboardEvent): boolean {
      const bucket = listeners.get(event.type);
      if (!bucket) {
        return true;
      }

      for (const listener of [...bucket]) {
        listener(event);
      }
      return !event.defaultPrevented;
    },
  };
}

function createMockAudio(): AudioEngine {
  return {
    noteOn: vi.fn(),
    noteOff: vi.fn(),
    warm: vi.fn().mockResolvedValue(undefined),
    init: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
  } as unknown as AudioEngine;
}

function keyEvent(
  type: 'keydown' | 'keyup',
  key: string,
  code: string,
  repeat = false,
): MockKeyboardEvent {
  return new MockKeyboardEvent(type, { key, code, repeat });
}

describe('InputManager two-hand routing', () => {
  let audio: AudioEngine;
  let inputManager: InputManager | null = null;
  let onFingerPress: ReturnType<typeof vi.fn<(mapping: FingerMapping) => void>>;
  let windowStub: ReturnType<typeof createWindowStub>;

  beforeEach(() => {
    windowStub = createWindowStub();
    vi.stubGlobal('window', windowStub);
    useEngineStore.setState({
      engineMode: 'two-hand',
      scopeStartMidi: 60,
    });
    audio = createMockAudio();
    onFingerPress = vi.fn();
    vi.spyOn(practiceEngine, 'handleNoteOn').mockImplementation(() => {});
  });

  afterEach(() => {
    inputManager?.destroy();
    inputManager = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const mount = () => {
    inputManager = new InputManager(audio, () => 60, { onFingerPress });
  };

  it('emits onFingerPress with the correct mapping on finger keydown', () => {
    mount();
    windowStub.dispatchEvent(keyEvent('keydown', 'n', 'KeyN'));

    expect(onFingerPress).toHaveBeenCalledTimes(1);
    expect(onFingerPress).toHaveBeenCalledWith({ hand: 'R', finger: 1 });
  });

  it('suppresses auto-repeat until keyup, then accepts the same key again', () => {
    mount();
    windowStub.dispatchEvent(keyEvent('keydown', 'n', 'KeyN', true));
    expect(onFingerPress).not.toHaveBeenCalled();

    windowStub.dispatchEvent(keyEvent('keydown', 'n', 'KeyN'));
    expect(onFingerPress).toHaveBeenCalledTimes(1);

    windowStub.dispatchEvent(keyEvent('keydown', 'n', 'KeyN'));
    expect(onFingerPress).toHaveBeenCalledTimes(1);

    windowStub.dispatchEvent(keyEvent('keyup', 'n', 'KeyN'));
    windowStub.dispatchEvent(keyEvent('keydown', 'n', 'KeyN'));
    expect(onFingerPress).toHaveBeenCalledTimes(2);
  });

  it('routes simultaneous chord finger keydowns synchronously', () => {
    mount();
    windowStub.dispatchEvent(keyEvent('keydown', 'q', 'KeyQ'));
    windowStub.dispatchEvent(keyEvent('keydown', 'w', 'KeyW'));
    windowStub.dispatchEvent(keyEvent('keydown', 'e', 'KeyE'));

    expect(onFingerPress).toHaveBeenCalledTimes(3);
    expect(onFingerPress.mock.calls.map(([mapping]) => mapping)).toEqual([
      { hand: 'L', finger: 5 },
      { hand: 'L', finger: 4 },
      { hand: 'L', finger: 3 },
    ]);
  });

  it('blocks overlapping one-hand note keys while in two-hand mode', () => {
    mount();
    for (const code of ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyP'] as const) {
      windowStub.dispatchEvent(
        keyEvent('keydown', code.replace('Key', '').toLowerCase(), code),
      );
    }

    expect(onFingerPress).toHaveBeenCalledTimes(5);
    expect(practiceEngine.handleNoteOn).not.toHaveBeenCalled();
  });

  it('does not swallow non-finger keys such as Enter', () => {
    mount();
    const external = vi.fn<(event: MockKeyboardEvent) => void>();
    windowStub.addEventListener('keydown', external);

    const event = keyEvent('keydown', 'Enter', 'Enter');
    windowStub.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(onFingerPress).not.toHaveBeenCalled();
    expect(practiceEngine.handleNoteOn).not.toHaveBeenCalled();
    expect(external).toHaveBeenCalled();
  });

  it('does not intercept finger keys in one-hand mode', () => {
    useEngineStore.setState({ engineMode: 'one-hand', scopeStartMidi: 60 });
    mount();

    windowStub.dispatchEvent(keyEvent('keydown', 'w', 'KeyW'));

    expect(onFingerPress).not.toHaveBeenCalled();
    expect(practiceEngine.handleNoteOn).toHaveBeenCalledTimes(1);
    expect(practiceEngine.handleNoteOn).toHaveBeenCalledWith(61);
  });
});
