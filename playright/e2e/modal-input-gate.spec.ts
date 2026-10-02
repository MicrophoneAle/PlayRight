import { expect, test, type Page } from '@playwright/test';

/**
 * Modal input gate. Any mounted ModalOverlay must suppress every app-level
 * keyboard path (one-hand notes, two-hand finger keys, practice shortcuts) and
 * keep keys from visibly depressing; a key held when a modal opens is released.
 *
 * This is DOM event-order behavior (several capture listeners on window), which
 * the node unit harness cannot exercise.
 */

const TUTORIAL_STORAGE_KEY = 'playright-onboarding-tutorial-seen';

/** Three right-hand notes with score fingerings 1-2-3 (bound to N, I, O). */
const GATE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Gate</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>3</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><notations><technical><fingering>1</fingering></technical></notations></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><notations><technical><fingering>2</fingering></technical></notations></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><notations><technical><fingering>3</fingering></technical></notations></note>
    </measure>
  </part>
</score-partwise>
`;

type Mode = 'one-hand' | 'two-hand';

async function loadAndStart(page: Page, mode: Mode): Promise<void> {
  await page.addInitScript(
    (key) => window.localStorage.setItem(key, new Date().toISOString()),
    TUTORIAL_STORAGE_KEY,
  );
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__playrightE2E));
  await page.evaluate(async (xml) => window.__playrightE2E!.loadXml(xml, 'gate'), GATE_XML);
  await page.evaluate((m) => window.__playrightE2E!.setEngineMode(m), mode);
  await page.evaluate(() => window.__playrightE2E!.startPractice());
}

/** Real physical key that plays the note the current step is waiting on. */
async function expectedKey(page: Page, mode: Mode): Promise<string> {
  const code = await page.evaluate((m) => {
    const harness = window.__playrightE2E!;
    if (m === 'two-hand') {
      return harness.getExpectedFingerKeyCodes()[0] ?? null;
    }
    const midi = harness.getExpectedMidis()[0];
    return midi === undefined ? null : harness.getPhysicalKeyForMidi(midi);
  }, mode);
  expect(code).not.toBeNull();
  return code!;
}

type Snapshot = { attacks: number; step: number; sounding: number[] };

function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const harness = window.__playrightE2E!;
    return {
      attacks: harness.getAudioNoteOnCount(),
      step: harness.getStepIndex(),
      sounding: harness.getSoundingAudioMidis(),
    };
  });
}

const pressedKeys = (page: Page) =>
  page.locator('[aria-label="88-key piano keyboard"] [data-pressed="true"]');

/**
 * Hold the key, assert nothing reacts (no attack, no step change, no visibly
 * depressed key) while it is down, then release.
 */
async function expectKeyIgnored(page: Page, code: string): Promise<void> {
  const before = await snapshot(page);
  await page.keyboard.down(code);
  // Let any (wrongly) triggered React flush / audio call land before asserting.
  await page.waitForTimeout(50);
  await expect(pressedKeys(page)).toHaveCount(0);
  const during = await snapshot(page);
  await page.keyboard.up(code);
  const after = await snapshot(page);

  expect(during.attacks).toBe(before.attacks);
  expect(after.attacks).toBe(before.attacks);
  expect(after.step).toBe(before.step);
  expect(during.sounding).toEqual([]);
}

/** Positive control: the same key, with the modal closed, really does play. */
async function expectKeyPlays(page: Page, code: string): Promise<void> {
  const before = await snapshot(page);
  await page.keyboard.down(code);
  await expect(pressedKeys(page)).not.toHaveCount(0);
  await page.keyboard.up(code);
  const after = await snapshot(page);
  expect(after.attacks).toBeGreaterThan(before.attacks);
  expect(after.step).toBe(before.step + 1);
}

async function overlayCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__playrightE2E!.getBlockingOverlayCount());
}

test.describe('modal input gate', () => {
  test('score library: one-hand note keys produce no audio and no step advance', async ({
    page,
  }) => {
    await loadAndStart(page, 'one-hand');
    const code = await expectedKey(page, 'one-hand');

    await page.evaluate(() => window.__playrightE2E!.openScoreLibrary());
    await expect(page.getByRole('dialog', { name: 'Scores' })).toBeVisible();
    await expectKeyIgnored(page, code);

    await page.evaluate(() => window.__playrightE2E!.closeScoreLibrary());
    await expect(page.getByRole('dialog', { name: 'Scores' })).toBeHidden();
    await expectKeyPlays(page, code);
  });

  test('score library: two-hand finger keys produce no audio, engine change, or depression', async ({
    page,
  }) => {
    await loadAndStart(page, 'two-hand');
    const code = await expectedKey(page, 'two-hand');

    await page.evaluate(() => window.__playrightE2E!.openScoreLibrary());
    await expect(page.getByRole('dialog', { name: 'Scores' })).toBeVisible();
    await expectKeyIgnored(page, code);

    await page.evaluate(() => window.__playrightE2E!.closeScoreLibrary());
    await expect(page.getByRole('dialog', { name: 'Scores' })).toBeHidden();
    await expectKeyPlays(page, code);
  });

  test('score library: practice shortcuts are gated, and C still closes it', async ({
    page,
  }) => {
    await loadAndStart(page, 'one-hand');
    expect(await page.evaluate(() => window.__playrightE2E!.isPracticeActive())).toBe(true);
    await page.evaluate(() => window.__playrightE2E!.openScoreLibrary());
    await expect(page.getByRole('dialog', { name: 'Scores' })).toBeVisible();

    // Space would pause the running practice session.
    await page.keyboard.press('Space');
    await expect(page.getByRole('dialog', { name: 'Scores' })).toBeVisible();
    // Practice still running: the shortcut never reached PracticeEngine.
    expect(await page.evaluate(() => window.__playrightE2E!.isPracticeActive())).toBe(true);

    await page.keyboard.press('c');
    await expect(page.getByRole('dialog', { name: 'Scores' })).toBeHidden();
    expect(await overlayCount(page)).toBe(0);
  });

  test('onboarding tutorial: one-hand note keys are gated', async ({ page }) => {
    await loadAndStart(page, 'one-hand');
    const code = await expectedKey(page, 'one-hand');

    await page.evaluate(() => window.__playrightE2E!.setTutorialOpen(true));
    await expect(page.getByTestId('onboarding-tutorial-panel')).toBeVisible();
    await expectKeyIgnored(page, code);

    await page.evaluate(() => window.__playrightE2E!.setTutorialOpen(false));
    await expect(page.getByTestId('onboarding-tutorial-panel')).toBeHidden();
    await expectKeyPlays(page, code);
  });

  test('key bindings editor: two-hand finger keys are gated', async ({ page }) => {
    await loadAndStart(page, 'two-hand');
    const code = await expectedKey(page, 'two-hand');

    await page.evaluate(() => window.__playrightE2E!.setKeyBindingEditorOpen(true));
    const editor = page.getByRole('dialog', { name: 'Two-hand key bindings' });
    await expect(editor).toBeVisible();
    await expectKeyIgnored(page, code);

    await page.evaluate(() => window.__playrightE2E!.setKeyBindingEditorOpen(false));
    await expect(editor).toBeHidden();
    await expectKeyPlays(page, code);
  });

  test('score summary: note keys are gated once the run summary is up', async ({ page }) => {
    await loadAndStart(page, 'one-hand');
    for (let note = 0; note < 3; note += 1) {
      await page.keyboard.press(await expectedKey(page, 'one-hand'));
    }
    const summary = page.getByRole('dialog', { name: 'Piece complete' });
    await expect(summary).toBeVisible();

    // Any scope key would sound if ungated; the piece's first key is in scope.
    const code = await page.evaluate(() => {
      const harness = window.__playrightE2E!;
      return harness.getPhysicalKeyForMidi(60) ?? harness.getPhysicalKeyForMidi(64);
    });
    expect(code).not.toBeNull();
    await expectKeyIgnored(page, code!);
  });

  for (const mode of ['one-hand', 'two-hand'] as const) {
    test(`${mode}: a key held when a modal opens is released, not hung`, async ({ page }) => {
      await loadAndStart(page, mode);
      const code = await expectedKey(page, mode);

      await page.keyboard.down(code);
      await expect(pressedKeys(page)).not.toHaveCount(0);
      expect((await snapshot(page)).sounding).not.toEqual([]);

      await page.evaluate(() => window.__playrightE2E!.openScoreLibrary());
      await expect(page.getByRole('dialog', { name: 'Scores' })).toBeVisible();

      // Released on open: silent and undepressed while the key is still down.
      await expect.poll(async () => (await snapshot(page)).sounding).toEqual([]);
      await expect(pressedKeys(page)).toHaveCount(0);

      await page.keyboard.up(code);
      await page.evaluate(() => window.__playrightE2E!.closeScoreLibrary());
      await expect(page.getByRole('dialog', { name: 'Scores' })).toBeHidden();
      expect((await snapshot(page)).sounding).toEqual([]);
      await expect(pressedKeys(page)).toHaveCount(0);
    });
  }
});
