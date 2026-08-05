/**
 * Regression: AudioEngine.releaseAll() was a no-op for every play-mode note.
 *
 * Tone's Sampler.triggerAttackRelease calls triggerAttack then triggerRelease
 * synchronously (the release time is only a future ToneBufferSource.stop), and
 * triggerRelease empties that midi's entry in the Sampler's `_activeSources`
 * map. Scheduled voices were therefore absent from the map for their entire
 * sounding life - measured as 0 active sources at all ~200 probes of a real
 * playthrough - so Sampler.releaseAll() had nothing to walk. Every caller that
 * relies on it (stop, seek, jump boundary, stall resync, restart, pause)
 * silently released nothing and notes rang on by their own scheduled release.
 *
 * The Sampler fake below reproduces Tone 15's exact bookkeeping so the test
 * fails against the old implementation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => {
  class FakeSource {
    started = false;
    stops: number[] = [];
    onended: (source: FakeSource) => void = () => {};
    start() {
      this.started = true;
    }
    stop(time: number) {
      this.stops.push(time);
    }
    /** Fire the natural end-of-voice callback Tone invokes after the stop. */
    end() {
      this.onended(this);
    }
  }

  class FakeSampler {
    // Mirrors Tone.Sampler's private map, including its emptying semantics.
    _activeSources = new Map<number, FakeSource[]>();
    allSources: FakeSource[] = [];
    releaseAllCalls: number[] = [];

    triggerAttack(note: string, time: number) {
      const midi = H.noteToMidi(note);
      const source = new FakeSource();
      source.start();
      const sources = this._activeSources.get(midi) ?? [];
      sources.push(source);
      this._activeSources.set(midi, sources);
      this.allSources.push(source);
      source.onended = () => {
        const list = this._activeSources.get(midi);
        const index = list ? list.indexOf(source) : -1;
        if (list && index !== -1) {
          list.splice(index, 1);
        }
      };
      void time;
      return this;
    }

    triggerRelease(note: string, time: number) {
      const midi = H.noteToMidi(note);
      const sources = this._activeSources.get(midi);
      if (sources && sources.length) {
        sources.forEach((source) => source.stop(time));
        this._activeSources.set(midi, []);
      }
      return this;
    }

    releaseAll(time: number) {
      this.releaseAllCalls.push(time);
      this._activeSources.forEach((sources) => {
        while (sources.length) {
          sources.shift()!.stop(time);
        }
      });
      return this;
    }

    dispose() {}
    toDestination() {
      return this;
    }
  }

  const ctx = {
    currentTime: 100,
    lookAhead: 0.1,
    state: 'running' as string,
    rawContext: {
      sampleRate: 44100,
      createBuffer: () => ({}),
      createBufferSource: () => ({ buffer: null, connect() {}, start() {} }),
      destination: {},
    },
    resume: () => Promise.resolve(),
    on() {},
    off() {},
  };

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteToMidi = (note: string): number => {
    const match = /^([A-G]#?)(-?\d+)$/.exec(note);
    if (!match) throw new Error(`bad note ${note}`);
    return (Number(match[2]) + 1) * 12 + NOTE_NAMES.indexOf(match[1]);
  };

  return { ctx, FakeSampler, FakeSource, noteToMidi };
});

vi.mock('tone', () => {
  class FakePolySynth {
    releaseAllCalls: number[] = [];
    triggerAttack() {}
    triggerRelease() {}
    triggerAttackRelease() {}
    releaseAll(time: number) {
      this.releaseAllCalls.push(time);
    }
    dispose() {}
    toDestination() {
      return this;
    }
  }

  return {
    Context: class {
      constructor() {
        return H.ctx as never;
      }
    },
    setContext: () => {},
    getContext: () => H.ctx,
    start: () => Promise.resolve(),
    loaded: () => Promise.resolve(),
    Sampler: H.FakeSampler,
    PolySynth: FakePolySynth,
    Synth: class {},
    Time: (v: unknown) => ({ toSeconds: () => (typeof v === 'number' ? v : 0.5) }),
    getTransport: () => ({ PPQ: 480, bpm: { value: 120 } }),
    getDraw: () => ({ schedule: vi.fn() }),
  };
});

import * as Tone from 'tone';
import { AudioEngine } from './AudioEngine.ts';

type Sources = InstanceType<typeof H.FakeSampler>['allSources'];

function makeEngine(): { engine: AudioEngine; sampler: InstanceType<typeof H.FakeSampler> } {
  const engine = new AudioEngine();
  const sampler = new Tone.Sampler() as unknown as InstanceType<typeof H.FakeSampler>;
  (engine as unknown as { sampler: unknown }).sampler = sampler;
  (engine as unknown as { loaded: boolean }).loaded = true;
  return { engine, sampler };
}

const stoppedAt = (sources: Sources, time: number) =>
  sources.filter((source) => source.stops.some((stop) => stop <= time)).length;

describe('AudioEngine.releaseAll on scheduled play-mode voices', () => {
  beforeEach(() => {
    H.ctx.currentTime = 100;
  });

  it('leaves the Sampler map empty for scheduled notes (the reason releaseAll broke)', () => {
    const { engine, sampler } = makeEngine();
    engine.schedulePlayedNote(60, 4, 101);
    engine.schedulePlayedNote(64, 4, 101);

    const mapped = [...sampler._activeSources.values()].reduce(
      (total, sources) => total + sources.length,
      0,
    );
    expect(mapped).toBe(0);
    // ...and yet both voices are scheduled and still sounding.
    expect(sampler.allSources).toHaveLength(2);
  });

  it('stops every still-sounding scheduled voice now, ahead of its own release', () => {
    const { engine, sampler } = makeEngine();
    // Long notes: their own scheduled stops are far in the future.
    engine.schedulePlayedNote(60, 4, 101);
    engine.schedulePlayedNote(64, 4, 101);
    engine.schedulePlayedNote(67, 4, 101);
    expect(stoppedAt(sampler.allSources, H.ctx.currentTime)).toBe(0);

    engine.releaseAll();

    // A seek/jump must not leave notes ringing: all three are cut at "now".
    expect(stoppedAt(sampler.allSources, H.ctx.currentTime)).toBe(3);
    for (const source of sampler.allSources) {
      expect(source.stops[source.stops.length - 1]).toBe(H.ctx.currentTime);
    }
  });

  it('still releases live (noteOn) voices through the Sampler', () => {
    const { engine, sampler } = makeEngine();
    engine.noteOn(72);
    expect(sampler._activeSources.get(72)).toHaveLength(1);

    engine.releaseAll();
    expect(sampler.releaseAllCalls).toEqual([H.ctx.currentTime]);
    expect(stoppedAt(sampler.allSources, H.ctx.currentTime)).toBe(1);
  });

  it('does not accumulate voice references across a long run', () => {
    const { engine, sampler } = makeEngine();
    const tracked = () =>
      (engine as unknown as { scheduledVoices: Set<unknown> }).scheduledVoices.size;

    for (let i = 0; i < 400; i += 1) {
      engine.schedulePlayedNote(60 + (i % 12), 0.25, 100 + i);
      // Each voice ends normally a moment later.
      sampler.allSources[i].end();
    }

    expect(tracked()).toBe(0);
  });

  it('does not throw when a tracked voice was already disposed', () => {
    const { engine, sampler } = makeEngine();
    engine.schedulePlayedNote(60, 4, 101);
    sampler.allSources[0].stop = () => {
      throw new Error('node is disposed');
    };

    expect(() => engine.releaseAll()).not.toThrow();
  });
});
