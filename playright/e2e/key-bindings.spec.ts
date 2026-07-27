import { expect, test, type Page } from '@playwright/test';

const STORAGE_KEY = 'playright-onboarding-tutorial-seen';

const dialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Two-hand key bindings' });

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

async function openKeyBindingsEditor(page: Page): Promise<void> {
  await page.addInitScript(
    (key) => window.localStorage.setItem(key, new Date().toISOString()),
    STORAGE_KEY,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Two-hand key bindings' }).click();
  await expect(dialog(page)).toBeVisible();
}

test.describe('two-hand key bindings editor', () => {
  test('opens from settings and closes without applying draft changes', async ({
    page,
  }) => {
    await openKeyBindingsEditor(page);

    await page.getByRole('button', { name: /Finger 5/ }).first().click();
    await page.keyboard.press('a');
    await expect(page.getByText(/Bound A to Left hand/i)).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog(page)).toBeHidden();

    // Reopen: defaults still present (draft discarded).
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Two-hand key bindings' }).click();
    await expect(dialog(page)).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Finger 5/ }).first(),
    ).toContainText('Q');
  });

  test('saves a remapped key and reflects it after reopen', async ({ page }) => {
    await openKeyBindingsEditor(page);

    await page.getByRole('button', { name: /Finger 5/ }).first().click();
    await page.keyboard.press('a');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(dialog(page)).toBeHidden();

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Two-hand key bindings' }).click();
    await expect(
      page.getByRole('button', { name: /Finger 5/ }).first(),
    ).toContainText('A');
  });

  test('swaps when assigning a key already used by another finger', async ({
    page,
  }) => {
    await openKeyBindingsEditor(page);

    // Left finger 5 is Q; assign N (right finger 1) → swap.
    await page.getByRole('button', { name: /Finger 5/ }).first().click();
    await page.keyboard.press('n');
    await expect(page.getByText(/Swapped with Right hand/i)).toBeVisible();

    await expect(
      page.getByRole('button', { name: /Finger 5/ }).first(),
    ).toContainText('N');
    await expect(
      page.getByRole('button', { name: /Finger 1/ }).nth(1),
    ).toContainText('Q');
  });

  test('reset restores default draft keys', async ({ page }) => {
    await openKeyBindingsEditor(page);

    await page.getByRole('button', { name: /Finger 5/ }).first().click();
    await page.keyboard.press('z');
    await page.getByRole('button', { name: 'Reset to defaults' }).click();
    await expect(
      page.getByRole('button', { name: /Finger 5/ }).first(),
    ).toContainText('Q');
  });

  test('captures arrow keys while open and releases them once closed', async ({
    page,
  }) => {
    await openKeyBindingsEditor(page);

    const anchorBefore = await scopeAnchorX(page);
    await page.keyboard.press('ArrowRight');
    expect(await scopeAnchorX(page)).toBe(anchorBefore);

    await page.getByRole('button', { name: 'Close key bindings' }).click();
    await expect(dialog(page)).toBeHidden();

    await page.keyboard.press('ArrowRight');
    expect(await scopeAnchorX(page)).toBeGreaterThan(anchorBefore);
  });
});
