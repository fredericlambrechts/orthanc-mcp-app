/**
 * End-to-end: the production OHIF bundle, loaded directly, renders the
 * BRAINIX study's MR pixels. This is the ground-truth test — if it fails,
 * nothing about the inline-in-Claude flow can work either.
 *
 * Runs a real headless Chromium against the deployed Fly instance. Saves a
 * screenshot to tmp/brainix-standalone.png so a human can eyeball it after
 * the run. Asserts the viewport canvas is populated with non-zero pixels so
 * the test fails loud if OHIF boots but never paints the image.
 *
 * This test is gated behind E2E=1 because:
 *   - it's slow (Chromium boot + real network + DICOM fetch = ~15s)
 *   - it hits a live deployment
 * Run with: `E2E=1 npx vitest run test/e2e/ohif-standalone.e2e.test.ts`
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const TARGET =
  process.env.TARGET_ORIGIN ?? 'https://orthanc-mcp-app.fly.dev';
// BRAINIX multi-sequence brain MR on the Orthanc demo server. Resolved via
// `GET /dicomweb/orthanc-demo/studies?PatientName=BRAINIX` on 2026-04-24.
const BRAINIX_STUDY_UID = '2.16.840.1.113669.632.20.1211.10000357775';

const TMP_DIR = resolve(process.cwd(), 'tmp');

const shouldRun = process.env.E2E === '1';

describe.skipIf(!shouldRun)('OHIF standalone renders BRAINIX', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await mkdir(TMP_DIR, { recursive: true });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  test('BRAINIX study loads and the viewport canvas paints non-zero pixels', async () => {
    const url = `${TARGET}/ohif/viewer?StudyInstanceUIDs=${BRAINIX_STUDY_UID}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // Dismiss the "OHIF Viewer is for investigational use only" banner so it
    // doesn't overlap the screenshot.
    const confirm = page.getByRole('button', { name: /confirm and hide/i });
    try {
      await confirm.click({ timeout: 8_000 });
    } catch {
      // Banner may already be dismissed from a previous session; that's fine.
    }

    // Wait for OHIF to mount its cornerstone viewport canvas and paint real
    // pixel data. Poll until a canvas reports a non-trivial set of non-zero
    // pixels (a fresh OHIF viewport is solid black before the image loads).
    const pixelSummary = await page.waitForFunction(
      () => {
        const c = document.querySelector('canvas');
        if (!c || !c.width || !c.height) return false;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (!ctx) return false;
        // Sample a small centered region to keep this cheap.
        const sampleW = Math.min(128, c.width);
        const sampleH = Math.min(128, c.height);
        const data = ctx.getImageData(
          Math.floor((c.width - sampleW) / 2),
          Math.floor((c.height - sampleH) / 2),
          sampleW,
          sampleH,
        ).data;
        let nonZero = 0;
        for (let i = 0; i < data.length; i += 4) {
          // R, G, B — skip alpha at i+3
          if (data[i] > 8 || data[i + 1] > 8 || data[i + 2] > 8) nonZero++;
        }
        if (nonZero < 200) return false;
        return { w: c.width, h: c.height, nonZero, sampled: sampleW * sampleH };
      },
      { timeout: 45_000, polling: 500 },
    );

    const summary = await pixelSummary.jsonValue();
    expect(summary).toBeTruthy();
    expect((summary as { nonZero: number }).nonZero).toBeGreaterThan(200);

    const pngPath = resolve(TMP_DIR, 'brainix-standalone.png');
    const bytes = await page.screenshot({ fullPage: false });
    await writeFile(pngPath, bytes);
    // Readable log so the human can find the artifact after the run.
    // eslint-disable-next-line no-console
    console.log(`[e2e] wrote screenshot to ${pngPath} (${bytes.byteLength} bytes)`);
    expect(bytes.byteLength).toBeGreaterThan(20_000);
  }, 90_000);
});
