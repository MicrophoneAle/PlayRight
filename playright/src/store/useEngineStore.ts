import { create } from 'zustand';
import { applyFingeringSettings, prepareScriptWithFingering } from '../core/fingeringPredictor.ts';
import { parseMusicXmlToScript } from '../core/parser/index.ts';
import { updateScoreManualFingerings } from '../core/scoreLibrary.ts';
import { cycleShiftMode as cycleShiftModeValue } from '../core/shiftMode.ts';
import { shiftScopeStart } from '../core/scopeShift.ts';
import { fingeringProgramEngine } from '../core/FingeringProgramEngine.ts';
import { canWriteProgramStepIndex } from '../core/programStepGuard.ts';
import { practiceEngine } from '../core/PracticeEngine.ts';
import type {
  EngineMode,
  Finger,
  FingeringMode,
  Hand,
  ManualFingeringMap,
  PlaybackScript,
  PlayingPlaybackNote,
  ScoreTiming,
  SelectedFingeringNote,
} from '../types/index.ts';
import { fingeringKey } from '../types/index.ts';

export type ShiftMode = 'octave' | 'semitone' | 'full-range';
export type SheetScrollMode = 'smooth' | 'instant';

const SHEET_SCROLL_MODE_STORAGE_KEY = 'playright-sheet-scroll-mode';
const AUTO_FINGERING_STORAGE_KEY = 'playright-auto-fingering';
const HAND_SPAN_STORAGE_KEY = 'playright-hand-span';
const OVERRIDE_SCORE_FINGERINGS_STORAGE_KEY = 'playright-override-score-fingerings';
const FINGERING_MODE_STORAGE_KEY = 'playright-fingering-mode';
const PLAY_MODE_STORAGE_KEY = 'playright-play-mode';
const SHOW_TWO_HAND_FINGERINGS_IN_PLAY_MODE_STORAGE_KEY =
  'playright-show-two-hand-fingerings-in-play-mode';
const TEMPO_FACTOR_STORAGE_KEY = 'playright-tempo-factor';

export const TEMPO_FACTOR_MIN = 0.5;
export const TEMPO_FACTOR_MAX = 1.5;
export const TEMPO_FACTOR_STEP = 0.05;
export const TEMPO_FACTOR_DEFAULT = 1;

export const HAND_SPAN_PRESETS = [0.85, 1, 1.15] as const;
export type HandSpanPreset = (typeof HAND_SPAN_PRESETS)[number];

function readStoredSheetScrollMode(): SheetScrollMode {
  if (typeof window === 'undefined') {
    return 'smooth';
  }

  const stored = window.localStorage.getItem(SHEET_SCROLL_MODE_STORAGE_KEY);
  return stored === 'instant' ? 'instant' : 'smooth';
}

function readStoredAutoFingering(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }

  const stored = window.localStorage.getItem(AUTO_FINGERING_STORAGE_KEY);
  return stored !== 'false';
}

function readStoredHandSpan(): HandSpanPreset {
  if (typeof window === 'undefined') {
    return 1;
  }

  const stored = window.localStorage.getItem(HAND_SPAN_STORAGE_KEY);
  const parsed = stored !== null ? Number(stored) : 1;

  return HAND_SPAN_PRESETS.includes(parsed as HandSpanPreset)
    ? (parsed as HandSpanPreset)
    : 1;
}

function readStoredOverrideScoreFingerings(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.localStorage.getItem(OVERRIDE_SCORE_FINGERINGS_STORAGE_KEY) === 'true';
}

function readStoredPlayMode(): boolean {
  return false;
}

function readStoredShowTwoHandFingeringsInPlayMode(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return (
    window.localStorage.getItem(SHOW_TWO_HAND_FINGERINGS_IN_PLAY_MODE_STORAGE_KEY) ===
    'true'
  );
}

function shouldAutoShowPlayModeFingerings(
  showTwoHandFingeringsInPlayMode: boolean,
): boolean {
  return showTwoHandFingeringsInPlayMode;
}

