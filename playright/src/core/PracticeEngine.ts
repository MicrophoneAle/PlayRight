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
  private soundingMidis = new Set<number>();
  private activeFingerSounds = new Map<string, number>();
  private storeSubscriptionInitialized = false;

  /** Subscribe to store changes once; safe to call repeatedly (StrictMode, HMR). */
  ensureStoreSubscription(): void {
    if (this.storeSubscriptionInitialized) {
      return;
    }

    this.storeSubscriptionInitialized = true;

    useEngineStore.subscribe((state, prevState) => {
      if (state.script !== prevState.script) {
        if (state.fingeringMode === 'program' || state.fingeringMode === 'edit') {
          return;
        }

        this.syncAfterScriptChange();
        return;
      }

      if (state.playMode !== prevState.playMode && state.script) {
        this.syncAfterPlayModeChange(state.playMode);
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

  /** Pause practice without resetting step (entering fingering program/edit). */
  suspendForFingeringMode(): void {
    this.hitNoteIndices.clear();
    this.expectedNotes.clear();
    this.practiceNotesForStep = [];
    this.releaseAllSoundingNotes();
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

    this.hitNoteIndices.clear();
    this.expectedNotes.clear();
    this.practiceNotesForStep = [];
    this.releaseAllSoundingNotes();
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

    if (!this.soundingMidis.has(midi)) {
      engine.noteOn(midi);
      this.soundingMidis.add(midi);
    }

    if (!useEngineStore.getState().isPracticeActive) {
      return;
    }

    this.registerPracticeHit(midi);
  }

  handleNoteOff(midi: number): void {
    const engine = this.audioEngine;
    if (!engine || !this.soundingMidis.has(midi)) {
      return;
    }

    engine.noteOff(midi);
    this.soundingMidis.delete(midi);
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

    const isTwoHand = useEngineStore.getState().engineMode === 'two-hand';

    if (!this.ensureTwoHandPracticeStarted()) {
      if (!isTwoHand) {
        this.playNotePreview(expected.midi);
      }
      return;
    }

    if (isTwoHand) {
      this.sustainNote(expected.midi, mapping);
    } else {
      this.playNotePreview(expected.midi);
    }

    if (!useEngineStore.getState().isPracticeActive) {
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

  handleFingerRelease(mapping: FingerMapping): void {
    const fingerKey = `${mapping.hand}:${mapping.finger}`;
    const midi = this.activeFingerSounds.get(fingerKey);
    if (midi === undefined) {
      return;
    }

    this.handleNoteOff(midi);
    this.activeFingerSounds.delete(fingerKey);
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

  registerPracticeHit(midi: number): void {
    if (!useEngineStore.getState().isPracticeActive) {
      return;
    }

    const { engineMode, activeHand } = useEngineStore.getState();

    // Mark every matching note for this midi first, then check completion ONCE.
    // Checking inside the loop could advance the step (reassigning
    // practiceNotesForStep) mid-iteration and corrupt the next step's hits.
    let marked = false;
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

      if (this.markHitAtIndex(index)) {
        marked = true;
      }
    }

    if (marked) {
      this.checkStepCompletion();
    }
  }

  private registerPracticeHitAtIndex(index: number): void {
    if (this.markHitAtIndex(index)) {
      this.checkStepCompletion();
    }
  }

  /**
   * Record a hit without advancing. Returns true when a new hit was recorded.
   * Completion is checked synchronously by the caller so the step advances within
   * the same event, before the next keydown is processed — otherwise a chord (or a
   * note pressed immediately after) is matched against the not-yet-advanced step
   * and silently dropped, forcing the player to space notes out.
   */
  private markHitAtIndex(index: number): boolean {
    if (!useEngineStore.getState().isPracticeActive) {
      return false;
    }

    if (index < 0 || index >= this.practiceNotesForStep.length) {
      return false;
    }

    if (this.hitNoteIndices.has(index)) {
      return false;
    }

    this.hitNoteIndices.add(index);
    return true;
  }

  private releaseAllSoundingNotes(): void {
    const engine = this.audioEngine;
    if (!engine) {
      this.soundingMidis.clear();
      return;
    }

    for (const midi of this.soundingMidis) {
      engine.noteOff(midi);
    }

    this.soundingMidis.clear();
    this.activeFingerSounds.clear();
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

  private playNotePreview(midi: number): void {
    const engine = this.audioEngine;
    if (!engine) {
      return;
    }

    engine.noteOn(midi);
    engine.noteOff(midi);
  }

  private syncAfterScriptChange(): void {
    this.loadCurrentStep({
      alignScope: useEngineStore.getState().script !== null,
    });
  }

  private syncAfterPlayModeChange(playMode: boolean): void {
    this.hitNoteIndices.clear();
    this.expectedNotes.clear();
    this.practiceNotesForStep = [];
    this.releaseAllSoundingNotes();

    if (!playMode) {
      this.loadCurrentStep({ alignScope: true });
    }
  }

  loadCurrentStep(options: { alignScope?: boolean; exactStep?: boolean } = {}): void {
    const { alignScope = false, exactStep = false } = options;
    const { script, engineMode, activeHand, actions } = useEngineStore.getState();

    this.hitNoteIndices.clear();
    this.expectedNotes.clear();
    this.practiceNotesForStep = [];

    if (!script) {
      actions.setExpectedNotes([]);
      return;
    }

    let index = useEngineStore.getState().currentStepIndex;

    if (exactStep && !stepHasPracticeNotes(script[index], engineMode, activeHand)) {
      const nearest = this.findNearestStepWithPracticeNotes(index);
      if (nearest === null) {
        actions.setPracticeActive(false);
        actions.setExpectedNotes([]);
        return;
      }

      index = nearest;
      actions.setStepIndex(index);
    } else if (!exactStep) {
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
    }

    if (index >= script.length) {
      actions.setPracticeActive(false);
      actions.setExpectedNotes([]);
      return;
    }

    const practiceNotes = getPracticeNotes(script[index], engineMode, activeHand);
    // Two-hand practice matches keys by finger; notes without a finger assignment
    // cannot be pressed and must not block step completion (e.g. chord overflow).
    const playableNotes =
      engineMode === 'two-hand'
        ? practiceNotes.filter((note) => note.finger !== null)
        : practiceNotes;
    this.practiceNotesForStep = playableNotes;
    const stepMidis = playableNotes.map((note) => note.midi);
    for (const midi of stepMidis) {
      this.expectedNotes.add(midi);
    }

    actions.setExpectedNotes(stepMidis);

    if (alignScope || useEngineStore.getState().isPracticeActive) {
      alignScopeToMidis(stepMidis);
    }
  }

  seekToStep(stepIndex: number): void {
    const { script, actions } = useEngineStore.getState();
    if (!script || stepIndex < 0 || stepIndex >= script.length) {
      return;
    }

    actions.setStepIndex(stepIndex);
    this.loadCurrentStep({
      alignScope: useEngineStore.getState().isPracticeActive,
      exactStep: true,
    });
  }

  private findNearestStepWithPracticeNotes(fromIndex: number): number | null {
    const { script, engineMode, activeHand } = useEngineStore.getState();
    if (!script) {
      return null;
    }

    if (stepHasPracticeNotes(script[fromIndex], engineMode, activeHand)) {
      return fromIndex;
    }

    for (let distance = 1; distance < script.length; distance += 1) {
      const forward = fromIndex + distance;
      if (
        forward < script.length &&
        stepHasPracticeNotes(script[forward], engineMode, activeHand)
      ) {
        return forward;
      }

      const backward = fromIndex - distance;
      if (
        backward >= 0 &&
        stepHasPracticeNotes(script[backward], engineMode, activeHand)
      ) {
        return backward;
      }
    }

    return null;
  }

  private checkStepCompletion(): void {
    if (this.practiceNotesForStep.length === 0) {
      return;
    }

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
      return;
    }

    this.loadCurrentStep();
  }
}

export const practiceEngine = new PracticeEngine();
