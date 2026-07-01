import type { AudioEngine } from './AudioEngine.ts';
import {
  buildTwoHandExpectedMidis,
  buildProgramAssignedKeys,
  countStepNotesByHand,
  isProgramStepComplete,
  programAssignmentKey,
  programTargetNote,
} from './practiceSteps.ts';
import { useEngineStore } from '../store/useEngineStore.ts';
import type { FingerMapping } from './twoHandMapping.ts';
import type { Hand, StepOrder } from '../types/index.ts';

function assignedArray(assigned: ReadonlySet<string>): string[] {
  return [...assigned].sort();
}

function handMidisAscending(step: StepOrder, hand: Hand): number[] {
  return step.notes
    .filter((note) => note.hand === hand)
    .map((note) => note.midi)
    .sort((left, right) => left - right);
}

function lowestUnassignedMidi(
  step: StepOrder,
  hand: Hand,
  assigned: ReadonlySet<string>,
): number | null {
  const candidates = step.notes
    .filter(
      (note) =>
        note.hand === hand && !assigned.has(programAssignmentKey(hand, note.midi)),
    )
    .sort((left, right) => left.midi - right.midi);
  return candidates[0]?.midi ?? null;
}

function programCompletionDiagnostics(
  step: StepOrder,
  assigned: ReadonlySet<string>,
): {
  needed: Record<Hand, number>;
  assignedCounts: Record<Hand, number>;
  complete: boolean;
} {
  const needed = countStepNotesByHand(step);
  const assignedCounts: Record<Hand, number> = { L: 0, R: 0 };
  for (const note of step.notes) {
    if (assigned.has(programAssignmentKey(note.hand, note.midi))) {
      assignedCounts[note.hand] += 1;
    }
  }
  return {
    needed,
    assignedCounts,
    complete: assignedCounts.L >= needed.L && assignedCounts.R >= needed.R,
  };
}

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
        console.log('[ProgramAdvance] subscription: currentStepIndex changed', {
          from: prevState.currentStepIndex,
          to: state.currentStepIndex,
          assignedThisStepBeforeClear: assignedArray(this.assignedThisStep),
        });
        this.assignedThisStep.clear();
        this.syncAssignedToStore();
        this.syncExpectedNotes();
        console.log('[ProgramAdvance] subscription: after stepIndex branch', {
          assignedThisStep: assignedArray(this.assignedThisStep),
        });
        return;
      }

      if (state.script !== prevState.script && state.script) {
        console.log('[ProgramAdvance] subscription: script changed', {
          currentStepIndex: state.currentStepIndex,
          assignedThisStepBeforeSync: assignedArray(this.assignedThisStep),
        });
        const step = state.script[state.currentStepIndex];
        if (step) {
          this.syncAssignedFromStep(step);
          console.log('[ProgramAdvance] subscription: after syncAssignedFromStep', {
            assignedThisStep: assignedArray(this.assignedThisStep),
            manualFingeringsForStep: step.notes.map((note) => ({
              hand: note.hand,
              midi: note.midi,
              key: `${step.onset}:${note.hand}:${note.midi}`,
            })),
          });
        }
      }
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
    const neededAtEntry = countStepNotesByHand(step);
    console.log('[ProgramAdvance] handleFingerPress entry', {
      currentStepIndex,
      hand: mapping.hand,
      finger: mapping.finger,
      needed: neededAtEntry,
      handMidisAscending: {
        L: handMidisAscending(step, 'L'),
        R: handMidisAscending(step, 'R'),
      },
      assignedThisStepAtEntry: assignedArray(this.assignedThisStep),
    });

    this.syncAssignedFromStep(step);
    console.log('[ProgramAdvance] after syncAssignedFromStep at entry', {
      assignedThisStep: assignedArray(this.assignedThisStep),
    });

    const expectedLowest = lowestUnassignedMidi(step, mapping.hand, this.assignedThisStep);
    const target = programTargetNote(step, mapping.hand, this.assignedThisStep);
    if (target === null) {
      console.log('[ProgramAdvance] programTargetNote returned NULL — press dropped', {
        hand: mapping.hand,
        finger: mapping.finger,
        expectedLowestUnassignedMidi: expectedLowest,
        assignedThisStep: assignedArray(this.assignedThisStep),
      });
      return;
    }

    const targetNotLowest =
      expectedLowest !== null && target.midi !== expectedLowest;
    console.log('[ProgramAdvance] programTargetNote result', {
      targetHand: target.hand,
      targetMidi: target.midi,
      expectedLowestUnassignedMidi: expectedLowest,
      ...(targetNotLowest ? { FLAG: 'target is NOT lowest unassigned midi on hand' } : {}),
    });

    console.log('[ProgramAdvance] assignedThisStep before setManualFinger', {
      assignedThisStep: assignedArray(this.assignedThisStep),
    });

    state.actions.setManualFinger(
      step.onset,
      target.hand,
      target.midi,
      mapping.finger,
      userId,
    );

    console.log('[ProgramAdvance] assignedThisStep after setManualFinger (before local add)', {
      assignedThisStep: assignedArray(this.assignedThisStep),
    });

    this.assignedThisStep.add(programAssignmentKey(target.hand, target.midi));
    this.syncAssignedToStore();
    this.sustainNote(target.midi, mapping);

    console.log('[ProgramAdvance] assignedThisStep after local add', {
      assignedThisStep: assignedArray(this.assignedThisStep),
    });

    const freshState = useEngineStore.getState();
    const freshStep = freshState.script?.[currentStepIndex];
    if (!freshStep) {
      console.log('[ProgramAdvance] freshStep missing after setManualFinger', {
        currentStepIndex,
      });
      return;
    }

    this.syncAssignedFromStep(freshStep);
    console.log('[ProgramAdvance] assignedThisStep after post-setManualFinger syncAssignedFromStep', {
      assignedThisStep: assignedArray(this.assignedThisStep),
    });

    const completion = programCompletionDiagnostics(freshStep, this.assignedThisStep);
    const stepComplete = isProgramStepComplete(freshStep, this.assignedThisStep);
    console.log('[ProgramAdvance] isProgramStepComplete check', {
      ...completion,
      isProgramStepComplete: stepComplete,
    });

    if (stepComplete) {
      const oldIndex = useEngineStore.getState().currentStepIndex;
      console.log('[ProgramAdvance] calling advanceStep()', { oldIndex });
      this.advanceStep();
      const newIndex = useEngineStore.getState().currentStepIndex;
      console.log('[ProgramAdvance] advanceStep() finished', { oldIndex, newIndex });
    } else {
      console.log('[ProgramAdvance] advanceStep() NOT called — step incomplete');
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

    console.log('[ProgramAdvance] advanceStep internal', { currentStepIndex });

    this.assignedThisStep.clear();
    this.syncAssignedToStore();
    const nextIndex = currentStepIndex + 1;

    if (nextIndex >= script.length) {
      console.log('[ProgramAdvance] advanceStep: end of piece', { nextIndex });
      actions.setPracticeActive(false);
      actions.setExpectedNotes([]);
      return;
    }

    actions.setStepIndex(nextIndex);
    this.syncExpectedNotes();
    console.log('[ProgramAdvance] advanceStep: setStepIndex', {
      from: currentStepIndex,
      to: nextIndex,
    });
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
