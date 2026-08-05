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
  /**
   * Scheduled play-mode voices that are still sounding (or still pending). See
   * trackScheduledVoice() for why the Sampler's own bookkeeping cannot serve.
   * Bounded by concurrent polyphony: each voice removes itself on `onended`.
   */
  private readonly scheduledVoices = new Set<Tone.ToneBufferSource>();

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
        import.meta.env.VITE_E2E === '1' && import.meta.env.VITE_E2E_AUDIO !== '1'
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
    if (import.meta.env.VITE_E2E === '1' && import.meta.env.VITE_E2E_AUDIO !== '1') {
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

  /**
   * Register the voice `Sampler.triggerAttack` just created so `releaseAll()`
   * can actually stop it.
   *
   * Tone's Sampler drops a voice from its own `_activeSources` map the instant
   * `triggerRelease` is called - and for a scheduled play-mode note that is
   * synchronous with the attack, since the release time is merely a future
   * `ToneBufferSource.stop(time)`. The map is therefore empty for the entire
   * life of every play-mode voice (measured: 0 active sources at every probe
   * during playback), which made `Sampler.releaseAll()` - and so our own
   * releaseAll() - a no-op for exactly the notes seeks and jumps need to cut.
   *
   * Holding our own reference is the only way to reach those voices without
   * either deferring the release to a main-thread timer (note-offs would then
   * ride the same jank that already troubles dense scores) or adding graph ops
   * per note. Reading `_activeSources` is a private-API dependency, deliberately
   * confined to this one guarded read: if a Tone upgrade renames it, tracking
   * degrades to today's behaviour rather than throwing.
   */
  private trackScheduledVoice(midi: number): void {
    const sources = (
      this.sampler as unknown as {
        _activeSources?: Map<number, Tone.ToneBufferSource[]>;
      } | null
    )?._activeSources?.get(midi);
    const source = sources?.[sources.length - 1];
    if (!source) {
      return;
    }

    this.scheduledVoices.add(source);
    // Sampler installs its own onended (splices the voice out of
    // _activeSources). Chain, never replace.
    const samplerOnended = source.onended;
    source.onended = (endedSource) => {
      this.scheduledVoices.delete(source);
      samplerOnended.call(source, endedSource);
    };
  }

  get isReady(): boolean {
    return this.loaded && this.sampler !== null;
  }

  /**
   * Schedule time for LIVE input (practice/program keypresses and previews).
   *
   * Passing `undefined` as Tone's schedule time does NOT mean "now": Tone
   * resolves it through TimeBase.valueOf() -> _noArg() -> Time._now() ->
   * context.now(), and `Context.now()` is `currentTime + lookAhead`. With the
   * 100ms lookAhead this context needs for scheduled playback, every live
   * keypress was being scheduled a full 100ms into the future - measured at
   * exactly 100.0ms from noteOn to the attack time handed to the sampler, on
   * top of the irreducible hardware/OS floor.
   *
   * `context.currentTime` is Tone's `immediate()` - the same clock without the
   * lookAhead - which is what live input wants: render in the next quantum.
   *
   * This deliberately does NOT touch play mode. PlaybackEngine passes explicit
   * transport-derived times to scheduleAttackRelease/schedulePlayedNote, so its
   * lookAhead budget, the rolling schedule window, and the background-throttle
   * resync are all unaffected - verified by a scheduled-path drift assertion.
   */
  private immediateTime(): number {
    return Tone.getContext().currentTime;
  }

  noteOn(midi: number, velocity = 0.8): void {
    this.resumeContextIfNeeded();

    const note = midiToNote(midi);
    const time = this.immediateTime();
    if (this.isReady) {
      this.sampler!.triggerAttack(note, time, velocity);
      return;
    }

    this.previewSynth.triggerAttack(note, time, velocity);
  }

  noteOff(midi: number): void {
    const note = midiToNote(midi);
    const time = this.immediateTime();

    if (this.isReady) {
      this.sampler!.triggerRelease(note, time);
    }

    this.previewSynth.triggerRelease(note, time);
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
    //
    // This is Sampler.triggerAttackRelease inlined verbatim for a single note
    // (it does exactly these two calls with `time` already in seconds), split
    // only so the voice can be registered in between - triggerRelease drops it
    // from the Sampler's map, so afterwards there is nothing left to grab.
    // Identical WebAudio work either way.
    const sampler = this.sampler!;
    sampler.triggerAttack(note, time, velocity);
    this.trackScheduledVoice(midi);
    sampler.triggerRelease(note, time + playSeconds);
  }

  /**
   * Stop every sounding voice now (seek, jump boundary, stall resync, pause,
   * stop, restart). Scheduled voices are stopped through our own registry
   * because the Sampler no longer knows about them; live noteOn voices are
   * still in the Sampler's map, so its releaseAll covers those.
   *
   * `stop(time)` re-targets a voice's already-scheduled stop earlier (Tone's
   * OneShotSource cancels the pending stop first), and the voice's normal
   * fadeOut (= the sampler's 0.25s release) still applies, so this releases
   * notes rather than clicking them off.
   */
  releaseAll(): void {
    const time = this.immediateTime();

    for (const source of this.scheduledVoices) {
      try {
        source.stop(time);
      } catch (err) {
        // A voice disposed between onended and this sweep. Nothing to stop.
        console.debug('[AudioEngine] scheduled voice stop skipped:', err);
      }
    }
    this.scheduledVoices.clear();

    this.sampler?.releaseAll(time);
    this.previewSynth.releaseAll(time);
  }

  destroy(): void {
    this.scheduledVoices.clear();
    this.previewSynth.dispose();
    this.sampler?.dispose();
    this.sampler = null;
    this.initPromise = null;
    this.warmPromise = null;
    this.loaded = false;
  }

  /** True when the browser has suspended or interrupted the audio context. */
  get isContextSuspended(): boolean {
    return Tone.getContext().state !== 'running';
  }

  /**
   * Explicitly resume a browser-suspended context.
   *
   * resumeContextIfNeeded() below cannot cover this on its own: it only runs
   * from noteOn/schedulePlayedNote, and every playback-path call to those
   * originates inside a Tone Transport callback. A suspended context freezes
   * AudioContext.currentTime, so Tone's Clock._loop sees a zero-length elapsed
   * range and stops emitting ticks - no transport callback fires, so nothing
   * ever reaches the lazy resume. A suspended context therefore never
   * self-recovers during playback. This is the external path out of that.
   */
  async resumeContext(): Promise<void> {
    const context = Tone.getContext();
    if (context.state === 'running') {
      return;
    }

    try {
      await context.resume();
    } catch (err) {
      console.warn('[AudioEngine] audio context resume failed:', err);
    }
  }

  /** Subscribe to context state transitions. Returns an unsubscribe function. */
  onContextStateChange(listener: () => void): () => void {
    const context = Tone.getContext();
    context.on('statechange', listener);
    return () => {
      context.off('statechange', listener);
    };
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
