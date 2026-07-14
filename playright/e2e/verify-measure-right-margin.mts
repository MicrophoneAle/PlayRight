/**
 * Confirm VoiceSpacing + margin open note→barline clearance without exploding widths.
 * Requires Vite VITE_E2E=1 on :5173.
 */
import { chromium, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARTICULATIONS_EXTENDED_MUSICXML } from '../src/core/parser/__fixtures__/articulations.musicxml.ts';
import { TEMPO_REPEAT_MUSICXML } from '../src/core/parser/__fixtures__/tempoRepeatJump.musicxml.ts';

const here = dirname(fileURLToPath(import.meta.url));
const FANFARE = readFileSync(
  join(here, '../src/assets/playright-fanfare.musicxml'),
  'utf8',
);
const OSMD_MIN = join(
  here,
  '../../node_modules/opensheetmusicdisplay/build/opensheetmusicdisplay.min.js',
);

const repeatXml = TEMPO_REPEAT_MUSICXML.replace(
  '<score-partwise version="3.1">\n  <part id="P1">',
  `<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>R</part-name></score-part></part-list>
  <part id="P1">`,
);

type Settings = {
  margin: number;
  repeatPad: number;
  mult: number;
  add: number;
};

const STOCK: Settings = { margin: 0, repeatPad: 2, mult: 0.65, add: 2 };
const FIXED: Settings = { margin: 1, repeatPad: 3.5, mult: 0.74, add: 2.5 };

async function probe(
  page: import('@playwright/test').Page,
  xml: string,
  label: string,
  s: Settings,
) {
  return page.evaluate(
    async ({ scoreXml, settings, sampleLabel }) => {
      const { OpenSheetMusicDisplay } = (
        window as unknown as {
          opensheetmusicdisplay: {
            OpenSheetMusicDisplay: new (
              el: HTMLElement,
              opts: object,
            ) => {
              EngravingRules: Record<string, number>;
              GraphicSheet?: {
                MeasureList: Array<
                  Array<{
                    PositionAndShape?: {
                      Size?: { width?: number };
                      AbsolutePosition?: { x?: number };
                    };
                    staffEntries?: Array<{
                      PositionAndShape?: {
                        AbsolutePosition?: { x?: number };
                        Size?: { width?: number };
                      };
                    }>;
                  }>
                >;
              };
              load: (x: string) => Promise<void>;
              render: () => void;
            };
          };
        }
      ).opensheetmusicdisplay;

      const host = document.createElement('div');
      host.style.cssText =
        'position:absolute;left:-99999px;top:0;width:900px;height:700px;background:#fff;';
      document.body.appendChild(host);

      const osmd = new OpenSheetMusicDisplay(host, {
        autoResize: false,
        backend: 'svg',
        drawingParameters: 'compacttight',
        drawTitle: false,
      });
      const rules = osmd.EngravingRules;
      rules.MeasureRightMargin = settings.margin;
      rules.RepeatEndStartPadding = settings.repeatPad;
      rules.VoiceSpacingMultiplierVexflow = settings.mult;
      rules.VoiceSpacingAddendVexflow = settings.add;
      await osmd.load(scoreXml);
      osmd.render();

      const list = osmd.GraphicSheet?.MeasureList ?? [];
      const gaps: number[] = [];
      let totalWidth = 0;
      for (const vertical of list) {
        const gm = vertical?.[0];
        if (!gm) continue;
        const sizeW = gm.PositionAndShape?.Size?.width ?? 0;
        totalWidth += sizeW;
        const entries = gm.staffEntries ?? [];
        const last = entries[entries.length - 1];
        if (!last?.PositionAndShape) continue;
        const absX = last.PositionAndShape.AbsolutePosition?.x;
        const entryW = last.PositionAndShape.Size?.width ?? 0;
        const measureAbsX = gm.PositionAndShape?.AbsolutePosition?.x ?? 0;
        if (absX == null) continue;
        gaps.push(sizeW - (absX + entryW - measureAbsX));
      }
      gaps.sort((a, b) => a - b);

      host.remove();
      return {
        label: sampleLabel,
        minGap: gaps[0] ?? null,
        medianGap: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null,
        totalWidth,
        measureCount: list.length,
      };
    },
    { scoreXml: xml, settings: s, sampleLabel: label },
  );
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5173');
await page.waitForFunction(() => Boolean(window.__playrightE2E));
await page.addScriptTag({ path: OSMD_MIN });

for (const [label, xml] of [
  ['articulations', ARTICULATIONS_EXTENDED_MUSICXML],
  ['tempo-repeat', repeatXml],
  ['fanfare', FANFARE],
] as const) {
  const before = await probe(page, xml, label, STOCK);
  const after = await probe(page, xml, label, FIXED);
  const growth = after.totalWidth / Math.max(before.totalWidth, 1e-6);
  console.log(JSON.stringify({ before, after, growth }, null, 2));
  expect(after.minGap!).toBeGreaterThan(before.minGap! + 0.05);
  expect(growth).toBeLessThan(1.15);
}

// Live app uses applyCompactSheetLayout — gap must stay positive.
await page.evaluate(
  async (xml) => window.__playrightE2E!.loadXml(xml, 'spacing-check'),
  ARTICULATIONS_EXTENDED_MUSICXML,
);
await expect(page.getByTestId('sheet-music').locator('svg').first()).toBeVisible({
  timeout: 30_000,
});
console.log('[verify] live articulations rendered');

await browser.close();
console.log('[verify] barline spacing ALL OK');
