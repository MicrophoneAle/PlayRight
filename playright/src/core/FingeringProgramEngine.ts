import type { AudioEngine } from './AudioEngine.ts';
import {
  buildTwoHandExpectedMidis,
  buildProgramAssignedKeys,
  isProgramStepComplete,
  programAssignmentKey,
  programTargetNote,
} from './practiceSteps.ts';
import { useEngineStore } from '../store/useEngineStore.ts';
import type { FingerMapping } from './twoHandMapping.ts';
import type { StepOrder } from '../types/index.ts';

/**
 * Step-through finger capture for fingering program mode. Advances when every note
 * in the step has received a finger press; binds each press to the lowest unassigned
 * pitch on that hand (chord targeting rule).
 */
export class FingeringProgramEngine {
  private audioEngine: AudioEngine | null = null;
  private assignedThisStep = new Set<string>();
  private activeFingerSounds = new Map<string, number>();
  private soundingMidis = new Set<number>();
  private storeSubscriptionInitialized = false;

  attachAudioEngine(audioEngine: AudioEngine): void {
    this.audioEngine = audioEngine;
  }

  ensureStoreSubscription(): void {
    if (this.storeSubscriptionInitialized) {
      return;
    }

    this.storeSubscriptionInitialized = true;

    useEngineStore.subscribe((state, prevState) => {
      if (state.fingeringMode !== 'program') {
        return;
      }

      if (state.currentStepIndex !== prevState.currentStepIndex) {
        this.assignedThisStep.clear();
        this.syncAssignedToStore();
        this.syncExpectedNotes();
        return;
      }

      if (state.script !== prevState.script && state.script) {
        const step = state.script[state.currentStepIndex];
        if (step) {
          this.syncAssignedFromStep(step);
        }
      }
    });
  }

  private syncAssignedFromStep(step: StepOrder): void {
    const { manualFingerings } = useEngineStore.getState();
    this.assignedThisStep = buildProgramAssignedKeys(step, manualFingerings);
    this.syncAssignedToStore();
  }

  private syncAssignedToStore(): void {
    useEngineStore
      .getState()
      .actions.setProgramAssignedKeys([...this.assignedThisStep]);
  }

  start(): void {
    this.ensureStoreSubscription();

    const { script, actions } = useEngineStore.getState();
    if (!script) {
      return;
    }

    this.assignedThisStep.clear();
    this.syncAssignedToStore();
    this.releaseAllSoundingNotes();
    actions.setHasPracticeStarted(true);
    actions.setPracticeActive(true);
    this.syncExpectedNotes();
  }

  stop(): void {
    this.assignedThisStep.clear();
    this.syncAssignedToStore();
    this.releaseAllSoundingNotes();
    const { actions } = useEngineStore.getState();
    actions.setPracticeActive(false);
    actions.setHasPracticeStarted(false);
    actions.setExpectedNotes([]);
  }

  resetStepAssignments(): void {
    this.assignedThisStep.clear();
  }

  /** Current program targets for UI highlighting (lowest unassigned per hand). */
  getAssignedKeys(): ReadonlySet<string> {
    return this.assignedThisStep;
  }

  handleFingerPress(mapping: FingerMapping, userId?: string | null): void {
    const state = useEngineStore.getState();
    if (state.fingeringMode !== 'program' || !state.script) {
      return;
    }

    const { currentStepIndex } = state;
    if (currentStepIndex < 0 || currentStepIndex >= state.script.length) {
      return;
    }

    const step = state.script[currentStepIndex];
    this.syncAssignedFromStep(step);

    const target = programTargetNote(step, mapping.hand, this.assignedThisStep);
    if (target === null) {
      return;
    }

    state.actions.setManualFinger(
      step.onset,
      target.hand,
      target.midi,
      mapping.finger,
      userId,
    );

    this.assignedThisStep.add(programAssignmentKey(target.hand, target.midi));
    this.syncAssignedToStore();
    this.sustainNote(target.midi, mapping);

    const freshState = useEngineStore.getState();
    const freshStep = freshState.script?.[currentStepIndex];
    if (!freshStep) {
      return;
    }

    this.syncAssignedFromStep(freshStep);

    if (isProgramStepComplete(freshStep, this.assignedThisStep)) {
      this.advanceStep();
    }
  }

  handleFingerRelease(mapping: FingerMapping): void {
    const fingerKey = `${mapping.hand}:${mapping.finger}`;
    const midi = this.activeFingerSounds.get(fingerKey);
    if (midi === undefined) {
      return;
    }

    this.noteOff(midi);
    this.activeFingerSounds.delete(fingerKey);
  }

  private advanceStep(): void {
    const { script, currentStepIndex, actions } = useEngineStore.getState();
    if (!script) {
      return;
    }

    this.assignedThisStep.clear();
    this.syncAssignedToStore();
    const nextIndex = currentStepIndex + 1;

    if (nextIndex >= script.length) {
      actions.setPracticeActive(false);
      actions.setExpectedNotes([]);
      return;
    }

    actions.setStepIndex(nextIndex);
    this.syncExpectedNotes();
  }

  private syncExpectedNotes(): void {
    const { script, currentStepIndex, actions } = useEngineStore.getState();
    if (!script || currentStepIndex < 0 || currentStepIndex >= script.length) {
      actions.setExpectedNotes([]);
      return;
    }

    const midis = [...buildTwoHandExpectedMidis(script, currentStepIndex)];
    actions.setExpectedNotes(midis);
  }

  private sustainNote(midi: number, mapping: FingerMapping): void {
    const engine = this.audioEngine;
    if (!engine) {
      return;
    }

    if (!this.soundingMidis.has(midi)) {
      engine.noteOn(midi);
      this.soundingMidis.add(midi);
    }

    this.activeFingerSounds.set(`${mapping.hand}:${mapping.finger}`, midi);
  }

  private noteOff(midi: number): void {
    const engine = this.audioEngine;
    if (!engine || !this.soundingMidis.has(midi)) {
      return;
    }

    engine.noteOff(midi);
    this.soundingMidis.delete(midi);
  }

  private releaseAllSoundingNotes(): void {
    const engine = this.audioEngine;
    if (!engine) {
      this.soundingMidis.clear();
      this.activeFingerSounds.clear();
      return;
    }

    for (const midi of this.soundingMidis) {
      engine.noteOff(midi);
    }

    this.soundingMidis.clear();
    this.activeFingerSounds.clear();
  }
}

export const fingeringProgramEngine = new FingeringProgramEngine();
