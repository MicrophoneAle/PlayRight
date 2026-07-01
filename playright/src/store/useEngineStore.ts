import { create } from 'zustand';
import { applyFingeringSettings, prepareScriptWithFingering } from '../core/fingeringPredictor.ts';
import { parseMusicXmlToScript } from '../core/parser/index.ts';
import { updateScoreManualFingerings } from '../core/scoreLibrary.ts';
import { cycleShiftMode as cycleShiftModeValue } from '../core/shiftMode.ts';
import { shiftScopeStart } from '../core/scopeShift.ts';
import { fingeringProgramEngine } from '../core/FingeringProgramEngine.ts';
import { practiceEngine } from '../core/PracticeEngine.ts';
import type {
  EngineMode,
  Finger,
  FingeringMode,
  Hand,
  ManualFingeringMap,
  ManualHandOverrideMap,
  PlaybackScript,
  PlayingPlaybackNote,
  ScoreTiming,
  SelectedFingeringNote,
} from '../types/index.ts';
import { fingeringKey, manualHandOverrideKey } from '../types/index.ts';

export type ShiftMode = 'octave' | 'semitone' | 'full-range';
export type SheetScrollMode = 'smooth' | 'instant';

const SHEET_SCROLL_MODE_STORAGE_KEY = 'playright-sheet-scroll-mode';
const AUTO_FINGERING_STORAGE_KEY = 'playright-auto-fingering';
const HAND_SPAN_STORAGE_KEY = 'playright-hand-span';
const OVERRIDE_SCORE_FINGERINGS_STORAGE_KEY = 'playright-override-score-fingerings';
const FINGERING_MODE_STORAGE_KEY = 'playright-fingering-mode';
const MANUAL_HAND_OVERRIDES_PREFIX = 'playright-hand-overrides:';
const PLAY_MODE_STORAGE_KEY = 'playright-play-mode';
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

function readStoredFingeringMode(): FingeringMode {
  if (typeof window === 'undefined') {
    return 'off';
  }

  const stored = window.localStorage.getItem(FINGERING_MODE_STORAGE_KEY);
  if (stored === 'program') {
    return 'program';
  }

  return 'off';
}

