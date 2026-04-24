/**
 * End-to-end: load the widget the way Claude loads it — inside a sandboxed
 * iframe — and verify that the rendered PNG image actually appears in the
 * widget body after we push it a synthetic tool-result.
 *
 * Claude's MCP Apps runtime:
 *   1. Fetches the widget HTML via `resources/read ui://viewer-v12`.
 *   2. Renders it in an iframe with sandbox="allow-scripts allow-same-origin
 *      allow-forms" under COEP: require-corp.
 *   3. Talks to the widget via postMessage using the MCP UI protocol.
 *
 * This test approximates (2) + (3) locally: a Playwright harness page opens
 * the widget in a sandboxed iframe and plays the ext-apps protocol
 * (ui/initialize → ui/notifications/tool-result with an open_study payload).
 * It then waits for the widget to fetch an <img> from /render/... and
 * verifies that PNG actually loaded.
 *
 * Writes tmp/brainix-widget-sandboxed.png as forensic evidence either way.
 *
 *   E2E=1 npx vitest run test/e2e/ohif-widget-sandboxed.e2e.test.ts
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const TARGET = process.env.TARGET_ORIGIN ?? 'https://orthanc-mcp-app.fly.dev';
const BRAINIX_STUDY_UID = '2.16.840.1.113669.632.20.1211.10000357775';
const TMP_DIR = resolve(process.cwd(), 'tmp');

const shouldRun = process.env.E2E === '1';

function harnessHtml(widgetUrl: string, studyUid: string, origin: string) {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>widget harness</title>
<style>
  html, body { margin:0; padding:0; background:#222; color:#eee; font-family: system-ui; }
  iframe { width: 100%; height: 100vh; border: 0; background: #000; display: block; }
</style>
</head>
<body>
  <iframe
    id="widget"
    src="${widgetUrl}"
    sandbox="allow-scripts allow-same-origin allow-forms"
  ></iframe>
<script>
  window.__harness = { messages: [], events: [], toolSent: false };
  const widget = document.getElementById('widget');

  const OPEN_STUDY_RESULT = {
    jsonrpc: '2.0',
    method: 'ui/notifications/tool-result',
    params: {
      content: [{ type: 'text', text: 'open_study result' }],
      structuredContent: {
        study_uid: ${JSON.stringify(studyUid)},
        server_id: 'orthanc-demo',
        reference_kind: 'bare_uid',
        ui_resource: 'ui://viewer-v12',
        ui_meta: {
          resourceUri: 'ui://viewer-v12',
          initialData: {
            studyUid: ${JSON.stringify(studyUid)},
            seriesUid: null,
            dicomwebBaseUrl: ${JSON.stringify(origin + '/dicomweb/orthanc-demo')},
            ohifBasePath: ${JSON.stringify(origin + '/ohif/viewer')},
          },
        },
      },
    },
  };

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m || m.jsonrpc !== '2.0') return;
    window.__harness.messages.push({
      method: m.method, id: m.id, hasResult: !!m.result, hasError: !!m.error,
    });

    if (m.method === 'ui/initialize') {
      widget.contentWindow.postMessage({
        jsonrpc: '2.0',
        id: m.id,
        result: {
          protocolVersion: '2026-01-26',
          hostInfo: { name: 'e2e-harness', version: '0.0.1' },
          hostCapabilities: {},
          hostContext: {
            displayMode: 'inline',
            availableDisplayModes: ['inline'],
            theme: 'dark',
          },
        },
      }, '*');
    }

    if (m.method === 'ui/notifications/initialized') {
      setTimeout(() => {
        widget.contentWindow.postMessage(OPEN_STUDY_RESULT, '*');
        window.__harness.toolSent = true;
      }, 200);
    }
  });
</script>
</body>
</html>`;
}

describe.skipIf(!shouldRun)('widget inline render', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
    await mkdir(TMP_DIR, { recursive: true });

    page.on('pageerror', (err) => {
      // eslint-disable-next-line no-console
      console.log('[page:error]', err.message);
    });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  test('widget fetches /render PNG and loads it into the inline <img>', async () => {
    const widgetUrl = `${TARGET}/widget.html`;
    const harness = harnessHtml(widgetUrl, BRAINIX_STUDY_UID, TARGET);

    // Track completed responses for the /render/... PNG endpoint. That's
    // our proof the widget actually asked the server for pixels.
    const renderResponses: Array<{ url: string; status: number; bytes: number }> = [];
    page.on('response', async (res) => {
      const url = res.url();
      if (url.includes('/render/') && url.endsWith('.png')) {
        try {
          const body = await res.body();
          renderResponses.push({ url, status: res.status(), bytes: body.byteLength });
        } catch {
          renderResponses.push({ url, status: res.status(), bytes: -1 });
        }
      }
    });

    // Serve harness with COEP so we mirror Claude's widget host.
    await page.route('http://example.test/harness', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        headers: {
          'Cross-Origin-Embedder-Policy': 'require-corp',
          'Cross-Origin-Opener-Policy': 'same-origin',
        },
        body: harness,
      }),
    );
    await page.goto('http://example.test/harness', { waitUntil: 'domcontentloaded' });

    // Wait for a render response of non-trivial size. 4 KB is well below a
    // real PNG (they're >>30 KB for 16-bit MR) and well above any error
    // payload.
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const good = renderResponses.find((r) => r.status === 200 && r.bytes > 4_000);
      if (good) break;
      await page.waitForTimeout(500);
    }

    const pngPath = resolve(TMP_DIR, 'brainix-widget-sandboxed.png');
    const bytes = await page.screenshot({ fullPage: false });
    await writeFile(pngPath, bytes);
    // eslint-disable-next-line no-console
    console.log(`[e2e] wrote screenshot to ${pngPath} (${bytes.byteLength} bytes)`);
    // eslint-disable-next-line no-console
    console.log('[e2e] /render responses:', JSON.stringify(renderResponses, null, 2));

    // Handshake plays.
    const diag = (await page.evaluate(() =>
      (window as unknown as { __harness: { messages: { method: string }[] } })
        .__harness,
    )) as { messages: { method: string }[] };
    const methods = diag.messages.map((m) => m.method).filter(Boolean);
    expect(methods).toContain('ui/initialize');
    expect(methods).toContain('ui/notifications/initialized');

    // And a render PNG actually came down the wire — which means the widget
    // parsed the tool result, called DICOMweb, picked a series, and asked
    // our server for the first slice.
    const good = renderResponses.find((r) => r.status === 200 && r.bytes > 4_000);
    expect(good, `expected a successful /render PNG; saw ${JSON.stringify(renderResponses)}`).toBeTruthy();
    expect(good!.bytes).toBeGreaterThan(4_000);
  }, 120_000);
});
