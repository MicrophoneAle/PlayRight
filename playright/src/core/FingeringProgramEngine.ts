import type { AudioEngine } from './AudioEngine.ts';
import {
  buildTwoHandExpectedMidis,
  buildProgramAssignedKeys,
  countStepNotesByHand,
  isProgramStepComplete,
  programAssignmentKey,
  programNextUnassignedNote,
} from './practiceSteps.ts';
import { useEngineStore } from '../store/useEngineStore.ts';
import type { FingerMapping } from './twoHandMapping.ts';
import type { StepOrder } from '../types/index.ts';

const logProgramAdvance = (...args: unknown[]): void => {
  if (import.meta.env.DEV) {
    console.debug('[ProgramAdvance]', ...args);
  }
};

/**
 * Step-through finger capture for fingering program mode. Advances when every note
 * in the step has received a finger press in score order; each press must be on the
 * hand of the next unassigned note.
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
        this.syncCurrentStepState();
      }
    });
  }

  private syncCurrentStepState(): void {
    const { script, currentStepIndex, actions } = useEngineStore.getState();
    const step = script?.[currentStepIndex];

    if (!step) {
      this.assignedThisStep.clear();
      this.syncAssignedToStore();
      actions.setExpectedNotes([]);
      return;
    }

    this.syncAssignedFromStep(step);
    this.syncExpectedNotes();

    logProgramAdvance('syncCurrentStepState', {
      stepIndex: currentStepIndex,
      uiStep: currentStepIndex + 1,
      needed: countStepNotesByHand(step),
      assignedKeys: [...this.assignedThisStep],
      next: programNextUnassignedNote(step, this.assignedThisStep)?.pitch ?? null,
    });
  }

  private syncAssignedFromStep(step: StepOrder): void {
    const { manualFingerings } = useEngineStore.getState();
    this.assignedThisStep = buildProgramAssignedKeys(step, manualFingerings);
    this.syncAssignedToStore();
  }

  syncAssignedToStore(): void {
    useEngineStore
      .getState()
      .actions.setProgramAssignedKeys([...this.assignedThisStep]);
  }

  /** Reload assignment state for the current step from persisted manual fingerings. */
  resyncCurrentStep(): void {
    this.syncCurrentStepState();
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
    this.resyncCurrentStep();
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

    const stepIndex = state.currentStepIndex;
    if (stepIndex < 0 || stepIndex >= state.script.length) {
      return;
    }

    const step = state.script[stepIndex];
    const nextNote = programNextUnassignedNote(step, this.assignedThisStep);

    if (nextNote === null) {
      if (isProgramStepComplete(step, this.assignedThisStep)) {
        logProgramAdvance('press on complete step — advancing', {
          stepIndex,
          uiStep: stepIndex + 1,
        });
        this.advanceStep();
      } else {
        logProgramAdvance('press ignored (no next note and step incomplete)', {
          stepIndex,
          uiStep: stepIndex + 1,
          assignedKeys: [...this.assignedThisStep],
          needed: countStepNotesByHand(step),
        });
      }
      return;
    }

    if (mapping.hand !== nextNote.hand) {
      logProgramAdvance('press ignored (wrong hand for next note)', {
        stepIndex,
        uiStep: stepIndex + 1,
        expectedHand: nextNote.hand,
        expectedPitch: nextNote.pitch,
        pressedHand: mapping.hand,
        finger: mapping.finger,
      });
      return;
    }

    state.actions.setManualFingerInProgram(
      step.onset,
      nextNote.hand,
      nextNote.midi,
      mapping.finger,
      userId,
    );

    this.assignedThisStep.add(programAssignmentKey(nextNote.hand, nextNote.midi));
    this.syncAssignedToStore();
    this.sustainNote(nextNote.midi, mapping);

    const complete = isProgramStepComplete(step, this.assignedThisStep);
    logProgramAdvance('press assigned', {
      stepIndex,
      uiStep: stepIndex + 1,
      target: `${nextNote.hand}:${nextNote.midi}`,
      pitch: nextNote.pitch,
      assignedKeys: [...this.assignedThisStep],
      needed: countStepNotesByHand(step),
      complete,
    });

    if (complete) {
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

    logProgramAdvance('advanceStep', {
      fromIndex: currentStepIndex,
      fromUiStep: currentStepIndex + 1,
      toIndex: nextIndex,
      toUiStep: nextIndex + 1,
    });

    if (nextIndex >= script.length) {
      actions.setPracticeActive(false);
      actions.setExpectedNotes([]);
      return;
    }

    actions.setStepIndex(nextIndex);
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
