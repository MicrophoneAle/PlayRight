import { useEffect, useRef } from "react";
import {
  CursorType,
  OpenSheetMusicDisplay,
} from "opensheetmusicdisplay";
import {
  buildPracticeVisualIndex,
  type HighlightSnapshot,
  type PracticeVisualIndex,
  syncSheetMusicPracticeVisuals,
} from "../core/sheetMusicPracticeSync.ts";
import { getPracticeNotes } from "../core/practiceSteps.ts";
import { useEngineStore } from "../store/useEngineStore.ts";

interface SheetMusicDisplayProps {
  musicXml: string | null;
}

const OSMD_CURSOR_OPTIONS = {
  type: CursorType.CurrentArea,
  color: "#7c3aed",
  alpha: 0.2,
  follow: false,
} as const;

function applyCompactSheetLayout(osmd: OpenSheetMusicDisplay): void {
  const rules = osmd.EngravingRules;
  rules.PageTopMargin = 0;
  rules.TitleTopDistance = 0;
  rules.SheetCopyrightMargin = 0;
  rules.SystemComposerDistance = 0;
  rules.SystemLyricistDistance = 0;
}

function trimTopWhitespace(container: HTMLElement): void {
  const svg = container.querySelector("svg");
  if (!svg) {
    return;
  }

  const firstStave =
    container.querySelector(".vf-stave") ??
    container.querySelector('[class*="stave"]');

  const reference = firstStave ?? svg;
  const containerTop = container.getBoundingClientRect().top;
  const referenceTop = reference.getBoundingClientRect().top;
  const gap = referenceTop - containerTop;

  if (gap > 6) {
    svg.style.marginTop = `${-(gap - 4)}px`;
  }
}

/** Merge MusicXML alternate fingerings into one label, e.g. 2 + alt 3 → "2 (3)". */
function prepareMusicXmlForDisplay(xml: string): string {
  return xml.replace(
    /<technical>([\s\S]*?)<\/technical>/g,
    (block, inner) => {
      const fingeringPattern = /<fingering(\s[^>]*)?>([^<]*)<\/fingering>/g;
      const matches = [...inner.matchAll(fingeringPattern)];

      if (matches.length <= 1) {
        return block;
      }

      const primary =
        matches.find((match) => !match[1]?.includes('alternate="yes"')) ??
        matches[0];
      const alternates = matches.filter(
        (match) =>
          match !== primary && match[1]?.includes('alternate="yes"'),
      );

      if (alternates.length === 0) {
        return block;
      }

      const primaryValue = primary[2].trim();
      const alternateValues = alternates.map((match) => match[2].trim()).join(", ");
      return `<technical><fingering>${primaryValue} (${alternateValues})</fingering></technical>`;
    },
  );
}

