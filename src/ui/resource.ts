import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppResource } from '@modelcontextprotocol/ext-apps/server';

export const UI_RESOURCE_URI = 'ui://viewer-v12';

// Production build output from `npm run build:ui`. Located one level up from
// the compiled src/ui/ directory: `dist/ui/index.html`.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path candidates for the built widget bundle. Vite outputs to dist/widget/
// (separate from dist/ui/ which holds compiled TS):
//   - Production (compiled): dist/ui/resource.js -> ../widget/index.html
//   - Development (tsx):     src/ui/resource.ts  -> ../../dist/widget/index.html
const PROD_WIDGET_PATH = resolve(__dirname, '../widget/index.html');
const DEV_WIDGET_PATH = resolve(__dirname, '../../dist/widget/index.html');

const FALLBACK_HTML = `<!doctype html>
<html>
<head><meta charset="UTF-8"><title>DICOM viewer</title></head>
<body style="background:#111;color:#ddd;font-family:system-ui;padding:32px">
  <h1>Widget bundle not built</h1>
  <p>Run <code>npm run build:ui</code> to generate the widget bundle, then
     restart the MCP server.</p>
  <p style="color:#999;font-size:12px">For demonstration, education, and
     non-diagnostic use only.</p>
</body>
</html>`;

export async function loadWidgetHtml(): Promise<string> {
  for (const path of [PROD_WIDGET_PATH, DEV_WIDGET_PATH]) {
    try {
      const html = await readFile(path, 'utf8');
      // Source HTML references `/src/widget.ts` which only resolves under
      // Vite's dev server, not as a static page. Detect that and skip.
      if (/\/src\/widget\.ts/.test(html)) continue;
      return html;
    } catch {
      // try next
    }
  }
  return FALLBACK_HTML;
}

/**
 * Registers the `ui://viewer` resource on the given MCP server.
 *
 * The resource body is the built HTML bundle from `dist/ui/index.html`.
 * Served as mimeType `text/html;profile=mcp-app` per the MCP Apps spec.
 *
 * CSP:
 *   - resourceDomains/connectDomains/frameDomains: only our own origin.
 *     No third-party CDN; OHIF is self-hosted under `/ohif/*`.
 */
/**
 * Returns the public origin of the MCP server, e.g. `https://orthanc-mcp-app.fly.dev`.
 * Pulled from PUBLIC_ORIGIN env var. Falls back to localhost for local dev.
 *
 * In production (`NODE_ENV=production`) we refuse to fall back: an unset or
 * malformed PUBLIC_ORIGIN means the widget CSP would point at localhost and
 * the browser would block every request from the Claude host. Failing fast
 * at startup is louder than a silently broken demo.
 */
export function getPublicOrigin(): string {
  const raw = process.env.PUBLIC_ORIGIN?.trim();
  if (raw && /^https?:\/\/[^\s/]+\/?$/.test(raw)) {
    return raw.replace(/\/+$/, '');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'PUBLIC_ORIGIN is missing or malformed. Set it to the https:// URL of this deploy before start (e.g. `fly secrets set PUBLIC_ORIGIN=https://orthanc-mcp-app.fly.dev`).',
    );
  }
  const port = process.env.PORT ?? '3000';
  return `http://localhost:${port}`;
}

export function registerViewerResource(
  server: Pick<McpServer, 'registerResource'>,
): void {
  registerAppResource(
    server,
    'DICOM Viewer',
    UI_RESOURCE_URI,
    {
      description:
        'Embedded OHIF DICOM viewer. Loaded in-place when tools like open_study execute. For demonstration, education, and non-diagnostic use only.',
    },
    async () => {
      const html = await loadWidgetHtml();
      const origin = getPublicOrigin();
      return {
        contents: [
          {
            uri: UI_RESOURCE_URI,
            mimeType: 'text/html;profile=mcp-app',
            text: html,
            _meta: {
              ui: {
                csp: {
                  // Single-origin CSP: all assets and fetches go back to our Fly.io server.
                  // This is Path A from the plan: OHIF is self-hosted at /ohif/*, DICOMweb
                  // proxied at /dicomweb/*. No third-party CDN.
                  resourceDomains: [origin],
                  connectDomains: [origin],
                  frameDomains: [origin],
                },
              },
            },
          },
        ],
      };
    },
  );
}
