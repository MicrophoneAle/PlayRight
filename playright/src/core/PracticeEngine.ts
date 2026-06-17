import type { AudioEngine } from './AudioEngine.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

export class PracticeEngine {
  private audioEngine: AudioEngine | null = null;
  private expectedNotes: Set<number> = new Set();
  private hitNotes: Set<number> = new Set();

  attachAudioEngine(audioEngine: AudioEngine): void {
    this.audioEngine = audioEngine;
  }

  start(): void {
    const { actions } = useEngineStore.getState();
    actions.setPracticeActive(true);
    this.loadCurrentStep();
  }

  pause(): void {
    useEngineStore.getState().actions.setPracticeActive(false);
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
    const { script, currentStepIndex } = useEngineStore.getState();

    this.hitNotes.clear();
    this.expectedNotes.clear();

    if (!script || currentStepIndex >= script.length) {
      return;
    }

    const step = script[currentStepIndex];
    for (const note of step.notes) {
      this.expectedNotes.add(note.midi);
    }
  }

  private checkStepCompletion(): void {
    if (this.hitNotes.size !== this.expectedNotes.size) {
      return;
    }

    const { currentStepIndex, totalSteps, actions } = useEngineStore.getState();
    const nextIndex = currentStepIndex + 1;

    actions.setStepIndex(nextIndex);

    if (nextIndex >= totalSteps) {
      actions.setPracticeActive(false);
      this.hitNotes.clear();
      this.expectedNotes.clear();
      return;
    }

    this.loadCurrentStep();
  }
}

export const practiceEngine = new PracticeEngine();
