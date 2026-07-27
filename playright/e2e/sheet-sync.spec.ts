import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { expect, test, type Page } from '@playwright/test';
import { E2E_SCROLL_MUSICXML } from './fixtures/scroll-piece.musicxml.ts';
import type { PlayRightE2EHarness } from '../src/core/e2eHarness.ts';

const here = dirname(fileURLToPath(import.meta.url));
const FANFARE_XML = readFileSync(
  join(here, '../src/assets/playright-fanfare.musicxml'),
  'utf8',
);
const CONSTANT_MODERATO_XML = readFileSync(
  join(here, '../src/assets/constant-moderato.musicxml'),
  'utf8',
);

async function loadUnwelcomeSchoolXml(): Promise<string> {
  const archive = await JSZip.loadAsync(
    readFileSync(join(here, '../src/assets/unwelcome-school.mxl')),
  );
  const scoreXml = archive.file('score.xml');
  if (!scoreXml) {
    throw new Error('unwelcome-school.mxl missing score.xml');
  }
  return scoreXml.async('string');
}

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
    seekPlaybackOrderIndex: (entryIndex) =>
      page.evaluate(
        (index) => window.__playrightE2E!.seekPlaybackOrderIndex(index),
        entryIndex,
      ),
    startPlayback: () => page.evaluate(() => window.__playrightE2E!.startPlayback()),
    stopPlayback: () => page.evaluate(() => window.__playrightE2E!.stopPlayback()),
    pausePlayback: () => page.evaluate(() => window.__playrightE2E!.pausePlayback()),
    isPlaybackFinished: () =>
      page.evaluate(() => window.__playrightE2E!.isPlaybackFinished()),
    isPlaybackActive: () =>
      page.evaluate(() => window.__playrightE2E!.isPlaybackActive()),
    isPlaybackPaused: () =>
      page.evaluate(() => window.__playrightE2E!.isPlaybackPaused()),
    getPlaybackOrderIndex: () =>
      page.evaluate(() => window.__playrightE2E!.getPlaybackOrderIndex()),
    getPlaybackOrder: () =>
      page.evaluate(() => window.__playrightE2E!.getPlaybackOrder()),
    isPendingPlaybackResize: () =>
      page.evaluate(() => window.__playrightE2E!.isPendingPlaybackResize()),
    getSheetRenderedSize: () =>
      page.evaluate(() => window.__playrightE2E!.getSheetRenderedSize()),
    getHighlightBounds: () =>
      page.evaluate(() => window.__playrightE2E!.getHighlightBounds()),
    probePlayedDurations: () =>
      page.evaluate(() => window.__playrightE2E!.probePlayedDurations()),
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
  await expect(sheet.locator('svg').first()).toBeVisible({ timeout: 60_000 });
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
    // Sheet tests run as a returning user: the first-launch tutorial overlay
    // would otherwise cover the score. Onboarding has its own spec.
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'playright-onboarding-tutorial-seen',
        new Date().toISOString(),
      );
    });
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

  test('defers sheet reflow until playback stops after a mid-play resize', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const api = await e2e(page);
    // Substantial repeat-free score so container resize changes engraving layout.
    await api.loadXml(CONSTANT_MODERATO_XML, 'constant-moderato');
    await waitForSheetReady(page);

    await api.setPlayMode(true);
    await api.startPlayback();
    await expect.poll(async () => api.isPlaybackActive(), { timeout: 15_000 }).toBe(true);
    await expect
      .poll(async () => api.getStepIndex(), { timeout: 20_000 })
      .toBeGreaterThan(0);
    await waitForHighlights(api);

    const sizeBefore = await api.getSheetRenderedSize();
    expect(sizeBefore).not.toBeNull();
    expect(sizeBefore!.width).toBeGreaterThan(280);

    await constrainSheetForScroll(page);

    await expect
      .poll(async () => api.isPendingPlaybackResize(), { timeout: 10_000 })
      .toBe(true);

    // Still playing: highlights keep updating; rendered size stays pre-resize.
    await expect.poll(async () => api.isPlaybackActive()).toBe(true);
    await expect.poll(async () => api.isPendingPlaybackResize()).toBe(true);
    const sizeWhilePending = await api.getSheetRenderedSize();
    expect(sizeWhilePending).not.toBeNull();
    expect(Math.abs(sizeWhilePending!.width - sizeBefore!.width)).toBeLessThanOrEqual(2);
    await waitForHighlights(api);
    const stepWhilePending = await api.getStepIndex();
    await expect
      .poll(async () => api.getStepIndex(), { timeout: 20_000 })
      .toBeGreaterThan(stepWhilePending);

    await api.stopPlayback();
    await expect.poll(async () => api.isPlaybackActive()).toBe(false);
    await expect
      .poll(async () => api.isPendingPlaybackResize(), { timeout: 15_000 })
      .toBe(false);
    await expect
      .poll(async () => {
        const size = await api.getSheetRenderedSize();
        return size?.width ?? -1;
      }, { timeout: 15_000 })
      .toBeLessThanOrEqual(280);
  });

  test('play-mode seek to a repeat second pass moves the sheet past the first-pass view', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const api = await e2e(page);
    // Only bundled score with real repeat/ending barlines (625 steps → 822 order).
    const xml = await loadUnwelcomeSchoolXml();
    await api.loadXml(xml, 'unwelcome-school');
    await waitForSheetReady(page);
    await constrainSheetForScroll(page);

    const order = await api.getPlaybackOrder();
    expect(order.length).toBeGreaterThan(await api.getTotalSteps());

    // Region 1 replay: first passIndex=1 entry in measures 9–15.
    const secondPassEntryIndex = order.findIndex(
      (entry) =>
        entry.passIndex === 1 &&
        entry.measureNumber >= 9 &&
        entry.measureNumber <= 15,
    );
    expect(secondPassEntryIndex).toBeGreaterThan(0);
    const secondPass = order[secondPassEntryIndex];
    const firstPassEntryIndex = order.findIndex(
      (entry) =>
        entry.stepIndex === secondPass.stepIndex && entry.passIndex === 0,
    );
    expect(firstPassEntryIndex).toBeGreaterThanOrEqual(0);
    expect(firstPassEntryIndex).toBeLessThan(secondPassEntryIndex);

    await api.setPlayMode(true);
    await api.startPlayback();
    await expect.poll(async () => api.isPlaybackActive(), { timeout: 15_000 }).toBe(true);

    await api.seekPlaybackOrderIndex(firstPassEntryIndex);
    await api.pausePlayback();
    await expect.poll(async () => api.isPlaybackPaused()).toBe(true);
    await expect
      .poll(async () => api.getPlaybackOrderIndex())
      .toBe(firstPassEntryIndex);
    await waitForHighlights(api);
    const firstPassScroll = (await api.getSheetOverflow()).scrollTop;
    const firstPassStep = await api.getStepIndex();
    const firstPassBounds = await api.getHighlightBounds();
    expect(firstPassBounds).not.toBeNull();

    await api.seekPlaybackOrderIndex(secondPassEntryIndex);
    await expect
      .poll(async () => api.getPlaybackOrderIndex())
      .toBe(secondPassEntryIndex);
    expect(await api.getStepIndex()).toBe(firstPassStep);
    await waitForHighlights(api);

    await expect
      .poll(async () => (await api.getSheetOverflow()).scrollTop, {
        timeout: 15_000,
      })
      .not.toBe(firstPassScroll);

    const secondPassBounds = await api.getHighlightBounds();
    expect(secondPassBounds).not.toBeNull();
    // Same document step, but engraved on the later (duplicated) system walk —
    // client Y (and usually scrollTop) must differ from the first-pass view.
    const moved =
      Math.abs(secondPassBounds!.y - firstPassBounds!.y) > 2 ||
      Math.abs((await api.getSheetOverflow()).scrollTop - firstPassScroll) > 2;
    expect(moved).toBe(true);
  });
});
