import { beforeEach, describe, expect, it } from 'vitest';
import {
  canWriteProgramStepIndex,
  runWithProgramStepIndexWrite,
} from './programStepGuard.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

function resetStore(): void {
  useEngineStore.setState({
    fingeringMode: 'off',
    currentStepIndex: 0,
  });
}

describe('programStepGuard', () => {
  it('denies step-index writes outside the program engine guard', () => {
    expect(canWriteProgramStepIndex()).toBe(false);
  });

  it('allows writes only while runWithProgramStepIndexWrite is active', () => {
    expect(canWriteProgramStepIndex()).toBe(false);

    runWithProgramStepIndexWrite(() => {
      expect(canWriteProgramStepIndex()).toBe(true);
    });

    expect(canWriteProgramStepIndex()).toBe(false);
  });

  it('restores guard depth after the wrapped function throws', () => {
    expect(() => {
      runWithProgramStepIndexWrite(() => {
        throw new Error('program advance failed');
      });
    }).toThrow('program advance failed');

    expect(canWriteProgramStepIndex()).toBe(false);
  });

  it('supports nested program-engine writes', () => {
    runWithProgramStepIndexWrite(() => {
      expect(canWriteProgramStepIndex()).toBe(true);

      runWithProgramStepIndexWrite(() => {
        expect(canWriteProgramStepIndex()).toBe(true);
      });

      expect(canWriteProgramStepIndex()).toBe(true);
    });

    expect(canWriteProgramStepIndex()).toBe(false);
  });

  it('returns the wrapped function value', () => {
    expect(runWithProgramStepIndexWrite(() => 42)).toBe(42);
  });
});

describe('setStepIndex program guard integration', () => {
  beforeEach(() => {
    resetStore();
  });

  it('blocks external setStepIndex while in program mode (sheet sync / scope race)', () => {
    useEngineStore.setState({ fingeringMode: 'program', currentStepIndex: 5 });

    useEngineStore.getState().actions.setStepIndex(1);

    expect(useEngineStore.getState().currentStepIndex).toBe(5);
  });

  it('permits setStepIndex from inside runWithProgramStepIndexWrite', () => {
    useEngineStore.setState({ fingeringMode: 'program', currentStepIndex: 0 });

    runWithProgramStepIndexWrite(() => {
      useEngineStore.getState().actions.setStepIndex(3);
    });

    expect(useEngineStore.getState().currentStepIndex).toBe(3);
  });

  it('does not block setStepIndex outside program mode', () => {
    useEngineStore.setState({ fingeringMode: 'off', currentStepIndex: 0 });

    useEngineStore.getState().actions.setStepIndex(2);

    expect(useEngineStore.getState().currentStepIndex).toBe(2);
  });
});
