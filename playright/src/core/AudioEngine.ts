import * as Tone from 'tone';
import { PIANO_SAMPLE_BASE_URL, PIANO_SAMPLE_URLS } from './pianoSamples.ts';

const MASTER_VOLUME_DB = -14;
const PREVIEW_VOLUME_DB = -12;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

type ToneTime = Tone.Unit.Time;

const audioContext = new Tone.Context({
  latencyHint: 'interactive',
  // Tone's default (100ms). Lower values cut note-on latency but leave almost
  // no room for rolling-window schedule bursts / React / OSMD on dense scores
  // (e.g. unwelcome-school at 180 BPM) before the transport slips.
  lookAhead: 0.1,
});
Tone.setContext(audioContext);

// requestIdleCallback disposal patch lives in audioIdleCallbackPatch.ts (imported
// first from main.tsx so it runs before any Tone module side effects).

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
      // Under E2E, do not block on Tone.start()/audio unlock. Transport
      // scheduling still advances step visuals, and the preview synth is
      // best-effort.
      this.warmPromise =
        import.meta.env.VITE_E2E === '1'
          ? Promise.resolve().then(() => {
              try {
                this.primeOutput();
              } catch {
                // ignore headless audio unlock failures
              }
            })
          : this.prepareAudio();
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

    // Headless browser E2E (`VITE_E2E=1`) skips the remote piano sample fetch.
    // Tone.loaded() otherwise hangs cold runs. Transport + duration math still work.
    // Notes fall back to the lightweight preview synth below.
    if (import.meta.env.VITE_E2E === '1') {
      this.initPromise = Promise.resolve();
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
      release: 0.25,
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

  scheduleAttackRelease(
    midi: number,
    duration: ToneTime,
    time: number,
    velocity = 0.8,
  ): void {
    this.schedulePlayedNote(midi, duration, time, velocity);
  }

  schedulePlayedNote(
    midi: number,
    playDuration: ToneTime,
    time: number,
    velocity = 0.8,
  ): void {
    this.resumeContextIfNeeded();

    const note = midiToNote(midi);
    const playSeconds = Tone.Time(playDuration).toSeconds();

    if (!this.isReady) {
      // In E2E or before the sampler loads, still schedule audible preview
      // tones so headless runs exercise note-on/off timing rather than going
      // fully silent.
      this.previewSynth.triggerAttackRelease(note, playSeconds, time, velocity);
      return;
    }

    // Single attack+release schedule. Consecutive same-pitch gaps come from
    // shortened playSeconds (articulation trim in PlaybackEngine), not an
    // extra pre-attack triggerRelease — that tripled WebAudio graph ops per
    // note and starved the transport on dense 180 BPM textures.
    this.sampler!.triggerAttackRelease(note, playSeconds, time, velocity);
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
