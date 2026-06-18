import type { AudioEngine } from './AudioEngine.ts';
import {
  getPracticeNotes,
  stepHasPracticeNotes,
} from './practiceSteps.ts';
import { alignScopeToMidis } from './scopeAlign.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

export class PracticeEngine {
  private audioEngine: AudioEngine | null = null;
  private expectedNotes: Set<number> = new Set();
  private hitNotes: Set<number> = new Set();

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

    this.hitNotes.clear();
    this.expectedNotes.clear();
    actions.setStepIndex(0);
    actions.setPracticeActive(true);
    this.loadCurrentStep({ alignScope: true });
  }

  pause(): void {
    const { actions } = useEngineStore.getState();
    actions.setPracticeActive(false);
    actions.setExpectedNotes([]);
  }

  switchHand(resumePractice: boolean): void {
    this.hitNotes.clear();
    this.expectedNotes.clear();

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

    if (!this.expectedNotes.has(midi)) {
      return;
    }

    this.hitNotes.add(midi);
    this.checkStepCompletion();
  }

  loadCurrentStep(options: { alignScope?: boolean } = {}): void {
    const { alignScope = false } = options;
    const { script, engineMode, activeHand, actions } = useEngineStore.getState();

    this.hitNotes.clear();
    this.expectedNotes.clear();

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
    for (const note of practiceNotes) {
      this.expectedNotes.add(note.midi);
    }

    actions.setExpectedNotes(Array.from(this.expectedNotes));

    if (alignScope || useEngineStore.getState().isPracticeActive) {
      alignScopeToMidis(this.expectedNotes);
    }
  }

  private checkStepCompletion(): void {
    if (this.hitNotes.size !== this.expectedNotes.size) {
      return;
    }

    const { script, currentStepIndex, actions } = useEngineStore.getState();
    const nextIndex = currentStepIndex + 1;

    actions.setStepIndex(nextIndex);

    if (!script || nextIndex >= script.length) {
      actions.setPracticeActive(false);
      actions.setExpectedNotes([]);
      this.hitNotes.clear();
      this.expectedNotes.clear();
      return;
    }

    this.loadCurrentStep();
  }
}

export const practiceEngine = new PracticeEngine();
