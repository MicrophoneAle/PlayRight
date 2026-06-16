import { useEffect, useRef } from "react";
import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";

interface SheetMusicDisplayProps {
  musicXml: string | null;
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
      drawTitle: false,
      // compacttight defaults to left-side fingerings; above/below centers on noteheads.
      fingeringPosition: "aboveorbelow",
    });

    osmd.OnXMLRead = prepareMusicXmlForDisplay;

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

  return <div ref={containerRef} className="w-full overflow-auto bg-white rounded-lg p-4" />;
}
