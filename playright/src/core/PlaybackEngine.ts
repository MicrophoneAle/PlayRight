import * as Tone from 'tone';
import { flushSync } from 'react-dom';
import type { AudioEngine } from './AudioEngine.ts';
import {
  buildConsecutiveSameNoteKeySet,
  buildFermataPlaybackContext,
  buildFinalNoteKeySet,
  buildPlaybackFermataOffsetsByStep,
  buildStepPlaybackDurationQuarterNotesByStep,
  isPlaybackTieContinuation,
  isSamePitchReattack,
  noteDurationQuarterNotes,
  playbackReleaseOnsetQuarterNotes,
  pieceEndQuarterNotes,
  resolveNotePlaybackDurationQuarterNotes,
  quarterNotesToTickDuration,
  quartersToTicks,
  scheduledPlaybackAttackQuarterNotes,
} from './playbackTiming.ts';
import { useEngineStore } from '../store/useEngineStore.ts';
import { PlayingMidiPressTracker } from './playingMidiPressTracker.ts';
import { getDisplayNotesForStep } from './practiceSteps.ts';
import type { Hand, ScriptNote } from '../types/index.ts';

function getTransport(): ReturnType<typeof Tone.getTransport> {
  return Tone.getTransport();
}

/**
 * Clamp a computed tick to a finite, non-decreasing integer before it reaches
 * Tone's Transport.
 *
 * scheduleFromStep computes every event's tick synchronously from
 * playbackTiming's fermata/duration math and hands it straight to
 * transport.scheduleOnce as a "<ticks>i" string. A NaN/Infinity or
 * out-of-order tick breaks Tone's ordered Timeline silently. Tone's Clock also
 * advances one whole tick at a time, so fractional ticks are never matched and
 * their events are skipped forever.
 */
function safeTickTime(
  rawTicks: number,
  minTick: number,
  label: string,
  context: Record<string, unknown>,
): { text: string; tick: number } {
  const roundedTicks = Math.round(rawTicks);

  if (Number.isFinite(roundedTicks) && roundedTicks >= minTick) {
    return { text: `${roundedTicks}i`, tick: roundedTicks };
  }

  const fallbackTick = minTick + 1;
  console.error(
    `[PlaybackEngine] ${label} produced a non-finite/out-of-order tick - clamped to avoid corrupting Tone's Transport Timeline`,
    { ...context, rawTicks, minTick, fallbackTick },
  );
  return { text: `${fallbackTick}i`, tick: fallbackTick };
}

/** Visual-only delay before a same-pitch re-strike press paints (~2 frames). */
const PLAYBACK_CONSECUTIVE_VISUAL_PRESS_DELAY_MS = 40;

export class PlaybackEngine {
  private audioEngine: AudioEngine | null = null;
  private scheduledEventIds: number[] = [];
  private pendingPressTimeouts = new Set<ReturnType<typeof setTimeout>>();
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
    transport.ticks = Math.round(quartersToTicks(startOnsetQuarters, this.transportPpq()));
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
    // Nothing to resume unless the engine is paused. This intentionally allows
    // the restart-armed state (isPaused=true, isPlaying=false) through, which
    // the old `!this.isPlaying` guard rejected, silently breaking Restart→Play.
    if (!this.isPaused) {
      return;
    }

    // End-of-piece replay: play() resets to step 0 and reschedules everything.
    if (this.hasFinishedPiece) {
      void this.play();
      return;
    }

    // Reschedule only when no events remain. A mid-piece pause keeps its
    // scheduled events, so it resumes in place. restart() clears them (and
    // resets the step to 0), so this rebuilds the schedule from the current
    // step — a fresh start from wherever the step index now points.
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
    this.isPlaying = true;
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
    this.audioEngine?.releaseAll();
    getTransport().ticks = Math.round(quartersToTicks(onsetQuarters, this.transportPpq()));
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

  private releasePlayingNote(pressId: number, flushVisual = false): void {
    this.playingPressTracker.release(pressId);
    if (flushVisual) {
      flushSync(() => {
        this.syncPlayingNotes();
      });
      return;
    }

    this.syncPlayingNotes();
  }

