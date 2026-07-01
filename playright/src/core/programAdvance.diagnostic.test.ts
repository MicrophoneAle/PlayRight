/**
 * Temporary diagnostic — run with:
 *   npx vitest run src/core/programAdvance.diagnostic.test.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngine } from './AudioEngine.ts';
import { FingeringProgramEngine } from './FingeringProgramEngine.ts';
import { parseMusicXmlToScript } from './parser/index.ts';
import { countStepNotesByHand } from './practiceSteps.ts';
import { useEngineStore } from '../store/useEngineStore.ts';
import type { Finger, Hand } from '../types/index.ts';

vi.mock('./PlaybackEngine.ts', () => ({
  playbackEngine: { stop: vi.fn(), setTempoFactor: vi.fn() },
}));

vi.mock('./PracticeEngine.ts', () => ({
  practiceEngine: {
    stop: vi.fn(),
    suspendForFingeringMode: vi.fn(),
  },
}));

function createMockAudio(): AudioEngine {
  return {
    noteOn: vi.fn(),
    noteOff: vi.fn(),
    warm: vi.fn(),
    init: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
  } as unknown as AudioEngine;
}

function fingerForHandOrder(hand: Hand, orderIndex: number): Finger {
  const finger = (orderIndex + 1) as Finger;
  if (finger < 1 || finger > 5) {
    throw new Error(`finger order ${orderIndex} out of range for ${hand}`);
  }
  return finger;
}

describe('program advance diagnostic (temporary)', () => {
  let engine: FingeringProgramEngine;

  beforeEach(() => {
    const storage = new Map<string, string>();
    const localStorageMock = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
    };
    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubGlobal('window', { localStorage: localStorageMock });

    useEngineStore.getState().actions.clearScript();
    useEngineStore.setState({
      fingeringMode: 'off',
      engineMode: 'two-hand',
      manualFingerings: {},
      currentStepIndex: 0,
    });
    engine = new FingeringProgramEngine();
    engine.attachAudioEngine(createMockAudio());
  });

  it('simulates chase program mode finger presses steps 0-4 without sheet clicks', () => {
    const logLines: string[] = [];
    const origLog = console.log.bind(console);
    const log = (...args: unknown[]) => {
      const line = args
        .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
        .join(' ');
      logLines.push(line);
      origLog(...args);
    };
    console.log = (...args: unknown[]) => {
      log(...args);
    };

    try {
      const CHASE_XML = readFileSync(
        new URL('../assets/chase-setsuna-yuki.musicxml', import.meta.url),
        'utf8',
      );
      const { script, scoreTiming } = parseMusicXmlToScript(CHASE_XML);

      useEngineStore.getState().actions.loadScript(
        script,
        CHASE_XML,
        'chase',
        { scoreId: 'chase-diag' },
        scoreTiming,
      );

      useEngineStore.getState().actions.setFingeringMode('program');
      engine.ensureStoreSubscription();

      const maxStepsToTry = 5;
      let stepIndex = useEngineStore.getState().currentStepIndex;

      log('[ProgramAdvanceDiag] === session start, steps to simulate:', maxStepsToTry);

      while (stepIndex < maxStepsToTry) {
        const state = useEngineStore.getState();
        const step = state.script?.[stepIndex];
        if (!step) {
          break;
        }

        const needed = countStepNotesByHand(step);
        const rhMidis = step.notes
          .filter((n) => n.hand === 'R')
          .map((n) => n.midi)
          .sort((a, b) => a - b);
        const lhMidis = step.notes
          .filter((n) => n.hand === 'L')
          .map((n) => n.midi)
          .sort((a, b) => a - b);

        log('[ProgramAdvanceDiag] === programming step', stepIndex, {
          onset: step.onset,
          needed,
          rhMidis,
          lhMidis,
        });

        const indexBefore = stepIndex;

        for (let i = 0; i < rhMidis.length; i += 1) {
          log('[ProgramAdvanceDiag] --- RH press', {
            stepIndex,
            finger: i + 1,
            targetMidi: rhMidis[i],
          });
          engine.handleFingerPress({ hand: 'R', finger: fingerForHandOrder('R', i) });
        }

        for (let i = 0; i < lhMidis.length; i += 1) {
          log('[ProgramAdvanceDiag] --- LH press', {
            stepIndex,
            finger: i + 1,
            targetMidi: lhMidis[i],
          });
          engine.handleFingerPress({ hand: 'L', finger: fingerForHandOrder('L', i) });
        }

        stepIndex = useEngineStore.getState().currentStepIndex;
        log('[ProgramAdvanceDiag] === after step', indexBefore, 'currentStepIndex now', stepIndex);

        if (stepIndex === indexBefore) {
          log('[ProgramAdvanceDiag] STALL at step', indexBefore);
          break;
        }
      }

      log('[ProgramAdvanceDiag] === session end at stepIndex', stepIndex);
      expect(stepIndex).toBeGreaterThan(0);
    } finally {
      console.log = origLog;
      writeFileSync(
        new URL('../programAdvance.diagnostic.log', import.meta.url),
        logLines.join('\n'),
        'utf8',
      );
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});
