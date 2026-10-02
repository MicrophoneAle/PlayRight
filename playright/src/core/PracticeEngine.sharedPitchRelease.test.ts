import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngine } from './AudioEngine.ts';
import { PracticeEngine } from './PracticeEngine.ts';
import type { FingerMapping } from './twoHandMapping.ts';
import type { PlaybackScript, ScriptNote } from '../types/index.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

/**
 * Two-hand practice voices shared by several held finger keys.
 *
 * The audio double reproduces Tone.Sampler's real release semantics:
 * triggerRelease(note) stops EVERY live voice of that pitch. A double that
 * stopped only "its own" voice would pass against the pitch-keyed bug this
 * guards. Each voice remembers the finger key that attacked it, and every stop
 * records which finger keys were still physically down at that moment.
 */

type Voice = { midi: number; owner: string; attackAt: number; stopAt: number | null; stoppedBy: string | null };

const fingerKey = (mapping: FingerMapping) => `${mapping.hand}:${mapping.finger}`;

function createHarness() {
  let clock = 0;
  let trigger = '';
  const held = new Set<string>();
  const voices: Voice[] = [];

  const audio = {
    noteOn: vi.fn((midi: number) => {
      voices.push({ midi, owner: trigger, attackAt: clock, stopAt: null, stoppedBy: null });
    }),
    noteOff: vi.fn((midi: number) => {
      for (const voice of voices) {
        if (voice.midi === midi && voice.stopAt === null) {
          voice.stopAt = clock;
          voice.stoppedBy = trigger;
        }
      }
    }),
    releaseAll: vi.fn(),
    warm: vi.fn(),
    init: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
  } as unknown as AudioEngine;

  const engine = new PracticeEngine();
  engine.ensureStoreSubscription();
  engine.attachAudioEngine(audio);

  return {
    engine,
    audio,
    voices,
    /** The live voice of `midi`, if any. */
    sounding: (midi: number) => voices.find((voice) => voice.midi === midi && voice.stopAt === null),
    down(mapping: FingerMapping, at: number) {
      clock = at;
      trigger = fingerKey(mapping);
      held.add(trigger);
      engine.handleFingerPress(mapping);
    },
    up(mapping: FingerMapping, at: number) {
      clock = at;
      trigger = fingerKey(mapping);
      held.delete(trigger);
      engine.handleFingerRelease(mapping);
      // A pitch whose holder is still down must still be sounding.
      for (const voice of voices) {
        if (voice.stopAt === clock && voice.stoppedBy === trigger) {
          const stillHeld = voices.some(
            (other) => other.midi === voice.midi && other.owner !== trigger && held.has(other.owner),
          );
          expect(stillHeld, `midi ${voice.midi} cut by ${trigger} while another holder is down`).toBe(false);
        }
      }
    },
  };
}

const R = (finger: FingerMapping['finger']): FingerMapping => ({ hand: 'R', finger });
const L = (finger: FingerMapping['finger']): FingerMapping => ({ hand: 'L', finger });

function step(order: number, notes: ScriptNote[]): PlaybackScript[number] {
  return { order, onset: order * 480, measureNumber: 1, notes };
}

function load(steps: PlaybackScript): void {
  useEngineStore.getState().actions.clearScript();
  useEngineStore.setState({
    engineMode: 'two-hand',
    isPracticeActive: false,
    hasPracticeStarted: false,
    currentStepIndex: 0,
    activeHand: 'R',
    scopeStartMidi: 60,
    expectedMidiNotes: [],
    scoringEnabled: true,
  });
  useEngineStore.getState().actions.loadScript(steps, '<score/>', 'test');
}

