import * as Tone from 'tone';
import { PIANO_SAMPLE_BASE_URL, PIANO_SAMPLE_URLS } from './pianoSamples.ts';

const RELEASE_SECONDS = 0.8;
const MASTER_VOLUME_DB = -14;

export class AudioEngine {
  private sampler: Tone.Sampler | null = null;
  private initialized = false;
  private loaded = false;

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.initialized = true;

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
  }

  get isReady(): boolean {
    return this.loaded && this.sampler !== null;
  }

  noteOn(midi: number, velocity = 0.8): void {
    if (!this.isReady) {
      return;
    }

    const note = Tone.Frequency(midi, 'midi').toNote();
    this.sampler!.triggerAttack(note, undefined, velocity);
  }

  noteOff(midi: number): void {
    if (!this.isReady) {
      return;
    }

    const note = Tone.Frequency(midi, 'midi').toNote();
    this.sampler!.triggerRelease(note);
  }

  releaseAll(): void {
    if (!this.isReady) {
      return;
    }

    this.sampler!.releaseAll();
  }

  destroy(): void {
    this.sampler?.dispose();
    this.sampler = null;
    this.initialized = false;
    this.loaded = false;
  }
}
