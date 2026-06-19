import * as Tone from 'tone';
import type { AudioEngine } from './AudioEngine.ts';
import { getDisplayNotesForStep } from './practiceSteps.ts';
import {
  noteDurationQuarterNotes,
  playbackDurationQuarterNotes,
  quarterNotesToToneDuration,
  stepOnsetQuarterNotes,
} from './playbackTiming.ts';
import { useEngineStore } from '../store/useEngineStore.ts';
import { PlayingMidiPressTracker } from './playingMidiPressTracker.ts';

const transport = Tone.getTransport();
const draw = Tone.getDraw();

function quartersToTransportPosition(quarterNotes: number): string {
  const bars = Math.floor(quarterNotes / 4);
  const beats = quarterNotes % 4;
  return `${bars}:${beats}:0`;
}

export class PlaybackEngine {
  private audioEngine: AudioEngine | null = null;
  private scheduledEventIds: number[] = [];
  private playingPressTracker = new PlayingMidiPressTracker();
  private isPlaying = false;
  private isPaused = false;
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
      }
    });
  }

  attachAudioEngine(audioEngine: AudioEngine): void {
    this.audioEngine = audioEngine;
  }

  async play(): Promise<void> {
    const { script, scoreTiming, currentStepIndex } = useEngineStore.getState();
    if (!script || !scoreTiming || script.length === 0) {
      return;
    }

    const engine = this.audioEngine;
    if (!engine) {
      return;
    }

    await engine.warm();
    await engine.init();

    const startIndex = Math.min(
      Math.max(currentStepIndex, 0),
      script.length - 1,
    );
    const startOnsetQuarters = stepOnsetQuarterNotes(
      script[startIndex].onset,
      scoreTiming.divisionsPerQuarter,
    );

    this.clearScheduledEvents();
    transport.stop();
    this.applyTransportBpm(scoreTiming.tempoBpm);
    transport.position = quartersToTransportPosition(startOnsetQuarters);
    this.applyStepVisual(startIndex);
    this.scheduleFromStep(startIndex);

    transport.start();
    this.isPlaying = true;
    this.isPaused = false;
    const { actions } = useEngineStore.getState();
    actions.setPlaybackActive(true);
    actions.setPlaybackPaused(false);
  }

  pause(): void {
    if (!this.isPlaying || this.isPaused) {
      return;
    }

    transport.pause();
    this.isPaused = true;
    this.clearPlayingMidis();
    useEngineStore.getState().actions.setPlaybackPaused(true);
  }

  resume(): void {
    if (!this.isPlaying || !this.isPaused) {
      return;
    }

    transport.start();
    this.isPaused = false;
    useEngineStore.getState().actions.setPlaybackPaused(false);
  }

  async restart(): Promise<void> {
    const { script, scoreTiming, actions } = useEngineStore.getState();
    if (!script || !scoreTiming) {
      return;
    }

    this.clearScheduledEvents();
    transport.stop();
    this.isPlaying = false;
    this.isPaused = true;

    this.applyTransportBpm(scoreTiming.tempoBpm);
    transport.position = 0;
    this.applyStepVisual(0);
    this.audioEngine?.releaseAll();

    actions.setPlaybackActive(true);
    actions.setPlaybackPaused(true);
  }

  stop(): void {
    this.clearScheduledEvents();
    transport.stop();
    this.isPlaying = false;
    this.isPaused = false;
    const { actions } = useEngineStore.getState();
    actions.setPlaybackActive(false);
    actions.setPlaybackPaused(false);

    actions.setStepIndex(0);
    actions.setExpectedNotes([]);
    actions.setPlayingMidiNotes([]);
    transport.position = 0;
    this.audioEngine?.releaseAll();
  }

  seekToStep(stepIndex: number): void {
    const { script, scoreTiming, actions } = useEngineStore.getState();
    if (!script || !scoreTiming || stepIndex < 0 || stepIndex >= script.length) {
      return;
    }

    const wasPlaying = this.isPlaying && !this.isPaused;
    const onsetQuarters = stepOnsetQuarterNotes(
      script[stepIndex].onset,
      scoreTiming.divisionsPerQuarter,
    );

    this.clearScheduledEvents();
    transport.position = quartersToTransportPosition(onsetQuarters);
    actions.setStepIndex(stepIndex);
    this.applyStepVisual(stepIndex);

    if (wasPlaying) {
      this.scheduleFromStep(stepIndex);
      transport.start();
      this.isPlaying = true;
      this.isPaused = false;
      actions.setPlaybackPaused(false);
      return;
    }

    transport.pause();
    actions.setPlaybackPaused(true);
  }

  setTempoFactor(factor: number): void {
    const { scoreTiming } = useEngineStore.getState();
    if (!scoreTiming) {
      return;
    }

    transport.bpm.value = scoreTiming.tempoBpm * factor;
  }

  dispose(): void {
    this.stop();
    this.audioEngine = null;
    this.storeSubscriptionInitialized = false;
  }

  private applyTransportBpm(baseTempoBpm: number): void {
    const { tempoFactor } = useEngineStore.getState();
    transport.bpm.value = baseTempoBpm * tempoFactor;
  }

  private syncPlayingMidis(): void {
    useEngineStore
      .getState()
      .actions.setPlayingMidiNotes(this.playingPressTracker.activeMidis());
  }

  private pressPlayingMidi(midi: number, pressId: number): void {
    this.playingPressTracker.press(midi, pressId);
    this.syncPlayingMidis();
  }

  private releasePlayingMidi(pressId: number): void {
    this.playingPressTracker.release(pressId);
    this.syncPlayingMidis();
  }

  private clearPlayingMidis(): void {
    this.playingPressTracker.clear();
    useEngineStore.getState().actions.setPlayingMidiNotes([]);
  }

  private scheduleFromStep(fromStepIndex: number): void {
    const { script, scoreTiming } = useEngineStore.getState();
    const engine = this.audioEngine;
    if (!script || !scoreTiming || !engine) {
      return;
    }

    const { divisionsPerQuarter } = scoreTiming;

    for (let stepIndex = fromStepIndex; stepIndex < script.length; stepIndex += 1) {
      const step = script[stepIndex];
      const onsetQuarters = stepOnsetQuarterNotes(step.onset, divisionsPerQuarter);
      const transportTime = quartersToTransportPosition(onsetQuarters);

      const eventId = transport.scheduleOnce((time) => {
        draw.schedule(() => {
          this.applyStepVisual(stepIndex);
        }, time);

        for (const note of step.notes) {
          const durationDivisions = note.durationDivisions ?? divisionsPerQuarter;
          const writtenQuarters = noteDurationQuarterNotes(
            durationDivisions,
            divisionsPerQuarter,
          );
          const playedQuarters = playbackDurationQuarterNotes(writtenQuarters);
          const toneDuration = quarterNotesToToneDuration(writtenQuarters);
          const releaseQuarters = onsetQuarters + playedQuarters;
          const pressId = this.playingPressTracker.allocatePressId();

          draw.schedule(() => {
            this.pressPlayingMidi(note.midi, pressId);
          }, time);

          const releaseEventId = transport.scheduleOnce((releaseTime) => {
            draw.schedule(() => {
              this.releasePlayingMidi(pressId);
            }, releaseTime);
          }, quartersToTransportPosition(releaseQuarters));
          this.scheduledEventIds.push(releaseEventId);

          engine.scheduleAttackRelease(note.midi, toneDuration, time);
        }
      }, transportTime);

      this.scheduledEventIds.push(eventId);
    }
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

  private clearScheduledEvents(): void {
    for (const eventId of this.scheduledEventIds) {
      transport.clear(eventId);
    }

    this.scheduledEventIds = [];
    this.clearPlayingMidis();
    transport.cancel(0);
  }
}

export const playbackEngine = new PlaybackEngine();
