import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngine } from './AudioEngine.ts';
import { FingeringProgramEngine } from './FingeringProgramEngine.ts';
import type { FingerMapping } from './twoHandMapping.ts';
import type { PlaybackScript, ScriptNote } from '../types/index.ts';
import { fingeringKey } from '../types/index.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

/**
 * Program-mode voices shared by several held finger keys. Mirrors
 * PracticeEngine.sharedPitchRelease.test.ts.
 *
 * The audio double reproduces Tone.Sampler's real release semantics:
 * triggerRelease(note) stops EVERY live voice of that pitch, so a pitch-keyed
 * release cannot pass by stopping only "its own" voice. Each voice remembers
 * the finger key that attacked it, and every release checks whether another
 * finger key still holding that pitch is physically down.
 */

type Voice = { midi: number; owner: string; attackAt: number; stopAt: number | null; stoppedBy: string | null };

const fingerKey = (mapping: FingerMapping) => `${mapping.hand}:${mapping.finger}`;

function createHarness() {
  let clock = 0;
  let trigger = '';
  /** Finger key -> pitch it is holding down. */
  const held = new Map<string, number>();
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

  const engine = new FingeringProgramEngine();
  engine.attachAudioEngine(audio);

  return {
    engine,
    audio,
    voices,
    /** The live voice of `midi`, if any. */
    sounding: (midi: number) => voices.find((voice) => voice.midi === midi && voice.stopAt === null),
    /** Press a finger key that the walk will bind to `midi`. */
    down(mapping: FingerMapping, midi: number, at: number) {
      clock = at;
      trigger = fingerKey(mapping);
      held.set(trigger, midi);
      engine.handleFingerPress(mapping);
    },
    up(mapping: FingerMapping, at: number) {
      clock = at;
      trigger = fingerKey(mapping);
      const midi = held.get(trigger);
      held.delete(trigger);
      engine.handleFingerRelease(mapping);
      if (midi !== undefined && [...held.values()].includes(midi)) {
        expect(
          voices.some((voice) => voice.midi === midi && voice.stopAt === null),
          `midi ${midi} cut by ${trigger} while another finger still holds it`,
        ).toBe(true);
      }
    },
  };
}

const R = (finger: FingerMapping['finger']): FingerMapping => ({ hand: 'R', finger });
const L = (finger: FingerMapping['finger']): FingerMapping => ({ hand: 'L', finger });

function note(pitch: string, midi: number, hand: 'L' | 'R'): ScriptNote {
  return { pitch, midi, hand, finger: null };
}

function step(order: number, notes: ScriptNote[]): PlaybackScript[number] {
  return { order, onset: order * 480, measureNumber: 1, notes };
}

function load(script: PlaybackScript): void {
  useEngineStore.getState().actions.clearScript();
  useEngineStore.setState({
    script,
    rawXml: null,
    totalSteps: script.length,
    fingeringMode: 'program',
    engineMode: 'two-hand',
    playMode: false,
    currentStepIndex: 0,
    manualFingerings: {},
    programAssignedKeys: [],
    programRefingerNoteIndex: null,
  });
}