export function SheetMusicDisplay({ musicXml }: SheetMusicDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const osmdReadyRef = useRef(false);
  const cursorsEnabledRef = useRef(false);
  const visualIndexRef = useRef<PracticeVisualIndex | null>(null);
  const visualIndexGenerationRef = useRef(0);
  const highlightedElementsRef = useRef<HighlightSnapshot[]>([]);
  const cursorOffsetRef = useRef(-1);
  const script = useEngineStore((state) => state.script);
  const engineMode = useEngineStore((state) => state.engineMode);
  const activeHand = useEngineStore((state) => state.activeHand);
  const currentStepIndex = useEngineStore((state) => state.currentStepIndex);
  const expectedMidiNotes = useEngineStore((state) => state.expectedMidiNotes);

  const syncPracticeVisuals = () => {
    const osmd = osmdRef.current;
    const container = containerRef.current;
    if (!osmd || !container || !osmdReadyRef.current) {
      return;
    }

    const state = useEngineStore.getState();
    const practiceNotes =
      state.script && state.script[state.currentStepIndex]
        ? getPracticeNotes(
            state.script[state.currentStepIndex],
            state.engineMode,
            state.activeHand,
          )
        : [];

    highlightedElementsRef.current = syncSheetMusicPracticeVisuals(osmd, {
      stepIndex: state.currentStepIndex,
      visualIndex: visualIndexRef.current,
      expectedMidiNotes: state.expectedMidiNotes,
      practiceNotes,
      container,
      highlightedElements: highlightedElementsRef.current,
      cursorOffsetRef,
    });
  };

  const scheduleVisualIndexBuild = () => {
    const generation = visualIndexGenerationRef.current + 1;
    visualIndexGenerationRef.current = generation;
    cursorOffsetRef.current = -1;

    requestAnimationFrame(() => {
      if (generation !== visualIndexGenerationRef.current) {
        return;
      }

      const osmd = osmdRef.current;
      const state = useEngineStore.getState();
      if (!osmd || !osmdReadyRef.current || !state.script) {
        visualIndexRef.current = null;
        return;
      }

      try {
        visualIndexRef.current = buildPracticeVisualIndex(
          osmd,
          state.script,
          state.engineMode,
          state.activeHand,
        );

        if (generation !== visualIndexGenerationRef.current) {
          return;
        }

        syncPracticeVisuals();
      } catch (err) {
        console.error("[SheetMusicDisplay] Practice visual index build failed:", err);
        visualIndexRef.current = null;
      }
    });
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !musicXml) {
      osmdReadyRef.current = false;
      cursorsEnabledRef.current = false;
      visualIndexRef.current = null;
      highlightedElementsRef.current = [];
      cursorOffsetRef.current = -1;
      return;
    }

    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    osmdReadyRef.current = false;
    cursorsEnabledRef.current = false;
    visualIndexRef.current = null;
    highlightedElementsRef.current = [];
    cursorOffsetRef.current = -1;
    visualIndexGenerationRef.current += 1;

    const osmd = new OpenSheetMusicDisplay(container, {
      autoResize: true,
      backend: "svg",
      drawingParameters: "compacttight",
      drawTitle: false,
      fingeringPosition: "aboveorbelow",
      cursorsOptions: [OSMD_CURSOR_OPTIONS],
    });

    osmdRef.current = osmd;
    osmd.OnXMLRead = prepareMusicXmlForDisplay;

    const safeRender = (rebuildIndex: boolean) => {
      if (cancelled || container.clientWidth === 0) {
        return;
      }

      try {
        applyCompactSheetLayout(osmd);
        osmd.render();
        osmdReadyRef.current = true;

        if (!cursorsEnabledRef.current) {
          osmd.enableOrDisableCursors(true);
          cursorsEnabledRef.current = true;
          osmd.render();
        }

        trimTopWhitespace(container);

        if (rebuildIndex) {
          scheduleVisualIndexBuild();
        } else {
          syncPracticeVisuals();
        }
      } catch (err) {
        console.error("[SheetMusicDisplay] OSMD render failed:", err);
      }
    };

    osmd
      .load(musicXml)
      .then(() => {
        if (cancelled) {
          return;
        }

        resizeObserver = new ResizeObserver(() => safeRender(false));
        resizeObserver.observe(container);

        requestAnimationFrame(() => {
          requestAnimationFrame(() => safeRender(true));
        });
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("[SheetMusicDisplay] OSMD load failed:", err);
        }
      });

    return () => {
      cancelled = true;
      visualIndexGenerationRef.current += 1;
      osmdReadyRef.current = false;
      cursorsEnabledRef.current = false;
      visualIndexRef.current = null;
      highlightedElementsRef.current = [];
      cursorOffsetRef.current = -1;
      resizeObserver?.disconnect();
      osmdRef.current = null;
      container.innerHTML = "";
    };
  }, [musicXml]);

  useEffect(() => {
    scheduleVisualIndexBuild();
  }, [script, engineMode, activeHand, musicXml]);

  useEffect(() => {
    syncPracticeVisuals();
  }, [currentStepIndex, expectedMidiNotes]);

  if (!musicXml) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="min-h-0 flex-1 w-full overflow-auto rounded-lg bg-white px-3 pb-2 pt-0 [&_svg]:max-w-full"
    />
  );
}
