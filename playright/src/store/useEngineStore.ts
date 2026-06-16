import { create } from 'zustand';
import type { PlaybackScript } from '../types/index.ts';

interface EngineState {
  script: PlaybackScript | null;
  songTitle: string | null;
  scopeStartMidi: number;
  shiftMode: 'octave' | 'semitone';
  actions: {
    loadScript: (script: PlaybackScript, title?: string) => void;
    clearScript: () => void;
    setScopeStart: (midi: number | ((prev: number) => number)) => void;
    toggleShiftMode: () => void;
  };
}

export const useEngineStore = create<EngineState>((set) => ({
  script: null,
  songTitle: null,
  scopeStartMidi: 60,
  shiftMode: 'octave',
  actions: {
    loadScript: (script, title) => {
      set({
        script,
        songTitle: title ?? null,
      });
    },
    clearScript: () => {
      set({
        script: null,
        songTitle: null,
      });
    },
    setScopeStart: (midi) => {
      set((state) => ({
        scopeStartMidi:
          typeof midi === 'function' ? midi(state.scopeStartMidi) : midi,
      }));
    },
    toggleShiftMode: () => {
      set((state) => ({
        shiftMode: state.shiftMode === 'octave' ? 'semitone' : 'octave',
      }));
    },
  },
}));
