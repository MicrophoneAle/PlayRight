import { create } from 'zustand';
import type { PlaybackScript } from '../types/index.ts';

export type ShiftMode = 'octave' | 'semitone' | 'full-range';

interface EngineState {
  script: PlaybackScript | null;
  rawXml: string | null;
  songTitle: string | null;
  scopeStartMidi: number;
  shiftMode: ShiftMode;
  actions: {
    loadScript: (script: PlaybackScript, rawXml: string, title?: string) => void;
    clearScript: () => void;
    setScopeStart: (midi: number | ((prev: number) => number)) => void;
    setShiftMode: (mode: ShiftMode) => void;
  };
}

export const useEngineStore = create<EngineState>((set) => ({
  script: null,
  rawXml: null,
  songTitle: null,
  scopeStartMidi: 60,
  shiftMode: 'semitone',
  actions: {
    loadScript: (script, rawXml, title) => {
      set({
        script,
        rawXml,
        songTitle: title ?? null,
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
  },
}));