describe('FingeringProgramEngine shared-pitch release', () => {
  let h: ReturnType<typeof createHarness>;

  beforeEach(() => {
    h = createHarness();
  });

  afterEach(() => {
    h.engine.stop();
  });

  it('control: distinct pitches each sustain until their own key lifts', () => {
    load([step(0, [note('C4', 60, 'R')]), step(1, [note('D4', 62, 'R')]), step(2, [note('E4', 64, 'R')])]);
    h.engine.start();

    h.down(R(1), 60, 0);
    h.down(R(2), 62, 300);
    h.up(R(1), 350);
    expect(h.sounding(62)).toBeDefined();
    h.up(R(2), 900);

    expect(h.voices.map((v) => [v.midi, v.stopAt, v.stoppedBy])).toEqual([
      [60, 350, 'R:1'],
      [62, 900, 'R:2'],
    ]);
    expect(h.audio.releaseAll).not.toHaveBeenCalled();
  });

  it('same pitch under two fingers: the second finger keeps it after the first lifts', () => {
    load([step(0, [note('C4', 60, 'R')]), step(1, [note('C4', 60, 'R')]), step(2, [note('E4', 64, 'R')])]);
    h.engine.start();

    h.down(R(1), 60, 0);
    h.down(R(3), 60, 300);
    expect(useEngineStore.getState().manualFingerings[fingeringKey(480, 'R', 60)]).toBe(3);
    h.up(R(1), 340);
    expect(h.sounding(60)).toBeDefined();
    h.up(R(3), 900);

    // Program mode joins the sounding pitch rather than re-striking it: one
    // voice, held by R1 then R3, released only by the last of them.
    expect(h.voices.map((v) => [v.midi, v.attackAt, v.stopAt, v.stoppedBy])).toEqual([[60, 0, 900, 'R:3']]);
  });

  it('unison across hands: the right hand keeps C4 after the left hand lifts', () => {
    load([step(0, [note('C4', 60, 'L')]), step(1, [note('C4', 60, 'R')]), step(2, [note('E4', 64, 'R')])]);
    h.engine.start();

    h.down(L(1), 60, 0);
    h.down(R(1), 60, 300);
    h.up(L(1), 320);
    expect(h.sounding(60)).toBeDefined();
    h.up(R(1), 900);

    expect(h.voices.map((v) => [v.midi, v.stopAt, v.stoppedBy])).toEqual([[60, 900, 'R:1']]);
  });

  it('unison chord within one step: either hand lifting first leaves the other sounding', () => {
    load([step(0, [note('C4', 60, 'L'), note('C4', 60, 'R')]), step(1, [note('E4', 64, 'R')])]);
    h.engine.start();

    h.down(L(1), 60, 0);
    h.down(R(1), 60, 10);
    expect(useEngineStore.getState().currentStepIndex).toBe(1);
    h.up(R(1), 300);
    expect(h.sounding(60)).toBeDefined();
    h.up(L(1), 600);

    expect(h.voices.map((v) => [v.midi, v.stopAt, v.stoppedBy])).toEqual([[60, 600, 'L:1']]);
  });

  it('cross-hand assignments onto one pitch: lifting the first crossover does not cut the second', () => {
    // C4 notated RH, played by the LEFT hand; then C4 notated LH, played by the RIGHT hand.
    load([step(0, [note('C4', 60, 'R')]), step(1, [note('C4', 60, 'L')]), step(2, [note('E4', 64, 'R')])]);
    h.engine.start();

    h.down(L(2), 60, 0);
    h.down(R(1), 60, 300);
    const fingerings = useEngineStore.getState().manualFingerings;
    expect(fingerings[fingeringKey(0, 'R', 60)]).toEqual({ finger: 2, physicalHand: 'L' });
    expect(fingerings[fingeringKey(480, 'L', 60)]).toEqual({ finger: 1, physicalHand: 'R' });

    h.up(L(2), 340);
    expect(h.sounding(60)).toBeDefined();
    h.up(R(1), 900);

    expect(h.voices.map((v) => [v.midi, v.stopAt, v.stoppedBy])).toEqual([[60, 900, 'R:1']]);
  });

  it('a finger re-pressed without its keyup lets go of its old pitch', () => {
    load([step(0, [note('C4', 60, 'R')]), step(1, [note('D4', 62, 'R')]), step(2, [note('E4', 64, 'R')])]);
    h.engine.start();

    h.down(R(1), 60, 0);
    // Keyup for R1 was lost; R1 then presses again on the next step.
    h.down(R(1), 62, 300);
    expect(h.sounding(60)).toBeUndefined();
    h.up(R(1), 600);

    expect(h.voices.map((v) => [v.midi, v.stopAt, v.stoppedBy])).toEqual([
      [60, 300, 'R:1'],
      [62, 600, 'R:1'],
    ]);
  });
});
