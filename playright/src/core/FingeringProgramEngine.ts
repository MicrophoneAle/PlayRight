import type { AudioEngine } from './AudioEngine.ts';
import {
  buildProgramAssignedKeys,
  countStepNotesByHand,
  isProgramStepComplete,
  programNextUnassignedNote,
  programStepExpectedMidis,
} from './practiceSteps.ts';
import { runWithProgramStepIndexWrite } from './programStepGuard.ts';
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
 * hand of the next unassigned note. Sheet click-jump enters refinger mode to overwrite
 * fingerings in score order for that step.
 */
export class FingeringProgramEngine {
  private audioEngine: AudioEngine | null = null;
  private activeFingerSounds = new Map<string, number>();
  private soundingMidis = new Set<number>();
  private storeSubscriptionInitialized = false;
  /** Ignore accidental sheet seeks briefly after advancing. */
  private sheetSeekLockedUntil = 0;

  isSheetSeekLocked(): boolean {
    return Date.now() < this.sheetSeekLockedUntil;
  }

  private lockSheetSeek(): void {
    this.sheetSeekLockedUntil = Date.now() + 500;
  }

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
        this.lockSheetSeek();
        this.syncCurrentStepState();
      }
    });
  }

  private assignedKeysForStep(step: StepOrder): Set<string> {
    const { manualFingerings } = useEngineStore.getState();
    return buildProgramAssignedKeys(step, manualFingerings);
  }

  private syncAssignedToStore(step: StepOrder): void {
    useEngineStore
      .getState()
      .actions.setProgramAssignedKeys([...this.assignedKeysForStep(step)]);
  }

  private skipForwardToFirstIncompleteStep(): void {
    const { script, actions } = useEngineStore.getState();
    if (!script) {
      return;
    }

    let index = useEngineStore.getState().currentStepIndex;

    while (
      index < script.length &&
      isProgramStepComplete(script[index], this.assignedKeysForStep(script[index]))
    ) {
      index += 1;
    }

    if (index >= script.length) {
      actions.setPracticeActive(false);
      actions.setExpectedNotes([]);
      actions.setProgramAssignedKeys([]);
      actions.setProgramRefingerNoteIndex(null);
      return;
    }

    if (index !== useEngineStore.getState().currentStepIndex) {
      runWithProgramStepIndexWrite(() => actions.setStepIndex(index));
    }
  }

  private syncCurrentStepState(): void {
    const { script, actions } = useEngineStore.getState();
    if (!script) {
      actions.setProgramAssignedKeys([]);
      actions.setExpectedNotes([]);
      return;
    }

    const { currentStepIndex } = useEngineStore.getState();
    const step = script[currentStepIndex];

    if (!step) {
      actions.setProgramAssignedKeys([]);
      actions.setExpectedNotes([]);
      return;
    }

    this.syncAssignedToStore(step);
    this.syncExpectedNotes();

    const assigned = this.assignedKeysForStep(step);
    const refingerIndex = useEngineStore.getState().programRefingerNoteIndex;
    const refingerTarget =
      refingerIndex !== null ? (step.notes[refingerIndex] ?? null) : null;

    logProgramAdvance('syncCurrentStepState', {
      stepIndex: currentStepIndex,
      uiStep: currentStepIndex + 1,
      nextStepIndex: currentStepIndex + 1 < script.length ? currentStepIndex + 1 : null,
      needed: countStepNotesByHand(step),
      assignedKeys: [...assigned],
      next: refingerTarget?.pitch ?? programNextUnassignedNote(step, assigned)?.pitch ?? null,
      refingerNoteIndex: refingerIndex,
    });
  }

  /** Jump to a step from a deliberate sheet click; enables score-order refingering. */
  seekToStep(stepIndex: number): void {
    const { script, actions, fingeringMode } = useEngineStore.getState();
    if (fingeringMode !== 'program' || !script) {
      return;
    }

    if (stepIndex < 0 || stepIndex >= script.length) {
      return;
    }

    logProgramAdvance('seekToStep', {
      toIndex: stepIndex,
      toUiStep: stepIndex + 1,
    });

    runWithProgramStepIndexWrite(() => actions.setStepIndex(stepIndex));
    actions.setProgramRefingerNoteIndex(0);
    this.syncCurrentStepState();
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

    this.releaseAllSoundingNotes();
    actions.setHasPracticeStarted(true);
    actions.setPracticeActive(true);
    actions.setProgramRefingerNoteIndex(null);
    this.skipForwardToFirstIncompleteStep();
    this.syncCurrentStepState();
  }

  stop(): void {
    const { actions } = useEngineStore.getState();
    actions.setProgramAssignedKeys([]);
    actions.setProgramRefingerNoteIndex(null);
    this.releaseAllSoundingNotes();
    actions.setPracticeActive(false);
    actions.setHasPracticeStarted(false);
    actions.setExpectedNotes([]);
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

    if (state.programRefingerNoteIndex !== null) {
      this.handleRefingerPress(step, stepIndex, mapping, userId);
      return;
    }

    let assigned = this.assignedKeysForStep(step);
    const nextNote = programNextUnassignedNote(step, assigned);

    if (nextNote === null) {
      if (isProgramStepComplete(step, assigned)) {
        logProgramAdvance('press on complete step — advancing', {
          stepIndex,
          uiStep: stepIndex + 1,
        });
        this.advanceStep();
      } else {
        logProgramAdvance('press ignored (no next note and step incomplete)', {
          stepIndex,
          uiStep: stepIndex + 1,
          assignedKeys: [...assigned],
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

    this.assignFingerToNote(step, stepIndex, nextNote, mapping, userId);

    const afterAssign = useEngineStore.getState();
    const stepAfter = afterAssign.script![stepIndex];
    assigned = this.assignedKeysForStep(stepAfter);

    const complete = isProgramStepComplete(stepAfter, assigned);
    logProgramAdvance('press assigned', {
      stepIndex,
      uiStep: stepIndex + 1,
      target: `${nextNote.hand}:${nextNote.midi}`,
      pitch: nextNote.pitch,
      assignedKeys: [...assigned],
      needed: countStepNotesByHand(stepAfter),
      complete,
    });

    if (complete) {
      this.advanceStep();
    }
  }

  private handleRefingerPress(
    step: StepOrder,
    stepIndex: number,
    mapping: FingerMapping,
    userId?: string | null,
  ): void {
    const { actions } = useEngineStore.getState();
    const refingerIndex = useEngineStore.getState().programRefingerNoteIndex;
    if (refingerIndex === null) {
      return;
    }

    const target = step.notes[refingerIndex];
    if (!target) {
      actions.setProgramRefingerNoteIndex(null);
      return;
    }

    if (mapping.hand !== target.hand) {
      logProgramAdvance('refinger press ignored (wrong hand)', {
        stepIndex,
        uiStep: stepIndex + 1,
        expectedHand: target.hand,
        expectedPitch: target.pitch,
        pressedHand: mapping.hand,
        finger: mapping.finger,
        refingerNoteIndex: refingerIndex,
      });
      return;
    }

    this.assignFingerToNote(step, stepIndex, target, mapping, userId);

    const nextRefingerIndex = refingerIndex + 1;
    if (nextRefingerIndex >= step.notes.length) {
      logProgramAdvance('refinger pass complete — advancing', {
        stepIndex,
        uiStep: stepIndex + 1,
      });
      this.advanceStep();
    } else {
      actions.setProgramRefingerNoteIndex(nextRefingerIndex);
    }
  }

  private assignFingerToNote(
    step: StepOrder,
    stepIndex: number,
    note: StepOrder['notes'][number],
    mapping: FingerMapping,
    userId?: string | null,
  ): void {
    useEngineStore.getState().actions.setManualFingerInProgram(
      step.onset,
      note.hand,
      note.midi,
      mapping.finger,
      userId,
    );

    const afterAssign = useEngineStore.getState();
    const stepAfter = afterAssign.script![stepIndex];
    this.syncAssignedToStore(stepAfter);
    this.syncExpectedNotes();
    this.sustainNote(note.midi, mapping);
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
      actions.setProgramAssignedKeys([]);
      actions.setProgramRefingerNoteIndex(null);
      return;
    }

    actions.setProgramRefingerNoteIndex(null);
    runWithProgramStepIndexWrite(() => actions.setStepIndex(nextIndex));
    this.lockSheetSeek();
  }

  private syncExpectedNotes(): void {
    const { script, currentStepIndex, actions } = useEngineStore.getState();
    if (!script || currentStepIndex < 0 || currentStepIndex >= script.length) {
      actions.setExpectedNotes([]);
      return;
    }

    const step = script[currentStepIndex];
    actions.setExpectedNotes(programStepExpectedMidis(step));
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
