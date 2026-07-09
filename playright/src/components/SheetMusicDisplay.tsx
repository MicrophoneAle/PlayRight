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
  resetSheetMusicPlaybackVisualCache,
  syncSheetMusicPlaybackVisuals,
  syncSheetMusicPracticeVisuals,
} from "../core/sheetMusicPracticeSync.ts";
import type { GraphicalNote } from "opensheetmusicdisplay";
import { practiceEngine } from "../core/PracticeEngine.ts";
import { playbackEngine } from "../core/PlaybackEngine.ts";
import { fingeringProgramEngine } from "../core/FingeringProgramEngine.ts";
import { getDisplayEngineMode, getDisplayNotesForStep, getPlayablePracticeNotesForPosition, practicePositionFromGraceCursor, programStepExpectedMidis } from "../core/practiceSteps.ts";
import type { ScriptNote } from "../types/index.ts";
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
  rules.PageTopMargin = 6;
  rules.TitleTopDistance = 0;
  rules.SheetCopyrightMargin = 0;
  rules.SystemComposerDistance = 0;
  rules.SystemLyricistDistance = 0;
  rules.MeasureNumberLabelOffset = 2;
}

const SHEET_TOP_CLEARANCE_PX = 16;

const SCORE_CONTENT_TOP_SELECTORS = [
  '.vf-stave',
  '.vf-notehead',
  '.vf-stem',
  '.vf-flag',
  '.vf-ledger-line',
  '.vf-beam',
  '.vf-tuplet',
  '.measure-number',
  'text',
].join(', ');

function getScoreContentTop(svg: SVGSVGElement): number {
  let top = Infinity;

  for (const element of svg.querySelectorAll<SVGGraphicsElement>(
    SCORE_CONTENT_TOP_SELECTORS,
  )) {
    if (element.closest('[id^="cursorImg-"]')) {
      continue;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      continue;
    }

    top = Math.min(top, rect.top);
  }

  if (!Number.isFinite(top)) {
    return svg.getBoundingClientRect().top;
  }

  return top;
}

/** Keep the topmost engraved content (stems, fingerings, measure numbers) inside view. */
function ensureSheetTopClearance(container: HTMLElement): void {
  const svg = container.querySelector('svg');
  if (!svg) {
    return;
  }

  svg.style.marginTop = '0';

  const containerTop = container.getBoundingClientRect().top;
  const contentTop = getScoreContentTop(svg);
  const gap = contentTop - containerTop;

  svg.style.marginTop = `${SHEET_TOP_CLEARANCE_PX - gap}px`;
}

/**
 * Strip pedal markings from the display copy when OSMD cannot lay them out.
 * OSMD can throw while calculating pedal brackets that span certain measure
 * boundaries (calculateSinglePedal reading undefined staffEntries), which
 * half-completes rendering and leaves everything after the crash without
 * graphical notes. PlayRight does not use pedal markings in playback; this is
 * a display-only fallback after a failed render, not the default path.
 */
function stripPedalDirections(xml: string): string {
  return xml.replace(/<direction\b[^>]*>[\s\S]*?<\/direction>/g, (block) =>
    block.includes('<pedal') ? '' : block,
  );
}

