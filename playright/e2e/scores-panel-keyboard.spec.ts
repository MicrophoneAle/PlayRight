import { expect, test, type Page, type Route } from '@playwright/test';
import type { PlayRightE2EHarness } from '../src/core/e2eHarness.ts';

/**
 * Scores-panel keyboard navigation. Requires:
 * - VITE_E2E harness (openScoreLibrary + setLibraryUserId) to bypass Clerk
 * - Fake VITE_SUPABASE_* from playwright.config so isSupabaseConfigured() is true
 * - page.route mock of PostgREST /rest/v1/scores so Public + Your scores populate
 *
 * Fixture uses an ODD public count (9) + 6 personal. That is the trigger for the
 * section-offset left/right bug: with a flat combined index, every personal
 * entry had flipped column parity.
 */

const STORAGE_KEY = 'playright-onboarding-tutorial-seen';
const E2E_USER_ID = 'user_e2e_scores_panel';
const PUBLIC_COUNT = 9;
const PERSONAL_COUNT = 6;
const TOTAL = PUBLIC_COUNT + PERSONAL_COUNT;

const MINIMAL_XML = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name/></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note></measure></part></score-partwise>`;

type ScoreRow = {
  id: string;
  title: string;
  created_at: string;
  raw_xml: string;
  user_id: string | null;
  is_public: boolean;
};

function buildPublicRows(): ScoreRow[] {
  return Array.from({ length: PUBLIC_COUNT }, (_, index) => {
    const n = String(index + 1).padStart(2, '0');
    return {
      id: `public-${n}`,
      title: `Public ${n}`,
      created_at: `2026-01-01T00:00:${n}.000Z`,
      raw_xml: MINIMAL_XML,
      user_id: 'user_curator',
      is_public: true,
    };
  });
}

function buildPersonalRows(): ScoreRow[] {
  return Array.from({ length: PERSONAL_COUNT }, (_, index) => {
    const n = String(index + 1).padStart(2, '0');
    // Newer first so date-desc personal sort matches Personal 01..06 order.
    const day = String(20 - index).padStart(2, '0');
    return {
      id: `personal-${n}`,
      title: `Personal ${n}`,
      created_at: `2026-01-${day}T12:00:00.000Z`,
      raw_xml: MINIMAL_XML,
      user_id: E2E_USER_ID,
      is_public: false,
    };
  });
}

const PUBLIC_ROWS = buildPublicRows();
const PERSONAL_ROWS = buildPersonalRows();

async function mockScoresRest(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  if (!url.pathname.includes('/rest/v1/scores')) {
    await route.continue();
    return;
  }

  const isPublic = url.searchParams.get('is_public') === 'eq.true';
  const userFilter = url.searchParams.get('user_id');
  let rows: ScoreRow[];
  if (isPublic) {
    rows = PUBLIC_ROWS;
  } else if (userFilter === `eq.${E2E_USER_ID}`) {
    rows = PERSONAL_ROWS;
  } else {
    rows = [];
  }

  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
    },
    body: JSON.stringify(rows),
  });
}

async function e2e(page: Page): Promise<Pick<
  PlayRightE2EHarness,
  'setLibraryUserId' | 'openScoreLibrary' | 'closeScoreLibrary'
>> {
  const ready = await page.evaluate(() => Boolean(window.__playrightE2E));
  if (!ready) {
    throw new Error('window.__playrightE2E missing — is VITE_E2E=1 set for Vite?');
  }
  return {
    setLibraryUserId: (userId) =>
      page.evaluate(
        (id) => window.__playrightE2E!.setLibraryUserId(id),
        userId,
      ),
    openScoreLibrary: () =>
      page.evaluate(() => window.__playrightE2E!.openScoreLibrary()),
    closeScoreLibrary: () =>
      page.evaluate(() => window.__playrightE2E!.closeScoreLibrary()),
  };
}

async function focusedLibraryIndex(page: Page): Promise<number> {
  const focused = page.locator('[data-library-index][data-focused="true"]');
  await expect(focused).toHaveCount(1);
  return Number(await focused.getAttribute('data-library-index'));
}

async function openPopulatedLibrary(page: Page): Promise<void> {
  await page.addInitScript(
    (key) => window.localStorage.setItem(key, new Date().toISOString()),
    STORAGE_KEY,
  );
  await page.route('**/rest/v1/scores*', mockScoresRest);
  // Also allow the supabase auth/preflight noise without failing the page.
  await page.route('**/auth/v1/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: '{}',
    });
  });

  await page.goto('/');
  const api = await e2e(page);
  await api.setLibraryUserId(E2E_USER_ID);
  await api.openScoreLibrary();

  await expect(page.getByRole('dialog', { name: 'Scores' })).toBeVisible();
  await expect(page.getByTestId('score-library-scroll')).toBeVisible();
  await expect(page.locator('[data-library-index]')).toHaveCount(TOTAL, {
    timeout: 20_000,
  });
  await expect(page.getByRole('heading', { name: 'Public' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your scores' })).toBeVisible();

  // Force a short scroll viewport so ArrowDown past the fold actually scrolls
  // (needed to exercise the hover-hijack / scroll-following regressions).
  await page.getByTestId('score-library-scroll').evaluate((el) => {
    const node = el as HTMLElement;
    node.style.maxHeight = '200px';
    node.style.height = '200px';
  });
}

async function parkPointerOverScroll(page: Page): Promise<{ x: number; y: number }> {
  // Leave the pointer stationary over the scrollport so scroll-driven
  // mouseenter can hijack focus (the pre-fix onMouseEnter bug).
  const scroll = page.getByTestId('score-library-scroll');
  const box = await scroll.boundingBox();
  expect(box).toBeTruthy();
  const point = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  await page.mouse.move(point.x, point.y);
  return point;
}

async function focusIndexZeroWithPointerParked(page: Page): Promise<void> {
  // Hover may have moved focus; walk back to index 0 without moving the mouse.
  for (let press = 0; press < 20; press += 1) {
    if ((await focusedLibraryIndex(page)) === 0) {
      return;
    }
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowUp');
  }
  expect(await focusedLibraryIndex(page)).toBe(0);
}

test.describe('scores panel keyboard navigation', () => {
  test.use({ viewport: { width: 800, height: 720 } });

  test('vertical traversal advances focus and scroll, then retraces with ArrowUp', async ({
    page,
  }) => {
    await openPopulatedLibrary(page);
    const scroll = page.getByTestId('score-library-scroll');
    await parkPointerOverScroll(page);
    await focusIndexZeroWithPointerParked(page);

    expect(await focusedLibraryIndex(page)).toBe(0);
    let previous = 0;
    let previousScroll = await scroll.evaluate((el) => el.scrollTop);
    let sawScrollAdvance = false;

    for (let press = 0; press < 40; press += 1) {
      await page.keyboard.press('ArrowDown');
      const next = await focusedLibraryIndex(page);
      if (next === previous) {
        break;
      }
      expect(next).toBeGreaterThan(previous);
      previous = next;

      const scrollTop = await scroll.evaluate((el) => el.scrollTop);
      if (scrollTop > previousScroll) {
        sawScrollAdvance = true;
      }
      previousScroll = scrollTop;

      // Focused row must remain inside the scrollport.
      const inView = await page.evaluate(() => {
        const focused = document.querySelector(
          '[data-library-index][data-focused="true"]',
        );
        const scroller = document.querySelector(
          '[data-testid="score-library-scroll"]',
        );
        if (!(focused instanceof HTMLElement) || !(scroller instanceof HTMLElement)) {
          return false;
        }
        const focusRect = focused.getBoundingClientRect();
        const scrollRect = scroller.getBoundingClientRect();
        return (
          focusRect.top >= scrollRect.top - 1 &&
          focusRect.bottom <= scrollRect.bottom + 1
        );
      });
      expect(inView).toBe(true);
    }

    expect(previous).toBeGreaterThanOrEqual(PUBLIC_COUNT);
    expect(sawScrollAdvance).toBe(true);

    for (let press = 0; press < 40; press += 1) {
      await page.keyboard.press('ArrowUp');
      const next = await focusedLibraryIndex(page);
      if (next === previous) {
        break;
      }
      expect(next).toBeLessThan(previous);
      previous = next;
    }

    expect(previous).toBe(0);
  });

  test('stationary pointer does not hijack focus when the list scrolls under it', async ({
    page,
  }) => {
    await openPopulatedLibrary(page);

    // Park over a mid-list row (hover may focus it), then scroll the list under
    // the stationary cursor without further pointer movement. onMouseEnter
    // would move focus to whichever row lands under the cursor; onMouseMove
    // must leave keyboard/hover focus alone.
    const parkedIndex = 2;
    const parked = page.locator(`[data-library-index="${parkedIndex}"] button`).first();
    const box = await parked.boundingBox();
    expect(box).toBeTruthy();
    const park = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
    await page.mouse.move(park.x, park.y);
    await expect.poll(async () => focusedLibraryIndex(page)).toBe(parkedIndex);

    await page.getByTestId('score-library-scroll').evaluate((el) => {
      (el as HTMLElement).scrollTop = 160;
    });
    // Give Chromium a turn to deliver scroll-driven mouseenter, if any.
    await page.waitForTimeout(50);

    const underIndex = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      const row = el instanceof Element ? el.closest('[data-library-index]') : null;
      return row ? Number(row.getAttribute('data-library-index')) : null;
    }, park);

    // Sanity: scroll actually put a different row under the parked point.
    expect(underIndex).not.toBeNull();
    expect(underIndex).not.toBe(parkedIndex);

    // Focus must stay on the parked row — not jump to the row that slid under.
    expect(await focusedLibraryIndex(page)).toBe(parkedIndex);
  });
  test('genuine pointer movement still moves focus (hover-to-focus)', async ({
    page,
  }) => {
    await openPopulatedLibrary(page);
    expect(await focusedLibraryIndex(page)).toBe(0);

    const targetIndex = 4;
    const target = page.locator(`[data-library-index="${targetIndex}"]`);
    const box = await target.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);

    await expect
      .poll(async () => focusedLibraryIndex(page))
      .toBe(targetIndex);
  });

  test('left/right column navigation works in the personal section with odd public count', async ({
    page,
  }) => {
    await openPopulatedLibrary(page);

    // Focus the first personal entry (flat index 9) via hover so we are not
    // coupling this guard to vertical section crossing. With an odd public
    // count, flat-index math treats 9 as column 1 (so ArrowRight is a no-op);
    // section-relative math treats it as column 0 of the personal grid.
    const personalStart = PUBLIC_COUNT;
    const personalCol0 = page
      .locator(`[data-library-index="${personalStart}"] button`)
      .first();
    await personalCol0.scrollIntoViewIfNeeded();
    const box = await personalCol0.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect.poll(async () => focusedLibraryIndex(page)).toBe(personalStart);

    await page.keyboard.press('ArrowRight');
    expect(await focusedLibraryIndex(page)).toBe(personalStart + 1);

    await page.keyboard.press('ArrowLeft');
    expect(await focusedLibraryIndex(page)).toBe(personalStart);
  });

  test('edge clamping: left/right no-ops at column edges and odd final row', async ({
    page,
  }) => {
    await openPopulatedLibrary(page);

    // Col 0: ArrowLeft is a no-op.
    expect(await focusedLibraryIndex(page)).toBe(0);
    await page.keyboard.press('ArrowLeft');
    expect(await focusedLibraryIndex(page)).toBe(0);

    // Col 1: ArrowRight is a no-op.
    await page.keyboard.press('ArrowRight');
    expect(await focusedLibraryIndex(page)).toBe(1);
    await page.keyboard.press('ArrowRight');
    expect(await focusedLibraryIndex(page)).toBe(1);

    // Return to col 0 and walk down to the lone public cell at index 8
    // (9 public over 2 columns → last row is [8] alone).
    await page.keyboard.press('ArrowLeft');
    expect(await focusedLibraryIndex(page)).toBe(0);
    for (let press = 0; press < 10; press += 1) {
      await page.keyboard.press('ArrowDown');
      if ((await focusedLibraryIndex(page)) === 8) {
        break;
      }
    }
    expect(await focusedLibraryIndex(page)).toBe(8);
    await page.keyboard.press('ArrowRight');
    expect(await focusedLibraryIndex(page)).toBe(8);
  });
});
