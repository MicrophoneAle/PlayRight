import * as Tone from 'tone';
import type { AudioEngine } from './AudioEngine.ts';
import {
  buildFinalNoteKeySet,
  buildPlaybackFermataOffsetsByStep,
  noteDurationQuarterNotes,
  playbackDurationQuarterNotes,
  pieceEndQuarterNotes,
  quarterNotesToRelativeTickTime,
  quarterNotesToTickDuration,
  quartersToTicks,
  quartersToTransportTickTime,
  scheduledPlaybackAttackQuarterNotes,
} from './playbackTiming.ts';
import { useEngineStore } from '../store/useEngineStore.ts';
import { PlayingMidiPressTracker } from './playingMidiPressTracker.ts';
import { getDisplayNotesForStep } from './practiceSteps.ts';
import type { Hand, PlaybackScript, ScriptNote } from '../types/index.ts';

function getTransport(): ReturnType<typeof Tone.getTransport> {
  return Tone.getTransport();
}

function isPlaybackTieContinuation(
  script: PlaybackScript,
  stepIndex: number,
  note: ScriptNote,
): boolean {
  if (stepIndex === 0) {
    return false;
  }

  const previousStep = script[stepIndex - 1];
  return previousStep.notes.some(
    (previous) =>
      previous.midi === note.midi &&
      previous.hand === note.hand &&
      previous.tiedToNext,
  );
}

export class PlaybackEngine {
  private audioEngine: AudioEngine | null = null;
  private scheduledEventIds: number[] = [];
  private playingPressTracker = new PlayingMidiPressTracker();
  private isPlaying = false;
  private isPaused = false;
  private hasFinishedPiece = false;
  private storeSubscriptionInitialized = false;

  /** Subscribe to store changes once; safe to call repeatedly (StrictMode, HMR). */
  ensureStoreSubscription(): void {
    if (this.storeSubscriptionInitialized) {
      return;
    }

    this.storeSubscriptionInitialized = true;

    useEngineStore.subscribe((state, prevState) => {
      if (
        state.script !== prevState.script ||
        state.scoreTiming !== prevState.scoreTiming
      ) {
        this.stop();
        return;
      }

      if (state.playMode !== prevState.playMode) {
        this.syncAfterPlayModeChange(state.playMode);
      }
    });
  }

  attachAudioEngine(audioEngine: AudioEngine): void {
    this.audioEngine = audioEngine;
  }

  async play(): Promise<void> {
    const { script, scoreTiming } = useEngineStore.getState();
    if (!script || !scoreTiming || script.length === 0) {
      return;
    }

    const engine = this.audioEngine;
    if (!engine) {
      return;
    }

    await engine.warm();
    await engine.init();

    const restartingFromEnd = this.hasFinishedPiece;
    if (restartingFromEnd) {
      this.hasFinishedPiece = false;
      useEngineStore.getState().actions.setStepIndex(0);
    }

    const { currentStepIndex } = useEngineStore.getState();
    const startIndex = restartingFromEnd
      ? 0
      : Math.min(Math.max(currentStepIndex, 0), script.length - 1);
    const finalNoteKeys = buildFinalNoteKeySet(script, scoreTiming.divisionsPerQuarter);
    const fermataOffsets = buildPlaybackFermataOffsetsByStep(
      script,
      scoreTiming.divisionsPerQuarter,
      finalNoteKeys,
    );
    const startOnsetQuarters = scheduledPlaybackAttackQuarterNotes(
      script[startIndex].onset,
      scoreTiming.divisionsPerQuarter,
      fermataOffsets[startIndex],
    );

    this.clearScheduledEvents();
    const transport = getTransport();
    transport.stop();
    this.applyTransportBpm(scoreTiming.tempoBpm);
    transport.ticks = quartersToTicks(startOnsetQuarters, this.transportPpq());
    this.applyStepVisual(startIndex);
    this.scheduleFromStep(startIndex);

    const { actions } = useEngineStore.getState();
    actions.setPlaybackActive(true);
    actions.setPlaybackFinished(false);
    actions.setPlaybackPaused(false);

    this.isPlaying = true;
    this.isPaused = false;
    transport.start();
  }

  pause(): void {
    if (!this.isPlaying || this.isPaused) {
      return;
    }

    getTransport().pause();
    this.isPaused = true;
    this.clearPlayingNotes();
    useEngineStore.getState().actions.setPlaybackPaused(true);
  }