function clampTempoFactor(value: number): number {
  const rounded = Math.round(value / TEMPO_FACTOR_STEP) * TEMPO_FACTOR_STEP;
  return Math.min(TEMPO_FACTOR_MAX, Math.max(TEMPO_FACTOR_MIN, rounded));
}

function readStoredTempoFactor(): number {
  if (typeof window === 'undefined') {
    return TEMPO_FACTOR_DEFAULT;
  }

  const stored = window.localStorage.getItem(TEMPO_FACTOR_STORAGE_KEY);
  const parsed = stored !== null ? Number(stored) : TEMPO_FACTOR_DEFAULT;

  if (!Number.isFinite(parsed)) {
    return TEMPO_FACTOR_DEFAULT;
  }

  return clampTempoFactor(parsed);
}

function syncPlaybackTempoFactor(factor: number): void {
  void import('../core/PlaybackEngine.ts').then(({ playbackEngine }) => {
    playbackEngine.setTempoFactor(factor);
  });
}

function stopPlaybackSession(): void {
  const state = useEngineStore.getState();
  if (!state.isPlaybackActive && !state.isPlaybackPaused) {
    return;
  }

  void import('../core/PlaybackEngine.ts').then(({ playbackEngine }) => {
    playbackEngine.stop();
  });
}

/** Restored when leaving program fingering mode. */
let engineModeBeforeFingering: EngineMode | null = null;

function stopPracticeSession(): void {
  practiceEngine.stop();
}

/** Pause practice without resetting step — used when entering fingering program mode. */
function suspendPracticeForFingeringMode(): void {
  practiceEngine.suspendForFingeringMode();
}

function stopFingeringProgramSession(): void {
  fingeringProgramEngine.stop();
}

function startFingeringProgramSession(): void {
  fingeringProgramEngine.start();
}

async function reprocessScriptFromRaw(
  rawXml: string | null,
  manualFingerings: ManualFingeringMap,
  autoFingering: boolean,
  handSpan: HandSpanPreset,
  overrideScoreFingerings: boolean,
): Promise<{ script: PlaybackScript; scoreTiming: ScoreTiming } | null> {
  if (!rawXml) {
    return null;
  }

  const { script: parsed, scoreTiming } = parseMusicXmlToScript(rawXml);
  const script = await prepareScriptWithFingering(
    parsed,
    manualFingerings,
    autoFingering,
    handSpan,
    overrideScoreFingerings,
    scoreTiming,
  );

  return { script, scoreTiming };
}

function persistManualFingerings(
  scoreId: string | null,
  manualFingerings: ManualFingeringMap,
  userId: string | null | undefined,
): void {
  if (!scoreId || !userId) {
    return;
  }

  void updateScoreManualFingerings(scoreId, userId, manualFingerings).then(
    (result) => {
      if (!result.ok) {
        console.error(
          '[scoreLibrary] Failed to persist manual fingerings:',
          result.reason,
        );
      }
    },
  );
}

export interface LoadScriptLibraryMeta {
  scoreId?: string | null;
  manualFingerings?: ManualFingeringMap;
}

