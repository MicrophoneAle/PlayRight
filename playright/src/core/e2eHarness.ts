/**
 * Browser E2E control surface. Attached to window only when VITE_E2E=1 so
 * Playwright can load scores without Clerk sign-in and drive step/seek state.
 */
import { parseMusicXmlToScript } from './parser/index.ts';
import { prepareScriptWithFingering } from './fingeringPredictor.ts';
import { practiceEngine } from './PracticeEngine.ts';
import { playbackEngine } from './PlaybackEngine.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

export const SHEET_HIGHLIGHT_COLOR = '#10b981';

export interface PlayRightE2EHarness {
  loadXml: (xml: string, title?: string) => Promise<void>;
  startPractice: () => void;
  getStepIndex: () => number;
  getTotalSteps: () => number;
  seekPractice: (stepIndex: number) => void;
  setPlayMode: (enabled: boolean) => void;
  seekPlayback: (stepIndex: number) => void;
  getSheetScrollTop: () => number;
  getSheetOverflow: () => {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
  };
  countHighlightedSvgNodes: () => number;
  /** Center of an engraved notehead, or null if none. */
  getNoteheadClientPoint: (indexFromEnd?: number) => { x: number; y: number } | null;
}

declare global {
  interface Window {
    __playrightE2E?: PlayRightE2EHarness;
  }
}

function installE2EHarness(): void {
  if (typeof window === 'undefined') {
    return;
  }

  const harness: PlayRightE2EHarness = {
    async loadXml(xml, title = 'e2e-score') {
      // Skip ONNX path for fast, deterministic sheet tests (score fingerings suffice).
      useEngineStore.setState({ autoFingering: false });
      const { script, scoreTiming, playbackOrder } = parseMusicXmlToScript(xml);
      const prepared = await prepareScriptWithFingering(
        script,
        {},
        false,
        useEngineStore.getState().handSpan,
        false,
        scoreTiming,
      );
      useEngineStore.getState().actions.loadScript(
        prepared,
        xml,
        title,
        { scoreId: null, manualFingerings: {} },
        scoreTiming,
        playbackOrder,
      );
    },

    startPractice() {
      practiceEngine.start();
    },

    getStepIndex() {
      return useEngineStore.getState().currentStepIndex;
    },

    getTotalSteps() {
      return useEngineStore.getState().totalSteps;
    },

    seekPractice(stepIndex) {
      practiceEngine.seekToStep(stepIndex);
    },

    setPlayMode(enabled) {
      useEngineStore.getState().actions.setPlayMode(enabled);
    },

    seekPlayback(stepIndex) {
      playbackEngine.seekToStep(stepIndex);
    },

    getSheetScrollTop() {
      const sheet = document.querySelector('[data-testid="sheet-music"]');
      return sheet instanceof HTMLElement ? sheet.scrollTop : -1;
    },

    getSheetOverflow() {
      const sheet = document.querySelector('[data-testid="sheet-music"]');
      if (!(sheet instanceof HTMLElement)) {
        return { scrollTop: -1, scrollHeight: 0, clientHeight: 0 };
      }
      return {
        scrollTop: sheet.scrollTop,
        scrollHeight: sheet.scrollHeight,
        clientHeight: sheet.clientHeight,
      };
    },

    getNoteheadClientPoint(indexFromEnd = 2) {
      const sheet = document.querySelector('[data-testid="sheet-music"]');
      if (!sheet) {
        return null;
      }
      const heads = [...sheet.querySelectorAll('.vf-notehead')];
      if (heads.length === 0) {
        return null;
      }
      const index = Math.max(0, heads.length - 1 - Math.max(0, indexFromEnd));
      const rect = heads[index].getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return null;
      }
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    },

    countHighlightedSvgNodes() {
      const sheet = document.querySelector('[data-testid="sheet-music"]');
      if (!sheet) {
        return 0;
      }

      let count = 0;
      for (const el of sheet.querySelectorAll('*')) {
        const fill = (el.getAttribute('fill') ?? '').toLowerCase();
        const stroke = (el.getAttribute('stroke') ?? '').toLowerCase();
        const style = (el.getAttribute('style') ?? '').toLowerCase();
        const hit =
          fill.includes('10b981') ||
          stroke.includes('10b981') ||
          style.includes('10b981') ||
          style.includes('16, 185, 129') ||
          style.includes('16,185,129');
        if (hit) {
          count += 1;
        }
      }
      return count;
    },
  };

  window.__playrightE2E = harness;
}

if (import.meta.env.VITE_E2E === '1') {
  installE2EHarness();
}
