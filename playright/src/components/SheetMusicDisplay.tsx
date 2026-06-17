import { useEffect, useRef } from "react";
import { CursorType, OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import { useEngineStore } from "../store/useEngineStore.ts";

interface SheetMusicDisplayProps {
  musicXml: string | null;
}

const OSMD_CURSOR_OPTIONS = {
  type: CursorType.Standard,
  color: "#7c3aed",
  alpha: 0.28,
  follow: true,
} as const;

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

function syncOsmdCursor(
  osmd: OpenSheetMusicDisplay,
  currentStepIndex: number,
  isPracticeActive: boolean,
): void {
  const cursor = osmd.cursor;
  if (!cursor) {
    return;
  }

  if (!isPracticeActive) {
    cursor.hide();
    return;
  }

  cursor.show();
  cursor.reset();
  for (let i = 0; i < currentStepIndex; i += 1) {
    cursor.next();
  }
}

export function SheetMusicDisplay({ musicXml }: SheetMusicDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const osmdReadyRef = useRef(false);
  const currentStepIndex = useEngineStore((state) => state.currentStepIndex);
  const isPracticeActive = useEngineStore((state) => state.isPracticeActive);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !musicXml) {
      osmdReadyRef.current = false;
      return;
    }

    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    osmdReadyRef.current = false;

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

    const safeRender = () => {
      if (cancelled || container.clientWidth === 0) {
        return;
      }

      osmd.render();

      if (!osmd.cursor) {
        return;
      }

      osmdReadyRef.current = true;
      const { currentStepIndex, isPracticeActive } = useEngineStore.getState();
      syncOsmdCursor(osmd, currentStepIndex, isPracticeActive);
    };

    osmd
      .load(musicXml)
      .then(() => {
        if (cancelled) {
          return;
        }

        osmd.enableOrDisableCursors(true);
        resizeObserver = new ResizeObserver(() => safeRender());
        resizeObserver.observe(container);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("[SheetMusicDisplay] OSMD load/render failed:", err);
        }
      });

    return () => {
      cancelled = true;
      osmdReadyRef.current = false;
      resizeObserver?.disconnect();
      osmdRef.current = null;
      container.innerHTML = "";
    };
  }, [musicXml]);

  useEffect(() => {
    const osmd = osmdRef.current;
    if (!osmd || !osmdReadyRef.current || !osmd.cursor) {
      return;
    }

    syncOsmdCursor(osmd, currentStepIndex, isPracticeActive);
  }, [currentStepIndex, isPracticeActive, musicXml]);

  return <div ref={containerRef} className="w-full overflow-auto bg-white rounded-lg p-4" />;
}
