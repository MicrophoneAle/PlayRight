import { create } from 'zustand';
import { applyFingeringSettings, prepareScriptWithFingering } from '../core/fingeringPredictor.ts';
import { parseMusicXmlToScript } from '../core/parser/index.ts';
import { updateScoreManualFingerings } from '../core/scoreLibrary.ts';
import { cycleShiftMode as cycleShiftModeValue } from '../core/shiftMode.ts';
import { shiftScopeStart } from '../core/scopeShift.ts';
import type {
  EngineMode,
  Finger,
  Hand,
  ManualFingeringMap,
  PlaybackScript,
} from '../types/index.ts';
import { fingeringKey } from '../types/index.ts';

export type ShiftMode = 'octave' | 'semitone' | 'full-range';
export type SheetScrollMode = 'smooth' | 'instant';

const SHEET_SCROLL_MODE_STORAGE_KEY = 'playright-sheet-scroll-mode';
const AUTO_FINGERING_STORAGE_KEY = 'playright-auto-fingering';
const HAND_SPAN_STORAGE_KEY = 'playright-hand-span';

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

function reprocessScriptFromRaw(
  rawXml: string | null,
  manualFingerings: ManualFingeringMap,
  autoFingering: boolean,
  handSpan: HandSpanPreset,
): PlaybackScript | null {
  if (!rawXml) {
    return null;
  }

  const parsed = parseMusicXmlToScript(rawXml);
  return prepareScriptWithFingering(
    parsed,
    manualFingerings,
    autoFingering,
    handSpan,
  );
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
  manualFingerings: ManualFingeringMap;
  scopeStartMidi: number;
  scopeTranspose: number;
  shiftMode: ShiftMode;
  sheetScrollMode: SheetScrollMode;
  autoFingering: boolean;
  handSpan: HandSpanPreset;
  engineMode: EngineMode;
  activeHand: Hand;
  /** Set by PracticeEngine; false when paused, stopped, or not yet started. */
  isPracticeActive: boolean;
  /** True after Start is pressed for the current piece (enables Restart). */
  hasPracticeStarted: boolean;
  headerCollapsed: boolean;
  currentStepIndex: number;
  totalSteps: number;
  expectedMidiNotes: number[];
  actions: {
    loadScript: (
      script: PlaybackScript,
      rawXml: string,
      title?: string,
      library?: LoadScriptLibraryMeta,
    ) => void;
    clearScript: () => void;
    setManualFinger: (
      stepIndex: number,
      hand: Hand,
      midi: number,
      finger: Finger,
      userId?: string | null,
    ) => void;
    clearManualFinger: (
      stepIndex: number,
      hand: Hand,
      midi: number,
      userId?: string | null,
    ) => void;
    setScopeStart: (midi: number | ((prev: number) => number)) => void;
    nudgeScope: (direction: 'up' | 'down') => void;
    setShiftMode: (mode: ShiftMode) => void;
    setSheetScrollMode: (mode: SheetScrollMode) => void;
    setAutoFingering: (enabled: boolean) => void;
    setHandSpan: (span: HandSpanPreset) => void;
    cycleShiftMode: (direction: 'up' | 'down') => void;
    setEngineMode: (mode: EngineMode) => void;
    setActiveHand: (hand: Hand) => void;
    setPracticeActive: (isActive: boolean) => void;
    setHasPracticeStarted: (started: boolean) => void;
    toggleHeaderCollapsed: () => void;
    setStepIndex: (index: number) => void;
    setExpectedNotes: (notes: number[]) => void;
  };
}

export const useEngineStore = create<EngineState>((set) => ({
  script: null,
  rawXml: null,
  songTitle: null,
  scoreId: null,
  manualFingerings: {},
  scopeStartMidi: 60,
  scopeTranspose: 0,
  shiftMode: 'semitone',
  sheetScrollMode: readStoredSheetScrollMode(),
  autoFingering: readStoredAutoFingering(),
  handSpan: readStoredHandSpan(),
  engineMode: 'one-hand',
  activeHand: 'R',
  isPracticeActive: false,
  hasPracticeStarted: false,
  headerCollapsed: false,
  currentStepIndex: 0,
  totalSteps: 0,
  expectedMidiNotes: [],
  actions: {
    loadScript: (script, rawXml, title, library) => {
      set({
        script,
        rawXml,
        songTitle: title ?? null,
        scoreId: library?.scoreId ?? null,
        manualFingerings: library?.manualFingerings ?? {},
        currentStepIndex: 0,
        totalSteps: script.length,
        isPracticeActive: false,
        hasPracticeStarted: false,
        expectedMidiNotes: [],
      });
    },
    clearScript: () => {
      set({
        script: null,
        rawXml: null,
        songTitle: null,
        scoreId: null,
        manualFingerings: {},
        hasPracticeStarted: false,
        expectedMidiNotes: [],
      });
    },
    setManualFinger: (stepIndex, hand, midi, finger, userId) => {
      set((state) => {
        const manualFingerings = {
          ...state.manualFingerings,
          [fingeringKey(stepIndex, hand, midi)]: finger,
        };
        const script = reprocessScriptFromRaw(
          state.rawXml,
          manualFingerings,
          state.autoFingering,
          state.handSpan,
        );

        persistManualFingerings(state.scoreId, manualFingerings, userId);

        if (!script) {
          return { manualFingerings };
        }

        return {
          manualFingerings,
          script,
          totalSteps: script.length,
        };
      });
    },
    clearManualFinger: (stepIndex, hand, midi, userId) => {
      set((state) => {
        const key = fingeringKey(stepIndex, hand, midi);
        const manualFingerings = { ...state.manualFingerings };
        delete manualFingerings[key];

        const script = reprocessScriptFromRaw(
          state.rawXml,
          manualFingerings,
          state.autoFingering,
          state.handSpan,
        );

        persistManualFingerings(state.scoreId, manualFingerings, userId);

        if (!script) {
          return { manualFingerings };
        }

        return {
          manualFingerings,
          script,
          totalSteps: script.length,
        };
      });
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
            )
          : null;

        return script ? { handSpan, script } : { handSpan };
      });
    },
    cycleShiftMode: (direction) => {
      set((state) => ({
        shiftMode: cycleShiftModeValue(state.shiftMode, direction),
      }));
    },
    setEngineMode: (mode) => {
      set({ engineMode: mode });
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
    toggleHeaderCollapsed: () => {
      set((state) => ({ headerCollapsed: !state.headerCollapsed }));
    },
    setStepIndex: (index) => {
      set({ currentStepIndex: index });
    },
    setExpectedNotes: (notes) => {
      set({ expectedMidiNotes: notes });
    },
  },
}));

/** True when practice is actively running (started, not paused or stopped). */
export const selectIsPracticeActive = (state: EngineState): boolean =>
  state.isPracticeActive && state.hasPracticeStarted;
