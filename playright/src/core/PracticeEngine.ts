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

    actions.setPracticeActive(true);
    this.loadCurrentStep();
  }

  pause(): void {
    useEngineStore.getState().actions.setPracticeActive(false);
  }

  onHandChanged(): void {
    this.hitNotes.clear();
    this.expectedNotes.clear();
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

  loadCurrentStep(): void {
    const { script, engineMode, activeHand, actions } = useEngineStore.getState();

    this.hitNotes.clear();
    this.expectedNotes.clear();

    if (!script) {
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
      return;
    }

    const practiceNotes = getPracticeNotes(script[index], engineMode, activeHand);
    for (const note of practiceNotes) {
      this.expectedNotes.add(note.midi);
    }

    if (useEngineStore.getState().isPracticeActive) {
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
      this.hitNotes.clear();
      this.expectedNotes.clear();
      return;
    }

    this.loadCurrentStep();
  }
}

export const practiceEngine = new PracticeEngine();
