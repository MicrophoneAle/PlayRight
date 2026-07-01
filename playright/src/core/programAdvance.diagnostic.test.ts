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
import {
  isProgramStepComplete,
  programAssignmentProgress,
} from './practiceSteps.ts';
import { useEngineStore } from '../store/useEngineStore.ts';
import { fingeringKey, type Finger, type ManualFingeringMap } from '../types/index.ts';

const CHASE_XML = readFileSync(
  new URL('../assets/chase-setsuna-yuki.musicxml', import.meta.url),
  'utf8',
);

describe('program advance diagnostics (chase)', () => {
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

  it('logs step 0→1→2 flow via setFingeringMode like the app', () => {
    const { script, scoreTiming } = parseMusicXmlToScript(CHASE_XML);
    useEngineStore.getState().actions.loadScript(
      script,
      CHASE_XML,
      'chase',
      { scoreId: 'chase-diagnostic' },
      scoreTiming,
    );

    useEngineStore.getState().actions.setFingeringMode('program');
    expect(useEngineStore.getState().engineMode).toBe('two-hand');
    expect(useEngineStore.getState().currentStepIndex).toBe(0);

    const log: string[] = [];
    const press = (label: string, hand: 'L' | 'R', finger: 1 | 2) => {
      const before = useEngineStore.getState().currentStepIndex;
      engine.handleFingerPress({ hand, finger });
      const after = useEngineStore.getState().currentStepIndex;
      const step = useEngineStore.getState().script![after];
      const progress = programAssignmentProgress(
        step,
        new Set(useEngineStore.getState().programAssignedKeys),
      );
      log.push(
        `${label}: step ${before + 1}→${after + 1} progress L=${progress.assignedCounts.L}/${progress.needed.L} R=${progress.assignedCounts.R}/${progress.needed.R} complete=${isProgramStepComplete(step, new Set(useEngineStore.getState().programAssignedKeys))}`,
      );
    };

    // Step 1 (index 0)
    const step0 = script[0];
    log.push(
      `step1 notes: ${step0.notes.map((n) => `${n.hand}:${n.midi}`).join(', ')}`,
    );
    for (const note of step0.notes) {
      engine.handleFingerPress({ hand: note.hand, finger: 1 });
    }
    expect(useEngineStore.getState().currentStepIndex).toBe(1);

    // Step 2 (index 1) — n, v, r
    const step1 = script[1];
    log.push(
      `step2 notes: ${step1.notes.map((n) => `${n.hand}:${n.midi}`).join(', ')} needed L=${step1.notes.filter((n) => n.hand === 'L').length} R=${step1.notes.filter((n) => n.hand === 'R').length}`,
    );

    press('n (R1)', 'R', 1);
    expect(useEngineStore.getState().currentStepIndex).toBe(1);

    press('v (L1)', 'L', 1);
    expect(useEngineStore.getState().currentStepIndex).toBe(1);

    press('r (L2)', 'L', 2);
    expect(useEngineStore.getState().currentStepIndex).toBe(2);
  });

  it('auto-skips step 2 when every note already has saved fingerings', () => {
    const { script, scoreTiming } = parseMusicXmlToScript(CHASE_XML);
    const step1 = script[1];
    const prefilled: ManualFingeringMap = {};
    for (const note of step1.notes) {
      prefilled[fingeringKey(step1.onset, note.hand, note.midi)] = 1 as Finger;
    }

    useEngineStore.getState().actions.loadScript(
      script,
      CHASE_XML,
      'chase',
      { scoreId: 'chase-prefilled', manualFingerings: prefilled },
      scoreTiming,
    );
    useEngineStore.getState().actions.setFingeringMode('program');
    useEngineStore.getState().actions.setStepIndex(1);
    engine.resyncCurrentStep();

    expect(useEngineStore.getState().currentStepIndex).toBe(2);
  });
});
