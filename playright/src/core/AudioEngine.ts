import * as Tone from 'tone';
import { PIANO_SAMPLE_BASE_URL, PIANO_SAMPLE_URLS } from './pianoSamples.ts';

const RELEASE_SECONDS = 0.8;
const MASTER_VOLUME_DB = -14;
const PREVIEW_VOLUME_DB = -12;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

function midiToNote(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[midi % 12]}${octave}`;
}

export class AudioEngine {
  private sampler: Tone.Sampler | null = null;
  private previewSynth: Tone.PolySynth<Tone.Synth> | null = null;
  private initPromise: Promise<void> | null = null;
  private loaded = false;

  async init(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.loadSampler();
    return this.initPromise;
  }

  private async loadSampler(): Promise<void> {
    await Tone.start();

    this.sampler = new Tone.Sampler({
      urls: PIANO_SAMPLE_URLS,
      baseUrl: PIANO_SAMPLE_BASE_URL,
      attack: 0,
      release: RELEASE_SECONDS,
      volume: MASTER_VOLUME_DB,
      onerror: (error) => {
        console.error('[AudioEngine] sample load error:', error);
      },
    }).toDestination();

    await Tone.loaded();
    this.loaded = true;
    this.previewSynth?.releaseAll();
    this.previewSynth?.dispose();
    this.previewSynth = null;
  }

  get isReady(): boolean {
    return this.loaded && this.sampler !== null;
  }

  noteOn(midi: number, velocity = 0.8): void {
    const note = midiToNote(midi);
    const time = Tone.now();

    if (this.isReady) {
      this.sampler!.triggerAttack(note, time, velocity);
      return;
    }

    void this.init();
    this.ensurePreviewSynth();
    this.previewSynth!.triggerAttack(note, time, velocity);
  }

  noteOff(midi: number): void {
    const note = midiToNote(midi);
    const time = Tone.now();

    if (this.isReady) {
      this.sampler!.triggerRelease(note, time);
    }

    this.previewSynth?.triggerRelease(note, time);
  }

  releaseAll(): void {
    const time = Tone.now();
    this.sampler?.releaseAll(time);
    this.previewSynth?.releaseAll(time);
  }

  destroy(): void {
    this.previewSynth?.dispose();
    this.previewSynth = null;
    this.sampler?.dispose();
    this.sampler = null;
    this.initPromise = null;
    this.loaded = false;
  }

  private ensurePreviewSynth(): void {
    if (this.previewSynth || this.loaded) {
      return;
    }

    this.previewSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0.25, release: 0.2 },
      volume: PREVIEW_VOLUME_DB,
    }).toDestination();
  }
}
