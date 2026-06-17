import { create } from 'zustand';
import { cycleShiftMode as cycleShiftModeValue } from '../core/shiftMode.ts';
import type { EngineMode, Hand, PlaybackScript } from '../types/index.ts';

export type ShiftMode = 'octave' | 'semitone' | 'full-range';

interface EngineState {
  script: PlaybackScript | null;
  rawXml: string | null;
  songTitle: string | null;
  scopeStartMidi: number;
  shiftMode: ShiftMode;
  engineMode: EngineMode;
  activeHand: Hand;
  isPracticeActive: boolean;
  currentStepIndex: number;
  totalSteps: number;
  actions: {
    loadScript: (script: PlaybackScript, rawXml: string, title?: string) => void;
    clearScript: () => void;
    setScopeStart: (midi: number | ((prev: number) => number)) => void;
    setShiftMode: (mode: ShiftMode) => void;
    cycleShiftMode: (direction: 'up' | 'down') => void;
    setEngineMode: (mode: EngineMode) => void;
    setActiveHand: (hand: Hand) => void;
    setPracticeActive: (isActive: boolean) => void;
    setStepIndex: (index: number) => void;
  };
}

export const useEngineStore = create<EngineState>((set) => ({
  script: null,
  rawXml: null,
  songTitle: null,
  scopeStartMidi: 60,
  shiftMode: 'semitone',
  engineMode: 'one-hand',
  activeHand: 'R',
  isPracticeActive: false,
  currentStepIndex: 0,
  totalSteps: 0,
  actions: {
    loadScript: (script, rawXml, title) => {
      set({
        script,
        rawXml,
        songTitle: title ?? null,
        currentStepIndex: 0,
        totalSteps: script.length,
        isPracticeActive: false,
      });
    },
    clearScript: () => {
      set({
        script: null,
        rawXml: null,
        songTitle: null,
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
      });
    },
    setPracticeActive: (isActive) => {
      set({ isPracticeActive: isActive });
    },
    setStepIndex: (index) => {
      set({ currentStepIndex: index });
    },
  },
}));
