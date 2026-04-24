/**
 * End-to-end: load the widget the way Claude loads it — inside a sandboxed
 * iframe with `allow-scripts allow-same-origin allow-forms` — and check
 * whether the nested OHIF iframe renders DICOM pixels.
 *
 * Claude.ai's MCP Apps runtime:
 *   1. Fetches the widget HTML via `resources/read ui://viewer-v5`.
 *   2. Renders it in an iframe with sandbox="allow-scripts allow-same-origin
 *      allow-forms" on a claudemcpcontent.com sandbox-CDN origin.
 *   3. Talks to the widget via postMessage following the MCP UI protocol.
 *
 * This test approximates (2) + (3) locally: a Playwright harness page opens
 * the widget in a sandboxed iframe and plays the ext-apps protocol
 * (ui/initialize handshake → ui/notifications/tool-result with an open_study
 * result). It then waits to see if the widget loads the nested OHIF iframe
 * and whether OHIF paints pixels on its canvas.
 *
 * Writes tmp/brainix-widget-sandboxed.png either way — a failing render is
 * useful forensic evidence. Run with:
 *
 *   E2E=1 npx vitest run test/e2e/ohif-widget-sandboxed.e2e.test.ts
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const TARGET =
  process.env.TARGET_ORIGIN ?? 'https://orthanc-mcp-app.fly.dev';
const BRAINIX_STUDY_UID = '2.16.840.1.113669.632.20.1211.10000357775';
const TMP_DIR = resolve(process.cwd(), 'tmp');

const shouldRun = process.env.E2E === '1';

/**
 * HTML for the harness page. Hosts the widget in a sandboxed iframe,
 * listens for its ui/initialize request, responds with a fake
 * hostContext that advertises fullscreen display mode, then pushes a
 * tool-result that carries the open_study payload.
 *
 * Exposes `window.__harness.diag()` which returns a diagnostic snapshot
 * the test polls for.
 */