  resume(): void {
    if (!this.isPlaying || !this.isPaused) {
      return;
    }

    if (this.hasFinishedPiece) {
      void this.play();
      return;
    }

    if (this.scheduledEventIds.length === 0) {
      const { currentStepIndex, script } = useEngineStore.getState();
      if (script) {
        const resumeIndex = Math.min(
          Math.max(currentStepIndex, 0),
          script.length - 1,
        );
        this.scheduleFromStep(resumeIndex);
      }
    }

    getTransport().start();
    this.isPaused = false;
    useEngineStore.getState().actions.setPlaybackPaused(false);
  }

  async restart(): Promise<void> {
    const { script, scoreTiming, actions } = useEngineStore.getState();
    if (!script || !scoreTiming) {
      return;
    }

    this.clearScheduledEvents();
    getTransport().stop();
    this.isPlaying = false;
    this.isPaused = true;
    this.hasFinishedPiece = false;

    this.applyTransportBpm(scoreTiming.tempoBpm);
    getTransport().ticks = 0;
    this.applyStepVisual(0);
    this.audioEngine?.releaseAll();

    actions.setPlaybackActive(true);
    actions.setPlaybackFinished(false);
    actions.setPlaybackPaused(true);
  }

  stop(): void {
    this.clearScheduledEvents();
    getTransport().stop();
    this.isPlaying = false;
    this.isPaused = false;
    this.hasFinishedPiece = false;
    const { actions } = useEngineStore.getState();
    actions.setPlaybackActive(false);
    actions.setPlaybackFinished(false);
    actions.setPlaybackPaused(false);

    actions.setStepIndex(0);
    actions.setExpectedNotes([]);
    actions.setPlayingMidiNotes([]);
    actions.setPlayingPlaybackNotes([]);
    getTransport().ticks = 0;
    this.audioEngine?.releaseAll();
  }

  seekToStep(stepIndex: number): void {
    const { script, scoreTiming, actions } = useEngineStore.getState();
    if (!script || !scoreTiming || stepIndex < 0 || stepIndex >= script.length) {
      return;
    }

    const wasPlaying = this.isPlaying && !this.isPaused;
    const finalNoteKeys = buildFinalNoteKeySet(script, scoreTiming.divisionsPerQuarter);
    const fermataOffsets = buildPlaybackFermataOffsetsByStep(
      script,
      scoreTiming.divisionsPerQuarter,
      finalNoteKeys,
    );
    const onsetQuarters = scheduledPlaybackAttackQuarterNotes(
      script[stepIndex].onset,
      scoreTiming.divisionsPerQuarter,
      fermataOffsets[stepIndex],
    );

    this.clearScheduledEvents();
    getTransport().ticks = quartersToTicks(onsetQuarters, this.transportPpq());
    this.hasFinishedPiece = false;
    actions.setStepIndex(stepIndex);
    this.applyStepVisual(stepIndex);

    if (wasPlaying) {
      this.scheduleFromStep(stepIndex);
      getTransport().start();
      this.isPlaying = true;
      this.isPaused = false;
      actions.setPlaybackPaused(false);
      return;
    }

    if (this.isPlaying) {
      this.scheduleFromStep(stepIndex);
    }

    getTransport().pause();
    this.isPaused = true;
    actions.setPlaybackPaused(true);
  }

  setTempoFactor(factor: number): void {
    const { scoreTiming } = useEngineStore.getState();
    if (!scoreTiming) {
      return;
    }

    getTransport().bpm.value = scoreTiming.tempoBpm * factor;
  }

  /** Re-push active note highlights after layout changes (e.g. header toggle). */
  refreshPlayingVisuals(): void {
    if (!this.isPlaying || this.isPaused) {
      return;
    }

    this.syncPlayingNotes();
  }

  dispose(): void {
    this.stop();
    this.audioEngine = null;
    this.storeSubscriptionInitialized = false;
  }

  private syncAfterPlayModeChange(playMode: boolean): void {
    this.clearScheduledEvents();
    getTransport().stop();
    this.isPlaying = false;
    this.isPaused = false;
    this.hasFinishedPiece = false;
    this.clearPlayingNotes();
    getTransport().ticks = 0;
    this.audioEngine?.releaseAll();

    if (!playMode) {
      const { actions } = useEngineStore.getState();
      actions.setPlaybackActive(false);
      actions.setPlaybackFinished(false);
      actions.setPlaybackPaused(false);
    }
  }

  private transportPpq(): number {
    return getTransport().PPQ;
  }

  private applyTransportBpm(baseTempoBpm: number): void {
    const { tempoFactor } = useEngineStore.getState();
    getTransport().bpm.value = baseTempoBpm * tempoFactor;
  }

  private syncPlayingNotes(): void {
    const activeNotes = this.playingPressTracker.activeNotes();
    const { actions } = useEngineStore.getState();
    actions.setPlayingMidiNotes(this.playingPressTracker.activeMidis());
    actions.setPlayingPlaybackNotes(activeNotes);
  }

