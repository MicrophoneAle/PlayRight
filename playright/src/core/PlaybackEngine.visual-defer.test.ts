import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const transportTicks = vi.hoisted(() => ({ value: 0 }));
const scheduledByTime = vi.hoisted(
  () => new Map<string, Array<(time: number) => void>>(),
);

vi.mock('tone', () => ({
  getTransport: () => ({
    PPQ: 480,
    bpm: { value: 120 },
    get ticks() {
      return transportTicks.value;
    },
    set ticks(value: number) {
      transportTicks.value = value;
    },
    start: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    scheduleOnce: (callback: (time: number) => void, time: string | number) => {
      const key = String(time);
      const list = scheduledByTime.get(key) ?? [];
      list.push(callback);
      scheduledByTime.set(key, list);
      return list.length;
    },
    clear: vi.fn(),
    cancel: vi.fn(),
  }),
  getDraw: () => ({ schedule: vi.fn() }),
}));

import { PlaybackEngine } from './PlaybackEngine.ts';
import { parseMusicXmlToScript } from './parser/index.ts';
import { isRepeatedPlaybackAttack, isSamePitchReattack } from './playbackTiming.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

async function loadTetorisScript() {
  const JSZip = (await import('jszip')).default;
  const buffer = readFileSync(new URL('../assets/tetoris.mxl', import.meta.url));
  const archive = await JSZip.loadAsync(buffer);
  const scoreXml = await archive.file('score.xml')?.async('string');
  if (!scoreXml) throw new Error('tetoris.mxl missing score.xml');
  return parseMusicXmlToScript(scoreXml);
}

describe('PlaybackEngine visual-defer gate (fix #1 + #2)', () => {
  beforeEach(() => {
    transportTicks.value = 0;
    scheduledByTime.clear();
    vi.useRealTimers();
  });

  it('gates the 40ms defer on isRepeatedPlaybackAttack, not the broader isSamePitchReattack', async () => {
    const { script, scoreTiming } = await loadTetorisScript();

    let broadCount = 0;
    let narrowCount = 0;
    let totalAttacks = 0;
    for (let stepIndex = 0; stepIndex < script.length; stepIndex += 1) {
      for (const note of script[stepIndex].notes) {
        totalAttacks += 1;
        if (isSamePitchReattack(script, stepIndex, note)) broadCount += 1;
        if (isRepeatedPlaybackAttack(script, stepIndex, note)) narrowCount += 1;
      }
    }

    // Confirms the old gate was far broader than the new one on a real fixture.
    expect(broadCount / totalAttacks).toBeGreaterThan(0.5);
    expect(narrowCount / totalAttacks).toBeLessThan(0.2);

    useEngineStore.setState({
      script,
      scoreTiming,
      playMode: true,
      currentStepIndex: 0,
      playingMidiNotes: [],
      playingPlaybackNotes: [],
      isPlaybackActive: false,
      isPlaybackFinished: false,
      isPlaybackPaused: false,
    });

    const engine = new PlaybackEngine();
    engine.attachAudioEngine({
      warm: async () => {},
      init: async () => {},
      scheduleAttackRelease: vi.fn(),
      noteOff: vi.fn(),
    } as never);

    await engine.play();
    (engine as unknown as { isPlaying: boolean }).isPlaying = true;

    // Fire every scheduled step-attack callback (deferred presses go through
    // setTimeout, counted separately below) to see which pressPlayingNote path
    // each attack actually takes at runtime.
    let immediatePresses = 0;
    const pressSpy = vi.spyOn(
      engine as unknown as { pressPlayingNote: (...a: unknown[]) => void },
      'pressPlayingNote',
    );
    const deferSpy = vi.spyOn(
      engine as unknown as { deferRepeatedPress: (...a: unknown[]) => void },
      'deferRepeatedPress',
    );

    for (const callbacks of scheduledByTime.values()) {
      for (const cb of callbacks) {
        cb(0);
      }
    }

    immediatePresses = pressSpy.mock.calls.length;
    const deferredPresses = deferSpy.mock.calls.length;
    const total = immediatePresses + deferredPresses;
    const deferredFraction = deferredPresses / total;

    console.log(
      `[visual-defer] tetoris runtime: total=${total} immediate=${immediatePresses} deferred=${deferredPresses} (${(100 * deferredFraction).toFixed(1)}%)`,
    );

    // Before the fix this was ~96%; after, it should track narrowCount/totalAttacks (~10%).
    expect(deferredFraction).toBeLessThan(0.2);
    expect(deferredFraction).toBeCloseTo(narrowCount / totalAttacks, 1);
  }, 20000);

  it('does not re-light a highlight whose release already fired before the deferred press timeout (fix #2)', () => {
    vi.useFakeTimers();

    useEngineStore.setState({
      playingMidiNotes: [],
      playingPlaybackNotes: [],
    });

    const engine = new PlaybackEngine();
    type EngineInternals = {
      isPlaying: boolean;
      isPaused: boolean;
      deferRepeatedPress: (
        stepIndex: number,
        midi: number,
        hand: 'R' | 'L',
        pressId: number,
      ) => void;
      releasePlayingNote: (pressId: number) => void;
      playingPressTracker: { allocatePressId: () => number };
    };
    const internals = engine as unknown as EngineInternals;
    internals.isPlaying = true;
    internals.isPaused = false;

    const pressId = internals.playingPressTracker.allocatePressId();

    // Same sequence PlaybackEngine produces for a fast repeated re-strike:
    // the attack callback defers the visual press (audio already fired via
    // scheduleAttackRelease, independent of this visual path)...
    internals.deferRepeatedPress(1, 60, 'R', pressId);

    // ...then, before the 40ms elapses, this same pressId's release fires
    // (short played-duration note, or main-thread jank delaying the timer).
    internals.releasePlayingNote(pressId);

    expect(useEngineStore.getState().playingMidiNotes).toEqual([]);

    // Now the deferred timeout elapses.
    vi.advanceTimersByTime(50);

    // Fix #2: must NOT re-light — the release already happened first.
    expect(useEngineStore.getState().playingMidiNotes).toEqual([]);

    vi.useRealTimers();
  });
});
