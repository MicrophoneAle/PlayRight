import { create } from 'zustand';
import { cycleShiftMode as cycleShiftModeValue } from '../core/shiftMode.ts';
import type { EngineMode, Hand, PlaybackScript } from '../types/index.ts';

export type ShiftMode = 'octave' | 'semitone' | 'full-range';
export type SheetScrollMode = 'smooth' | 'instant';

const SHEET_SCROLL_MODE_STORAGE_KEY = 'playright-sheet-scroll-mode';

function readStoredSheetScrollMode(): SheetScrollMode {
  if (typeof window === 'undefined') {
    return 'smooth';
  }

  const stored = window.localStorage.getItem(SHEET_SCROLL_MODE_STORAGE_KEY);
  return stored === 'instant' ? 'instant' : 'smooth';
}

interface EngineState {
  script: PlaybackScript | null;
  rawXml: string | null;
  songTitle: string | null;
  scopeStartMidi: number;
  shiftMode: ShiftMode;
  sheetScrollMode: SheetScrollMode;
  engineMode: EngineMode;
  activeHand: Hand;
  isPracticeActive: boolean;
  /** True after Start is pressed for the current piece (enables Restart). */
  hasPracticeStarted: boolean;
  headerCollapsed: boolean;
  currentStepIndex: number;
  totalSteps: number;
  expectedMidiNotes: number[];
  actions: {
    loadScript: (script: PlaybackScript, rawXml: string, title?: string) => void;
    clearScript: () => void;
    setScopeStart: (midi: number | ((prev: number) => number)) => void;
    setShiftMode: (mode: ShiftMode) => void;
    setSheetScrollMode: (mode: SheetScrollMode) => void;
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
  scopeStartMidi: 60,
  shiftMode: 'semitone',
  sheetScrollMode: readStoredSheetScrollMode(),
  engineMode: 'one-hand',
  activeHand: 'R',
  isPracticeActive: false,
  hasPracticeStarted: false,
  headerCollapsed: false,
  currentStepIndex: 0,
  totalSteps: 0,
  expectedMidiNotes: [],
  actions: {
    loadScript: (script, rawXml, title) => {
      set({
        script,
        rawXml,
        songTitle: title ?? null,
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
        hasPracticeStarted: false,
        expectedMidiNotes: [],
      });
    },
    setScopeStart: (midi) => {
      set((state) => ({
        scopeStartMidi:
          typeof midi === 'function' ? midi(state.scopeStartMidi) : midi,
      }));
    },
    setShiftMode: (mode) => {
      set({ shiftMode: mode });
    },
    setSheetScrollMode: (mode) => {
      window.localStorage.setItem(SHEET_SCROLL_MODE_STORAGE_KEY, mode);
      set({ sheetScrollMode: mode });
    },
    cycleShiftMode: (direction) => {
      set((state) => ({
        shiftMode: cycleShiftModeValue(state.shiftMode, direction),
      }));
    },
    setEngineMode: (mode) => {
      if (mode === 'two-hand') {
        return;
      }

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
