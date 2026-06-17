import * as Tone from 'tone';
import { PIANO_SAMPLE_BASE_URL, PIANO_SAMPLE_URLS } from './pianoSamples.ts';

const RELEASE_SECONDS = 0.8;
const MASTER_VOLUME_DB = -14;
const PREVIEW_VOLUME_DB = -12;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

const audioContext = new Tone.Context({
  latencyHint: 'interactive',
  lookAhead: 0.02,
});
Tone.setContext(audioContext);

function midiToNote(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[midi % 12]}${octave}`;
}

export class AudioEngine {
  private sampler: Tone.Sampler | null = null;
  private readonly previewSynth: Tone.PolySynth<Tone.Synth>;
  private initPromise: Promise<void> | null = null;
  private warmPromise: Promise<void> | null = null;
  private loaded = false;

  constructor() {
    this.previewSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0, decay: 0.02, sustain: 0.8, release: 0.08 },
      volume: PREVIEW_VOLUME_DB,
    }).toDestination();
  }

  warm(): Promise<void> {
    if (!this.warmPromise) {
      this.warmPromise = this.prepareAudio();
    }
    return this.warmPromise;
  }

  private async prepareAudio(): Promise<void> {
    await Tone.start();
    this.primeOutput();
  }

  async init(): Promise<void> {
    await this.warm();
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.loadSampler();
    return this.initPromise;
  }

  private async loadSampler(): Promise<void> {
    if (this.sampler) {
      return;
    }

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
    this.previewSynth.releaseAll();
  }

  get isReady(): boolean {
    return this.loaded && this.sampler !== null;
  }

  noteOn(midi: number, velocity = 0.8): void {
    this.resumeContextIfNeeded();

    const note = midiToNote(midi);
    if (this.isReady) {
      this.sampler!.triggerAttack(note, undefined, velocity);
      return;
    }

    this.previewSynth.triggerAttack(note, undefined, velocity);
  }

  noteOff(midi: number): void {
    const note = midiToNote(midi);

    if (this.isReady) {
      this.sampler!.triggerRelease(note, undefined);
    }

    this.previewSynth.triggerRelease(note, undefined);
  }

  releaseAll(): void {
    this.sampler?.releaseAll();
    this.previewSynth.releaseAll();
  }

  destroy(): void {
    this.previewSynth.dispose();
    this.sampler?.dispose();
    this.sampler = null;
    this.initPromise = null;
    this.warmPromise = null;
    this.loaded = false;
  }

  private resumeContextIfNeeded(): void {
    const context = Tone.getContext();
    if (context.state !== 'running') {
      void context.resume();
    }
  }

  private primeOutput(): void {
    const rawContext = Tone.getContext().rawContext;
    const buffer = rawContext.createBuffer(1, 1, rawContext.sampleRate);
    const source = rawContext.createBufferSource();
    source.buffer = buffer;
    source.connect(rawContext.destination);
    source.start();
  }
}
