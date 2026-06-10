import type { AudioEngine } from './AudioEngine.ts';

/** Physical keys Q through \\ mapped to semitone offsets within the 1-hand window. */
const KEY_TO_SEMITONE_OFFSET: Readonly<Record<string, number>> = {
  KeyQ: 0,
  KeyW: 1,
  KeyE: 2,
  KeyR: 3,
  KeyT: 4,
  KeyY: 5,
  KeyU: 6,
  KeyI: 7,
  KeyO: 8,
  KeyP: 9,
  BracketLeft: 10,
  BracketRight: 11,
  Backslash: 12,
} as const;

/** Base MIDI anchor for the 13-key chromatic window (middle C). */
const BASE_MIDI_PITCH = 60;

const PLAY_KEYS = new Set(Object.keys(KEY_TO_SEMITONE_OFFSET));

export class InputManager {
  private readonly audioEngine: AudioEngine;
  private readonly activePhysicalKeys = new Set<string>();
  private initialized = false;

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!PLAY_KEYS.has(event.code)) {
      return;
    }

    event.preventDefault();

    if (this.activePhysicalKeys.has(event.code)) {
      return;
    }

    void this.ensureInitialized();

    this.activePhysicalKeys.add(event.code);

    const midiPitch = this.resolveMidiPitch(event.code);
    this.audioEngine.triggerNoteOn(midiPitch);
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (!PLAY_KEYS.has(event.code)) {
      return;
    }

    event.preventDefault();

    if (!this.activePhysicalKeys.has(event.code)) {
      return;
    }

    this.activePhysicalKeys.delete(event.code);

    const midiPitch = this.resolveMidiPitch(event.code);
    this.audioEngine.triggerNoteOff(midiPitch);
  };

  constructor(audioEngine: AudioEngine) {
    this.audioEngine = audioEngine;
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

  private resolveMidiPitch(keyCode: string): number {
    const offset = KEY_TO_SEMITONE_OFFSET[keyCode];
    return BASE_MIDI_PITCH + offset;
  }
}