function harnessHtml(widgetUrl: string, studyUid: string, origin: string) {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>widget sandbox harness</title>
<style>
  html, body { margin: 0; padding: 0; background: #222; color: #eee; font-family: system-ui; }
  iframe { width: 100%; height: 100vh; border: 0; background: #000; display: block; }
  #log { position: fixed; top: 0; left: 0; background: rgba(0,0,0,0.6); padding: 4px 8px; font: 11px ui-monospace, monospace; z-index: 99; max-width: 40vw; max-height: 40vh; overflow: auto; }
</style>
</head>
<body>
  <div id="log"></div>
  <iframe
    id="widget"
    src="${widgetUrl}"
    sandbox="allow-scripts allow-same-origin allow-forms"
    allow="fullscreen *"
  ></iframe>
<script>
  const log = (...a) => {
    const s = a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ');
    const el = document.getElementById('log');
    el.textContent += s + '\\n';
    console.log('[harness]', s);
  };
  window.__harness = { messages: [], events: [], toolSent: false };
  const widget = document.getElementById('widget');

  // Protocol: ui/initialize → reply with hostCapabilities. Then push a
  // tool-result with our open_study structuredContent.
  const OPEN_STUDY_RESULT = {
    jsonrpc: '2.0',
    method: 'ui/notifications/tool-result',
    params: {
      content: [{ type: 'text', text: 'open_study result' }],
      structuredContent: {
        study_uid: ${JSON.stringify(studyUid)},
        server_id: 'orthanc-demo',
        reference_kind: 'bare_uid',
        ui_resource: 'ui://viewer-v5',
        ui_meta: {
          resourceUri: 'ui://viewer-v5',
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
    log('recv', m.method || 'response', 'id=' + (m.id ?? '-'));

    if (m.method === 'ui/initialize') {
      // Reply with a canned hostContext. availableDisplayModes includes
      // fullscreen so the widget's requestDisplayMode call resolves.
      widget.contentWindow.postMessage({
        jsonrpc: '2.0',
        id: m.id,
        result: {
          protocolVersion: '2026-01-26',
          hostInfo: { name: 'e2e-harness', version: '0.0.1' },
          hostCapabilities: {},
          hostContext: {
            displayMode: 'inline',
            availableDisplayModes: ['inline', 'fullscreen'],
            theme: 'dark',
          },
        },
      }, '*');
      log('replied to ui/initialize');
    }

    if (m.method === 'ui/notifications/initialized') {
      // Widget handshake complete. Send it a fake tool-result so it loads
      // the study.
      setTimeout(() => {
        widget.contentWindow.postMessage(OPEN_STUDY_RESULT, '*');
        window.__harness.toolSent = true;
        log('sent open_study tool-result');
      }, 200);
    }

    if (m.method === 'ui/request-display-mode') {
      widget.contentWindow.postMessage({
        jsonrpc: '2.0',
        id: m.id,
        result: { mode: m.params?.mode ?? 'inline' },
      }, '*');
    }
  });

  window.__harness.diag = async () => {
    const out = {
      url: widget.src,
      sandbox: Array.from(widget.sandbox).join(' '),
      messages: window.__harness.messages,
      toolSent: window.__harness.toolSent,
    };
    // Try to inspect the widget's body (only works if same-origin sandbox)
    try {
      const doc = widget.contentDocument;
      out.widgetDocAccessible = !!doc;
      if (doc) {
        const placeholder = doc.getElementById('placeholder');
        const viewer = doc.getElementById('viewer');
        out.placeholderHidden = placeholder?.classList.contains('hidden');
        out.viewerSrc = viewer?.src || null;
        out.diagText = doc.getElementById('diag')?.innerText || null;
        // Walk into the OHIF iframe
        const ohifDoc = viewer?.contentDocument;
        out.ohifDocAccessible = !!ohifDoc;
        if (ohifDoc) {
          const cs = Array.from(ohifDoc.querySelectorAll('canvas'));
          out.ohifCanvases = cs.length;
          if (cs[0]) {
            out.canvasDims = { w: cs[0].width, h: cs[0].height };
            try {
              const ctx = cs[0].getContext('2d', { willReadFrequently: true });
              if (ctx) {
                const cw = cs[0].width, ch = cs[0].height;
                const sw = Math.min(64, cw), sh = Math.min(64, ch);
                const data = ctx.getImageData(Math.floor((cw - sw) / 2), Math.floor((ch - sh) / 2), sw, sh).data;
                let nz = 0;
                for (let i = 0; i < data.length; i += 4) {
                  if (data[i] > 8 || data[i + 1] > 8 || data[i + 2] > 8) nz++;
                }
                out.canvasNonZero = nz;
              }
            } catch (e) { out.canvasReadError = String(e); }
          }
        }
      }
    } catch (e) { out.probeError = String(e); }
    return out;
  };
</script>
</body>
</html>`;
}

describe.skipIf(!shouldRun)('widget sandbox harness', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await mkdir(TMP_DIR, { recursive: true });

    // Surface only errors; OHIF logs a lot of noise otherwise.
    page.on('pageerror', (err) => {
      // eslint-disable-next-line no-console
      console.log('[page:error]', err.message);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        // eslint-disable-next-line no-console
        console.log('[page:error]', msg.text());
      }
    });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  test('widget in sandboxed iframe loads OHIF and renders BRAINIX pixels (with Claude-style COEP)', async () => {
    const widgetUrl = `${TARGET}/widget.html`;
    const harness = harnessHtml(widgetUrl, BRAINIX_STUDY_UID, TARGET);
    // Serve the harness page with Cross-Origin-Embedder-Policy: require-corp.
    // Claude's MCP Apps frame appears to enforce this. Without it, the
    // widget's nested OHIF iframe loads fine; with it, every cross-origin
    // subresource must respond with Cross-Origin-Resource-Policy or Chrome
    // refuses to load it (surfacing as "This content is blocked. Contact
    // the site owner to fix the issue." in the user's face).
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

    // Watch the page console for the OHIF log line that fires after OHIF
    // has loaded its first display set. That's the most reliable signal we
    // can observe from outside the cross-origin widget.
    const ohifRenderedEvents: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (
        /displaySetsToFirstImage|studyToFirstImage|ProtocolEngine::matchImages bestMatch/.test(
          text,
        )
      ) {
        ohifRenderedEvents.push(text);
      }
    });

    // Poll harness diag for the widget handshake state (synchronous over
    // postMessage) and wait for the OHIF render signal above.
    let finalDiag: Record<string, unknown> | null = null;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      finalDiag = (await page.evaluate(() =>
        (window as unknown as { __harness: { diag(): Promise<unknown> } })
          .__harness.diag(),
      )) as Record<string, unknown>;
      if (ohifRenderedEvents.length >= 1) break;
      await page.waitForTimeout(500);
    }

    // Save the screenshot regardless of pass/fail so the human has forensic
    // evidence when the render fails.
    const pngPath = resolve(TMP_DIR, 'brainix-widget-sandboxed.png');
    const bytes = await page.screenshot({ fullPage: false });
    await writeFile(pngPath, bytes);
    // eslint-disable-next-line no-console
    console.log(`[e2e] wrote screenshot to ${pngPath} (${bytes.byteLength} bytes)`);
    // eslint-disable-next-line no-console
    console.log('[e2e] final diag:', JSON.stringify(finalDiag, null, 2));
    // eslint-disable-next-line no-console
    console.log('[e2e] ohif render events:', ohifRenderedEvents.length);

    expect(finalDiag).toBeTruthy();
    const methods = (finalDiag as { messages: { method: string }[] }).messages
      .map((m) => m.method)
      .filter(Boolean);
    expect(methods).toContain('ui/initialize');
    expect(methods).toContain('ui/notifications/initialized');
    // The hard assertion: OHIF actually booted up to the point of matching
    // images and painting the first display set. If this is zero the widget
    // either failed to mount OHIF or the nested iframe was blocked before
    // OHIF's JS ran. Either case is a regression.
    expect(ohifRenderedEvents.length).toBeGreaterThan(0);
  }, 120_000);
});
