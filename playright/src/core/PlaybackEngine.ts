import * as Tone from 'tone';
import type { AudioEngine } from './AudioEngine.ts';
import {
  buildConsecutiveSameNoteKeySet,
  buildFermataPlaybackContext,
  buildFinalNoteKeySet,
  buildPlaybackFermataOffsetsByStep,
  buildStepPlaybackDurationQuarterNotesByStep,
  isPlaybackTieContinuation,
  isRepeatedPlaybackAttack,
  noteDurationQuarterNotes,
  playbackReleaseOnsetQuarterNotes,
  PLAYBACK_ARTICULATION_GAP_MIN_QUARTERS,
  PLAYBACK_SCHEDULE_AHEAD_QUARTERS,
  resolveNotePlaybackDurationQuarterNotes,
  quarterNotesToTickDuration,
  quartersToTicks,
  scheduledPlaybackAttackQuarterNotes,
  tempoBpmAtOnset,
} from './playbackTiming.ts';
import type { FermataPlaybackContext } from './playbackTiming.ts';
import { useEngineStore } from '../store/useEngineStore.ts';
import { PlayingMidiPressTracker } from './playingMidiPressTracker.ts';
import { getDisplayNotesForStep } from './practiceSteps.ts';
import type {
  GraceNoteInfo,
  Hand,
  PlaybackOrder,
  PlaybackScript,
  ScriptNote,
} from '../types/index.ts';

/**
 * Whole-script derived timing data (fermata context/offsets, final-note keys,
 * consecutive-same-note keys, per-step durations) used by every rolling
 * schedule-window extension. These are pure functions of (script,
 * divisionsPerQuarter) - they don't depend on which window is being
 * scheduled - so recomputing them from scratch on every extension (up to
 * several ms of synchronous work on longer scores, measured via
 * schedule-window-cost-observe.temp.test.ts) is wasted main-thread time that
 * lands inside the same Transport callback responsible for scheduling
 * near-future note attacks, right before that callback reads transport.ticks
 * to detect rolling-window lag. That read-after-heavy-work ordering made the
 * lag detector partly measure its own computation time, baking a small but
 * audible seam into nearly every window boundary.
 */
interface ScheduleDerivedData {
  script: PlaybackScript;
  divisionsPerQuarter: number;
  /**
   * R1: resolved playback sequence (identity for non-repeat scores). The
   * rolling window iterates ENTRIES of this order; the document script is
   * never reordered.
   */
  playbackOrder: PlaybackOrder;
  /** True when playbackOrder is the exact identity mapping. */
  isIdentityOrder: boolean;
  /**
   * Virtual step sequence over playbackOrder entries (onset = playbackOnset,
   * order = entry index; notes shared with the document steps). Aliases the
   * document script itself when the order is identity, so identity scores
   * compute exactly the same tables as before R1.
   */
  entryScript: PlaybackScript;
  // Document-indexed, pass-INVARIANT tables: these drive each note's own
  // sounded duration (incl. staccato/fermata length), which must not depend
  // on which repeat pass the note is played on.
  finalNoteKeys: Set<string>;
  fermataContext: FermataPlaybackContext;
  consecutiveSameNoteKeys: Set<string>;
  stepDurations: number[];
  // Entry-indexed, pass-DEPENDENT tables: these drive the unrolled attack
  // timeline, where a backward jump creates real new adjacency (last note of
  // an ending against the repeat target's first note).
  entryFinalNoteKeys: Set<string>;
  entryFermataOffsets: number[];
  entryAttackQuarters: number[];
  /** True when a repeat/volta discontinuity sits between entry k and k+1. */
  jumpBoundaryAfterEntry: boolean[];
  /** Playback-time quarters of the first discontinuity at/after each entry (Infinity when none). */
  nextJumpBoundaryQuarters: number[];
  /** First (lowest-pass) entry index for each document step; drives seek. */
  firstEntryIndexByStep: number[];
  /** Latest release on the unrolled timeline (end-of-piece event time). */
  pieceEndQuarters: number;
}

/**
 * Cap a note's sounded length so its release never crosses the next repeat
 * jump discontinuity: nothing may keep sounding across a backward jump. The
 * clamp leaves the minimum articulation gap before the post-jump attack so a
 * same-pitch re-strike at the jump target still re-triggers. No-op (boundary
 * = Infinity) for identity orders and for notes ending before the boundary.
 */
function clampPlayedQuartersToJumpBoundary(
  playedQuarters: number,
  attackOnsetQuarters: number,
  boundaryQuarters: number,
): number {
  if (!Number.isFinite(boundaryQuarters)) {
    return playedQuarters;
  }

  const maxPlayed =
    boundaryQuarters - attackOnsetQuarters - PLAYBACK_ARTICULATION_GAP_MIN_QUARTERS;
  if (playedQuarters <= maxPlayed) {
    return playedQuarters;
  }

  return Math.max(Math.min(playedQuarters, maxPlayed), 0.01);
}