  /**
   * Defer a same-pitch re-strike's highlight press so the prior note's release
   * paints first. Audio fires at the written attack time; only the visual press
   * is delayed slightly so the key visibly lifts between strikes.
   */
  private deferRepeatedPress(
    stepIndex: number,
    midi: number,
    hand: Hand,
    pressId: number,
  ): void {
    const timeoutId = setTimeout(() => {
      this.pendingPressTimeouts.delete(timeoutId);
      if (!this.isPlaying || this.isPaused) {
        return;
      }
      this.pressPlayingNote(stepIndex, midi, hand, pressId);
    }, PLAYBACK_CONSECUTIVE_VISUAL_PRESS_DELAY_MS);
    this.pendingPressTimeouts.add(timeoutId);
  }

  private cancelPendingPressTimeouts(): void {
    for (const timeoutId of this.pendingPressTimeouts) {
      clearTimeout(timeoutId);
    }
    this.pendingPressTimeouts.clear();
  }

  /** Fallback when an absolute release event was skipped during transport catch-up. */
  private releasePriorStepNotes(currentStepIndex: number): void {
    const priorNotes = this.playingPressTracker
      .activeNotes()
      .filter((note) => note.stepIndex < currentStepIndex);

    if (priorNotes.length > 0) {
      const releasedMidis = new Set<number>();
      for (const note of priorNotes) {
        if (!releasedMidis.has(note.midi)) {
          this.audioEngine?.noteOff(note.midi);
          releasedMidis.add(note.midi);
        }
      }
    }

    const changed = this.playingPressTracker.releaseMatching(
      (note) => note.stepIndex < currentStepIndex,
    );

    if (changed) {
      this.syncPlayingNotes();
    }
  }

  private scheduleTieEndRelease(
    stepIndex: number,
    note: ScriptNote,
    attackOnsetQuarters: number,
    attackTick: number,
    divisionsPerQuarter: number,
    ppq: number,
    finalNoteKeys: Set<string>,
  ): void {
    const durationDivisions = note.durationDivisions ?? divisionsPerQuarter;
    const writtenQuarters = noteDurationQuarterNotes(
      durationDivisions,
      divisionsPerQuarter,
    );
    const isFinalNote = finalNoteKeys.has(`${stepIndex}:${note.hand}:${note.midi}`);
    const durationOptions = {
      isFinalNote,
      hasFermata: note.hasFermata ?? false,
    };
    const releaseOnset = playbackReleaseOnsetQuarterNotes(
      attackOnsetQuarters,
      writtenQuarters,
      false,
      durationOptions,
    );
    const { text: releaseTime } = safeTickTime(
      quartersToTicks(releaseOnset, ppq),
      attackTick,
      'tie-end release',
      { stepIndex, midi: note.midi, hand: note.hand },
    );
    const releaseEventId = getTransport().scheduleOnce(() => {
      try {
        this.playingPressTracker.releaseMatching(
          (active) =>
            active.midi === note.midi &&
            active.hand === note.hand &&
            active.stepIndex < stepIndex,
        );
        this.syncPlayingNotes();
      } catch (err) {
        console.error('[PlaybackEngine] tie-end release callback failed (skipped):', err);
      }
    }, releaseTime);
    this.scheduledEventIds.push(releaseEventId);
  }