interface EngineState {
  script: PlaybackScript | null;
  rawXml: string | null;
  songTitle: string | null;
  scoreId: string | null;
  scoreTiming: ScoreTiming | null;
  manualFingerings: ManualFingeringMap;
  fingeringMode: FingeringMode;
  selectedFingeringNote: SelectedFingeringNote | null;
  /** Keys `${hand}:${midi}` assigned in the current program step (transient UI). */
  programAssignedKeys: string[];
  /** Score-order note index to (re)assign after a sheet click-jump; null = normal capture. */
  programRefingerNoteIndex: number | null;
  scopeStartMidi: number;
  scopeTranspose: number;
  shiftMode: ShiftMode;
  sheetScrollMode: SheetScrollMode;
  autoFingering: boolean;
  handSpan: HandSpanPreset;
  overrideScoreFingerings: boolean;
  engineMode: EngineMode;
  activeHand: Hand;
  /** Set by PracticeEngine; false when paused, stopped, or not yet started. */
  isPracticeActive: boolean;
  /** Index into the current step's graceBefore array; null = at the main note or none. */
  practiceGraceCursor: number | null;
  /** True after Start is pressed for the current piece (enables Restart). */
  hasPracticeStarted: boolean;
  /** True while a playback session is active (playing or paused). */
  isPlaybackActive: boolean;
  /** True when play mode reached the end of the piece and is paused awaiting replay. */
  isPlaybackFinished: boolean;
  /** True when playback is paused mid-session. */
  isPlaybackPaused: boolean;
  playMode: boolean;
  /** Persisted: auto-enable play-mode fingerings when entering play in two-hand mode. */
  showTwoHandFingeringsInPlayMode: boolean;
  /** Runtime: show two-hand fingering labels on the keyboard during play mode. */
  playModeFingeringsVisible: boolean;
  tempoFactor: number;
  headerCollapsed: boolean;
  /** Non-fatal parse notices for the current piece; shown in a dismissible panel. */
  parseWarnings: string[];
  currentStepIndex: number;
  totalSteps: number;
  expectedMidiNotes: number[];
  playingMidiNotes: number[];
  /** Notes currently sounding during play mode (includes step index for sheet sync). */
  playingPlaybackNotes: PlayingPlaybackNote[];
  actions: {
    loadScript: (
      script: PlaybackScript,
      rawXml: string,
      title?: string,
      library?: LoadScriptLibraryMeta,
      scoreTiming?: ScoreTiming,
    ) => void;
    clearScript: () => void;
    setManualFinger: (
      onset: number,
      hand: Hand,
      midi: number,
      finger: Finger,
      userId?: string | null,
    ) => void;
    setManualFingerInProgram: (
      onset: number,
      hand: Hand,
      midi: number,
      finger: Finger,
      physicalHand: Hand,
      userId?: string | null,
    ) => void;
    clearManualFinger: (
      onset: number,
      hand: Hand,
      midi: number,
      userId?: string | null,
    ) => void;
    setFingeringMode: (mode: FingeringMode) => void;
    setSelectedFingeringNote: (note: SelectedFingeringNote | null) => void;
    setProgramAssignedKeys: (keys: string[]) => void;
    setProgramRefingerNoteIndex: (index: number | null) => void;
    setScopeStart: (midi: number | ((prev: number) => number)) => void;
    nudgeScope: (direction: 'up' | 'down') => void;
    setShiftMode: (mode: ShiftMode) => void;
    setSheetScrollMode: (mode: SheetScrollMode) => void;
    setAutoFingering: (enabled: boolean) => void;
    setHandSpan: (span: HandSpanPreset) => void;
    setOverrideScoreFingerings: (enabled: boolean) => void;
    cycleShiftMode: (direction: 'up' | 'down') => void;
    setEngineMode: (mode: EngineMode) => void;
    setActiveHand: (hand: Hand) => void;
    setPracticeActive: (isActive: boolean) => void;
    setPracticeGraceCursor: (index: number | null) => void;
    setHasPracticeStarted: (started: boolean) => void;
    setPlaybackActive: (active: boolean) => void;
    setPlaybackFinished: (finished: boolean) => void;
    setPlaybackPaused: (paused: boolean) => void;
    setPlayMode: (enabled: boolean) => void;
    setShowTwoHandFingeringsInPlayMode: (enabled: boolean) => void;
    setPlayModeFingeringsVisible: (visible: boolean) => void;
    togglePlayModeFingeringsVisible: () => void;
    setTempoFactor: (factor: number) => void;
    toggleHeaderCollapsed: () => void;
    setParseWarnings: (warnings: string[]) => void;
    setStepIndex: (index: number) => void;
    setExpectedNotes: (notes: number[]) => void;
    setPlayingMidiNotes: (notes: number[]) => void;
    setPlayingPlaybackNotes: (notes: PlayingPlaybackNote[]) => void;
  };
}

