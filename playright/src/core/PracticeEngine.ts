import type { AudioEngine } from './AudioEngine.ts';
import { PlayingMidiPressTracker } from './playingMidiPressTracker.ts';
import {
  firstPositionWithinStep,
  getExpectedNoteForFingerAtPosition,
  getPlayablePracticeNotesForPosition,
  positionHasRequiredPracticeNotes,
  stepHasAnyPracticeContent,
} from './practiceSteps.ts';
import {
  buildPracticePositionOffsets,
  countPracticePositions,
  countScoreablePracticePositions,
  practicePositionIndexFromCursor,
  wrongNoteFeedbackMidi,
  type PracticeAttemptOutcome,
} from './practiceScoring.ts';
import { alignScopeToPracticeNotes, centerScopeOnPracticeNotes } from './scopeAlign.ts';
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
  /** Last step is hit but final held notes must release before practice ends. */
  private pendingPieceCompletion = false;
  /** MIDI pitches from the completed final step still held down. */
  private pendingFinalStepMidis = new Set<number>();
  /** Index of each step's first walk position, for the scoring session's script. */
  private scoringPositionOffsets: number[] = [];

  /** Subscribe to store changes once. Safe to call repeatedly (StrictMode, HMR). */
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
    this.pendingPieceCompletion = false;
    this.pendingFinalStepMidis.clear();
    this.beginScoringSession();
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
    this.pendingPieceCompletion = false;
    this.pendingFinalStepMidis.clear();
    this.beginScoringSession();
    this.loadCurrentStep({ alignScope: true });
  }

  pause(): void {
    const { actions } = useEngineStore.getState();
    this.pendingPieceCompletion = false;
    this.pendingFinalStepMidis.clear();
    actions.setPracticeActive(false);
    actions.setExpectedNotes([]);
  }

  /** Pause practice without resetting step (entering fingering program/edit). */
  suspendForFingeringMode(): void {
    this.hitNoteIndices.clear();
    this.expectedNotes.clear();
    this.practiceNotesForStep = [];
    this.pendingPieceCompletion = false;
    this.pendingFinalStepMidis.clear();
    this.releaseAllSoundingNotes();
    this.resetScoringSession();
    const { actions } = useEngineStore.getState();
    actions.setPracticeActive(false);
    actions.setExpectedNotes([]);
    // The grace cursor is deliberately NOT cleared: this path suspends practice
    // without resetting position, and the grace sub-position is part of that
    // position. Program mode ignores it (it derives its own capture target), so
    // holding it here is inert until practice resumes.
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
    this.pendingPieceCompletion = false;
    this.pendingFinalStepMidis.clear();
    this.releaseAllSoundingNotes();
    this.resetScoringSession();
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
    this.resetScoringSession();

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
    const { actions, engineMode } = useEngineStore.getState();
    actions.setStepIndex(0);
    this.loadCurrentStep({ alignScope: engineMode === 'one-hand' });
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
    if (engine && this.soundingMidis.has(midi)) {
      engine.noteOff(midi);
      this.soundingMidis.delete(midi);
      this.practicePressTracker.releaseMatching((note) => note.midi === midi);
      this.syncPracticeSoundingToStore();
    }

    if (this.pendingPieceCompletion) {
      this.pendingFinalStepMidis.delete(midi);
    }

    this.tryFinalizePieceCompletion();
  }

  handleFingerPress(mapping: FingerMapping): void {
    const { script, currentStepIndex, practiceGraceCursor } = useEngineStore.getState();
    if (!script || currentStepIndex < 0 || currentStepIndex >= script.length) {
      return;
    }

    const position = this.currentPosition(currentStepIndex, practiceGraceCursor);
    // Match any note at this position with this finger, including notes
    // already marked hit (a re-press is neutral: it re-articulates but does
    // not count as progress or as an error).
    const expected = getExpectedNoteForFingerAtPosition(
      script,
      position,
      mapping.hand,
      mapping.finger,
    );
    if (expected === null) {
      // One of the ten mapped finger keys with no note at this position: a
      // wrong note. Unmapped keys (space, enter, arrows, any other shortcut)
      // never reach here at all - InputManager only emits a FingerMapping for
      // the ten slots in the store's twoHandKeyBindings.
      if (selectIsPracticeActive(useEngineStore.getState())) {
        this.handleWrongFingerPress(mapping);
      }
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
      // Always (re)articulate matching finger presses for the current position,
      // even when that note was already counted toward step completion.
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

    // markHitAtIndex no-ops when already hit, so completion state does not
    // regress. Only the first hit counts toward advancement.
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

  /** In two-hand mode, begin practice on the first correct finger hit if Start was not pressed. */
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
    this.beginScoringSession();
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
      return;
    }

    // One-hand (MIDI) mode owns its own wrong-note detection: two-hand presses
    // arrive as finger mappings through handleFingerPress instead.
    if (engineMode === 'one-hand') {
      this.registerOneHandMiss(midi);
    }
  }

  /**
   * A one-hand press that marked nothing. A re-press of a note already hit at
   * this position is neutral. Everything else - a pitch in no note here, the
   * other hand's note, or a note expected at a later position - is wrong. The
   * pressed key already sounded its own (wrong) pitch in attackMidi, which is
   * the audible feedback for this path.
   */
  private registerOneHandMiss(midi: number): void {
    for (const index of this.hitNoteIndices) {
      if (this.practiceNotesForStep[index]?.midi === midi) {
        return;
      }
    }

    this.recordScoringAttempt('wrong');
  }

  private registerPracticeHitAtIndex(index: number): void {
    if (this.markHitAtIndex(index)) {
      this.checkStepCompletion();
    }
  }

  /**
   * Record a hit without advancing. Returns true when a new hit was recorded.
   * Completion is checked synchronously by the caller so the step advances within
   * the same event, before the next keydown is processed. Otherwise a chord (or a
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
    this.recordScoringAttempt('correct');
    return true;
  }

  /**
   * Open a scoring session for the current script/mode/hand. Called from every
   * point practice actually begins, including the auto-start path in
   * ensureTwoHandPracticeStarted (a session can start from a finger press with
   * no explicit Start).
   */
  private beginScoringSession(): void {
    const { script, engineMode, activeHand, actions } = useEngineStore.getState();
    if (!script) {
      this.scoringPositionOffsets = [];
      actions.resetPracticeScoring();
      return;
    }

    this.scoringPositionOffsets = buildPracticePositionOffsets(script);
    actions.startPracticeScoring(
      countPracticePositions(script),
      countScoreablePracticePositions(script, engineMode, activeHand),
    );
  }

  private resetScoringSession(): void {
    this.scoringPositionOffsets = [];
    useEngineStore.getState().actions.resetPracticeScoring();
  }

  /** Record index for the position the walk is currently on, or null when unscoreable. */
  private currentScoringPositionIndex(): number | null {
    const { script, currentStepIndex, practiceGraceCursor } = useEngineStore.getState();
    if (!script || this.scoringPositionOffsets.length === 0) {
      return null;
    }

    return practicePositionIndexFromCursor(
      this.scoringPositionOffsets,
      script,
      currentStepIndex,
      practiceGraceCursor,
    );
  }

  private recordScoringAttempt(outcome: PracticeAttemptOutcome): void {
    const positionIndex = this.currentScoringPositionIndex();
    if (positionIndex === null) {
      return;
    }

    useEngineStore.getState().actions.recordPracticeAttempt(positionIndex, outcome);
  }

  /**
   * Wrong two-hand finger press: sound a deterministic 1-2 semitone clash and
   * count it. This never touches hitNoteIndices, so it cannot contribute to the
   * finger total that completes a step.
   */
  private handleWrongFingerPress(mapping: FingerMapping): void {
    this.recordScoringAttempt('wrong');

    const feedbackMidi = wrongNoteFeedbackMidi(mapping, this.practiceNotesForStep);
    if (feedbackMidi !== null) {
      this.playNotePreview(feedbackMidi);
    }
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
    const fingerKey = `${mapping.hand}:${mapping.finger}`;
    // Re-press of a matching finger must always produce a fresh attack, even
    // if soundingMidis still tracks this midi (sticky hold / missed release).
    // hitNoteIndices alone owns completion, and re-articulation must not be
    // gated by prior hit or lingering sustain state.
    if (this.soundingMidis.has(midi)) {
      const engine = this.audioEngine;
      if (engine) {
        engine.noteOff(midi);
      }
      this.soundingMidis.delete(midi);
      this.practicePressTracker.releaseMatching((note) => note.midi === midi);
    }

    this.attackMidi(midi, mapping.hand);
    this.activeFingerSounds.set(fingerKey, midi);
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
    this.resetScoringSession();
    this.loadCurrentStep({
      alignScope: useEngineStore.getState().script !== null,
    });
  }

  private syncAfterPlayModeChange(playMode: boolean): void {
    this.hitNoteIndices.clear();
    this.expectedNotes.clear();
    this.practiceNotesForStep = [];
    this.pendingPieceCompletion = false;
    this.pendingFinalStepMidis.clear();
    this.releaseAllSoundingNotes();
    this.resetScoringSession();

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
   * Callers own step-boundary and within-step position resolution. This only
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

    const previousPracticeNotes = this.practiceNotesForStep;
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

    // Scope is the one-hand keyboard window. Two-hand practice uses finger
    // bindings and must not thrash scope when a step spans bass + treble.
    if (engineMode === 'one-hand') {
      if (alignScope) {
        centerScopeOnPracticeNotes(playableNotes);
      } else if (useEngineStore.getState().isPracticeActive) {
        alignScopeToPracticeNotes(playableNotes, previousPracticeNotes);
      }
    }
  }

  loadCurrentStep(options: { alignScope?: boolean; exactStep?: boolean } = {}): void {
    const { alignScope = false, exactStep = false } = options;
    const { script, engineMode, activeHand, actions } = useEngineStore.getState();

    this.hitNoteIndices.clear();
    this.expectedNotes.clear();
    // Keep practiceNotesForStep until loadPositionNotes so finger-reach
    // anchors survive step advances. Clear only on early exits below.

    if (!script) {
      this.practiceNotesForStep = [];
      actions.setExpectedNotes([]);
      actions.setPracticeGraceCursor(null);
      return;
    }

    let index = useEngineStore.getState().currentStepIndex;

    if (exactStep && !stepHasAnyPracticeContent(script, index, engineMode, activeHand)) {
      const nearest = this.findNearestStepWithPracticeNotes(index);
      if (nearest === null) {
        this.practiceNotesForStep = [];
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
      this.practiceNotesForStep = [];
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

    this.pendingPieceCompletion = false;
    this.pendingFinalStepMidis.clear();
    this.releaseAllSoundingNotes();
    // A seek keeps the session's records (a revisited position keeps its
    // accumulated wrongAttempts) and only flags that navigation happened.
    actions.markPracticeNavigated();
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

    // Mark the position correct before any advance, while the store still
    // points at it.
    const completedPositionIndex = this.currentScoringPositionIndex();
    if (completedPositionIndex !== null) {
      useEngineStore
        .getState()
        .actions.markPracticePositionCorrect(completedPositionIndex);
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

      // Graces are exhausted, so try the step's main position next.
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

    if (nextIndex >= script.length) {
      this.pendingPieceCompletion = true;
      this.pendingFinalStepMidis = new Set(
        this.practiceNotesForStep.map((note) => note.midi),
      );
      this.tryFinalizePieceCompletion();
      return;
    }

    actions.setStepIndex(nextIndex);
    actions.setPracticeGraceCursor(null);

    this.loadCurrentStep();
  }

  private tryFinalizePieceCompletion(): void {
    if (!this.pendingPieceCompletion) {
      return;
    }

    if (this.pendingFinalStepMidis.size > 0) {
      return;
    }

    this.pendingPieceCompletion = false;
    this.pendingFinalStepMidis.clear();
    const { script, actions } = useEngineStore.getState();
    // Finalize here, not on the last correct press: this is the release-gated
    // point where the piece is actually finished.
    actions.finalizePracticeScoring();
    if (script) {
      actions.setStepIndex(script.length);
    }
    actions.setPracticeActive(false);
    actions.setExpectedNotes([]);
    this.hitNoteIndices.clear();
    this.expectedNotes.clear();
    this.practiceNotesForStep = [];
    this.clearPracticeSoundingInStore();
  }
}

export const practiceEngine = new PracticeEngine();