  private clearPlayingNotes(): void {
    this.cancelPendingPressTimeouts();
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
    const fermataContext = buildFermataPlaybackContext(script, divisionsPerQuarter);
    const fermataOffsets = buildPlaybackFermataOffsetsByStep(
      script,
      divisionsPerQuarter,
      finalNoteKeys,
      fermataContext,
    );
    const consecutiveSameNoteKeys = buildConsecutiveSameNoteKeySet(
      script,
      divisionsPerQuarter,
      fermataOffsets,
    );
    const stepDurations = buildStepPlaybackDurationQuarterNotesByStep(
      script,
      divisionsPerQuarter,
      finalNoteKeys,
      consecutiveSameNoteKeys,
      fermataContext,
    );

    let lastSafeAttackTick = -1;

    for (let stepIndex = fromStepIndex; stepIndex < script.length; stepIndex += 1) {
      try {
        const step = script[stepIndex];
        const attackOnsetQuarters = scheduledPlaybackAttackQuarterNotes(
          step.onset,
          divisionsPerQuarter,
          fermataOffsets[stepIndex],
        );
        const { text: attackTime, tick: attackTick } = safeTickTime(
          quartersToTicks(attackOnsetQuarters, ppq),
          lastSafeAttackTick,
          'step attack',
          { stepIndex, attackOnsetQuarters, fermataOffset: fermataOffsets[stepIndex] ?? 0 },
        );
        lastSafeAttackTick = attackTick;

        const stepPresses: Array<{
          pressId: number;
          note: ScriptNote;
          playedDuration: string;
        }> = [];

        for (const note of step.notes) {
          if (isPlaybackTieContinuation(script, stepIndex, note)) {
            if (!note.tiedToNext) {
              this.scheduleTieEndRelease(
                stepIndex,
                note,
                attackOnsetQuarters,
                attackTick,
                divisionsPerQuarter,
                ppq,
                finalNoteKeys,
              );
            }
            continue;
          }

          const playedQuarters = resolveNotePlaybackDurationQuarterNotes(
            stepIndex,
            note,
            script,
            stepDurations,
            divisionsPerQuarter,
            finalNoteKeys,
            consecutiveSameNoteKeys,
            fermataContext,
          );
          const playedDuration = quarterNotesToTickDuration(playedQuarters, ppq);
          const pressId = this.playingPressTracker.allocatePressId();

          stepPresses.push({ pressId, note, playedDuration });

          if (!note.tiedToNext) {
            const releaseOnset = attackOnsetQuarters + playedQuarters;
            const followedByConsecutiveSameNote = consecutiveSameNoteKeys.has(
              `${stepIndex}:${note.hand}:${note.midi}`,
            );
            const { text: releaseTime } = safeTickTime(
              quartersToTicks(releaseOnset, ppq),
              attackTick,
              'note release',
              { stepIndex, midi: note.midi, hand: note.hand },
            );
            const releaseEventId = transport.scheduleOnce(() => {
              try {
                this.releasePlayingNote(pressId, followedByConsecutiveSameNote);
              } catch (err) {
                console.error('[PlaybackEngine] note release callback failed (skipped):', err);
              }
            }, releaseTime);
            this.scheduledEventIds.push(releaseEventId);
          }
        }

        const stepEventId = transport.scheduleOnce((time) => {
          try {
            this.releasePriorStepNotes(stepIndex);
            this.applyStepVisual(stepIndex);

            for (const { pressId, note, playedDuration } of stepPresses) {
              engine.scheduleAttackRelease(note.midi, playedDuration, time);

              if (isSamePitchReattack(script, stepIndex, note)) {
                this.deferRepeatedPress(stepIndex, note.midi, note.hand, pressId);
              } else {
                this.pressPlayingNote(stepIndex, note.midi, note.hand, pressId);
              }
            }
          } catch (err) {
            console.error('[PlaybackEngine] step attack callback failed (skipped):', err);
          }
        }, attackTime);

        this.scheduledEventIds.push(stepEventId);
      } catch (err) {
        console.error(
          '[PlaybackEngine] scheduleFromStep step scheduling failed (step skipped, continuing)',
          {
            stepIndex,
            errorMessage: err instanceof Error ? err.message : String(err),
            errorStack: err instanceof Error ? err.stack : undefined,
          },
        );
      }
    }

    const pieceEndQuarters = pieceEndQuarterNotes(script, divisionsPerQuarter);
    const { text: pieceEndTime } = safeTickTime(
      quartersToTicks(pieceEndQuarters, ppq),
      lastSafeAttackTick,
      'piece end',
      { scriptLength: script.length },
    );
    const endEventId = transport.scheduleOnce(() => {
      try {
        this.completePlayback();
      } catch (err) {
        console.error('[PlaybackEngine] piece-end callback failed (skipped):', err);
      }
    }, pieceEndTime);
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