export const useEngineStore = create<EngineState>((set) => {
  return {
  script: null,
  rawXml: null,
  songTitle: null,
  scoreId: null,
  scoreTiming: null,
  manualFingerings: {},
  fingeringMode: 'off',
  selectedFingeringNote: null,
  programAssignedKeys: [],
  programRefingerNoteIndex: null,
  scopeStartMidi: 60,
  scopeTranspose: 0,
  shiftMode: 'semitone',
  sheetScrollMode: readStoredSheetScrollMode(),
  autoFingering: readStoredAutoFingering(),
  handSpan: readStoredHandSpan(),
  overrideScoreFingerings: readStoredOverrideScoreFingerings(),
  engineMode: 'one-hand',
  activeHand: 'R',
  isPracticeActive: false,
  practiceGraceCursor: null,
  hasPracticeStarted: false,
  isPlaybackActive: false,
  isPlaybackFinished: false,
  isPlaybackPaused: false,
  playMode: readStoredPlayMode(),
  showTwoHandFingeringsInPlayMode: readStoredShowTwoHandFingeringsInPlayMode(),
  playModeFingeringsVisible: false,
  tempoFactor: readStoredTempoFactor(),
  headerCollapsed: false,
  parseWarnings: [],
  currentStepIndex: 0,
  totalSteps: 0,
  expectedMidiNotes: [],
  playingMidiNotes: [],
  playingPlaybackNotes: [],
  actions: {
    loadScript: (script, rawXml, title, library, scoreTiming) => {
      stopPlaybackSession();
      if (useEngineStore.getState().fingeringMode === 'program') {
        stopFingeringProgramSession();
      }

      set({
        script,
        rawXml,
        songTitle: title ?? null,
        scoreId: library?.scoreId ?? null,
        scoreTiming: scoreTiming ?? null,
        manualFingerings: library?.manualFingerings ?? {},
        currentStepIndex: 0,
        totalSteps: script.length,
        isPracticeActive: false,
        practiceGraceCursor: null,
        hasPracticeStarted: false,
        isPlaybackActive: false,
        isPlaybackFinished: false,
        isPlaybackPaused: false,
        expectedMidiNotes: [],
        playingMidiNotes: [],
        playingPlaybackNotes: [],
        parseWarnings: [],
      });
    },
    clearScript: () => {
      set({
        script: null,
        rawXml: null,
        songTitle: null,
        scoreId: null,
        scoreTiming: null,
        manualFingerings: {},
        selectedFingeringNote: null,
        hasPracticeStarted: false,
        practiceGraceCursor: null,
        isPlaybackActive: false,
        isPlaybackFinished: false,
        isPlaybackPaused: false,
        expectedMidiNotes: [],
        playingMidiNotes: [],
        playingPlaybackNotes: [],
        parseWarnings: [],
      });
    },
    setManualFinger: (onset, hand, midi, finger, userId) => {
      const state = useEngineStore.getState();
      const manualFingerings = {
        ...state.manualFingerings,
        [fingeringKey(onset, hand, midi)]: finger,
      };

      persistManualFingerings(state.scoreId, manualFingerings, userId);

      void reprocessScriptFromRaw(
        state.rawXml,
        manualFingerings,
        state.autoFingering,
        state.handSpan,
        state.overrideScoreFingerings,
      ).then((reprocessed) => {
        if (!reprocessed) {
          set({ manualFingerings });
          return;
        }

        set({
          manualFingerings,
          script: reprocessed.script,
          scoreTiming: reprocessed.scoreTiming,
          totalSteps: reprocessed.script.length,
        });
      });
    },
    setManualFingerInProgram: (onset, hand, midi, finger, physicalHand, userId) => {
      set((state) => {
        const value =
          physicalHand === hand
            ? finger
            : { finger, physicalHand };
        const manualFingerings = {
          ...state.manualFingerings,
          [fingeringKey(onset, hand, midi)]: value,
        };

        persistManualFingerings(state.scoreId, manualFingerings, userId);

        if (!state.script) {
          return { manualFingerings };
        }

        const script = state.script.map((step) => {
          if (step.onset !== onset) {
            return step;
          }

          return {
            ...step,
            notes: step.notes.map((note) =>
              note.hand === hand && note.midi === midi
                ? {
                    ...note,
                    finger,
                    playingHand: physicalHand,
                    fingerSource: 'manual' as const,
                  }
                : note,
            ),
          };
        });

        return { manualFingerings, script };
      });
    },
    clearManualFinger: (onset, hand, midi, userId) => {
      const state = useEngineStore.getState();
      const key = fingeringKey(onset, hand, midi);
      const manualFingerings = { ...state.manualFingerings };
      delete manualFingerings[key];

      persistManualFingerings(state.scoreId, manualFingerings, userId);

      void reprocessScriptFromRaw(
        state.rawXml,
        manualFingerings,
        state.autoFingering,
        state.handSpan,
        state.overrideScoreFingerings,
      ).then((reprocessed) => {
        if (!reprocessed) {
          set({ manualFingerings });
          return;
        }

        set({
          manualFingerings,
          script: reprocessed.script,
          scoreTiming: reprocessed.scoreTiming,
          totalSteps: reprocessed.script.length,
        });
      });
    },
    setFingeringMode: (mode) => {
      const prevMode = useEngineStore.getState().fingeringMode;
      if (mode === prevMode) {
        return;
      }

      window.localStorage.setItem(FINGERING_MODE_STORAGE_KEY, mode);

      if (mode === 'program') {
        stopPlaybackSession();
        suspendPracticeForFingeringMode();
      }
      if (mode !== 'program') {
        stopFingeringProgramSession();
      }

      set((state) => {
        const enteringFromOff = state.fingeringMode === 'off' && mode !== 'off';
        const leavingToOff = state.fingeringMode !== 'off' && mode === 'off';

        if (enteringFromOff) {
          engineModeBeforeFingering = state.engineMode;
        }

        const enteringProgram = mode === 'program' && prevMode !== 'program';

        const restoredEngineMode =
          mode === 'program'
            ? ('two-hand' as const)
            : leavingToOff
              ? (engineModeBeforeFingering ?? state.engineMode)
              : state.engineMode;

        if (leavingToOff) {
          engineModeBeforeFingering = null;
        }

        const base = {
          fingeringMode: mode,
          playMode: false,
          isPracticeActive: false,
          practiceGraceCursor: null,
          hasPracticeStarted: false,
          isPlaybackActive: false,
          isPlaybackFinished: false,
          isPlaybackPaused: false,
          expectedMidiNotes: [],
          playingMidiNotes: [],
          playingPlaybackNotes: [],
          selectedFingeringNote: null,
          currentStepIndex: enteringProgram ? 0 : state.currentStepIndex,
          engineMode: restoredEngineMode,
        };

        return base;
      });

      if (mode === 'program' && prevMode !== 'program') {
        startFingeringProgramSession();
      }
    },
    setSelectedFingeringNote: (note) => {
      set({ selectedFingeringNote: note });
    },
    setProgramAssignedKeys: (keys) => {
      set({ programAssignedKeys: keys });
    },
    setProgramRefingerNoteIndex: (index) => {
      set({ programRefingerNoteIndex: index });
    },
    setScopeStart: (midi) => {
      set((state) => ({
        scopeStartMidi:
          typeof midi === 'function' ? midi(state.scopeStartMidi) : midi,
        scopeTranspose: 0,
      }));
    },
    nudgeScope: (direction) => {
      set((state) => ({
        scopeStartMidi: shiftScopeStart(
          state.scopeStartMidi,
          direction,
          state.shiftMode,
        ),
        scopeTranspose: 0,
      }));
    },
    setShiftMode: (mode) => {
      set({ shiftMode: mode });
    },
    setSheetScrollMode: (mode) => {
      window.localStorage.setItem(SHEET_SCROLL_MODE_STORAGE_KEY, mode);
      set({ sheetScrollMode: mode });
    },
    setAutoFingering: (enabled) => {
      window.localStorage.setItem(
        AUTO_FINGERING_STORAGE_KEY,
        enabled ? 'true' : 'false',
      );
      const state = useEngineStore.getState();
      void (async () => {
        const script = state.script
          ? await applyFingeringSettings(
              state.script,
              enabled,
              state.handSpan,
              state.overrideScoreFingerings,
              state.scoreTiming?.divisionsPerQuarter,
            )
          : null;

        set(script ? { autoFingering: enabled, script } : { autoFingering: enabled });
      })();
    },
    setHandSpan: (span) => {
      window.localStorage.setItem(HAND_SPAN_STORAGE_KEY, String(span));
      const state = useEngineStore.getState();
      void (async () => {
        const handSpan = span;
        const script = state.script
          ? await applyFingeringSettings(
              state.script,
              state.autoFingering,
              handSpan,
              state.overrideScoreFingerings,
              state.scoreTiming?.divisionsPerQuarter,
            )
          : null;

        set(script ? { handSpan, script } : { handSpan });
      })();
    },
    setOverrideScoreFingerings: (enabled) => {
      window.localStorage.setItem(
        OVERRIDE_SCORE_FINGERINGS_STORAGE_KEY,
        enabled ? 'true' : 'false',
      );
      const state = useEngineStore.getState();
      const overrideScoreFingerings = enabled;

      void reprocessScriptFromRaw(
        state.rawXml,
        state.manualFingerings,
        state.autoFingering,
        state.handSpan,
        overrideScoreFingerings,
      ).then((reprocessed) => {
        if (reprocessed) {
          set({
            overrideScoreFingerings,
            script: reprocessed.script,
            scoreTiming: reprocessed.scoreTiming,
            totalSteps: reprocessed.script.length,
          });
          return;
        }

        void (async () => {
          const script = state.script
            ? await applyFingeringSettings(
                state.script,
                state.autoFingering,
                state.handSpan,
                overrideScoreFingerings,
                state.scoreTiming?.divisionsPerQuarter,
              )
            : null;

          set(
            script
              ? { overrideScoreFingerings, script }
              : { overrideScoreFingerings },
          );
        })();
      });
    },
    cycleShiftMode: (direction) => {
      set((state) => ({
        shiftMode: cycleShiftModeValue(state.shiftMode, direction),
      }));
    },
    setEngineMode: (mode) => {
      set((state) => {
        if (mode === state.engineMode) {
          return state;
        }

        if (mode === 'one-hand' && state.fingeringMode === 'program') {
          stopFingeringProgramSession();
          window.localStorage.setItem(FINGERING_MODE_STORAGE_KEY, 'off');
          return {
            engineMode: mode,
            fingeringMode: 'off' as const,
            isPracticeActive: false,
            practiceGraceCursor: null,
            hasPracticeStarted: false,
            expectedMidiNotes: [],
          };
        }

        return { engineMode: mode };
      });
    },
    setActiveHand: (hand) => {
      set({
        activeHand: hand,
        currentStepIndex: 0,
        isPracticeActive: false,
        practiceGraceCursor: null,
        expectedMidiNotes: [],
      });
    },
    setPracticeActive: (isActive) => {
      set({ isPracticeActive: isActive });
    },
    setPracticeGraceCursor: (index) => {
      set({ practiceGraceCursor: index });
    },
    setHasPracticeStarted: (started) => {
      set({ hasPracticeStarted: started });
    },
    setPlaybackActive: (active) => {
      set({ isPlaybackActive: active });
    },
    setPlaybackFinished: (finished) => {
      set({ isPlaybackFinished: finished });
    },
    setPlaybackPaused: (paused) => {
      set({ isPlaybackPaused: paused });
    },
    setPlayMode: (enabled) => {
      window.localStorage.setItem(
        PLAY_MODE_STORAGE_KEY,
        enabled ? 'true' : 'false',
      );

      set((state) => {
        if (state.playMode === enabled) {
          return state;
        }

        if (enabled) {
          stopPracticeSession();
          stopFingeringProgramSession();
        } else {
          stopPlaybackSession();
        }

        return {
          playMode: enabled,
          fingeringMode: enabled ? ('off' as const) : state.fingeringMode,
          currentStepIndex: 0,
          practiceGraceCursor: null,
          expectedMidiNotes: [],
          playingMidiNotes: [],
          playingPlaybackNotes: [],
          selectedFingeringNote: enabled ? null : state.selectedFingeringNote,
          playModeFingeringsVisible: enabled
            ? shouldAutoShowPlayModeFingerings(state.showTwoHandFingeringsInPlayMode)
            : false,
          ...(enabled
            ? {
                isPracticeActive: false,
                hasPracticeStarted: false,
              }
            : {
                isPlaybackActive: false,
                isPlaybackFinished: false,
                isPlaybackPaused: false,
              }),
        };
      });
    },
    setShowTwoHandFingeringsInPlayMode: (enabled) => {
      window.localStorage.setItem(
        SHOW_TWO_HAND_FINGERINGS_IN_PLAY_MODE_STORAGE_KEY,
        enabled ? 'true' : 'false',
      );

      set((state) => {
        if (state.showTwoHandFingeringsInPlayMode === enabled) {
          return state;
        }

        if (
          enabled &&
          state.playMode
        ) {
          return {
            showTwoHandFingeringsInPlayMode: enabled,
            playModeFingeringsVisible: true,
          };
        }

        return { showTwoHandFingeringsInPlayMode: enabled };
      });
    },
    setPlayModeFingeringsVisible: (visible) => {
      set({ playModeFingeringsVisible: visible });
    },
    togglePlayModeFingeringsVisible: () => {
      set((state) => ({ playModeFingeringsVisible: !state.playModeFingeringsVisible }));
    },
    setTempoFactor: (factor) => {
      const tempoFactor = clampTempoFactor(factor);
      window.localStorage.setItem(TEMPO_FACTOR_STORAGE_KEY, String(tempoFactor));
      set({ tempoFactor });
      syncPlaybackTempoFactor(tempoFactor);
    },
    toggleHeaderCollapsed: () => {
      set((state) => ({ headerCollapsed: !state.headerCollapsed }));
    },
    setParseWarnings: (warnings) => {
      set({ parseWarnings: warnings });
    },
    setStepIndex: (index) => {
      const state = useEngineStore.getState();
      if (state.fingeringMode === 'program' && !canWriteProgramStepIndex()) {
        if (import.meta.env.DEV) {
          console.warn('[Program] Ignored external setStepIndex while in program mode', {
            requested: index,
            current: state.currentStepIndex,
          });
        }
        return;
      }

      set({ currentStepIndex: index });
    },
    setExpectedNotes: (notes) => {
      set({ expectedMidiNotes: notes });
    },
    setPlayingMidiNotes: (notes) => {
      // Bail on no-op updates: play mode syncs after every transport event,
      // and a fresh-but-identical array would re-render the 88-key keyboard.
      set((state) =>
        state.playingMidiNotes.length === notes.length &&
        state.playingMidiNotes.every((midi, index) => midi === notes[index])
          ? state
          : { playingMidiNotes: notes },
      );
    },
    setPlayingPlaybackNotes: (notes) => {
      set((state) =>
        state.playingPlaybackNotes.length === notes.length &&
        state.playingPlaybackNotes.every((note, index) => note === notes[index])
          ? state
          : { playingPlaybackNotes: notes },
      );
    },
  },
};
});

/** True when practice is actively running (started, not paused or stopped). */
export const selectIsPracticeActive = (state: EngineState): boolean =>
  state.isPracticeActive && state.hasPracticeStarted;
