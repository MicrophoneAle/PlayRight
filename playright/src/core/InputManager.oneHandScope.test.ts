import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngine } from './AudioEngine.ts';
import { InputManager } from './InputManager.ts';
import { practiceEngine } from './PracticeEngine.ts';
import type { PlaybackScript } from '../types/index.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

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
): MockKeyboardEvent {
  return new MockKeyboardEvent(type, { key, code });
}

function loadChordScript(): void {
  const script: PlaybackScript = [
    {
      order: 0,
      onset: 0,
      measureNumber: 1,
      notes: [
        { pitch: 'C4', midi: 60, hand: 'R', finger: 1 },
        { pitch: 'E4', midi: 64, hand: 'R', finger: 3 },
      ],
    },
    {
      order: 1,
      onset: 480,
      measureNumber: 1,
      notes: [{ pitch: 'G4', midi: 67, hand: 'R', finger: 5 }],
    },
  ];

  useEngineStore.getState().actions.loadScript(script, '<score/>', 'test');
}

describe('InputManager one-hand scope persistence', () => {
  let audio: AudioEngine;
  let inputManager: InputManager | null = null;
  let windowStub: ReturnType<typeof createWindowStub>;
  let noteOnSpy: ReturnType<typeof vi.spyOn>;
  let noteOffSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    windowStub = createWindowStub();
    vi.stubGlobal('window', windowStub);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    useEngineStore.getState().actions.clearScript();
    useEngineStore.setState({
      engineMode: 'one-hand',
      activeHand: 'R',
      scopeStartMidi: 60,
      scopeTranspose: 0,
      isPracticeActive: false,
      hasPracticeStarted: false,
      currentStepIndex: 0,
      expectedMidiNotes: [],
    });

    audio = createMockAudio();
    practiceEngine.attachAudioEngine(audio);
    noteOnSpy = vi.spyOn(practiceEngine, 'handleNoteOn');
    noteOffSpy = vi.spyOn(practiceEngine, 'handleNoteOff');
  });

  afterEach(() => {
    inputManager?.destroy();
    inputManager = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const mount = () => {
    inputManager = new InputManager(audio, () => useEngineStore.getState().scopeStartMidi, {
      getScopeTranspose: () => useEngineStore.getState().scopeTranspose,
    });
  };

  it('does not re-attack or register an extra practice hit when scope shifts while a key is held', () => {
    loadChordScript();
    practiceEngine.start();
    mount();

    windowStub.dispatchEvent(keyEvent('keydown', 'a', 'KeyA'));

    expect(noteOnSpy).toHaveBeenCalledTimes(1);
    expect(noteOnSpy).toHaveBeenCalledWith(60);
    expect(useEngineStore.getState().currentStepIndex).toBe(0);

    useEngineStore.getState().actions.setScopeStart(66);

    expect(noteOnSpy).toHaveBeenCalledTimes(1);
    expect(noteOffSpy).not.toHaveBeenCalled();
    expect(useEngineStore.getState().currentStepIndex).toBe(0);
  });

  it('releases the originally attacked pitch after a scope shift on keyup', () => {
    loadChordScript();
    practiceEngine.start();
    mount();

    windowStub.dispatchEvent(keyEvent('keydown', 'a', 'KeyA'));
    useEngineStore.getState().actions.setScopeStart(66);
    windowStub.dispatchEvent(keyEvent('keyup', 'a', 'KeyA'));

    expect(noteOffSpy).toHaveBeenCalledTimes(1);
    expect(noteOffSpy).toHaveBeenCalledWith(60);
    expect(noteOffSpy).not.toHaveBeenCalledWith(66);
  });
});