function getTransport(): ReturnType<typeof Tone.getTransport> {
  return Tone.getTransport();
}

/**
 * Clamp a computed tick to a finite, non-decreasing integer before it reaches
 * Tone's Transport.
 *
 * scheduleFromEntry computes every event's tick synchronously from
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

/**
 * Crushed grace-note length: a 32nd note's worth of time
 * (divisionsPerQuarter / 8 divisions = 1/8 quarter note). Graces play
 * back-to-back ending exactly at their main note's attack; the time is
 * borrowed from the preceding note's tail, never from the main note's own
 * onset or duration. v1 simplification: appoggiaturas use this same crushed
 * duration as acciaccaturas; proper appoggiatura time-stealing from the main
 * note is a later refinement.
 */
const GRACE_NOTE_DURATION_QUARTERS = 1 / 8;

export { PLAYBACK_SCHEDULE_AHEAD_QUARTERS } from './playbackTiming.ts';

export class PlaybackEngine {
  private audioEngine: AudioEngine | null = null;
  private scheduledEventIds: number[] = [];
  private pendingPressTimeouts = new Set<ReturnType<typeof setTimeout>>();
  private playingPressTracker = new PlayingMidiPressTracker();
  private readonly scheduledReleaseTickByPressId = new Map<number, number>();
  private isPlaying = false;
  private isPaused = false;
  private hasFinishedPiece = false;
  private storeSubscriptionInitialized = false;
  private nextUnscheduledEntryIndex = 0;
  private lastScheduledAttackTick = -1;
  /** PlaybackOrder entry whose attack must fire after a sheet seek (Tone skips same-tick events). */
  private seekTargetEntryIndex: number | null = null;
  private scheduleDerivedData: ScheduleDerivedData | null = null;

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
    const derived = this.getScheduleDerivedData(
      script,
      scoreTiming.divisionsPerQuarter,
    );
    // Start from the step's FIRST pass on the unrolled timeline.
    const startEntryIndex = restartingFromEnd
      ? 0
      : derived.firstEntryIndexByStep[startIndex];
    const startOnsetQuarters = derived.entryAttackQuarters[startEntryIndex];

    this.clearScheduledEvents();
    const transport = getTransport();
    transport.stop();
    this.applyTempoForDocumentOnset(script[startIndex]?.onset ?? 0, scoreTiming);
    transport.ticks = Math.round(quartersToTicks(startOnsetQuarters, this.transportPpq()));
    this.applyStepVisual(
      derived.playbackOrder[startEntryIndex].stepIndex,
      startEntryIndex,
    );
    this.scheduleFromEntry(startEntryIndex);

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
      const { currentStepIndex, script, scoreTiming } = useEngineStore.getState();
      if (script && scoreTiming) {
        const resumeIndex = Math.min(
          Math.max(currentStepIndex, 0),
          script.length - 1,
        );
        const derived = this.getScheduleDerivedData(
          script,
          scoreTiming.divisionsPerQuarter,
        );
        this.scheduleFromEntry(derived.firstEntryIndexByStep[resumeIndex]);
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

    this.applyTempoForDocumentOnset(0, scoreTiming);
    getTransport().ticks = 0;
    this.applyStepVisual(0, 0);
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
    actions.setPlaybackOrderIndex(0);
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
    const derived = this.getScheduleDerivedData(
      script,
      scoreTiming.divisionsPerQuarter,
    );
    // A clicked document step maps to its FIRST pass on the unrolled timeline.
    const entryIndex = derived.firstEntryIndexByStep[stepIndex];
    const onsetQuarters = derived.entryAttackQuarters[entryIndex];

    this.clearScheduledEvents();
    this.audioEngine?.releaseAll();
    const transport = getTransport();
    if (wasPlaying) {
      transport.pause();
    }
    this.applyTempoForDocumentOnset(script[stepIndex].onset, scoreTiming);
    transport.ticks = Math.round(quartersToTicks(onsetQuarters, this.transportPpq()));
    this.hasFinishedPiece = false;
    this.seekTargetEntryIndex = entryIndex;
    this.applyStepVisual(stepIndex, entryIndex);
    this.scheduleFromEntry(entryIndex);
    this.seekTargetEntryIndex = null;

    if (wasPlaying) {
      transport.start();
      this.isPlaying = true;
      this.isPaused = false;
      actions.setPlaybackPaused(false);
      return;
    }

    if (this.isPlaying) {
      // scheduleFromEntry already ran above for paused mid-piece seeks.
    }

    transport.pause();
    this.isPaused = true;
    actions.setPlaybackPaused(true);
  }