describe('PracticeEngine two-hand shared-pitch release', () => {
  let h: ReturnType<typeof createHarness>;

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    h = createHarness();
  });

  it('A: legato distinct pitches across a step advance each sustain until their own key lifts', () => {
    load([
      step(0, [{ pitch: 'C4', midi: 60, hand: 'R', finger: 1 }]),
      step(1, [{ pitch: 'D4', midi: 62, hand: 'R', finger: 2 }]),
    ]);
    h.engine.start();

    h.down(R(1), 0);
    h.down(R(2), 300);
    h.up(R(1), 350);
    expect(h.sounding(62)).toBeDefined();
    h.up(R(2), 900);

    expect(h.voices.map((v) => [v.midi, v.stopAt, v.stoppedBy])).toEqual([
      [60, 350, 'R:1'],
      [62, 900, 'R:2'],
    ]);
    expect(h.audio.releaseAll).not.toHaveBeenCalled();
  });

  it('B: a repeated pitch under a new finger survives the previous finger lifting', () => {
    load([
      step(0, [{ pitch: 'C4', midi: 60, hand: 'R', finger: 1 }]),
      step(1, [{ pitch: 'C4', midi: 60, hand: 'R', finger: 3 }]),
    ]);
    h.engine.start();

    h.down(R(1), 0);
    h.down(R(3), 300);
    h.up(R(1), 340);
    expect(h.sounding(60)?.owner).toBe('R:3');
    h.up(R(3), 900);

    // R3's press re-strikes C4 (the old voice ends there, a new attack begins),
    // and the re-struck voice lasts until R3 itself lifts.
    expect(h.voices.map((v) => [v.owner, v.attackAt, v.stopAt, v.stoppedBy])).toEqual([
      ['R:1', 0, 300, 'R:3'],
      ['R:3', 300, 900, 'R:3'],
    ]);
  });

  it('C: a unison struck by the other hand survives the first hand lifting', () => {
    load([
      step(0, [{ pitch: 'C4', midi: 60, hand: 'L', finger: 1 }]),
      step(1, [{ pitch: 'C4', midi: 60, hand: 'R', finger: 1 }]),
    ]);
    h.engine.start();

    h.down(L(1), 0);
    h.down(R(1), 300);
    h.up(L(1), 320);
    expect(h.sounding(60)?.owner).toBe('R:1');
    h.up(R(1), 900);

    expect(h.voices.map((v) => [v.owner, v.stopAt, v.stoppedBy])).toEqual([
      ['L:1', 300, 'R:1'],
      ['R:1', 900, 'R:1'],
    ]);
  });

  it('D: a wrong-note clash on a held pitch does not cut it when the wrong finger lifts', () => {
    load([
      step(0, [{ pitch: 'D4', midi: 62, hand: 'R', finger: 2 }]),
      step(1, [{ pitch: 'C4', midi: 60, hand: 'R', finger: 1 }]),
    ]);
    h.engine.start();

    h.down(R(2), 0); // D4 correct, advances to step 1; keep holding
    h.down(R(3), 300); // wrong at step 1: clash is C4 + 2 = D4, the held pitch
    expect(h.sounding(62)?.owner).toBe('R:3');
    h.up(R(3), 380);
    expect(h.sounding(62)).toBeDefined();
    h.down(R(1), 400);
    h.up(R(2), 900);
    h.up(R(1), 950);

    const d4 = h.voices.filter((v) => v.midi === 62);
    expect(d4.at(-1)).toMatchObject({ stopAt: 900, stoppedBy: 'R:2' });
    expect(h.sounding(60)).toBeUndefined();
  });

  it('E: a wrong press then the correct notes on other fingers sustain normally', () => {
    load([
      step(0, [
        { pitch: 'C4', midi: 60, hand: 'R', finger: 1 },
        { pitch: 'E4', midi: 64, hand: 'R', finger: 3 },
      ]),
    ]);
    h.engine.start();

    h.down(R(2), 0);
    h.up(R(2), 100);
    h.down(R(1), 200);
    h.down(R(3), 210);
    h.up(R(1), 900);
    h.up(R(3), 900);

    expect(h.voices.map((v) => [v.midi, v.stopAt, v.stoppedBy])).toEqual([
      [61, 100, 'R:2'],
      [60, 900, 'R:1'],
      [64, 900, 'R:3'],
    ]);
  });

  it('keeps both hands highlighted while a unison is held, then clears per lift', () => {
    load([
      step(0, [
        { pitch: 'C4', midi: 60, hand: 'L', finger: 1 },
        { pitch: 'C4', midi: 60, hand: 'R', finger: 1 },
      ]),
      step(1, [{ pitch: 'G4', midi: 67, hand: 'R', finger: 5 }]),
    ]);
    h.engine.start();

    h.down(L(1), 0);
    h.down(R(1), 10);
    const hands = () => useEngineStore.getState().playingPlaybackNotes.map((n) => `${n.hand}${n.midi}`);
    expect(hands().sort()).toEqual(['L60', 'R60']);

    h.up(L(1), 300);
    expect(hands()).toEqual(['R60']);
    h.up(R(1), 400);
    expect(hands()).toEqual([]);
    expect(h.sounding(60)).toBeUndefined();
  });
});
