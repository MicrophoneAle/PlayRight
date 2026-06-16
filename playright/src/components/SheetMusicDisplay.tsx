import { useEffect, useRef } from "react";
import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";

interface SheetMusicDisplayProps {
  musicXml: string | null;
}

export function SheetMusicDisplay({ musicXml }: SheetMusicDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // One effect handles create -> load -> render -> teardown, keyed on the XML.
  // Recreating the instance per score is cheap and avoids the StrictMode
  // double-mount bug where a ref-held instance never gets load() called.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !musicXml) return;

    let cancelled = false;
    const osmd = new OpenSheetMusicDisplay(container, {
      autoResize: true,                   // reflow on window resize, self-managed
      backend: "svg",                     // svg is easy to inspect / recolor later
      drawingParameters: "compacttight",  // tighter vertical layout for practice view
      drawTitle: true,
    });

    osmd
      .load(musicXml)
      .then(() => {
        if (cancelled) return;
        osmd.render();
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("[SheetMusicDisplay] OSMD load/render failed:", err);
        }
      });

    return () => {
      cancelled = true;        // stop a late .then() from rendering post-unmount
      container.innerHTML = ""; // clear OSMD's SVG so a remount/new score starts clean
    };
  }, [musicXml]);

  return <div ref={containerRef} className="w-full overflow-auto" />;
}