/** Merge MusicXML alternate fingerings into one label, e.g. 2 + alt 3 → "2 (3)". */
function prepareMusicXmlForDisplay(xml: string, stripPedals = false): string {
  const base = stripPedals ? stripPedalDirections(xml) : xml;
  return base.replace(
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
  /** Hand-independent index for line scroll anchoring (always two-hand). */
  const scrollVisualIndexRef = useRef<PracticeVisualIndex | null>(null);
  const visualIndexGenerationRef = useRef(0);
  const highlightedNotesRef = useRef<GraphicalNote[]>([]);
  const cursorOffsetRef = useRef(-1);
  const lastRenderedSizeRef = useRef<{ width: number; height: number } | null>(null);
  /** A genuine container resize arrived mid-playback; re-render once playback stops. */
  const pendingPlaybackResizeRef = useRef(false);
  /** Lets effects outside the OSMD-lifecycle effect trigger a render. */
  const safeRenderRef = useRef<((rebuildIndex: boolean) => void) | null>(null);
  const scrollStateRef = useRef<PracticeScrollState>({
    systemKey: null,
    lineScrollTop: null,
  });
  /** Pending rAF that coalesces playback visual syncs to one per frame. */
  const playbackSyncFrameRef = useRef<number | null>(null);
  /** When true, display XML strips pedal directions after an OSMD render crash. */
  const stripPedalsForDisplayRef = useRef(false);
  const sheetPointerStartRef = useRef<{
    x: number;
    y: number;
    noteStepIndex: number | null;
  } | null>(null);
  const script = useEngineStore((state) => state.script);
  const playMode = useEngineStore((state) => state.playMode);
  const engineMode = useEngineStore((state) => state.engineMode);
  const activeHand = useEngineStore((state) => state.activeHand);
  const currentStepIndex = useEngineStore((state) => state.currentStepIndex);
  const practiceGraceCursor = useEngineStore((state) => state.practiceGraceCursor);
  const expectedMidiNotes = useEngineStore((state) => state.expectedMidiNotes);
  const playingPlaybackNotes = useEngineStore((state) => state.playingPlaybackNotes);
  const isPlaybackActive = useEngineStore((state) => state.isPlaybackActive);
  const isPlaybackPaused = useEngineStore((state) => state.isPlaybackPaused);
  const sheetScrollMode = useEngineStore((state) => state.sheetScrollMode);
  const fingeringMode = useEngineStore((state) => state.fingeringMode);

  // This runs inside zustand subscribers and React effects, which in play
  // mode execute synchronously inside PlaybackEngine's Tone.js transport
  // callbacks (setStepIndex/setPlayingPlaybackNotes -> subscriber -> here).
  // It must NEVER throw: an escaping exception propagates into Tone's
  // event-draining loop and permanently freezes step advancement. A failed
  // sync is one skipped visual frame; the next store change retries.
  //
  // During live playback the sync is COALESCED onto animation frames instead
  // of running synchronously: dense bars fire dozens of press/release store
  // updates per second, and doing OSMD/DOM work (setColor, cursor moves,
  // layout reads for scroll) inside each transport callback starved Tone's
  // scheduling lookahead - the audible "piece suddenly slows down" bug. One
  // sync per frame reads the latest store state, so nothing is lost.
  const syncPracticeVisuals = () => {
    const state = useEngineStore.getState();
    if (state.playMode && state.isPlaybackActive && !state.isPlaybackPaused) {
      if (playbackSyncFrameRef.current !== null) {
        return;
      }
      playbackSyncFrameRef.current = requestAnimationFrame(() => {
        playbackSyncFrameRef.current = null;
        try {
          syncPracticeVisualsUnsafe();
        } catch (err) {
          console.warn('[SheetMusicDisplay] visual sync failed (frame skipped):', err);
        }
      });
      return;
    }

    if (playbackSyncFrameRef.current !== null) {
      cancelAnimationFrame(playbackSyncFrameRef.current);
      playbackSyncFrameRef.current = null;
    }

    try {
      syncPracticeVisualsUnsafe();
    } catch (err) {
      console.warn('[SheetMusicDisplay] visual sync failed (frame skipped):', err);
    }
  };

  const syncPracticeVisualsUnsafe = () => {
    const osmd = osmdRef.current;
    const container = containerRef.current;
    if (!osmd || !container || !osmdReadyRef.current) {
      return;
    }

    const state = useEngineStore.getState();
    const displayEngineMode = getDisplayEngineMode(
      state.playMode,
      state.engineMode,
    );

    if (state.playMode && state.isPlaybackActive && !state.isPlaybackPaused) {
      highlightedNotesRef.current = syncSheetMusicPlaybackVisuals(osmd, {
        visualIndex: visualIndexRef.current,
        scrollStepIndex: state.currentStepIndex,
        activeNotes: state.playingPlaybackNotes,
        container,
        highlightedNotes: highlightedNotesRef.current,
        cursorOffsetRef,
        scrollStateRef,
        scrollMode: state.sheetScrollMode,
        scrollVisualIndex: scrollVisualIndexRef.current,
        activeHand: state.activeHand,
        engineMode: displayEngineMode,
      });
      return;
    }

    const step = state.script?.[state.currentStepIndex];
    let practiceNotes: ScriptNote[] = [];
    if (
      state.isPracticeActive &&
      !state.playMode &&
      state.fingeringMode !== 'program' &&
      state.script
    ) {
      practiceNotes = getPlayablePracticeNotesForPosition(
        state.script,
        practicePositionFromGraceCursor(
          state.currentStepIndex,
          state.practiceGraceCursor,
        ),
        state.engineMode,
        state.activeHand,
      );
    } else if (step) {
      practiceNotes = getDisplayNotesForStep(
        step,
        state.playMode,
        state.engineMode,
        state.activeHand,
      );
    }

    // Program mode: mirror the keyboard — derive highlights from the current step
    // directly so the staff stays green even when store expectedMidiNotes is stale.
    let expectedMidiNotes = state.expectedMidiNotes;
    if (state.fingeringMode === 'program' && step) {
      practiceNotes = getDisplayNotesForStep(step, false, 'two-hand', state.activeHand);
      expectedMidiNotes = programStepExpectedMidis(step);
    }

    highlightedNotesRef.current = syncSheetMusicPracticeVisuals(osmd, {
      stepIndex: state.currentStepIndex,
      graceCursor: state.fingeringMode === 'program' ? null : state.practiceGraceCursor,
      visualIndex: visualIndexRef.current,
      expectedMidiNotes,
      practiceNotes,
      container,
      highlightedNotes: highlightedNotesRef.current,
      cursorOffsetRef,
      scrollStateRef,
      scrollMode: state.sheetScrollMode,
      scrollVisualIndex: scrollVisualIndexRef.current,
      activeHand: state.activeHand,
      engineMode: displayEngineMode,
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
        scrollVisualIndexRef.current = null;
        return;
      }

      try {
        const displayEngineMode = getDisplayEngineMode(
          state.playMode,
          state.engineMode,
        );
        visualIndexRef.current = buildPracticeVisualIndex(
          osmd,
          state.script,
          displayEngineMode,
          state.activeHand,
        );
        scrollVisualIndexRef.current = buildPracticeVisualIndex(
          osmd,
          state.script,
          'two-hand',
          state.activeHand,
        );

        if (generation !== visualIndexGenerationRef.current) {
          return;
        }

        syncPracticeVisuals();
      } catch (err) {
        console.error("[SheetMusicDisplay] Practice visual index build failed:", err);
        visualIndexRef.current = null;
        scrollVisualIndexRef.current = null;
      }
    });
  };

  const resolveSheetStepAtPointer = (
    clientX: number,
    clientY: number,
    allowBoundingBoxFallback = true,
  ) => {
    try {
      return resolveStepIndexFromPointer(
        visualIndexRef.current,
        clientX,
        clientY,
        containerRef.current,
        { allowBoundingBoxFallback },
      );
    } catch (err) {
      // Stale GraphicalNote DOM references (post re-render) must not break
      // click handling; treat as "no note here" and let the index rebuild.
      console.warn('[SheetMusicDisplay] pointer step resolve failed:', err);
      return null;
    }
  };

  const handleSheetPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    const isProgram = useEngineStore.getState().fingeringMode === 'program';
    sheetPointerStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      noteStepIndex: resolveSheetStepAtPointer(
        event.clientX,
        event.clientY,
        !isProgram,
      ),
    };
  };

  const clearSheetPointerStart = () => {
    sheetPointerStartRef.current = null;
  };

  const handleSheetPointerSeek = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    const start = sheetPointerStartRef.current;
    clearSheetPointerStart();
    if (!start) {
      return;
    }

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (dx * dx + dy * dy > 100) {
      return;
    }

    const state = useEngineStore.getState();
    const isProgram = state.fingeringMode === 'program';
    const upStepIndex = resolveSheetStepAtPointer(
      event.clientX,
      event.clientY,
      !isProgram,
    );

    if (isProgram) {
      if (start.noteStepIndex === null || upStepIndex === null) {
        return;
      }
      if (upStepIndex !== start.noteStepIndex) {
        return;
      }

      scrollStateRef.current = { systemKey: null, lineScrollTop: null };
      fingeringProgramEngine.seekToStep(upStepIndex);
      return;
    }

    const stepIndex = upStepIndex ?? start.noteStepIndex;

    if (stepIndex === null) {
      return;
    }

    if (stepIndex === state.currentStepIndex) {
      return;
    }

    scrollStateRef.current = {
      systemKey: null,
      lineScrollTop: null,
      previousSystemKey: null,
      switchedAt: undefined,
    };
    resetSheetMusicPlaybackVisualCache();

    if (state.isPlaybackActive) {
      playbackEngine.seekToStep(stepIndex);
      return;
    }

    practiceEngine.seekToStep(stepIndex);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !musicXml) {
      osmdReadyRef.current = false;
      cursorsEnabledRef.current = false;
      visualIndexRef.current = null;
      scrollVisualIndexRef.current = null;
      highlightedNotesRef.current = [];
      cursorOffsetRef.current = -1;
      lastRenderedSizeRef.current = null;
      pendingPlaybackResizeRef.current = false;
      scrollStateRef.current = { systemKey: null, lineScrollTop: null };
      return;
    }

    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    pendingPlaybackResizeRef.current = false;
    osmdReadyRef.current = false;
    cursorsEnabledRef.current = false;
    visualIndexRef.current = null;
    scrollVisualIndexRef.current = null;
    highlightedNotesRef.current = [];
    cursorOffsetRef.current = -1;
    lastRenderedSizeRef.current = null;
    scrollStateRef.current = { systemKey: null, lineScrollTop: null };
    visualIndexGenerationRef.current += 1;
    stripPedalsForDisplayRef.current = false;

    // autoResize is off: this component's ResizeObserver is the ONLY render
    // authority. OSMD's internal window-resize handler re-renders behind our
    // back, replacing the SVG and orphaning every GraphicalNote held by the
    // visual index / highlight refs mid-playback - the root of the
    // "deferred DOM Node" freeze at the measure 8-9 fermata.
    const osmd = new OpenSheetMusicDisplay(container, {
      autoResize: false,
      backend: "svg",
      drawingParameters: "compacttight",
      drawTitle: false,
      fingeringPosition: "aboveorbelow",
      cursorsOptions: [OSMD_CURSOR_OPTIONS],
    });

    osmdRef.current = osmd;
    osmd.OnXMLRead = (xml) =>
      prepareMusicXmlForDisplay(xml, stripPedalsForDisplayRef.current);

    const completeAfterRender = (rebuildIndex: boolean) => {
      osmdReadyRef.current = true;

      if (!cursorsEnabledRef.current) {
        osmd.enableOrDisableCursors(true);
        cursorsEnabledRef.current = true;
        osmd.render();
      }

      normalizeMeasureNumberPositions(container);
      ensureSheetTopClearance(container);

      lastRenderedSizeRef.current = {
        width: container.clientWidth,
        height: container.clientHeight,
      };

      const state = useEngineStore.getState();
      const playbackRunning =
        state.playMode && state.isPlaybackActive && !state.isPlaybackPaused;

      if (rebuildIndex || playbackRunning) {
        scheduleVisualIndexBuild();
      } else {
        syncPracticeVisuals();
      }
    };

    const attemptRender = (rebuildIndex: boolean) => {
      applyCompactSheetLayout(osmd);
      osmd.render();
      completeAfterRender(rebuildIndex);
    };

    const safeRender = (rebuildIndex: boolean) => {
      if (cancelled || container.clientWidth === 0) {
        return;
      }

      try {
        attemptRender(rebuildIndex);
      } catch (err) {
        if (!stripPedalsForDisplayRef.current && musicXml) {
          console.warn(
            '[SheetMusicDisplay] OSMD render failed with pedal markings; retrying without pedals.',
            err,
          );
          stripPedalsForDisplayRef.current = true;
          void osmd
            .load(musicXml)
            .then(() => {
              if (cancelled) {
                return;
              }

              try {
                attemptRender(rebuildIndex);
              } catch (retryErr) {
                console.error('[SheetMusicDisplay] OSMD render failed:', retryErr);
              }
            })
            .catch((loadErr) => {
              console.error(
                '[SheetMusicDisplay] OSMD reload without pedals failed:',
                loadErr,
              );
            });
          return;
        }

        console.error('[SheetMusicDisplay] OSMD render failed:', err);
      }
    };

    safeRenderRef.current = safeRender;

    osmd
      .load(musicXml)
      .then(() => {
        if (cancelled) {
          return;
        }

        const RESIZE_EPSILON_PX = 1;

        resizeObserver = new ResizeObserver(() => {
          const width = container.clientWidth;
          const height = container.clientHeight;
          const lastRendered = lastRenderedSizeRef.current;
          const isSelfInducedResize =
            lastRendered !== null &&
            Math.abs(width - lastRendered.width) <= RESIZE_EPSILON_PX &&
            Math.abs(height - lastRendered.height) <= RESIZE_EPSILON_PX;

          const state = useEngineStore.getState();
          const playbackRunning =
            state.playMode && state.isPlaybackActive && !state.isPlaybackPaused;

          if (isSelfInducedResize) {
            // Our own render (osmd.render(), marginTop/measure-number
            // adjustments, scrollbar toggling) nudged the box back to the
            // size we just rendered at - not a genuine external resize.
            // Ignoring it breaks the render -> resize -> render loop.
            return;
          }

          if (playbackRunning) {
            // NEVER re-render while the transport is live. A render replaces
            // OSMD's SVG, orphaning every GraphicalNote the visual index and
            // highlight refs hold; the next sync then dies on stale deferred
            // DOM nodes and (before the engine callbacks were hardened) froze
            // step advancement permanently. The current layout's notes remain
            // valid at any container size, so highlights and scroll keep
            // working - the reflow is deferred until playback pauses/stops.
            pendingPlaybackResizeRef.current = true;
            syncPracticeVisuals();
            return;
          }

          safeRender(false);
        });
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
      scrollVisualIndexRef.current = null;
      highlightedNotesRef.current = [];
      cursorOffsetRef.current = -1;
      lastRenderedSizeRef.current = null;
      pendingPlaybackResizeRef.current = false;
      safeRenderRef.current = null;
      scrollStateRef.current = { systemKey: null, lineScrollTop: null };
      if (playbackSyncFrameRef.current !== null) {
        cancelAnimationFrame(playbackSyncFrameRef.current);
        playbackSyncFrameRef.current = null;
      }
      resizeObserver?.disconnect();
      osmdRef.current = null;
      container.innerHTML = "";
    };
  }, [musicXml]);

  // Reflow deferred from mid-playback: when a genuine container resize
  // arrived while the transport was live, the observer only flagged it.
  // Run the full render + index rebuild once playback pauses or stops.
  const playbackRunning = playMode && isPlaybackActive && !isPlaybackPaused;
  useEffect(() => {
    if (playbackRunning || !pendingPlaybackResizeRef.current) {
      return;
    }

    pendingPlaybackResizeRef.current = false;
    safeRenderRef.current?.(true);
  }, [playbackRunning]);

  useEffect(() => {
    scheduleVisualIndexBuild();
  }, [engineMode, playMode, activeHand, fingeringMode, script]);

  useEffect(() => {
    scrollStateRef.current = { systemKey: null, lineScrollTop: null };
    resetSheetMusicPlaybackVisualCache();
  }, [activeHand, musicXml, script]);

  useEffect(() => {
    const state = useEngineStore.getState();
    if (state.playMode && state.isPlaybackActive && !state.isPlaybackPaused) {
      return;
    }
    syncPracticeVisuals();
  }, [
    currentStepIndex,
    practiceGraceCursor,
    expectedMidiNotes,
    playingPlaybackNotes,
    playMode,
    isPlaybackActive,
    isPlaybackPaused,
    sheetScrollMode,
    fingeringMode,
  ]);

  useEffect(() => {
    return useEngineStore.subscribe((state, prevState) => {
      if (state.fingeringMode === 'program') {
        if (
          state.currentStepIndex !== prevState.currentStepIndex ||
          state.script !== prevState.script
        ) {
          syncPracticeVisuals();
        }
        return;
      }

      if (
        state.playMode &&
        state.isPlaybackActive &&
        !state.isPlaybackPaused &&
        (state.playingPlaybackNotes !== prevState.playingPlaybackNotes ||
          state.currentStepIndex !== prevState.currentStepIndex)
      ) {
        syncPracticeVisuals();
      }
    });
  }, []);

  if (!musicXml) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      onPointerDown={handleSheetPointerDown}
      onPointerUp={handleSheetPointerSeek}
      onPointerCancel={clearSheetPointerStart}
      className="min-h-0 flex-1 w-full cursor-pointer overflow-auto rounded-lg bg-white px-4 pb-2 pt-4 [&_svg]:max-w-full [&_svg]:overflow-visible [&_[id^=cursorImg-]]:hidden [&_.measure-number>line]:hidden [&_.measure-number>path]:hidden"
    />
  );
}
