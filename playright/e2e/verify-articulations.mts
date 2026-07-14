/**
 * One-off browser verification for Part A articulations + play-mode scheduling.
 * Run: npx tsx e2e/verify-articulations.mts  (with Vite already up, or this starts Chromium against playwright webServer via direct launch + VITE_E2E).
 */
import { chromium, expect } from '@playwright/test';
import { ARTICULATIONS_EXTENDED_MUSICXML } from '../src/core/parser/__fixtures__/articulations.musicxml.ts';

/** Extended articulations plus a fermata and a mid-score tempo change (no grace). */
const ARTICULATIONS_WITH_FERMATA_TEMPO = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Verify</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <direction placement="above">
        <direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type>
        <sound tempo="120"/>
      </direction>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>480</duration>
        <type>quarter</type>
        <notations><articulations><tenuto/></articulations></notations>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>480</duration>
        <type>quarter</type>
        <notations><articulations><staccatissimo/></articulations></notations>
      </note>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>480</duration>
        <type>quarter</type>
        <notations><articulations><detached-legato/></articulations></notations>
      </note>
      <note>
        <pitch><step>F</step><octave>4</octave></pitch>
        <duration>480</duration>
        <type>quarter</type>
        <notations>
          <articulations><strong-accent/></articulations>
          <fermata/>
        </notations>
      </note>
    </measure>
    <measure number="2">
      <direction placement="above">
        <direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>90</per-minute></metronome></direction-type>
        <sound tempo="90"/>
      </direction>
      <note>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>480</duration>
        <type>quarter</type>
        <notations><articulations><staccato/></articulations></notations>
      </note>
      <note>
        <pitch><step>A</step><octave>4</octave></pitch>
        <duration>480</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch><step>B</step><octave>4</octave></pitch>
        <duration>960</duration>
        <type>half</type>
      </note>
    </measure>
  </part>
</score-partwise>`;

async function main(): Promise<void> {
  const browser = await chromium.launch({
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();

  await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__playrightE2E), null, {
    timeout: 30_000,
  });
  await page.locator('body').click({ position: { x: 8, y: 8 } });

  // --- Part A fixture ---
  await page.evaluate(
    async (xml) => {
      await window.__playrightE2E!.loadXml(xml, 'articulations-extended');
    },
    ARTICULATIONS_EXTENDED_MUSICXML,
  );
  await expect(page.getByTestId('sheet-music').locator('svg').first()).toBeVisible({
    timeout: 30_000,
  });

  const durations = await page.evaluate(() =>
    window.__playrightE2E!.probePlayedDurations(),
  );
  console.log('[verify] Part A playedQn table:', JSON.stringify(durations, null, 2));

  const byPitch = Object.fromEntries(durations.map((d) => [d.pitch, d]));
  const tenuto = byPitch.C4!;
  const staccatissimo = byPitch.D4!;
  const detached = byPitch.E4!;
  const marcato = byPitch.F4!;
  const accent = byPitch.G4!; // plain accent — no duration effect
  const plain = byPitch.B4!;
  const staccatoMarcato = byPitch.C5!;

  expect(tenuto.hasTenuto).toBe(true);
  expect(tenuto.playedQn).toBeCloseTo(1, 5);

  expect(staccatissimo.hasStaccatissimo).toBe(true);
  expect(staccatissimo.playedQn).toBeCloseTo(0.265, 5);
  expect(staccatissimo.playedQn).toBeLessThan(0.5);

  expect(detached.hasDetachedLegato).toBe(true);
  expect(detached.playedQn).toBeCloseTo(0.715, 5);

  expect(marcato.hasMarcato).toBe(true);
  expect(marcato.playedQn).toBeCloseTo(0.665, 5);

  expect(staccatoMarcato.hasStaccato).toBe(true);
  expect(staccatoMarcato.playedQn).toBeCloseTo(0.465, 5);

  expect(staccatissimo.playedQn).toBeLessThan(staccatoMarcato.playedQn);
  expect(staccatoMarcato.playedQn).toBeLessThan(marcato.playedQn);
  expect(marcato.playedQn).toBeLessThan(detached.playedQn);
  expect(detached.playedQn).toBeLessThan(tenuto.playedQn);

  expect(accent.hasAccent).toBe(true);
  expect(accent.hasMarcato).toBeFalsy();
  expect(Math.abs(accent.playedQn - plain.playedQn)).toBeLessThan(0.01);

  const playResult = await page.evaluate(async () => {
    try {
      window.__playrightE2E!.setPlayMode(true);
      const t0 = performance.now();
      await window.__playrightE2E!.startPlayback();
      return {
        ok: true,
        ms: performance.now() - t0,
        active: window.__playrightE2E!.isPlaybackActive(),
        step: window.__playrightE2E!.getStepIndex(),
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
  console.log('[verify] startPlayback result', playResult);
  expect(playResult.ok).toBe(true);

  await expect
    .poll(
      async () => page.evaluate(() => window.__playrightE2E!.isPlaybackActive()),
      { timeout: 10_000 },
    )
    .toBe(true);
  console.log('[verify] playback active');

  // Advance past first note within a few seconds (not stalled at step 0).
  await expect
    .poll(async () => page.evaluate(() => window.__playrightE2E!.getStepIndex()), {
      timeout: 20_000,
    })
    .toBeGreaterThan(0);

  await expect
    .poll(async () => page.evaluate(() => window.__playrightE2E!.isPlaybackFinished()), {
      timeout: 60_000,
    })
    .toBe(true);
  console.log('[verify] Part A playback finished without stall');

  // --- Combined fermata + tempo map ---
  await page.evaluate(
    async (xml) => {
      window.__playrightE2E!.stopPlayback();
      await window.__playrightE2E!.loadXml(xml, 'articulations-fermata-tempo');
    },
    ARTICULATIONS_WITH_FERMATA_TEMPO,
  );
  await expect(page.getByTestId('sheet-music').locator('svg').first()).toBeVisible({
    timeout: 30_000,
  });

  const combined = await page.evaluate(() =>
    window.__playrightE2E!.probePlayedDurations(),
  );
  console.log('[verify] Combined playedQn table:', JSON.stringify(combined, null, 2));

  const marcatoFermata = combined.find((d) => d.pitch === 'F4')!;
  expect(marcatoFermata.hasMarcato).toBe(true);
  expect(marcatoFermata.hasFermata).toBe(true);
  expect(marcatoFermata.playedQn).toBeGreaterThan(0.665);
  expect(marcatoFermata.playedQn).toBeGreaterThan(1);

  await page.evaluate(async () => {
    window.__playrightE2E!.setPlayMode(true);
    await window.__playrightE2E!.startPlayback();
  });
  await expect
    .poll(async () => page.evaluate(() => window.__playrightE2E!.getStepIndex()), {
      timeout: 20_000,
    })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => page.evaluate(() => window.__playrightE2E!.isPlaybackFinished()), {
      timeout: 90_000,
    })
    .toBe(true);
  console.log('[verify] Combined fermata+tempo playback finished without stall');

  await browser.close();
  console.log('[verify] ALL OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
