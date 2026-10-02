import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngine } from './AudioEngine.ts';
import { InputManager } from './InputManager.ts';
import { practiceEngine } from './PracticeEngine.ts';
import { useEngineStore } from '../store/useEngineStore.ts';
import {
  DEFAULT_TWO_HAND_KEY_BINDINGS,
  cloneTwoHandKeyBindings,
  type FingerMapping,
} from './twoHandMapping.ts';

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
  let onFingerRelease: ReturnType<typeof vi.fn<(mapping: FingerMapping) => void>>;
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
    onFingerRelease = vi.fn();
    vi.spyOn(practiceEngine, 'handleNoteOn').mockImplementation(() => {});
  });

  afterEach(() => {
    inputManager?.destroy();
    inputManager = null;
    useEngineStore.setState({
      blockingOverlayCount: 0,
      playMode: false,
      twoHandKeyBindings: cloneTwoHandKeyBindings(DEFAULT_TWO_HAND_KEY_BINDINGS),
    });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const mount = () => {
    inputManager = new InputManager(audio, () => 60, { onFingerPress, onFingerRelease });
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

  it('uses remapped store bindings for finger press routing', () => {
    const remapped = cloneTwoHandKeyBindings(DEFAULT_TWO_HAND_KEY_BINDINGS);
    remapped['R:1'] = { key: 'a', code: 'KeyA' };
    remapped['L:5'] = { key: 'n', code: 'KeyN' };
    useEngineStore.setState({ twoHandKeyBindings: remapped });
    mount();

    windowStub.dispatchEvent(keyEvent('keydown', 'a', 'KeyA'));
    expect(onFingerPress).toHaveBeenCalledWith({ hand: 'R', finger: 1 });

    windowStub.dispatchEvent(keyEvent('keydown', 'n', 'KeyN'));
    expect(onFingerPress).toHaveBeenCalledWith({ hand: 'L', finger: 5 });
  });

  it('ignores finger keys without preventDefault while a modal overlay is open', () => {
    useEngineStore.setState({ blockingOverlayCount: 1 });
    mount();

    const down = keyEvent('keydown', 'n', 'KeyN');
    windowStub.dispatchEvent(down);
    windowStub.dispatchEvent(keyEvent('keyup', 'n', 'KeyN'));
    expect(onFingerPress).not.toHaveBeenCalled();
    expect(onFingerRelease).not.toHaveBeenCalled();
    expect(down.defaultPrevented).toBe(false);
  });

  it('releases a held finger when a modal opens, and ignores its later keyup', () => {
    mount();
    windowStub.dispatchEvent(keyEvent('keydown', 'n', 'KeyN'));
    expect(onFingerPress).toHaveBeenCalledWith({ hand: 'R', finger: 1 });

    useEngineStore.getState().actions.acquireBlockingOverlay();
    expect(onFingerRelease).toHaveBeenCalledTimes(1);
    expect(onFingerRelease).toHaveBeenCalledWith({ hand: 'R', finger: 1 });

    windowStub.dispatchEvent(keyEvent('keyup', 'n', 'KeyN'));
    expect(onFingerRelease).toHaveBeenCalledTimes(1);
  });

  it('blocks one-hand note keys while a modal is open and releases held ones on open', () => {
    useEngineStore.setState({ engineMode: 'one-hand', fingeringMode: 'off', playMode: false });
    const noteOn = vi.mocked(practiceEngine.handleNoteOn);
    const noteOff = vi.spyOn(practiceEngine, 'handleNoteOff').mockImplementation(() => {});
    mount();

    windowStub.dispatchEvent(keyEvent('keydown', 'a', 'KeyA'));
    expect(noteOn).toHaveBeenCalledTimes(1);
    const heldMidi = noteOn.mock.calls[0][0];

    const release = useEngineStore.getState().actions.acquireBlockingOverlay();
    expect(noteOff).toHaveBeenCalledWith(heldMidi);

    windowStub.dispatchEvent(keyEvent('keyup', 'a', 'KeyA'));
    windowStub.dispatchEvent(keyEvent('keydown', 's', 'KeyS'));
    expect(noteOn).toHaveBeenCalledTimes(1);
    expect(noteOff).toHaveBeenCalledTimes(1);

    release();
    windowStub.dispatchEvent(keyEvent('keydown', 's', 'KeyS'));
    expect(noteOn).toHaveBeenCalledTimes(2);
  });

  it('play mode with a modal open leaves non-practice keys alone', () => {
    useEngineStore.setState({ playMode: true, blockingOverlayCount: 1 });
    mount();

    const tab = keyEvent('keydown', 'Tab', 'Tab');
    windowStub.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
  });
});
