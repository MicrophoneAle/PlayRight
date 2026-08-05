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
    this.installTempProbe();
  }

  /**
   * TEMP DIAGNOSTIC - remove before commit.
   *
   * Per-block RMS measured ON THE AUDIO THREAD, so the trace is immune to
   * main-thread stalls / CPU throttling (unlike an Analyser polled from JS).
   * Each entry is [audioContextTime, rms] for one ~93ms bucket.
   */
  private async installTempAudioThreadTrace(): Promise<void> {
    const trace: Array<[number, number]> = [];
    (window as unknown as { __audioTrace?: unknown }).__audioTrace = trace;
    (window as unknown as { __attackTrace?: unknown }).__attackTrace = [];

    const workletSource = `
      class RmsTap extends AudioWorkletProcessor {
        constructor() {
          super();
          this.sum = 0;
          this.count = 0;
        }
        process(inputs) {
          const ch = inputs[0] && inputs[0][0];
          if (ch) {
            for (let i = 0; i < ch.length; i += 1) {
              this.sum += ch[i] * ch[i];
            }
            this.count += ch.length;
          } else {
            this.count += 128;
          }
          if (this.count >= 4096) {
            this.port.postMessage([currentTime, Math.sqrt(this.sum / this.count)]);
            this.sum = 0;
            this.count = 0;
          }
          return true;
        }
      }
      registerProcessor('rms-tap', RmsTap);
    `;

    try {
      const context = Tone.getContext();
      const url = URL.createObjectURL(
        new Blob([workletSource], { type: 'application/javascript' }),
      );
      await context.addAudioWorkletModule(url);
      URL.revokeObjectURL(url);

      const node = context.createAudioWorkletNode('rms-tap');
      node.port.onmessage = (event: MessageEvent<[number, number]>) => {
        const counters = (
          window as unknown as {
            __voiceCounters?: { started: number; disposed: number };
          }
        ).__voiceCounters;
        const ctx = Tone.getContext() as unknown as {
          _timeouts?: { length: number };
        };
        trace.push([
          event.data[0],
          event.data[1],
          counters ? counters.started - counters.disposed : -1,
          ctx._timeouts?.length ?? -1,
          counters?.started ?? -1,
        ] as unknown as [number, number]);
      };
      // Tap the sampler output. The worklet must still be pulled by the graph,
      // so route it to the destination through a silent gain.
      const silent = new Tone.Gain(0);
      node.connect(silent.input as unknown as AudioNode);
      silent.toDestination();
      this.sampler?.connect(node as unknown as AudioNode);
    } catch (err) {
      console.error('[AudioEngine] TEMP worklet trace failed:', err);
    }
  }

  // TEMP DIAGNOSTIC - remove before commit.
  private installTempProbe(): void {
    if (typeof window === 'undefined') {
      return;
    }
    const sampler = this.sampler as unknown as {
      _activeSources: Map<number, unknown[]>;
    } | null;
    const analyser = new Tone.Analyser({ type: 'waveform', size: 1024 });
    this.sampler?.connect(analyser);
    void this.installTempAudioThreadTrace();

    // TEMP: count voice lifecycle. Sampler voices are ToneBufferSources; a
    // leak shows up as (started - disposed) growing without bound.
    const counters = { started: 0, disposed: 0, onended: 0 };
    (window as unknown as { __voiceCounters?: unknown }).__voiceCounters = counters;
    const proto = Tone.ToneBufferSource.prototype as unknown as {
      start: (...args: unknown[]) => unknown;
      dispose: (...args: unknown[]) => unknown;
      _onended: (...args: unknown[]) => unknown;
      __patched?: boolean;
    };
    if (!proto.__patched) {
      proto.__patched = true;
      const origStart = proto.start;
      const origDispose = proto.dispose;
      const origOnended = proto._onended;
      proto.start = function patchedStart(...args: unknown[]) {
        counters.started += 1;
        return origStart.apply(this, args);
      };
      proto.dispose = function patchedDispose(...args: unknown[]) {
        counters.disposed += 1;
        return origDispose.apply(this, args);
      };
      proto._onended = function patchedOnended(...args: unknown[]) {
        counters.onended += 1;
        return origOnended.apply(this, args);
      };
    }
    (window as unknown as { __audioProbe?: unknown }).__audioProbe = () => {
      const map = sampler?._activeSources;
      let total = 0;
      let keys = 0;
      let maxPerKey = 0;
      if (map) {
        map.forEach((sources) => {
          keys += 1;
          total += sources.length;
          maxPerKey = Math.max(maxPerKey, sources.length);
        });
      }
      const ctx = Tone.getContext();
      const rawCtx = ctx.rawContext as unknown as {
        currentTime: number;
        state: string;
        baseLatency?: number;
      };
      const transport = Tone.getTransport();
      const anyCtx = ctx as unknown as { _timeouts?: { length: number } };
      const wave = analyser.getValue() as Float32Array;
      let sumSquares = 0;
      for (let i = 0; i < wave.length; i += 1) {
        sumSquares += wave[i] * wave[i];
      }
      const rms = Math.sqrt(sumSquares / wave.length);

      return {
        rms,
        attacks: AudioEngine.tempScheduledAttacks,
        samplerLoaded: this.isReady,
        activeSources: total,
        activeKeys: keys,
        maxPerKey,
        ctxState: rawCtx.state,
        ctxTime: rawCtx.currentTime,
        ctxTimeouts: anyCtx._timeouts?.length ?? -1,
        transportTicks: transport.ticks,
        transportState: transport.state,
        transportTimeline:
          (transport as unknown as { _timeline?: { length: number } })._timeline
            ?.length ?? -1,
        transportScheduled: Object.keys(
          (transport as unknown as { _scheduledEvents: Record<string, unknown> })
            ._scheduledEvents,
        ).length,
      };
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
    // TEMP DIAGNOSTIC - remove before commit. Records the SCHEDULED attack
    // time on the audio clock, plus how far in the past/future it was.
    AudioEngine.tempScheduledAttacks += 1;
    const attackTrace = (
      window as unknown as { __attackTrace?: Array<[number, number, number]> }
    ).__attackTrace;
    if (attackTrace) {
      attackTrace.push([
        time,
        midi,
        time - Tone.getContext().rawContext.currentTime,
      ]);
    }
    this.sampler!.triggerAttackRelease(note, playSeconds, time, velocity);
  }

  /** TEMP DIAGNOSTIC - remove before commit. */
  static tempScheduledAttacks = 0;

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
