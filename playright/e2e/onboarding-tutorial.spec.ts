import { expect, test, type Page } from '@playwright/test';

const STORAGE_KEY = 'playright-onboarding-tutorial-seen';

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Getting started' });

async function readSeenFlag(page: Page): Promise<string | null> {
  return page.evaluate(
    (key) => window.localStorage.getItem(key),
    STORAGE_KEY,
  );
}

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

test.describe('onboarding tutorial', () => {
  test('auto-opens on first launch and stays closed after dismissal', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(dialog(page)).toBeVisible();
    await expect(page.getByText('1 of 5')).toBeVisible();
    await expect(await readSeenFlag(page)).toBeNull();

    await page.getByRole('button', { name: 'Close tutorial' }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(await readSeenFlag(page)).not.toBeNull();

    await page.reload();
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
    await expect(dialog(page)).toBeHidden();
  });

  test('pages forward and back with buttons and arrow keys', async ({ page }) => {
    await page.goto('/');
    await expect(dialog(page)).toBeVisible();

    const back = page.getByRole('button', { name: 'Previous page' });
    const next = page.getByRole('button', { name: 'Next page' });

    await expect(back).toBeDisabled();
    await expect(page.getByRole('heading', { name: 'Signing in' })).toBeVisible();

    await next.click();
    await expect(page.getByText('2 of 5')).toBeVisible();
    await expect(back).toBeEnabled();

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByText('5 of 5')).toBeVisible();
    await expect(next).toBeHidden();
    await expect(page.getByRole('button', { name: 'Start playing' })).toBeVisible();

    // Last page does not wrap.
    await page.keyboard.press('ArrowRight');
    await expect(page.getByText('5 of 5')).toBeVisible();

    await page.keyboard.press('ArrowLeft');
    await expect(page.getByText('4 of 5')).toBeVisible();

    await back.click();
    await expect(page.getByText('3 of 5')).toBeVisible();

    // Page indicator keys jump directly.
    await page.getByRole('button', { name: 'Page 1: Signing in' }).click();
    await expect(page.getByText('1 of 5')).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByText('1 of 5')).toBeVisible();
  });

  test('closes from a middle page via backdrop click', async ({ page }) => {
    await page.goto('/');
    await expect(dialog(page)).toBeVisible();

    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByText('2 of 5')).toBeVisible();

    // Backdrop: click the top-left corner, outside the centered panel.
    await page.mouse.click(6, 6);
    await expect(dialog(page)).toBeHidden();
    await expect(await readSeenFlag(page)).not.toBeNull();
  });

  test('captures arrow keys while open and releases them once closed', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(dialog(page)).toBeVisible();

    const anchorBefore = await scopeAnchorX(page);

    await page.keyboard.press('ArrowRight');
    await expect(page.getByText('2 of 5')).toBeVisible();
    expect(await scopeAnchorX(page)).toBe(anchorBefore);

    await page.getByRole('button', { name: 'Close tutorial' }).click();
    await expect(dialog(page)).toBeHidden();

    await page.keyboard.press('ArrowRight');
    expect(await scopeAnchorX(page)).toBeGreaterThan(anchorBefore);
  });

  test('reopens from the header info button after dismissal', async ({ page }) => {
    await page.addInitScript(
      (key) => window.localStorage.setItem(key, new Date().toISOString()),
      STORAGE_KEY,
    );
    await page.goto('/');
    await expect(dialog(page)).toBeHidden();

    await page.getByRole('button', { name: 'Getting started tutorial' }).click();

    await expect(dialog(page)).toBeVisible();
    await expect(page.getByText('1 of 5')).toBeVisible();
  });

  test('reopens from the settings menu after dismissal', async ({ page }) => {
    await page.addInitScript(
      (key) => window.localStorage.setItem(key, new Date().toISOString()),
      STORAGE_KEY,
    );
    await page.goto('/');
    await expect(dialog(page)).toBeHidden();

    await page.getByRole('button', { name: 'Settings' }).click();
    // hasText targets the settings-panel entry; the header button is icon-only.
    await page
      .locator('button', { hasText: 'Getting started tutorial' })
      .click();

    await expect(dialog(page)).toBeVisible();
    await expect(page.getByText('1 of 5')).toBeVisible();
  });

  test('keeps identical outer panel size across all five pages', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(dialog(page)).toBeVisible();

    const panel = page.getByTestId('onboarding-tutorial-panel');
    const sizes: Array<{ width: number; height: number }> = [];

    for (let i = 0; i < 5; i += 1) {
      await expect(page.getByText(`${i + 1} of 5`)).toBeVisible();
      const box = await panel.boundingBox();
      expect(box).not.toBeNull();
      sizes.push({
        width: Math.round(box!.width),
        height: Math.round(box!.height),
      });

      if (i < 4) {
        await page.getByRole('button', { name: 'Next page' }).click();
      }
    }

    const first = sizes[0];
    for (const size of sizes) {
      expect(size).toEqual(first);
    }

    expect(first).toEqual({ width: 544, height: 568 });

    // Equal inset above and below the panel (matches backdrop p-4).
    const panelBox = await panel.boundingBox();
    expect(panelBox).not.toBeNull();
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    const topGap = panelBox!.y;
    const bottomGap = viewport!.height - (panelBox!.y + panelBox!.height);
    expect(topGap).toBeGreaterThanOrEqual(15);
    expect(bottomGap).toBeGreaterThanOrEqual(15);
    expect(Math.abs(topGap - bottomGap)).toBeLessThanOrEqual(2);

    // Page 4: three equal-width stacked shots, all visible with no scrollbar.
    await page.getByRole('button', { name: 'Page 4: Modify Controls' }).click();
    const stack = panel.getByTestId('onboarding-artwork-stack');
    const imgs = stack.locator('img');
    await expect(imgs).toHaveCount(3);

    const metrics = await imgs.evaluateAll((els) =>
      els.map((el) => {
        const image = el as HTMLImageElement;
        const rect = image.getBoundingClientRect();
        return {
          nw: image.naturalWidth,
          nh: image.naturalHeight,
          w: rect.width,
          h: rect.height,
          top: rect.top,
          bottom: rect.bottom,
        };
      }),
    );

    const widths = metrics.map((m) => Math.round(m.w * 10) / 10);
    expect(widths[0]).toBeGreaterThan(0);
    expect(widths[1]).toBeCloseTo(widths[0], 0);
    expect(widths[2]).toBeCloseTo(widths[0], 0);

    for (const natural of metrics) {
      expect(natural.nw).toBeGreaterThan(0);
      expect(natural.nh).toBeGreaterThan(0);
      const naturalRatio = natural.nw / natural.nh;
      const displayRatio = natural.w / natural.h;
      expect(Math.abs(naturalRatio - displayRatio)).toBeLessThan(0.02);
    }

    const scrollState = await stack.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(scrollState.scrollHeight).toBeLessThanOrEqual(
      scrollState.clientHeight + 1,
    );

    const stackBox = await stack.boundingBox();
    expect(stackBox).not.toBeNull();
    expect(metrics[0].top).toBeGreaterThanOrEqual(stackBox!.y - 1);
    expect(metrics[2].bottom).toBeLessThanOrEqual(
      stackBox!.y + stackBox!.height + 1,
    );
  });
});