function readStoredPlayMode(): boolean {
  return false;
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

function reprocessScriptFromRaw(
  rawXml: string | null,
  manualFingerings: ManualFingeringMap,
  manualHandOverrides: ManualHandOverrideMap,
  autoFingering: boolean,
  handSpan: HandSpanPreset,
  overrideScoreFingerings: boolean,
): { script: PlaybackScript; scoreTiming: ScoreTiming } | null {
  if (!rawXml) {
    return null;
  }

  const { script: parsed, scoreTiming } = parseMusicXmlToScript(rawXml);
  const script = prepareScriptWithFingering(
    parsed,
    manualFingerings,
    autoFingering,
    handSpan,
    overrideScoreFingerings,
    manualHandOverrides,
  );

  return { script, scoreTiming };
}

function readStoredHandOverrides(scoreId: string | null): ManualHandOverrideMap {
  if (!scoreId || typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(`${MANUAL_HAND_OVERRIDES_PREFIX}${scoreId}`);
    if (!raw) {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const result: ManualHandOverrideMap = {};
    for (const [key, hand] of Object.entries(parsed)) {
      if ((hand === 'L' || hand === 'R') && /^\d+:\d+$/.test(key)) {
        result[key as keyof ManualHandOverrideMap] = hand;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function persistHandOverrides(
  scoreId: string | null,
  manualHandOverrides: ManualHandOverrideMap,
): void {
  if (!scoreId || typeof window === 'undefined') {
    return;
  }

  const storageKey = `${MANUAL_HAND_OVERRIDES_PREFIX}${scoreId}`;
  if (Object.keys(manualHandOverrides).length === 0) {
    window.localStorage.removeItem(storageKey);
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(manualHandOverrides));
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
  manualHandOverrides?: ManualHandOverrideMap;
}

interface EngineState {
  script: PlaybackScript | null;
  rawXml: string | null;
  songTitle: string | null;
  scoreId: string | null;
  scoreTiming: ScoreTiming | null;
  manualFingerings: ManualFingeringMap;
  manualHandOverrides: ManualHandOverrideMap;
  fingeringMode: FingeringMode;
  selectedFingeringNote: SelectedFingeringNote | null;
  /** Keys `${hand}:${midi}` assigned in the current program step (transient UI). */
  programAssignedKeys: string[];
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
  /** True after Start is pressed for the current piece (enables Restart). */
  hasPracticeStarted: boolean;
  /** True while a playback session is active (playing or paused). */
  isPlaybackActive: boolean;
  /** True when play mode reached the end of the piece and is paused awaiting replay. */
  isPlaybackFinished: boolean;
  /** True when playback is paused mid-session. */
  isPlaybackPaused: boolean;
  playMode: boolean;
  tempoFactor: number;
  headerCollapsed: boolean;
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
    clearManualFinger: (
      onset: number,
      hand: Hand,
      midi: number,
      userId?: string | null,
    ) => void;
    setManualFingerCrossover: (
      onset: number,
      fromHand: Hand,
      midi: number,
      toHand: Hand,
      finger: Finger,
      userId?: string | null,
    ) => void;
    setFingeringMode: (mode: FingeringMode) => void;
    setSelectedFingeringNote: (note: SelectedFingeringNote | null) => void;
    setProgramAssignedKeys: (keys: string[]) => void;
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
    setHasPracticeStarted: (started: boolean) => void;
    setPlaybackActive: (active: boolean) => void;
    setPlaybackFinished: (finished: boolean) => void;
    setPlaybackPaused: (paused: boolean) => void;
    setPlayMode: (enabled: boolean) => void;
    setTempoFactor: (factor: number) => void;
    toggleHeaderCollapsed: () => void;
    setStepIndex: (index: number) => void;
    setExpectedNotes: (notes: number[]) => void;
    setPlayingMidiNotes: (notes: number[]) => void;
    setPlayingPlaybackNotes: (notes: PlayingPlaybackNote[]) => void;
  };
}

export const useEngineStore = create<EngineState>((set) => {
  const initialFingeringMode = readStoredFingeringMode();

  return {
  script: null,
  rawXml: null,
  songTitle: null,
  scoreId: null,
  scoreTiming: null,
  manualFingerings: {},
  manualHandOverrides: {},
  fingeringMode: initialFingeringMode,
  selectedFingeringNote: null,
  programAssignedKeys: [],
  scopeStartMidi: 60,
  scopeTranspose: 0,
  shiftMode: 'semitone',
  sheetScrollMode: readStoredSheetScrollMode(),
  autoFingering: readStoredAutoFingering(),
  handSpan: readStoredHandSpan(),
  overrideScoreFingerings: readStoredOverrideScoreFingerings(),
  engineMode:
    initialFingeringMode === 'program' ? 'two-hand' : 'one-hand',
  activeHand: 'R',
  isPracticeActive: false,
  hasPracticeStarted: false,
  isPlaybackActive: false,
  isPlaybackFinished: false,
  isPlaybackPaused: false,
  playMode: readStoredPlayMode(),
  tempoFactor: readStoredTempoFactor(),
  headerCollapsed: false,
  currentStepIndex: 0,
  totalSteps: 0,
  expectedMidiNotes: [],
  playingMidiNotes: [],
  playingPlaybackNotes: [],
  actions: {
    loadScript: (script, rawXml, title, library, scoreTiming) => {
      set({
        script,
        rawXml,
        songTitle: title ?? null,
        scoreId: library?.scoreId ?? null,
        scoreTiming: scoreTiming ?? null,
        manualFingerings: library?.manualFingerings ?? {},
        manualHandOverrides:
          library?.manualHandOverrides ??
          readStoredHandOverrides(library?.scoreId ?? null),
        currentStepIndex: 0,
        totalSteps: script.length,
        isPracticeActive: false,
        hasPracticeStarted: false,
        isPlaybackActive: false,
        isPlaybackFinished: false,
        isPlaybackPaused: false,
        expectedMidiNotes: [],
        playingMidiNotes: [],
        playingPlaybackNotes: [],
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
        manualHandOverrides: {},
        selectedFingeringNote: null,
        hasPracticeStarted: false,
        isPlaybackActive: false,
        isPlaybackFinished: false,
        isPlaybackPaused: false,
        expectedMidiNotes: [],
        playingMidiNotes: [],
        playingPlaybackNotes: [],
      });
    },
    setManualFinger: (onset, hand, midi, finger, userId) => {
      set((state) => {
        const manualFingerings = {
          ...state.manualFingerings,
          [fingeringKey(onset, hand, midi)]: finger,
        };
        const reprocessed = reprocessScriptFromRaw(
          state.rawXml,
          manualFingerings,
          state.manualHandOverrides,
          state.autoFingering,
          state.handSpan,
          state.overrideScoreFingerings,
        );

        persistManualFingerings(state.scoreId, manualFingerings, userId);

        if (!reprocessed) {
          return { manualFingerings };
        }

        return {
          manualFingerings,
          script: reprocessed.script,
          scoreTiming: reprocessed.scoreTiming,
          totalSteps: reprocessed.script.length,
        };
      });
    },
    clearManualFinger: (onset, hand, midi, userId) => {
      set((state) => {
        const key = fingeringKey(onset, hand, midi);
        const manualFingerings = { ...state.manualFingerings };
        delete manualFingerings[key];

        const manualHandOverrides = { ...state.manualHandOverrides };
        delete manualHandOverrides[manualHandOverrideKey(onset, midi)];

        const reprocessed = reprocessScriptFromRaw(
          state.rawXml,
          manualFingerings,
          manualHandOverrides,
          state.autoFingering,
          state.handSpan,
          state.overrideScoreFingerings,
        );

        persistManualFingerings(state.scoreId, manualFingerings, userId);
        persistHandOverrides(state.scoreId, manualHandOverrides);

        if (!reprocessed) {
          return { manualFingerings, manualHandOverrides };
        }

        return {
          manualFingerings,
          manualHandOverrides,
          script: reprocessed.script,
          scoreTiming: reprocessed.scoreTiming,
          totalSteps: reprocessed.script.length,
        };
      });
    },
    setManualFingerCrossover: (onset, fromHand, midi, toHand, finger, userId) => {
      set((state) => {
        const manualFingerings = { ...state.manualFingerings };
        delete manualFingerings[fingeringKey(onset, fromHand, midi)];
        manualFingerings[fingeringKey(onset, toHand, midi)] = finger;

        const manualHandOverrides = {
          ...state.manualHandOverrides,
          [manualHandOverrideKey(onset, midi)]: toHand,
        };

        const reprocessed = reprocessScriptFromRaw(
          state.rawXml,
          manualFingerings,
          manualHandOverrides,
          state.autoFingering,
          state.handSpan,
          state.overrideScoreFingerings,
        );

        persistManualFingerings(state.scoreId, manualFingerings, userId);
        persistHandOverrides(state.scoreId, manualHandOverrides);

        if (!reprocessed) {
          return { manualFingerings, manualHandOverrides };
        }

        return {
          manualFingerings,
          manualHandOverrides,
          script: reprocessed.script,
          scoreTiming: reprocessed.scoreTiming,
          totalSteps: reprocessed.script.length,
        };
      });
    },
    setFingeringMode: (mode) => {
      window.localStorage.setItem(FINGERING_MODE_STORAGE_KEY, mode);

      const prevMode = useEngineStore.getState().fingeringMode;

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
      set((state) => {
        const autoFingering = enabled;
        const script = state.script
          ? applyFingeringSettings(
              state.script,
              autoFingering,
              state.handSpan,
              state.overrideScoreFingerings,
            )
          : null;

        return script
          ? { autoFingering, script }
          : { autoFingering };
      });
    },
    setHandSpan: (span) => {
      window.localStorage.setItem(HAND_SPAN_STORAGE_KEY, String(span));
      set((state) => {
        const handSpan = span;
        const script = state.script
          ? applyFingeringSettings(
              state.script,
              state.autoFingering,
              handSpan,
              state.overrideScoreFingerings,
            )
          : null;

        return script ? { handSpan, script } : { handSpan };
      });
    },
    setOverrideScoreFingerings: (enabled) => {
      window.localStorage.setItem(
        OVERRIDE_SCORE_FINGERINGS_STORAGE_KEY,
        enabled ? 'true' : 'false',
      );
      set((state) => {
        const overrideScoreFingerings = enabled;
        const reprocessed = reprocessScriptFromRaw(
          state.rawXml,
          state.manualFingerings,
          state.manualHandOverrides,
          state.autoFingering,
          state.handSpan,
          overrideScoreFingerings,
        );

        if (reprocessed) {
          return {
            overrideScoreFingerings,
            script: reprocessed.script,
            scoreTiming: reprocessed.scoreTiming,
            totalSteps: reprocessed.script.length,
          };
        }

        const script = state.script
          ? applyFingeringSettings(
              state.script,
              state.autoFingering,
              state.handSpan,
              overrideScoreFingerings,
            )
          : null;

        return script
          ? { overrideScoreFingerings, script }
          : { overrideScoreFingerings };
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
        expectedMidiNotes: [],
      });
    },
    setPracticeActive: (isActive) => {
      set({ isPracticeActive: isActive });
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
          expectedMidiNotes: [],
          playingMidiNotes: [],
          playingPlaybackNotes: [],
          selectedFingeringNote: enabled ? null : state.selectedFingeringNote,
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
    setTempoFactor: (factor) => {
      const tempoFactor = clampTempoFactor(factor);
      window.localStorage.setItem(TEMPO_FACTOR_STORAGE_KEY, String(tempoFactor));
      set({ tempoFactor });
      syncPlaybackTempoFactor(tempoFactor);
    },
    toggleHeaderCollapsed: () => {
      set((state) => ({ headerCollapsed: !state.headerCollapsed }));
    },
    setStepIndex: (index) => {
      set({ currentStepIndex: index });
    },
    setExpectedNotes: (notes) => {
      set({ expectedMidiNotes: notes });
    },
    setPlayingMidiNotes: (notes) => {
      set({ playingMidiNotes: notes });
    },
    setPlayingPlaybackNotes: (notes) => {
      set({ playingPlaybackNotes: notes });
    },
  },
};
});

/** True when practice is actively running (started, not paused or stopped). */
export const selectIsPracticeActive = (state: EngineState): boolean =>
  state.isPracticeActive && state.hasPracticeStarted;
