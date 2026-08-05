/** TEMP DIAGNOSTIC - delete after the audio-cutout investigation. */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DENSE = fileURLToPath(
  new URL(
    '../src/assets/if-i-can-stop-one-heart-from-breaking-hoyo-mix.musicxml',
    import.meta.url,
  ),
);

test('diag: audio-thread RMS + scheduled attacks over a dense playthrough', async ({
  page,
}) => {
  test.setTimeout(900_000);

  const t0 = Date.now();
  const warnings: string[] = [];
  page.on('console', (msg) => {
    const t = msg.text();
    if (
      /polyphony|stalled|clamped|out-of-order|jump-boundary|skipped|TEMP worklet|AudioEngine/i.test(
        t,
      )
    ) {
      warnings.push(
        `${((Date.now() - t0) / 1000).toFixed(1)}s [${msg.type()}] ${t.slice(0, 200)}`,
      );
    }
  });

  const cdp = await page.context().newCDPSession(page);
  const throttle = Number(process.env.DIAG_CPU_THROTTLE ?? '1');
  const pauseAt = (process.env.DIAG_PAUSE_AT ?? '')
    .split(',')
    .filter(Boolean)
    .map(Number);
  console.log('CPU THROTTLE', throttle, 'PAUSE AT', pauseAt);

  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__playrightE2E));
  await page.mouse.click(5, 5);

  const xml = readFileSync(DENSE, 'utf8');
  await page.evaluate(async (x) => {
    await window.__playrightE2E!.loadXml(x, 'dense');
  }, xml);

  await page.waitForFunction(
    () => Array.isArray((window as never as { __audioTrace?: unknown[] }).__audioTrace),
    undefined,
    { timeout: 180_000 },
  );

  console.log('TOTAL STEPS', await page.evaluate(() => window.__playrightE2E!.getTotalSteps()));
  await page.evaluate(() => window.__playrightE2E!.setPlayMode(true));

  if (throttle > 1) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }
  await page.evaluate(async () => {
    await window.__playrightE2E!.startPlayback();
  });

  // Wait it out, injecting pause/resume cycles at the requested wall seconds.
  for (let sec = 0; sec < 400; sec += 1) {
    if (pauseAt.includes(sec)) {
      console.log(`PAUSE/RESUME at t=${sec}s`);
      await page.evaluate(() => window.__playrightE2E!.pausePlayback());
      await page.waitForTimeout(1500);
      await page.evaluate(() => window.__playrightE2E!.resumePlayback());
    }
    if (sec % 5 === 0) {
      const done = await page.evaluate(() =>
        window.__playrightE2E!.isPlaybackFinished(),
      );
      if (done) {
        console.log('FINISHED at wall', sec, 's');
        break;
      }
    }
    await page.waitForTimeout(1000);
  }

  const audio = (await page.evaluate(
    () => (window as never as { __audioTrace: Array<[number, number]> }).__audioTrace,
  )) as Array<[number, number]>;
  const attacks = (await page.evaluate(
    () =>
      (window as never as { __attackTrace: Array<[number, number, number]> })
        .__attackTrace,
  )) as Array<[number, number, number]>;

  console.log('audio buckets', audio.length, 'attacks', attacks.length);
  console.log('WARNINGS', warnings.length);
  for (const w of warnings.slice(0, 40)) console.log(' ', w);
  if (audio.length === 0) {
    throw new Error('no audio-thread trace captured');
  }

  // Bucket both traces on the SAME audio clock, 2s wide.
  const base = Math.floor(audio[0][0]);
  const bucketOf = (t: number) => Math.floor((t - base) / 2);
  const lastBucket = bucketOf(audio[audio.length - 1][0]);

  const peak = new Array<number>(lastBucket + 1).fill(0);
  const mean = new Array<number>(lastBucket + 1).fill(0);
  const n = new Array<number>(lastBucket + 1).fill(0);
  const alive = new Array<number>(lastBucket + 1).fill(0);
  const ctxTo = new Array<number>(lastBucket + 1).fill(0);
  for (const row of audio as unknown as Array<
    [number, number, number, number, number]
  >) {
    const [t, r, a, to] = row;
    const b = bucketOf(t);
    if (b < 0 || b > lastBucket) continue;
    peak[b] = Math.max(peak[b], r);
    mean[b] += r;
    n[b] += 1;
    alive[b] = Math.max(alive[b], a);
    ctxTo[b] = Math.max(ctxTo[b], to);
  }

  const atk = new Array<number>(lastBucket + 1).fill(0);
  let lateAttacks = 0;
  for (const [t, , lead] of attacks) {
    const b = bucketOf(t);
    if (b >= 0 && b <= lastBucket) atk[b] += 1;
    if (lead < 0) lateAttacks += 1;
  }

  console.log('LATE (past-dated) attacks:', lateAttacks, 'of', attacks.length);
  console.log('bucket(2s)\tpeakRMS\tmeanRMS\tattacks\taliveVoices\tctxTimeouts');
  for (let b = 0; b <= lastBucket; b += 1) {
    console.log(
      [
        (b * 2).toFixed(0),
        peak[b].toFixed(4),
        (n[b] ? mean[b] / n[b] : 0).toFixed(4),
        atk[b],
        alive[b],
        ctxTo[b],
      ].join('\t'),
    );
  }
  console.log(
    'FINAL voice counters',
    JSON.stringify(
      await page.evaluate(
        () => (window as never as { __voiceCounters: unknown }).__voiceCounters,
      ),
    ),
  );

  // Silent buckets that still had attacks scheduled == the reported symptom.
  const silentWithAttacks = peak
    .map((p, b) => ({ b, p, a: atk[b] }))
    .filter((x) => x.a > 0 && x.p < 0.002);
  console.log(
    'SILENT-BUT-SCHEDULED buckets:',
    JSON.stringify(silentWithAttacks.map((x) => [x.b * 2, x.a, +x.p.toFixed(5)])),
  );
  console.log('WARNINGS', warnings.length);
  for (const w of warnings.slice(0, 40)) console.log(' ', w);

  expect(audio.length).toBeGreaterThan(0);
});
