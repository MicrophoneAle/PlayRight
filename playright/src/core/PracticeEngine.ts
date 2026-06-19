import type { AudioEngine } from './AudioEngine.ts';
import {
  getExpectedNoteForFinger,
  getPracticeNotes,
  stepHasPracticeNotes,
} from './practiceSteps.ts';
import { alignScopeToMidis } from './scopeAlign.ts';
import { selectIsPracticeActive, useEngineStore } from '../store/useEngineStore.ts';
import type { ScriptNote } from '../types/index.ts';
import type { FingerMapping } from './twoHandMapping.ts';

export class PracticeEngine {
  private audioEngine: AudioEngine | null = null;
  private expectedNotes: Set<number> = new Set();
  private practiceNotesForStep: ScriptNote[] = [];
  private hitNoteIndices: Set<number> = new Set();
  private completionFrame: number | null = null;

  constructor() {
    useEngineStore.subscribe((state, prevState) => {
      if (state.script !== prevState.script) {
        this.syncAfterScriptChange();
        return;
      }

      if (state.engineMode !== prevState.engineMode && state.script) {
        this.hitNoteIndices.clear();
        this.loadCurrentStep({
          alignScope: state.engineMode === 'one-hand',
        });
      }
    });
  }

  attachAudioEngine(audioEngine: AudioEngine): void {
    this.audioEngine = audioEngine;
  }

  start(): void {
    const { script, currentStepIndex, actions } = useEngineStore.getState();
    if (!script) {
      return;
    }

    if (currentStepIndex >= script.length) {
      actions.setStepIndex(0);
    }

    actions.setHasPracticeStarted(true);
    actions.setPracticeActive(true);
    this.loadCurrentStep({ alignScope: true });
  }

  restart(): void {
    const { script, actions } = useEngineStore.getState();
    if (!script) {
      return;
    }

    this.hitNoteIndices.clear();
    this.expectedNotes.clear();
    this.practiceNotesForStep = [];
    actions.setStepIndex(0);
    actions.setPracticeActive(true);
    this.loadCurrentStep({ alignScope: true });
  }

  pause(): void {
    const { actions } = useEngineStore.getState();
    actions.setPracticeActive(false);
    actions.setExpectedNotes([]);
  }

  /** End the current playthrough and return to the beginning. */
  stop(): void {
    const { script, actions } = useEngineStore.getState();
    if (!script) {
      return;
    }

    this.cancelCompletionCheck();
    this.hitNoteIndices.clear();
    this.expectedNotes.clear();
    this.practiceNotesForStep = [];
    actions.setStepIndex(0);
    actions.setPracticeActive(false);
    actions.setHasPracticeStarted(false);
    actions.setExpectedNotes([]);
  }

  switchHand(resumePractice: boolean): void {
    this.hitNoteIndices.clear();
    this.expectedNotes.clear();
    this.practiceNotesForStep = [];

    if (!useEngineStore.getState().script) {
      return;
    }

    if (resumePractice) {
      this.start();
      return;
    }

    this.prepareCurrentHand();
  }

  /** Load the first step for the active hand without starting practice. */
  prepareCurrentHand(): void {
    const { actions } = useEngineStore.getState();
    actions.setStepIndex(0);
    this.loadCurrentStep({ alignScope: true });
  }

  handleNoteOn(midi: number): void {
    const engine = this.audioEngine;
    if (!engine) {
      return;
    }

    engine.noteOn(midi);

    if (!useEngineStore.getState().isPracticeActive) {
      return;
    }

    this.registerPracticeHit(midi);
  }

  handleFingerPress(mapping: FingerMapping): void {
    const { script, currentStepIndex } = useEngineStore.getState();
    if (!script || currentStepIndex < 0 || currentStepIndex >= script.length) {
      return;
    }

    const currentStep = script[currentStepIndex];
    const expected = getExpectedNoteForFinger(
      currentStep,
      mapping.hand,
      mapping.finger,
    );
    if (expected === null) {
      return;
    }

    this.playNotePreview(expected.midi);

    if (!this.ensureTwoHandPracticeStarted()) {
      return;
    }

    const hitIndex = this.practiceNotesForStep.findIndex(
      (note) => note.hand === mapping.hand && note.finger === mapping.finger,
    );
    if (hitIndex < 0) {
      return;
    }

    this.registerPracticeHitAtIndex(hitIndex);
  }