  private pressPlayingNote(
    stepIndex: number,
    midi: number,
    hand: Hand,
    pressId: number,
  ): void {
    this.playingPressTracker.press({ pressId, stepIndex, midi, hand });
    this.syncPlayingNotes();
  }

  private releasePlayingNote(pressId: number): void {
    this.playingPressTracker.release(pressId);
    this.syncPlayingNotes();
  }

  private clearPlayingNotes(): void {
    this.playingPressTracker.clear();
    const { actions } = useEngineStore.getState();
    actions.setPlayingMidiNotes([]);
    actions.setPlayingPlaybackNotes([]);
  }

  private applyStepVisual(stepIndex: number): void {
    const { script, engineMode, activeHand, playMode, actions } =
      useEngineStore.getState();
    if (!script || stepIndex < 0 || stepIndex >= script.length) {
      return;
    }

    const displayNotes = getDisplayNotesForStep(
      script[stepIndex],
      playMode,
      engineMode,
      activeHand,
    );

    actions.setStepIndex(stepIndex);
    actions.setExpectedNotes(displayNotes.map((note) => note.midi));
  }

  private scheduleFromStep(fromStepIndex: number): void {
    const { script, scoreTiming } = useEngineStore.getState();
    const engine = this.audioEngine;
    if (!script || !scoreTiming || !engine) {
      return;
    }

    const transport = getTransport();
    const { divisionsPerQuarter } = scoreTiming;
    const ppq = this.transportPpq();
    const finalNoteKeys = buildFinalNoteKeySet(script, divisionsPerQuarter);
    const fermataOffsets = buildPlaybackFermataOffsetsByStep(
      script,
      divisionsPerQuarter,
      finalNoteKeys,
    );

    for (let stepIndex = fromStepIndex; stepIndex < script.length; stepIndex += 1) {
      const step = script[stepIndex];
      const onsetQuarters = scheduledPlaybackAttackQuarterNotes(
        step.onset,
        divisionsPerQuarter,
        fermataOffsets[stepIndex],
      );
      const transportTime = quartersToTransportTickTime(onsetQuarters, ppq);

      const stepEventId = transport.scheduleOnce((time) => {
        this.applyStepVisual(stepIndex);

        for (const note of step.notes) {
          if (isPlaybackTieContinuation(script, stepIndex, note)) {
            continue;
          }

          const durationDivisions = note.durationDivisions ?? divisionsPerQuarter;
          const writtenQuarters = noteDurationQuarterNotes(
            durationDivisions,
            divisionsPerQuarter,
          );
          const isFinalNote = finalNoteKeys.has(
            `${stepIndex}:${note.hand}:${note.midi}`,
          );
          const durationOptions = {
            isFinalNote,
            hasFermata: note.hasFermata ?? false,
          };
          const playedQuarters = playbackDurationQuarterNotes(
            writtenQuarters,
            note.tiedToNext ?? false,
            durationOptions,
          );
          const playedDuration = quarterNotesToTickDuration(playedQuarters, ppq);
          const pressId = this.playingPressTracker.allocatePressId();

          engine.scheduleAttackRelease(note.midi, playedDuration, time);
          this.pressPlayingNote(stepIndex, note.midi, note.hand, pressId);

          if (!note.tiedToNext) {
            const releaseEventId = transport.scheduleOnce(() => {
              this.releasePlayingNote(pressId);
            }, quarterNotesToRelativeTickTime(playedQuarters, ppq));
            this.scheduledEventIds.push(releaseEventId);
          }
        }
      }, transportTime);

      this.scheduledEventIds.push(stepEventId);
    }

    const pieceEndQuarters = pieceEndQuarterNotes(script, divisionsPerQuarter);
    const endEventId = transport.scheduleOnce(() => {
      this.completePlayback();
    }, quartersToTransportTickTime(pieceEndQuarters, ppq));
    this.scheduledEventIds.push(endEventId);
  }

  private completePlayback(): void {
    if (!this.isPlaying || this.isPaused) {
      return;
    }

    getTransport().pause();
    this.isPaused = true;
    this.hasFinishedPiece = true;
    this.clearPlayingNotes();
    const { actions } = useEngineStore.getState();
    actions.setPlaybackFinished(true);
    actions.setPlaybackPaused(true);
  }

  private clearScheduledEvents(): void {
    const transport = getTransport();

    for (const eventId of this.scheduledEventIds) {
      transport.clear(eventId);
    }

    this.scheduledEventIds = [];
    this.clearPlayingNotes();
    transport.cancel(0);
  }
}

export const playbackEngine = new PlaybackEngine();
