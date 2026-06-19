import { useEffect, useRef } from "react";
import {
  CursorType,
  OpenSheetMusicDisplay,
} from "opensheetmusicdisplay";
import {
  buildPracticeVisualIndex,
  type PracticeScrollState,
  type PracticeVisualIndex,
  resolveStepIndexFromPointer,
  syncSheetMusicPracticeVisuals,
} from "../core/sheetMusicPracticeSync.ts";
import type { GraphicalNote } from "opensheetmusicdisplay";
import { practiceEngine } from "../core/PracticeEngine.ts";
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

function screenDeltaToSvgUnits(svg: SVGSVGElement, deltaY: number): number {
  const ctm = svg.getScreenCTM();
  if (!ctm) {
    return deltaY;
  }

  const scaleY = Math.hypot(ctm.c, ctm.d);
  return scaleY > 0 ? deltaY / scaleY : deltaY;
}

function translateSvgElement(
  element: SVGGraphicsElement,
  deltaX: number,
  deltaY: number,
): void {
  const existing = element.getAttribute('transform') ?? '';
  const match = existing.match(
    /translate\(\s*([-\d.]+)(?:[,\s]+([-\d.]+))?\s*\)/,
  );

  if (match) {
    const x = parseFloat(match[1]);
    const y = parseFloat(match[2] ?? '0');
    const remainder = existing.replace(match[0], '').trim();
    const next = `translate(${x + deltaX}, ${y + deltaY})`;
    element.setAttribute(
      'transform',
      remainder ? `${next} ${remainder}` : next,
    );
    return;
  }

  element.setAttribute(
    'transform',
    `${existing} translate(${deltaX}, ${deltaY})`.trim(),
  );
}

/** Anchor measure numbers a fixed distance above the staff instead of the skyline. */
function normalizeMeasureNumberPositions(container: HTMLElement): void {
  const OFFSET_ABOVE_STAFF_PX = 10;
  const svg = container.querySelector('svg');
  if (!svg) {
    return;
  }

  const labels = container.querySelectorAll<SVGGraphicsElement>('.measure-number');
  const staves = [...container.querySelectorAll<SVGGraphicsElement>('.vf-stave')];

  if (labels.length === 0 || staves.length === 0) {
    return;
  }

  for (const label of labels) {
    const labelRect = label.getBoundingClientRect();
    if (labelRect.width === 0 && labelRect.height === 0) {
      continue;
    }

    const anchorX = labelRect.left + Math.min(labelRect.width * 0.2, 8);
    let topStaveTop = Infinity;

    for (const stave of staves) {
      const staveRect = stave.getBoundingClientRect();
      if (anchorX < staveRect.left - 4 || anchorX > staveRect.right + 4) {
        continue;
      }

      if (staveRect.top < topStaveTop) {
        topStaveTop = staveRect.top;
      }
    }

    if (!Number.isFinite(topStaveTop)) {
      continue;
    }

    const targetBottom = topStaveTop - OFFSET_ABOVE_STAFF_PX;
    const deltaScreenY = targetBottom - labelRect.bottom;

    if (Math.abs(deltaScreenY) < 0.5) {
      continue;
    }

    const deltaSvgY = screenDeltaToSvgUnits(svg, deltaScreenY);
    translateSvgElement(label, 0, deltaSvgY);
  }
}

function applyCompactSheetLayout(osmd: OpenSheetMusicDisplay): void {
  const rules = osmd.EngravingRules;
  rules.PageTopMargin = 0;
  rules.TitleTopDistance = 0;
  rules.SheetCopyrightMargin = 0;
  rules.SystemComposerDistance = 0;
  rules.SystemLyricistDistance = 0;
  rules.MeasureNumberLabelOffset = 2;
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

  if (gap > 24) {
    svg.style.marginTop = `${-(gap - 20)}px`;
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
  const highlightedNotesRef = useRef<GraphicalNote[]>([]);
  const cursorOffsetRef = useRef(-1);
  const scrollStateRef = useRef<PracticeScrollState>({
    systemKey: null,
    lineScrollTop: null,
  });
  const script = useEngineStore((state) => state.script);
  const engineMode = useEngineStore((state) => state.engineMode);
  const activeHand = useEngineStore((state) => state.activeHand);
  const currentStepIndex = useEngineStore((state) => state.currentStepIndex);
  const expectedMidiNotes = useEngineStore((state) => state.expectedMidiNotes);
  const sheetScrollMode = useEngineStore((state) => state.sheetScrollMode);

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

    highlightedNotesRef.current = syncSheetMusicPracticeVisuals(osmd, {
      stepIndex: state.currentStepIndex,
      visualIndex: visualIndexRef.current,
      expectedMidiNotes: state.expectedMidiNotes,
      practiceNotes,
      container,
      highlightedNotes: highlightedNotesRef.current,
      cursorOffsetRef,
      scrollStateRef,
      scrollMode: state.sheetScrollMode,
      activeHand: state.activeHand,
      engineMode: state.engineMode,
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

  const handleSheetPointerSeek = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    const stepIndex = resolveStepIndexFromPointer(
      visualIndexRef.current,
      event.clientX,
      event.clientY,
    );

    if (stepIndex === null) {
      return;
    }

    const state = useEngineStore.getState();
    if (stepIndex === state.currentStepIndex) {
      return;
    }

    scrollStateRef.current = { systemKey: null, lineScrollTop: null };
    practiceEngine.seekToStep(stepIndex);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !musicXml) {
      osmdReadyRef.current = false;
      cursorsEnabledRef.current = false;
      visualIndexRef.current = null;
      highlightedNotesRef.current = [];
      cursorOffsetRef.current = -1;
      scrollStateRef.current = { systemKey: null, lineScrollTop: null };
      return;
    }

    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    osmdReadyRef.current = false;
    cursorsEnabledRef.current = false;
    visualIndexRef.current = null;
    highlightedNotesRef.current = [];
    cursorOffsetRef.current = -1;
    scrollStateRef.current = { systemKey: null, lineScrollTop: null };
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
        normalizeMeasureNumberPositions(container);

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
      highlightedNotesRef.current = [];
      cursorOffsetRef.current = -1;
      scrollStateRef.current = { systemKey: null, lineScrollTop: null };
      resizeObserver?.disconnect();
      osmdRef.current = null;
      container.innerHTML = "";
    };
  }, [musicXml]);

  useEffect(() => {
    scrollStateRef.current = { systemKey: null, lineScrollTop: null };
    scheduleVisualIndexBuild();
  }, [script, engineMode, musicXml]);

  useEffect(() => {
    scrollStateRef.current = { systemKey: null, lineScrollTop: null };
    scheduleVisualIndexBuild();
  }, [activeHand]);

  useEffect(() => {
    syncPracticeVisuals();
  }, [currentStepIndex, expectedMidiNotes, sheetScrollMode]);

  if (!musicXml) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      onClick={handleSheetPointerSeek}
      className="min-h-0 flex-1 w-full cursor-pointer overflow-auto rounded-lg bg-white px-3 pb-2 pt-5 [&_svg]:max-w-full [&_[id^=cursorImg-]]:hidden [&_.measure-number>line]:hidden [&_.measure-number>path]:hidden"
    />
  );
}
