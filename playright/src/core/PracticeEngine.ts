import type { AudioEngine } from './AudioEngine.ts';
import { PlayingMidiPressTracker } from './playingMidiPressTracker.ts';
import {
  firstPositionWithinStep,
  getExpectedNoteForFingerAtPosition,
  getPlayablePracticeNotesForPosition,
  positionHasRequiredPracticeNotes,
  stepHasAnyPracticeContent,
} from './practiceSteps.ts';
import { alignScopeToMidis } from './scopeAlign.ts';
import { selectIsPracticeActive, useEngineStore } from '../store/useEngineStore.ts';
import type { Hand, PlaybackScript, PracticePosition, ScriptNote } from '../types/index.ts';
import type { FingerMapping } from './twoHandMapping.ts';

export class PracticeEngine {
  private audioEngine: AudioEngine | null = null;
  private expectedNotes: Set<number> = new Set();
  private practiceNotesForStep: ScriptNote[] = [];
  private hitNoteIndices: Set<number> = new Set();
  private soundingMidis = new Set<number>();
  private activeFingerSounds = new Map<string, number>();
  private practicePressTracker = new PlayingMidiPressTracker();
  private storeSubscriptionInitialized = false;

  /** Subscribe to store changes once; safe to call repeatedly (StrictMode, HMR). */
  ensureStoreSubscription(): void {
    if (this.storeSubscriptionInitialized) {
      return;
    }

    this.storeSubscriptionInitialized = true;

    useEngineStore.subscribe((state, prevState) => {
      if (state.script !== prevState.script) {
        if (state.fingeringMode === 'program') {
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
    actions.setPracticeGraceCursor(null);
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
    actions.setPracticeGraceCursor(null);
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
    actions.setPracticeGraceCursor(null);
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
    this.loadCurrentStep({ alignScope: false });
  }

  handleNoteOn(midi: number): void {
    this.attackMidi(midi);
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
    this.practicePressTracker.releaseMatching((note) => note.midi === midi);
    this.syncPracticeSoundingToStore();
  }

  handleFingerPress(mapping: FingerMapping): void {
    const { script, currentStepIndex, practiceGraceCursor } = useEngineStore.getState();
    if (!script || currentStepIndex < 0 || currentStepIndex >= script.length) {
      return;
    }

    const position = this.currentPosition(currentStepIndex, practiceGraceCursor);
    const expected = getExpectedNoteForFingerAtPosition(
      script,
      position,
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
      (note) =>
        (note.playingHand ?? note.hand) === mapping.hand &&
        note.finger === mapping.finger,
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
      this.activeFingerSounds.clear();
      this.practicePressTracker.clear();
      this.clearPracticeSoundingInStore();
      return;
    }

    for (const midi of this.soundingMidis) {
      engine.noteOff(midi);
    }

    this.soundingMidis.clear();
    this.activeFingerSounds.clear();
    this.practicePressTracker.clear();
    this.clearPracticeSoundingInStore();
  }

  private attackMidi(midi: number, hand?: Hand): void {
    const engine = this.audioEngine;
    if (!engine) {
      return;
    }

    if (this.soundingMidis.has(midi)) {
      return;
    }

    engine.noteOn(midi);
    this.soundingMidis.add(midi);
    this.trackPracticePress(midi, hand);
  }

  private trackPracticePress(midi: number, explicitHand?: Hand): void {
    if (!selectIsPracticeActive(useEngineStore.getState())) {
      return;
    }

    const { currentStepIndex, engineMode, activeHand } = useEngineStore.getState();
    const matchingNotes = this.practiceNotesForStep.filter((note) => note.midi === midi);
    const hands =
      explicitHand !== undefined
        ? [explicitHand]
        : matchingNotes
            .filter((note) => engineMode !== 'one-hand' || note.hand === activeHand)
            .map((note) => note.hand);

    const uniqueHands = [...new Set(hands.length > 0 ? hands : engineMode === 'one-hand' ? [activeHand] : [])];
    if (uniqueHands.length === 0) {
      return;
    }

    for (const hand of uniqueHands) {
      this.practicePressTracker.press({
        pressId: this.practicePressTracker.allocatePressId(),
        stepIndex: currentStepIndex,
        midi,
        hand,
      });
    }

    this.syncPracticeSoundingToStore();
  }

  private syncPracticeSoundingToStore(): void {
    if (!selectIsPracticeActive(useEngineStore.getState())) {
      return;
    }

    const { actions } = useEngineStore.getState();
    actions.setPlayingPlaybackNotes(this.practicePressTracker.activeNotes());
    actions.setPlayingMidiNotes(this.practicePressTracker.activeMidis());
  }

  private clearPracticeSoundingInStore(): void {
    const { actions } = useEngineStore.getState();
    actions.setPlayingPlaybackNotes([]);
    actions.setPlayingMidiNotes([]);
  }

  private sustainNote(midi: number, mapping: FingerMapping): void {
    this.attackMidi(midi, mapping.hand);
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

  /** Resolve the walk position for a (step, graceCursor) pair. */
  private currentPosition(
    stepIndex: number,
    graceCursor: number | null,
  ): PracticePosition {
    return graceCursor === null
      ? { kind: 'main', stepIndex }
      : { kind: 'grace', stepIndex, graceIndex: graceCursor };
  }

  /**
   * Set practiceNotesForStep/expectedNotes for an already-resolved position.
   * Callers own step-boundary and within-step position resolution; this only
   * loads the notes for the position they land on.
   */
  private loadPositionNotes(
    script: PlaybackScript,
    stepIndex: number,
    graceCursor: number | null,
    alignScope: boolean,
  ): void {
    const { engineMode, activeHand, actions } = useEngineStore.getState();
    const position = this.currentPosition(stepIndex, graceCursor);

    this.hitNoteIndices.clear();
    this.expectedNotes.clear();

    const playableNotes = getPlayablePracticeNotesForPosition(
      script,
      position,
      engineMode,
      activeHand,
    );
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

  loadCurrentStep(options: { alignScope?: boolean; exactStep?: boolean } = {}): void {
    const { alignScope = false, exactStep = false } = options;
    const { script, engineMode, activeHand, actions } = useEngineStore.getState();

    this.hitNoteIndices.clear();
    this.expectedNotes.clear();
    this.practiceNotesForStep = [];

    if (!script) {
      actions.setExpectedNotes([]);
      actions.setPracticeGraceCursor(null);
      return;
    }

    let index = useEngineStore.getState().currentStepIndex;

    if (exactStep && !stepHasAnyPracticeContent(script, index, engineMode, activeHand)) {
      const nearest = this.findNearestStepWithPracticeNotes(index);
      if (nearest === null) {
        actions.setPracticeActive(false);
        actions.setExpectedNotes([]);
        actions.setPracticeGraceCursor(null);
        return;
      }

      index = nearest;
      actions.setStepIndex(index);
    } else if (!exactStep) {
      while (index < script.length) {
        if (stepHasAnyPracticeContent(script, index, engineMode, activeHand)) {
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
      actions.setPracticeGraceCursor(null);
      return;
    }

    const graceCursor = firstPositionWithinStep(script, index, engineMode, activeHand);
    actions.setPracticeGraceCursor(graceCursor);
    this.loadPositionNotes(script, index, graceCursor, alignScope);
  }

  seekToStep(stepIndex: number): void {
    const { script, actions } = useEngineStore.getState();
    if (!script || stepIndex < 0 || stepIndex >= script.length) {
      return;
    }

    this.releaseAllSoundingNotes();
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

    if (stepHasAnyPracticeContent(script, fromIndex, engineMode, activeHand)) {
      return fromIndex;
    }

    for (let distance = 1; distance < script.length; distance += 1) {
      const forward = fromIndex + distance;
      if (
        forward < script.length &&
        stepHasAnyPracticeContent(script, forward, engineMode, activeHand)
      ) {
        return forward;
      }

      const backward = fromIndex - distance;
      if (
        backward >= 0 &&
        stepHasAnyPracticeContent(script, backward, engineMode, activeHand)
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

    const { script, currentStepIndex, practiceGraceCursor, engineMode, activeHand, actions } =
      useEngineStore.getState();
    if (!script) {
      return;
    }

    if (practiceGraceCursor !== null) {
      const graceCount = script[currentStepIndex]?.graceBefore?.length ?? 0;

      for (
        let graceIndex = practiceGraceCursor + 1;
        graceIndex < graceCount;
        graceIndex += 1
      ) {
        if (
          positionHasRequiredPracticeNotes(
            script,
            { kind: 'grace', stepIndex: currentStepIndex, graceIndex },
            engineMode,
            activeHand,
          )
        ) {
          actions.setPracticeGraceCursor(graceIndex);
          this.loadPositionNotes(script, currentStepIndex, graceIndex, false);
          return;
        }
      }

      // Graces exhausted; try the step's main position next.
      if (
        positionHasRequiredPracticeNotes(
          script,
          { kind: 'main', stepIndex: currentStepIndex },
          engineMode,
          activeHand,
        )
      ) {
        actions.setPracticeGraceCursor(null);
        this.loadPositionNotes(script, currentStepIndex, null, false);
        return;
      }

      // Main doesn't qualify either (e.g. one-hand mode, main notes belong to
      // the other hand) - fall through to advance past this step entirely.
    }

    const nextIndex = currentStepIndex + 1;

    actions.setStepIndex(nextIndex);
    actions.setPracticeGraceCursor(null);

    if (nextIndex >= script.length) {
      actions.setPracticeActive(false);
      actions.setExpectedNotes([]);
      this.hitNoteIndices.clear();
      this.expectedNotes.clear();
      this.practiceNotesForStep = [];
      this.clearPracticeSoundingInStore();
      return;
    }

    this.loadCurrentStep();
  }
}

export const practiceEngine = new PracticeEngine();
