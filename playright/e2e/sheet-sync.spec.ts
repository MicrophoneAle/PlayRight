import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { E2E_SCROLL_MUSICXML } from './fixtures/scroll-piece.musicxml.ts';
import type { PlayRightE2EHarness } from '../src/core/e2eHarness.ts';

const here = dirname(fileURLToPath(import.meta.url));
const FANFARE_XML = readFileSync(
  join(here, '../src/assets/playright-fanfare.musicxml'),
  'utf8',
);

type E2EApi = PlayRightE2EHarness;

async function e2e(page: Page): Promise<E2EApi> {
  const ready = await page.evaluate(() => Boolean(window.__playrightE2E));
  if (!ready) {
    throw new Error('window.__playrightE2E missing — is VITE_E2E=1 set for Vite?');
  }
  return {
    loadXml: (xml, title) =>
      page.evaluate(
        ({ xml: scoreXml, title: scoreTitle }) =>
          window.__playrightE2E!.loadXml(scoreXml, scoreTitle),
        { xml, title },
      ),
    startPractice: () => page.evaluate(() => window.__playrightE2E!.startPractice()),
    getStepIndex: () => page.evaluate(() => window.__playrightE2E!.getStepIndex()),
    getTotalSteps: () => page.evaluate(() => window.__playrightE2E!.getTotalSteps()),
    seekPractice: (stepIndex) =>
      page.evaluate(
        (index) => window.__playrightE2E!.seekPractice(index),
        stepIndex,
      ),
    setPlayMode: (enabled) =>
      page.evaluate((on) => window.__playrightE2E!.setPlayMode(on), enabled),
    seekPlayback: (stepIndex) =>
      page.evaluate(
        (index) => window.__playrightE2E!.seekPlayback(index),
        stepIndex,
      ),
    getSheetScrollTop: () =>
      page.evaluate(() => window.__playrightE2E!.getSheetScrollTop()),
    getSheetOverflow: () =>
      page.evaluate(() => window.__playrightE2E!.getSheetOverflow()),
    getNoteheadClientPoint: (indexFromEnd) =>
      page.evaluate(
        (fromEnd) => window.__playrightE2E!.getNoteheadClientPoint(fromEnd),
        indexFromEnd,
      ),
    countHighlightedSvgNodes: () =>
      page.evaluate(() => window.__playrightE2E!.countHighlightedSvgNodes()),
  };
}

async function waitForSheetReady(page: Page): Promise<void> {
  const sheet = page.getByTestId('sheet-music');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('svg').first()).toBeVisible({ timeout: 30_000 });
}

async function waitForHighlights(api: E2EApi): Promise<void> {
  await expect
    .poll(async () => api.countHighlightedSvgNodes(), { timeout: 20_000 })
    .toBeGreaterThan(0);
}

/** Narrow + short sheet so OSMD wraps systems and the container can scroll. */
async function constrainSheetForScroll(page: Page): Promise<void> {
  const sheet = page.getByTestId('sheet-music');
  await sheet.evaluate((el) => {
    const node = el as HTMLElement;
    // flex-1 would otherwise keep growing to the parent width and ignore width.
    node.style.flex = '0 0 auto';
    node.style.width = '260px';
    node.style.maxWidth = '260px';
    node.style.height = '160px';
    node.style.maxHeight = '160px';
    node.style.minHeight = '160px';
    node.style.overflow = 'auto';
  });

  await expect
    .poll(
      async () => {
        const o = await page.evaluate(() => {
          const el = document.querySelector(
            '[data-testid="sheet-music"]',
          ) as HTMLElement | null;
          if (!el) {
            return { canScroll: false, width: 0 };
          }
          return {
            canScroll: el.scrollHeight > el.clientHeight + 24,
            width: el.clientWidth,
          };
        });
        return o.width <= 280 && o.canScroll;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
}

test.describe('sheet sync (OSMD browser)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect
      .poll(async () => page.evaluate(() => Boolean(window.__playrightE2E)), {
        timeout: 30_000,
      })
      .toBe(true);
  });

  test('loads a piece and renders sheet SVG', async ({ page }) => {
    const api = await e2e(page);
    await api.loadXml(FANFARE_XML, 'fanfare');
    await waitForSheetReady(page);
    expect(await api.getTotalSteps()).toBeGreaterThan(0);
    await expect(page.getByText(/Step 1 of/)).toBeVisible();
  });

  test('practice seek highlights notes on the sheet', async ({ page }) => {
    const api = await e2e(page);
    await api.loadXml(FANFARE_XML, 'fanfare');
    await waitForSheetReady(page);
    await api.startPractice();
    await waitForHighlights(api);

    const target = Math.min(3, (await api.getTotalSteps()) - 1);
    await api.seekPractice(target);
    await expect.poll(async () => api.getStepIndex()).toBe(target);
    await waitForHighlights(api);
  });

  test('scroll advances when seeking to a later system', async ({ page }) => {
    const api = await e2e(page);
    await api.loadXml(E2E_SCROLL_MUSICXML, 'scroll-piece');
    await waitForSheetReady(page);
    await constrainSheetForScroll(page);

    await api.startPractice();
    await waitForHighlights(api);
    await api.seekPractice(0);
    await expect
      .poll(async () => (await api.getSheetOverflow()).scrollTop)
      .toBeGreaterThanOrEqual(0);
    const startScroll = (await api.getSheetOverflow()).scrollTop;

    const last = (await api.getTotalSteps()) - 1;
    await api.seekPractice(last);
    await expect
      .poll(async () => (await api.getSheetOverflow()).scrollTop, {
        timeout: 15_000,
      })
      .toBeGreaterThan(startScroll);
  });

  test('sheet click-jump changes the practice step', async ({ page }) => {
    const api = await e2e(page);
    await api.loadXml(E2E_SCROLL_MUSICXML, 'click-piece');
    await waitForSheetReady(page);
    await api.startPractice();
    await waitForHighlights(api);
    await api.seekPractice(0);
    expect(await api.getStepIndex()).toBe(0);

    await expect
      .poll(async () => api.getNoteheadClientPoint(1), { timeout: 10_000 })
      .not.toBeNull();
    const point = await api.getNoteheadClientPoint(1);
    if (!point) {
      throw new Error('no notehead hit target');
    }

    await page.mouse.click(point.x, point.y);
    await expect
      .poll(async () => api.getStepIndex(), { timeout: 10_000 })
      .toBeGreaterThan(0);
  });

  test('play-mode seek updates step and keeps highlights', async ({ page }) => {
    const api = await e2e(page);
    await api.loadXml(FANFARE_XML, 'fanfare-play');
    await waitForSheetReady(page);

    await api.setPlayMode(true);
    const target = Math.min(4, (await api.getTotalSteps()) - 1);
    await api.seekPlayback(target);

    await expect.poll(async () => api.getStepIndex()).toBe(target);
    await waitForHighlights(api);
  });
});
