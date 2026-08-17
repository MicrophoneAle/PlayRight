import { expect, test, type Page } from '@playwright/test';
import { E2E_SUMMARY_MUSICXML } from './fixtures/summary-piece.musicxml.ts';

const TUTORIAL_STORAGE_KEY = 'playright-onboarding-tutorial-seen';

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Piece complete' });

/** X position of the scope's first white-key label; moves when the scope shifts. */
async function scopeAnchorX(page: Page): Promise<number> {
  const label = page
    .locator('[aria-label="88-key piano keyboard"] span')
    .filter({ hasText: /^A$/ })
    .first();
  await expect(label).toBeVisible();
  const box = await label.boundingBox();
  return box?.x ?? -1;
}

async function loadAndStart(page: Page): Promise<void> {
  await page.addInitScript(
    (key) => window.localStorage.setItem(key, new Date().toISOString()),
    TUTORIAL_STORAGE_KEY,
  );
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__playrightE2E));
  await page.evaluate(
    async (xml) => window.__playrightE2E!.loadXml(xml, 'summary-piece'),
    E2E_SUMMARY_MUSICXML,
  );
  // Summary E2E presses one-hand piano keys; two-hand is the app default.
  await page.evaluate(() => window.__playrightE2E!.setEngineMode('one-hand'));
  await page.evaluate(() => window.__playrightE2E!.startPractice());
}

/**
 * Press the real physical key bound to the note the piece is waiting on.
 * Resolved from the live scope map rather than hardcoded, because starting
 * practice recenters the scope on the first note.
 */
async function playExpectedNote(page: Page): Promise<void> {
  const code = await page.evaluate(() => {
    const harness = window.__playrightE2E!;
    const midi = harness.getExpectedMidis()[0];
    return midi === undefined ? null : harness.getPhysicalKeyForMidi(midi);
  });

  expect(code).not.toBeNull();
  await page.keyboard.press(code!);
}

test.describe('practice run summary', () => {
  test('live accuracy tracks presses during the run', async ({ page }) => {
    await loadAndStart(page);

    const accuracy = page.getByTestId('practice-accuracy');
    const rank = page.getByTestId('practice-rank');
    // 0/0 is not an accuracy, so neither figure exists before the first note.
    await expect(accuracy).toHaveCount(0);
    await expect(rank).toHaveCount(0);

    await playExpectedNote(page);
    await expect(accuracy).toHaveText('100% accurate');
    await expect(rank).toHaveText('SS');
    await expect(page.getByTestId('practice-wrong-count')).toHaveCount(0);
  });

  test('opens with a rank after the final note is released, and dismisses three ways', async ({
    page,
  }) => {
    await loadAndStart(page);
    await expect(dialog(page)).toBeHidden();

    await playExpectedNote(page);
    await playExpectedNote(page);

    await expect(dialog(page)).toBeVisible();
    await expect(page.getByTestId('score-summary-rank')).toHaveText('SS');
    await expect(page.getByTestId('score-summary-accuracy')).toHaveText('100%');
    await expect(page.getByTestId('score-summary-correct')).toHaveText('2');
    await expect(page.getByTestId('score-summary-wrong')).toHaveText('0');
    await expect(page.getByTestId('score-summary-streak')).toHaveText('2');

    // Escape.
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();

    // Backdrop click.
    await page.evaluate(() => window.__playrightE2E!.startPractice());
    await playExpectedNote(page);
    await playExpectedNote(page);
    await expect(dialog(page)).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(dialog(page)).toBeHidden();

    // Close button.
    await page.evaluate(() => window.__playrightE2E!.startPractice());
    await playExpectedNote(page);
    await playExpectedNote(page);
    await expect(dialog(page)).toBeVisible();
    await page.getByRole('button', { name: 'Close run summary' }).click();
    await expect(dialog(page)).toBeHidden();
  });

  test('withholds the rank when the run was navigated', async ({ page }) => {
    await loadAndStart(page);

    await page.evaluate(() => window.__playrightE2E!.seekPractice(1));
    await playExpectedNote(page);
    // The live line drops the rank for a navigated run too, not just the modal.
    await expect(page.getByTestId('practice-rank')).toHaveText('Unranked');

    await expect(dialog(page)).toBeVisible();
    await expect(page.getByTestId('score-summary-rank')).toHaveText('Unranked');
    await expect(
      page.getByText(/Ranking is off for runs where you navigated/),
    ).toBeVisible();
    // Counts and accuracy are still reported.
    await expect(page.getByTestId('score-summary-accuracy')).toHaveText('100%');
    await expect(page.getByTestId('score-summary-correct')).toHaveText('1');
  });

  test('scoring off persists, hides the live figures, and suppresses the modal', async ({
    page,
  }) => {
    await page.addInitScript(() => window.localStorage.setItem('playright-scoring', 'false'));
    await loadAndStart(page);

    await playExpectedNote(page);
    await expect(page.getByTestId('practice-accuracy')).toHaveCount(0);
    await expect(page.getByTestId('practice-rank')).toHaveCount(0);

    await playExpectedNote(page);
    await expect(page.getByTestId('practice-status-line')).toContainText('Piece complete');
    await expect(dialog(page)).toBeHidden();

    // The stored value survives the reload and drives the settings checkbox.
    await page.reload();
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByLabel('Scoring')).not.toBeChecked();

    // Turning it back on mid-run cannot resurrect the discarded counts.
    await page.getByLabel('Scoring').check();
    await expect(page.getByTestId('practice-accuracy')).toHaveCount(0);
  });

  test('captures practice keys while open and releases them once closed', async ({
    page,
  }) => {
    await loadAndStart(page);
    await playExpectedNote(page);
    await playExpectedNote(page);
    await expect(dialog(page)).toBeVisible();

    const anchorBefore = await scopeAnchorX(page);
    const stepBefore = await page.evaluate(() => window.__playrightE2E!.getStepIndex());

    // Arrow keys normally shift the scope; Enter normally starts practice.
    await page.keyboard.press('ArrowRight');
    expect(await scopeAnchorX(page)).toBe(anchorBefore);

    await page.keyboard.press('Enter');
    expect(
      await page.evaluate(() => window.__playrightE2E!.getStepIndex()),
    ).toBe(stepBefore);

    await page.getByRole('button', { name: 'Done' }).click();
    await expect(dialog(page)).toBeHidden();

    // Both work again once the modal is gone.
    await page.keyboard.press('ArrowRight');
    expect(await scopeAnchorX(page)).toBeGreaterThan(anchorBefore);
  });
});
