import { create } from 'zustand';
import type { PlaybackScript } from '../types/index.ts';

interface EngineState {
  script: PlaybackScript | null;
  songTitle: string | null;
  actions: {
    loadScript: (script: PlaybackScript, title?: string) => void;
    clearScript: () => void;
  };
}

export const useEngineStore = create<EngineState>((set) => ({
  script: null,
  songTitle: null,
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
  },
}));