  setTempoFactor(factor: number): void {
    const { script, scoreTiming } = useEngineStore.getState();
    if (!scoreTiming) {
      return;
    }

    const transport = getTransport();
    const divisionsPerQuarter = scoreTiming.divisionsPerQuarter;
    const documentOnset =
      script && script.length > 0
        ? this.documentOnsetNearTransportQuarters(
            script,
            transport.ticks / this.transportPpq(),
            divisionsPerQuarter,
          )
        : 0;
    getTransport().bpm.value =
      tempoBpmAtOnset(scoreTiming.tempoMap, documentOnset, scoreTiming.tempoBpm) *
      factor;
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
    this.scheduleDerivedData = null;
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

  private applyTempoForDocumentOnset(
    documentOnset: number,
    scoreTiming: {
      tempoBpm: number;
      tempoMap: { onset: number; bpm: number }[];
    },
  ): void {
    const { tempoFactor } = useEngineStore.getState();
    getTransport().bpm.value =
      tempoBpmAtOnset(scoreTiming.tempoMap, documentOnset, scoreTiming.tempoBpm) *
      tempoFactor;
  }

  /**
   * Best-effort document onset for the current transport position when only
   * tick time is known (tempo-factor slider mid-playback). Prefers the latest
   * step whose musical onset is at or before the transport quarter position.
   */
  private documentOnsetNearTransportQuarters(
    script: PlaybackScript,
    transportQuarters: number,
    divisionsPerQuarter: number,
  ): number {
    const targetDivisions = transportQuarters * divisionsPerQuarter;
    let best = script[0]?.onset ?? 0;
    for (const step of script) {
      if (step.onset > targetDivisions) {
        break;
      }
      best = step.onset;
    }
    return best;
  }

  /** Compute (or reuse) whole-script timing data; see ScheduleDerivedData for why this is cached. */
  private getScheduleDerivedData(
    script: PlaybackScript,
    divisionsPerQuarter: number,
  ): ScheduleDerivedData {
    const cached = this.scheduleDerivedData;
    if (
      cached &&
      cached.script === script &&
      cached.divisionsPerQuarter === divisionsPerQuarter
    ) {
      return cached;
    }

    // R1: resolve the playback order (identity when absent). A stale or
    // corrupt order must never crash scheduling — fall back to identity.
    const storeOrder = useEngineStore.getState().playbackOrder;
    let playbackOrder: PlaybackOrder;
    if (
      storeOrder &&
      storeOrder.length > 0 &&
      storeOrder.every((entry) => entry.stepIndex >= 0 && entry.stepIndex < script.length)
    ) {
      playbackOrder = storeOrder;
    } else {
      if (storeOrder) {
        console.error(
          '[DIAG:playback-order] store playbackOrder is inconsistent with the script - falling back to document order',
          { orderLength: storeOrder.length, scriptLength: script.length },
        );
      }
      playbackOrder = script.map((step, stepIndex) => ({
        stepIndex,
        playbackOnset: step.onset,
        passIndex: 0,
      }));
    }

    const isIdentityOrder =
      playbackOrder.length === script.length &&
      playbackOrder.every(
        (entry, entryIndex) =>
          entry.stepIndex === entryIndex &&
          entry.passIndex === 0 &&
          entry.playbackOnset === script[entryIndex].onset,
      );

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

    // Pass-dependent tables over ENTRY adjacency. For identity orders these
    // alias the document tables outright (equal by construction), so
    // non-repeat scores compute and schedule exactly as before R1.
    let entryScript: PlaybackScript;
    let entryFinalNoteKeys: Set<string>;
    let entryFermataOffsets: number[];
    if (isIdentityOrder) {
      entryScript = script;
      entryFinalNoteKeys = finalNoteKeys;
      entryFermataOffsets = fermataOffsets;
    } else {
      entryScript = playbackOrder.map((entry, entryIndex) => ({
        ...script[entry.stepIndex],
        order: entryIndex,
        onset: entry.playbackOnset,
      }));
      entryFinalNoteKeys = buildFinalNoteKeySet(entryScript, divisionsPerQuarter);
      const entryFermataContext = buildFermataPlaybackContext(
        entryScript,
        divisionsPerQuarter,
      );
      // Sounded durations stay pass-invariant: reuse the per-step values.
      const entryDurations = playbackOrder.map(
        (entry) => stepDurations[entry.stepIndex],
      );
      entryFermataOffsets = buildPlaybackFermataOffsetsByStep(
        entryScript,
        divisionsPerQuarter,
        entryFinalNoteKeys,
        entryFermataContext,
        entryDurations,
      );
    }

    const entryAttackQuarters = entryScript.map((entryStep, entryIndex) =>
      scheduledPlaybackAttackQuarterNotes(
        entryStep.onset,
        divisionsPerQuarter,
        entryFermataOffsets[entryIndex],
      ),
    );

    // A discontinuity between entry k and k+1 (backward jump or volta skip)
    // is any break in document-step contiguity.
    const jumpBoundaryAfterEntry = playbackOrder.map((entry, entryIndex) => {
      const next = playbackOrder[entryIndex + 1];
      return next !== undefined && next.stepIndex !== entry.stepIndex + 1;
    });

    const nextJumpBoundaryQuarters = new Array<number>(playbackOrder.length).fill(
      Infinity,
    );
    let upcomingBoundary = Infinity;
    for (let entryIndex = playbackOrder.length - 1; entryIndex >= 0; entryIndex -= 1) {
      if (jumpBoundaryAfterEntry[entryIndex]) {
        upcomingBoundary = entryAttackQuarters[entryIndex + 1];
      }
      nextJumpBoundaryQuarters[entryIndex] = upcomingBoundary;
    }

    const firstEntryIndexByStep = new Array<number>(script.length).fill(-1);
    playbackOrder.forEach((entry, entryIndex) => {
      if (firstEntryIndexByStep[entry.stepIndex] === -1) {
        firstEntryIndexByStep[entry.stepIndex] = entryIndex;
      }
    });
    for (let stepIndex = 0; stepIndex < firstEntryIndexByStep.length; stepIndex += 1) {
      if (firstEntryIndexByStep[stepIndex] === -1) {
        console.error(
          '[DIAG:playback-order] document step is never visited by playbackOrder - seeking maps it to a clamped entry',
          { stepIndex },
        );
        firstEntryIndexByStep[stepIndex] = Math.min(
          stepIndex,
          playbackOrder.length - 1,
        );
      }
    }

    // Latest release on the unrolled timeline. Equals the document-order
    // piece end for identity (same per-note resolution over the same steps).
    let pieceEndQuarters = 0;
    for (let entryIndex = 0; entryIndex < playbackOrder.length; entryIndex += 1) {
      const stepIndex = playbackOrder[entryIndex].stepIndex;
      const attackQuarters = entryAttackQuarters[entryIndex];
      for (const note of script[stepIndex].notes) {
        const playedQuarters = clampPlayedQuartersToJumpBoundary(
          resolveNotePlaybackDurationQuarterNotes(
            stepIndex,
            note,
            script,
            stepDurations,
            divisionsPerQuarter,
            finalNoteKeys,
            consecutiveSameNoteKeys,
            fermataContext,
          ),
          attackQuarters,
          nextJumpBoundaryQuarters[entryIndex],
        );
        pieceEndQuarters = Math.max(pieceEndQuarters, attackQuarters + playedQuarters);
      }
    }

    const data: ScheduleDerivedData = {
      script,
      divisionsPerQuarter,
      playbackOrder,
      isIdentityOrder,
      entryScript,
      finalNoteKeys,
      fermataContext,
      consecutiveSameNoteKeys,
      stepDurations,
      entryFinalNoteKeys,
      entryFermataOffsets,
      entryAttackQuarters,
      jumpBoundaryAfterEntry,
      nextJumpBoundaryQuarters,
      firstEntryIndexByStep,
      pieceEndQuarters,
    };
    this.scheduleDerivedData = data;
    return data;
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
    this.scheduledReleaseTickByPressId.delete(pressId);
    this.playingPressTracker.release(pressId);
    // No flushSync here even for consecutive same-note releases: the re-press
    // is deferred by PLAYBACK_CONSECUTIVE_VISUAL_PRESS_DELAY_MS (~2 frames),
    // so React's normal async commit paints the release in time. Forcing a
    // synchronous render inside the transport callback burned CPU on every
    // repeated-note release and contributed to audio-scheduling starvation.
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
      // The note's release can beat this deferred press (fast re-strike under
      // jank, or a short played duration). Pressing after release would light
      // a highlight with no release event left to ever turn it back off.
      if (this.playingPressTracker.wasReleased(pressId)) {
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
  private releaseOverduePresses(transportTick: number): void {
    let changed = false;

    for (const [pressId, releaseTick] of this.scheduledReleaseTickByPressId) {
      if (releaseTick <= transportTick) {
        this.scheduledReleaseTickByPressId.delete(pressId);
        this.playingPressTracker.release(pressId);
        changed = true;
      }
    }

    if (changed) {
      this.syncPlayingNotes();
    }
  }

  private scheduleTieEndRelease(
    entryIndex: number,
    stepIndex: number,
    note: ScriptNote,
    attackOnsetQuarters: number,
    attackTick: number,
    divisionsPerQuarter: number,
    ppq: number,
    entryFinalNoteKeys: Set<string>,
    windowLagTicks: number,
    jumpBoundaryQuarters: number,
  ): void {
    const durationDivisions = note.durationDivisions ?? divisionsPerQuarter;
    const writtenQuarters = noteDurationQuarterNotes(
      durationDivisions,
      divisionsPerQuarter,
    );
    // Final-note detection is pass-dependent (entry adjacency): a step that
    // ends the document can still be mid-piece on an earlier repeat pass.
    const isFinalNote = entryFinalNoteKeys.has(
      `${entryIndex}:${note.hand}:${note.midi}`,
    );
    const durationOptions = {
      isFinalNote,
      hasFermata: note.hasFermata ?? false,
    };
    const releaseOnset = Math.min(
      playbackReleaseOnsetQuarterNotes(
        attackOnsetQuarters,
        writtenQuarters,
        false,
        durationOptions,
      ),
      // Never let a tie release outlive the next backward-jump boundary.
      jumpBoundaryQuarters,
    );
    const { text: releaseTime } = safeTickTime(
      quartersToTicks(releaseOnset, ppq) + windowLagTicks,
      attackTick,
      'tie-end release',
      { entryIndex, stepIndex, midi: note.midi, hand: note.hand },
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
    this.scheduledReleaseTickByPressId.clear();
    this.playingPressTracker.clear();
    const { actions } = useEngineStore.getState();
    actions.setPlayingMidiNotes([]);
    actions.setPlayingPlaybackNotes([]);
  }

  /**
   * R2: every visual step update also records its PlaybackOrder position so
   * the sheet cursor can be keyed per-pass (a repeated step's second pass maps
   * to different cursor-walk offsets than its first). Every caller knows the
   * entry index natively (play/seek/replay resolve it, the attack callback
   * closes over it), so no reverse lookup is ever needed.
   */
  private applyStepVisual(stepIndex: number, entryIndex: number): void {
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
    actions.setPlaybackOrderIndex(entryIndex);
    actions.setExpectedNotes(displayNotes.map((note) => note.midi));
  }

  /**
   * Schedule a step's graceBefore notes back-to-back so the last grace ends
   * exactly at the main attack. The main note's own attack time and duration
   * are never moved. When the main attack sits too close to the timeline
   * start for the full window, the graces compress into whatever room exists
   * (and are skipped entirely at onset 0, where there is none).
   */
  private scheduleGraceNotes(
    stepIndex: number,
    graceNotes: GraceNoteInfo[],
    mainAttackQuarters: number,
    minTick: number,
    ppq: number,
    engine: AudioEngine,
    windowLagTicks: number,
  ): void {
    const transport = getTransport();
    const windowStartQuarters = Math.max(
      0,
      mainAttackQuarters - graceNotes.length * GRACE_NOTE_DURATION_QUARTERS,
    );
    const perGraceQuarters =
      (mainAttackQuarters - windowStartQuarters) / graceNotes.length;
    if (perGraceQuarters <= 0) {
      return;
    }

    const graceDuration = quarterNotesToTickDuration(perGraceQuarters, ppq);
    let previousGraceTick = minTick;

    graceNotes.forEach((grace, graceIndex) => {
      const graceAttackQuarters = windowStartQuarters + graceIndex * perGraceQuarters;
      const { text: graceAttackTime, tick: graceAttackTick } = safeTickTime(
        quartersToTicks(graceAttackQuarters, ppq) + windowLagTicks,
        previousGraceTick,
        'grace attack',
        { stepIndex, graceIndex, midi: grace.midi },
      );
      previousGraceTick = graceAttackTick;

      const pressId = this.playingPressTracker.allocatePressId();
      const attackEventId = transport.scheduleOnce((time) => {
        try {
          engine.scheduleAttackRelease(grace.midi, graceDuration, time);
          this.pressPlayingNote(stepIndex, grace.midi, grace.hand, pressId);
        } catch (err) {
          console.error('[PlaybackEngine] grace attack callback failed (skipped):', err);
        }
      }, graceAttackTime);
      this.scheduledEventIds.push(attackEventId);

      const { text: graceReleaseTime, tick: graceReleaseTick } = safeTickTime(
        quartersToTicks(graceAttackQuarters + perGraceQuarters, ppq) + windowLagTicks,
        graceAttackTick,
        'grace release',
        { stepIndex, graceIndex, midi: grace.midi },
      );
      this.scheduledReleaseTickByPressId.set(pressId, graceReleaseTick);
      const releaseEventId = transport.scheduleOnce(() => {
        try {
          this.releasePlayingNote(pressId);
        } catch (err) {
          console.error('[PlaybackEngine] grace release callback failed (skipped):', err);
        }
      }, graceReleaseTime);
      this.scheduledEventIds.push(releaseEventId);
    });
  }

  private scheduleFromEntry(fromEntryIndex: number): void {
    this.nextUnscheduledEntryIndex = fromEntryIndex;
    this.lastScheduledAttackTick = -1;
    this.extendScheduleWindow();
  }

  /**
   * Explicit release-all at a repeat jump boundary: any pending note-off or
   * tie-release from before the jump must fire or be cleared here, never
   * orphaned across the jump. Scheduled while processing the pre-jump entry,
   * so at an equal tick it dispatches BEFORE the post-jump attack (Tone fires
   * equal-tick events in insertion order) and cannot cut the incoming notes.
   */
  private scheduleJumpBoundaryRelease(
    entryIndex: number,
    boundaryQuarters: number,
    minTick: number,
    ppq: number,
    windowLagTicks: number,
  ): void {
    const { text: boundaryTime, tick: boundaryTick } = safeTickTime(
      quartersToTicks(boundaryQuarters, ppq) + windowLagTicks,
      minTick,
      'jump-boundary release',
      { entryIndex, boundaryQuarters },
    );
    const eventId = getTransport().scheduleOnce(() => {
      try {
        console.debug(
          '[DIAG:jump-boundary] repeat jump boundary reached - releasing all pre-jump notes',
          { entryIndex, boundaryTick },
        );
        // Sweep releases whose events were skipped during transport catch-up,
        // then force-release anything still held from before the jump (e.g. a
        // dangling tie start with no release event of its own).
        this.releaseOverduePresses(Math.round(getTransport().ticks));
        const changed = this.playingPressTracker.releaseMatching(() => true);
        if (changed) {
          this.syncPlayingNotes();
        }
        // Audio safety net: sounded durations are already clamped to end
        // before the boundary, so this only catches voices that slipped
        // through. Post-jump attacks at this same tick fire after this
        // callback and are unaffected.
        this.audioEngine?.releaseAll();
      } catch (err) {
        console.error(
          '[DIAG:jump-boundary] release-all callback failed (skipped):',
          err,
        );
      }
    }, boundaryTime);
    this.scheduledEventIds.push(eventId);
  }

  /** Schedule the next window of PlaybackOrder entries so the Tone timeline stays bounded. */
  private extendScheduleWindow(): void {
    const { script, scoreTiming } = useEngineStore.getState();
    const engine = this.audioEngine;
    if (!script || !scoreTiming || !engine) {
      return;
    }

    const transport = getTransport();
    const { divisionsPerQuarter } = scoreTiming;
    const ppq = this.transportPpq();
    // Snapshot transport.ticks BEFORE any script-derived recomputation below.
    // These structures are pure functions of (script, divisionsPerQuarter)
    // and get cached by getScheduleDerivedData, but even a cache miss must
    // not delay this read: reading ticks after doing that work would make
    // the windowLagTicks lag detector further down partly measure this
    // callback's own computation time instead of genuine external jank,
    // baking a phantom seam into every window boundary.
    const transportTicksAtEntry = transport.ticks;
    const {
      playbackOrder,
      entryScript,
      finalNoteKeys,
      fermataContext,
      consecutiveSameNoteKeys,
      stepDurations,
      entryFinalNoteKeys,
      entryAttackQuarters,
      jumpBoundaryAfterEntry,
      nextJumpBoundaryQuarters,
      pieceEndQuarters,
    } = this.getScheduleDerivedData(script, divisionsPerQuarter);

    const fromEntryIndex = this.nextUnscheduledEntryIndex;
    const totalEntries = playbackOrder.length;
    if (fromEntryIndex >= totalEntries) {
      return;
    }

    const currentQuarters = transportTicksAtEntry / ppq;
    const anchorQuarters =
      fromEntryIndex > 0 ? entryAttackQuarters[fromEntryIndex] : currentQuarters;
    const windowEndQuarters = anchorQuarters + PLAYBACK_SCHEDULE_AHEAD_QUARTERS;

    const anchorTick = Math.round(quartersToTicks(anchorQuarters, ppq));
    const transportNow = Math.round(transportTicksAtEntry);
    // When a rolling-window extension fires slightly late, shift this window's
    // events forward together so inter-attack gaps stay at score tempo instead
    // of past-due attacks firing in a burst (audible speed-up/slow-down wobble).
    const windowLagTicks =
      this.lastScheduledAttackTick < 0
        ? 0
        : Math.max(0, transportNow - anchorTick);
    const laggedTicksFromQuarters = (quarterNotes: number): number =>
      quartersToTicks(quarterNotes, ppq) + windowLagTicks;

    let lastScheduledEntry = fromEntryIndex;
    // Monotonic floor comes from the last scheduled *musical* attack. Only fall
    // back to transport.ticks when seeking mid-piece (lastScheduledAttackTick
    // reset to -1). Blending transport into every rolling-window extension
    // caused clamps when the clock ran slightly ahead of the next chunk's
    // anchor (extension fires at musical time, but transport.ticks can be a
    // few ticks ahead under load — tetoris step 639 et al.).
    let lastSafeAttackTick = this.lastScheduledAttackTick;
    if (lastSafeAttackTick < 0) {
      lastSafeAttackTick = Math.max(-1, transportNow - 1);
    }

    for (let entryIndex = fromEntryIndex; entryIndex < totalEntries; entryIndex += 1) {
      const stepIndex = playbackOrder[entryIndex].stepIndex;
      try {
        const step = script[stepIndex];
        const attackOnsetQuarters = entryAttackQuarters[entryIndex];

        if (entryIndex > fromEntryIndex && attackOnsetQuarters > windowEndQuarters) {
          break;
        }

        const { text: attackTime, tick: attackTickRaw } = safeTickTime(
          laggedTicksFromQuarters(attackOnsetQuarters),
          lastSafeAttackTick,
          'step attack',
          {
            entryIndex,
            stepIndex,
            passIndex: playbackOrder[entryIndex].passIndex,
            attackOnsetQuarters,
          },
        );
        let attackTick = attackTickRaw;
        let attackTimeText = attackTime;
        // After a backward (or any) sheet seek the transport is parked exactly on
        // the target attack tick; Tone's timeline often will not dispatch an
        // event scheduled at the current tick, so bump the seek entry one tick
        // forward so the jump is audible and visuals stay in sync.
        if (entryIndex === this.seekTargetEntryIndex) {
          const transportNow = Math.round(transportTicksAtEntry);
          if (attackTick <= transportNow) {
            attackTick = transportNow + 1;
            attackTimeText = `${attackTick}i`;
          }
        }

        // Mid-score tempo map: when this entry's document-onset BPM differs from
        // the previous entry's, retarget Transport.bpm at the attack tick so
        // subsequent tick→wall-clock conversion follows the new marking.
        // tempoFactor is read inside the callback so the settings slider stays live.
        if (entryIndex > 0) {
          const entryBpm = tempoBpmAtOnset(
            scoreTiming.tempoMap,
            step.onset,
            scoreTiming.tempoBpm,
          );
          const previousBpm = tempoBpmAtOnset(
            scoreTiming.tempoMap,
            script[playbackOrder[entryIndex - 1].stepIndex].onset,
            scoreTiming.tempoBpm,
          );
          if (entryBpm !== previousBpm) {
            const tempoEventId = transport.scheduleOnce(() => {
              try {
                const { tempoFactor } = useEngineStore.getState();
                transport.bpm.value = entryBpm * tempoFactor;
              } catch (err) {
                console.error('[PlaybackEngine] tempo-map callback failed (skipped):', err);
              }
            }, attackTimeText);
            this.scheduledEventIds.push(tempoEventId);
          }
        }

        // Graces are scheduled before this step's attack/release events so
        // that, at the shared main-attack tick, the last grace's release
        // fires ahead of the main press (Tone dispatches equal-tick events
        // in insertion order). The tick floor is the previous entry's attack,
        // since all grace events land between the two attacks.
        if (step.graceBefore && step.graceBefore.length > 0) {
          this.scheduleGraceNotes(
            stepIndex,
            step.graceBefore,
            attackOnsetQuarters,
            lastSafeAttackTick,
            ppq,
            engine,
            windowLagTicks,
          );
        }
        lastSafeAttackTick = attackTick;

        // Acciaccatura time is borrowed from the preceding note's tail: when
        // the NEXT entry opens with graces, any of this entry's releases that
        // would land inside that grace window release early to make room.
        // Notes intentionally sustaining past the next attack (other voices,
        // long holds) are left alone. Entry adjacency: after a backward jump
        // the "next" step is the repeat target, not the document successor.
        let nextGraceWindowStartQuarters: number | null = null;
        let nextAttackQuarters = 0;
        const nextEntryStep =
          entryIndex + 1 < totalEntries ? entryScript[entryIndex + 1] : null;
        const nextGraceCount = nextEntryStep?.graceBefore?.length ?? 0;
        if (nextEntryStep && nextGraceCount > 0) {
          nextAttackQuarters = entryAttackQuarters[entryIndex + 1];
          const windowStart =
            nextAttackQuarters - nextGraceCount * GRACE_NOTE_DURATION_QUARTERS;
          if (windowStart > attackOnsetQuarters) {
            nextGraceWindowStartQuarters = windowStart;
          }
        }

        const boundaryQuarters = nextJumpBoundaryQuarters[entryIndex];

        const stepPresses: Array<{
          pressId: number;
          note: ScriptNote;
          playedDuration: string;
        }> = [];

        for (const note of step.notes) {
          // Tie continuation is pass-dependent: consult ENTRY adjacency, so a
          // backward jump breaks any tie written across the jump boundary
          // instead of silently swallowing the post-jump attack.
          if (isPlaybackTieContinuation(entryScript, entryIndex, note)) {
            if (!note.tiedToNext) {
              this.scheduleTieEndRelease(
                entryIndex,
                stepIndex,
                note,
                attackOnsetQuarters,
                attackTick,
                divisionsPerQuarter,
                ppq,
                entryFinalNoteKeys,
                windowLagTicks,
                boundaryQuarters,
              );
            }
            continue;
          }

          // Sounded duration is pass-INVARIANT: resolved from the document
          // step tables, identical on every repeat pass.
          let playedQuarters = resolveNotePlaybackDurationQuarterNotes(
            stepIndex,
            note,
            script,
            stepDurations,
            divisionsPerQuarter,
            finalNoteKeys,
            consecutiveSameNoteKeys,
            fermataContext,
          );
          if (nextGraceWindowStartQuarters !== null) {
            const releaseQuarters = attackOnsetQuarters + playedQuarters;
            if (
              releaseQuarters > nextGraceWindowStartQuarters &&
              releaseQuarters <= nextAttackQuarters
            ) {
              playedQuarters = nextGraceWindowStartQuarters - attackOnsetQuarters;
            }
          }
          playedQuarters = clampPlayedQuartersToJumpBoundary(
            playedQuarters,
            attackOnsetQuarters,
            boundaryQuarters,
          );
          const playedDuration = quarterNotesToTickDuration(playedQuarters, ppq);
          const pressId = this.playingPressTracker.allocatePressId();

          stepPresses.push({ pressId, note, playedDuration });

          if (!note.tiedToNext) {
            const releaseOnset = attackOnsetQuarters + playedQuarters;
            const { text: releaseTime, tick: releaseTick } = safeTickTime(
              laggedTicksFromQuarters(releaseOnset),
              attackTick,
              'note release',
              { entryIndex, stepIndex, midi: note.midi, hand: note.hand },
            );
            this.scheduledReleaseTickByPressId.set(pressId, releaseTick);
            const releaseEventId = transport.scheduleOnce(() => {
              try {
                this.releasePlayingNote(pressId);
              } catch (err) {
                console.error('[PlaybackEngine] note release callback failed (skipped):', err);
              }
            }, releaseTime);
            this.scheduledEventIds.push(releaseEventId);
          }
        }

        const stepEventId = transport.scheduleOnce((time) => {
          try {
            this.releaseOverduePresses(Math.round(getTransport().ticks));
            this.applyStepVisual(stepIndex, entryIndex);

            for (const { pressId, note, playedDuration } of stepPresses) {
              // note.hasAccent / note.hasMarcato: deferred velocity/loudness emphasis only.
              // AudioEngine already threads velocity through Sampler.triggerAttack; not wired
              // here. Marcato's duration shortening IS applied - it's baked into
              // playedDuration via playbackTiming's resolveNotePlaybackDurationQuarterNotes.
              engine.scheduleAttackRelease(note.midi, playedDuration, time);

              // Repeated-attack detection consults ENTRY adjacency: a backward
              // jump makes the repeat target's first note a real re-strike when
              // the pre-jump entry ended on the same pitch.
              if (isRepeatedPlaybackAttack(entryScript, entryIndex, note)) {
                this.deferRepeatedPress(stepIndex, note.midi, note.hand, pressId);
              } else {
                this.pressPlayingNote(stepIndex, note.midi, note.hand, pressId);
              }
            }
          } catch (err) {
            console.error('[PlaybackEngine] step attack callback failed (skipped):', err);
          }
        }, attackTimeText);

        this.scheduledEventIds.push(stepEventId);

        // Backward jump / volta skip directly after this entry: nothing may
        // keep sounding across it.
        if (jumpBoundaryAfterEntry[entryIndex] && entryIndex + 1 < totalEntries) {
          this.scheduleJumpBoundaryRelease(
            entryIndex,
            nextJumpBoundaryQuarters[entryIndex],
            attackTick,
            ppq,
            windowLagTicks,
          );
        }

        lastScheduledEntry = entryIndex + 1;
      } catch (err) {
        console.error(
          '[PlaybackEngine] scheduleFromEntry entry scheduling failed (entry skipped, continuing)',
          {
            entryIndex,
            stepIndex,
            errorMessage: err instanceof Error ? err.message : String(err),
            errorStack: err instanceof Error ? err.stack : undefined,
          },
        );
        lastScheduledEntry = entryIndex + 1;
      }
    }

    this.nextUnscheduledEntryIndex = lastScheduledEntry;
    this.lastScheduledAttackTick = lastSafeAttackTick;

    if (lastScheduledEntry < totalEntries) {
      const triggerQuarters = entryAttackQuarters[lastScheduledEntry];
      const { text: extensionTime } = safeTickTime(
        laggedTicksFromQuarters(triggerQuarters),
        lastSafeAttackTick,
        'schedule extension',
        { fromEntryIndex: lastScheduledEntry },
      );
      const extensionEventId = transport.scheduleOnce((_time) => {
        try {
          if (!this.isPlaying || this.isPaused) {
            return;
          }
          if (this.nextUnscheduledEntryIndex >= totalEntries) {
            return;
          }
          this.extendScheduleWindow();
        } catch (err) {
          console.error('[PlaybackEngine] schedule extension callback failed (skipped):', err);
        }
      }, extensionTime);
      this.scheduledEventIds.push(extensionEventId);
      return;
    }

    const { text: pieceEndTime } = safeTickTime(
      laggedTicksFromQuarters(pieceEndQuarters),
      lastSafeAttackTick,
      'piece end',
      { totalEntries },
    );
    const endEventId = transport.scheduleOnce((time) => {
      try {
        this.completePlayback(time);
      } catch (err) {
        console.error('[PlaybackEngine] piece-end callback failed (skipped):', err);
      }
    }, pieceEndTime);
    this.scheduledEventIds.push(endEventId);
  }

  private completePlayback(time?: number): void {
    if (!this.isPlaying || this.isPaused) {
      return;
    }

    if (time !== undefined) {
      getTransport().pause(time);
    } else {
      getTransport().pause();
    }
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
    this.nextUnscheduledEntryIndex = 0;
    this.lastScheduledAttackTick = -1;
    this.clearPlayingNotes();
    transport.cancel(0);
  }
}

export const playbackEngine = new PlaybackEngine();