  /** Two-hand: begin practice on the first correct finger hit if Start was not pressed. */
  private ensureTwoHandPracticeStarted(): boolean {
    const state = useEngineStore.getState();

    if (selectIsPracticeActive(state)) {
      return true;
    }

    if (state.engineMode !== 'two-hand' || !state.script) {
      return false;
    }

    state.actions.setHasPracticeStarted(true);
    state.actions.setPracticeActive(true);
    this.loadCurrentStep({ alignScope: false });
    return true;
  }

  /** Re-register held keys after a step or scope change. */
  registerPracticeHit(midi: number): void {
    if (!useEngineStore.getState().isPracticeActive) {
      return;
    }

    const { engineMode, activeHand } = useEngineStore.getState();

    for (let index = 0; index < this.practiceNotesForStep.length; index += 1) {
      if (this.hitNoteIndices.has(index)) {
        continue;
      }

      const note = this.practiceNotesForStep[index];
      if (note.midi !== midi) {
        continue;
      }

      if (engineMode === 'one-hand' && note.hand !== activeHand) {
        continue;
      }

      this.registerPracticeHitAtIndex(index);
      break;
    }
  }

  private registerPracticeHitAtIndex(index: number): void {
    if (!useEngineStore.getState().isPracticeActive) {
      return;
    }

    if (index < 0 || index >= this.practiceNotesForStep.length) {
      return;
    }

    if (this.hitNoteIndices.has(index)) {
      return;
    }

    this.hitNoteIndices.add(index);
    this.scheduleCompletionCheck();
  }

  private playNotePreview(midi: number): void {
    const engine = this.audioEngine;
    if (!engine) {
      return;
    }

    engine.noteOn(midi);
    engine.noteOff(midi);
  }

  private scheduleCompletionCheck(): void {
    if (this.completionFrame !== null) {
      return;
    }

    this.completionFrame = requestAnimationFrame(() => {
      this.completionFrame = null;
      this.checkStepCompletion();
    });
  }

  private cancelCompletionCheck(): void {
    if (this.completionFrame !== null) {
      cancelAnimationFrame(this.completionFrame);
      this.completionFrame = null;
    }
  }

  private syncAfterScriptChange(): void {
    this.cancelCompletionCheck();
    this.loadCurrentStep({
      alignScope: useEngineStore.getState().script !== null,
    });
  }

  loadCurrentStep(options: { alignScope?: boolean } = {}): void {
    const { alignScope = false } = options;
    const { script, engineMode, activeHand, actions } = useEngineStore.getState();

    this.hitNoteIndices.clear();
    this.expectedNotes.clear();
    this.practiceNotesForStep = [];

    if (!script) {
      actions.setExpectedNotes([]);
      return;
    }

    let index = useEngineStore.getState().currentStepIndex;

    while (index < script.length) {
      const step = script[index];
      if (stepHasPracticeNotes(step, engineMode, activeHand)) {
        break;
      }
      index += 1;
    }

    if (index !== useEngineStore.getState().currentStepIndex) {
      actions.setStepIndex(index);
    }

    if (index >= script.length) {
      actions.setPracticeActive(false);
      actions.setExpectedNotes([]);
      return;
    }

    const practiceNotes = getPracticeNotes(script[index], engineMode, activeHand);
    this.practiceNotesForStep = practiceNotes;
    for (const note of practiceNotes) {
      this.expectedNotes.add(note.midi);
    }

    actions.setExpectedNotes(Array.from(this.expectedNotes));

    if (alignScope || useEngineStore.getState().isPracticeActive) {
      alignScopeToMidis(this.expectedNotes);
    }
  }

  private checkStepCompletion(): void {
    if (this.hitNoteIndices.size !== this.practiceNotesForStep.length) {
      return;
    }

    const { script, currentStepIndex, actions } = useEngineStore.getState();
    const nextIndex = currentStepIndex + 1;

    actions.setStepIndex(nextIndex);

    if (!script || nextIndex >= script.length) {
      actions.setPracticeActive(false);
      actions.setExpectedNotes([]);
      this.hitNoteIndices.clear();
      this.expectedNotes.clear();
      this.practiceNotesForStep = [];
      this.cancelCompletionCheck();
      return;
    }

    this.loadCurrentStep();
  }
}

export const practiceEngine = new PracticeEngine();
