import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./PlaybackEngine.ts', () => ({
  playbackEngine: { stop: vi.fn(), setTempoFactor: vi.fn() },
}));
vi.mock('./PracticeEngine.ts', () => ({
  practiceEngine: { stop: vi.fn(), suspendForFingeringMode: vi.fn() },
}));

import { FingeringProgramEngine } from './FingeringProgramEngine.ts';
import { parseMusicXmlToScript } from './parser/index.ts';
import { programAssignmentProgress } from './practiceSteps.ts';
import { useEngineStore } from '../store/useEngineStore.ts';
import { fingeringKey, type Finger, type ManualFingeringMap } from '../types/index.ts';

const CHASE_XML = readFileSync(
  new URL('../assets/chase-setsuna-yuki.musicxml', import.meta.url),
  'utf8',
);

describe('chase step onsets', () => {
  it('uses unique onsets for the first several steps', () => {
    const { script } = parseMusicXmlToScript(CHASE_XML);
    const onsets = script.slice(0, 10).map((step) => step.onset);
    expect(new Set(onsets).size).toBe(onsets.length);
  });

  it('step 2 (index 1) note order is R then L chord', () => {
    const { script } = parseMusicXmlToScript(CHASE_XML);
    const step = script[1];
    expect(step.notes.map((n) => `${n.hand}:${n.pitch}`)).toEqual([
      'R:E5',
      'L:C#3',
      'L:G#3',
    ]);
  });
});

describe('program advance sequencing (chase)', () => {
  let engine: FingeringProgramEngine;
  let localStorageMock: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    localStorageMock = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };
    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubGlobal('window', { localStorage: localStorageMock });

    engine = new FingeringProgramEngine();
    useEngineStore.getState().actions.clearScript();
    useEngineStore.setState({
      fingeringMode: 'off',
      engineMode: 'one-hand',
      manualFingerings: {},
      currentStepIndex: 0,
    });
  });

  afterEach(() => {
    engine.stop();
    vi.unstubAllGlobals();
  });

  it('does not reset step index after each note on step 2', () => {
    const { script, scoreTiming } = parseMusicXmlToScript(CHASE_XML);
    useEngineStore.getState().actions.loadScript(
      script,
      CHASE_XML,
      'chase',
      { scoreId: 'chase-seq' },
      scoreTiming,
    );
    useEngineStore.getState().actions.setFingeringMode('program');
    useEngineStore.setState({ currentStepIndex: 1 });
    engine.ensureStoreSubscription();
    engine.resyncCurrentStep();

    const progress = () =>
      programAssignmentProgress(
        useEngineStore.getState().script![1],
        new Set(useEngineStore.getState().programAssignedKeys),
      );

    engine.handleFingerPress({ hand: 'R', finger: 1 });
    expect(useEngineStore.getState().currentStepIndex).toBe(1);
    expect(progress()).toEqual({
      needed: { L: 2, R: 1 },
      assignedCounts: { L: 0, R: 1 },
    });

    engine.handleFingerPress({ hand: 'L', finger: 1 });
    expect(useEngineStore.getState().currentStepIndex).toBe(1);
    expect(progress()).toEqual({
      needed: { L: 2, R: 1 },
      assignedCounts: { L: 1, R: 1 },
    });

    engine.handleFingerPress({ hand: 'L', finger: 2 });
    expect(useEngineStore.getState().currentStepIndex).toBe(2);
  });

  it('does not reset step index when start runs mid-session', () => {
    const { script, scoreTiming } = parseMusicXmlToScript(CHASE_XML);
    useEngineStore.getState().actions.loadScript(
      script,
      CHASE_XML,
      'chase',
      { scoreId: 'chase-seq' },
      scoreTiming,
    );
    useEngineStore.setState({ fingeringMode: 'program', engineMode: 'two-hand', currentStepIndex: 1 });
    engine.ensureStoreSubscription();

    for (const note of script[1].notes) {
      engine.handleFingerPress({ hand: note.hand, finger: 1 });
    }
    expect(useEngineStore.getState().currentStepIndex).toBe(2);

    engine.start();
    expect(useEngineStore.getState().currentStepIndex).toBe(2);
  });

  it('start skips prefilled complete steps to the first incomplete step', () => {
    const { script, scoreTiming } = parseMusicXmlToScript(CHASE_XML);
    const prefilled: ManualFingeringMap = {};
    for (const step of script.slice(0, 2)) {
      for (const note of step.notes) {
        prefilled[fingeringKey(step.onset, note.hand, note.midi)] = 1 as Finger;
      }
    }

    useEngineStore.getState().actions.loadScript(
      script,
      CHASE_XML,
      'chase',
      { scoreId: 'chase-prefilled', manualFingerings: prefilled },
      scoreTiming,
    );
    useEngineStore.getState().actions.setFingeringMode('program');
    engine.ensureStoreSubscription();

    expect(useEngineStore.getState().currentStepIndex).toBe(2);
  });
});
