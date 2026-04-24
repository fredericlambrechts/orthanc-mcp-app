import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServerInstance, SERVER_INFO } from './mcpServer.js';
import { dicomwebProxy } from './dicomweb/proxy.js';
import { ohifPlaceholder } from './ohif/placeholder.js';
import { createOhifStaticRouter, hasOhifBundle } from './ohif/static.js';
import { clearViewState } from './state/session.js';
import { getPublicOrigin } from './ui/resource.js';

function getPublicOriginSafe(): string {
  try {
    return getPublicOrigin();
  } catch {
    return '';
  }
}

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

// Map of transports keyed by their MCP session ID.
const transports: Record<string, StreamableHTTPServerTransport> = {};

export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Health check - for Fly.io / any uptime monitor.
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      name: SERVER_INFO.name,
      version: SERVER_INFO.version,
      ohif_bundled: hasOhifBundle(),
    });
  });

  // Static branding assets (Orthanc icon + wordmark, served to Claude.ai via
  // the `icons` field on `serverInfo`). Directory is committed at the project
  // root. Resolve with two candidates because server.js lives in a different
  // relative position depending on whether we're under tsx (src/server.ts ->
  // ../assets) or compiled (dist/server.js -> ../assets). Both resolve the
  // same /app/assets directory in the Fly.io image.
  const assetsDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../assets',
  );
  app.use(
    '/assets',
    express.static(assetsDir, {
      maxAge: '1d',
      etag: true,
      fallthrough: true,
    }),
  );

  // Favicon - serve the original Orthanc .ico directly (no redirect) because
  // many clients (including Claude.ai's connector UI) fetch /favicon.ico and
  // do not follow redirects.
  app.get('/favicon.ico', (_req, res) => {
    res.sendFile(resolve(assetsDir, 'orthanc-favicon.ico'), {
      headers: { 'Cache-Control': 'public, max-age=86400' },
    });
  });
  // Apple touch icon - iOS/macOS and some other clients fetch this.
  app.get('/apple-touch-icon.png', (_req, res) => {
    res.sendFile(resolve(assetsDir, 'orthanc-icon.png'), {
      headers: { 'Cache-Control': 'public, max-age=86400' },
    });
  });
  // Root landing page - minimal HTML with icon meta tags for clients that
  // scrape the origin root when rendering a connector card.
  app.get('/', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Orthanc DICOM Viewer - Claude MCP App</title>
  <meta name="description" content="View DICOM studies inline in Claude via the OHIF viewer. Powered by Orthanc. For demonstration, education, and non-diagnostic use only." />
  <link rel="icon" type="image/x-icon" href="/favicon.ico" />
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/orthanc-icon.png" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <meta property="og:title" content="Orthanc DICOM Viewer" />
  <meta property="og:description" content="View DICOM studies inline in Claude. Powered by Orthanc." />
  <meta property="og:image" content="${getPublicOriginSafe()}/assets/orthanc-wordmark.png" />
  <meta property="og:url" content="${getPublicOriginSafe()}/" />
  <meta property="og:type" content="website" />
  <style>
    body { font: 14px/1.5 -apple-system, Segoe UI, sans-serif; max-width: 640px; margin: 48px auto; padding: 0 16px; color: #222; }
    img { max-width: 320px; height: auto; }
    .disclaimer { color: #888; font-size: 12px; margin-top: 32px; font-style: italic; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
  </style>
</head>
<body>
  <img src="/assets/orthanc-wordmark.png" alt="Orthanc" />
  <h1>Orthanc DICOM Viewer</h1>
  <p>A Claude MCP App that embeds the OHIF DICOM viewer inline in chat. Paste any DICOMweb study link and the viewer renders.</p>
  <p>MCP endpoint: <code>/mcp</code> - see <a href="https://github.com/fredericlambrechts/orthanc-mcp-app">GitHub</a> for install instructions.</p>
  <p class="disclaimer">For demonstration, education, and non-diagnostic use only. Not a medical device. Powered by <a href="https://www.orthanc-server.com/">Orthanc</a>, the open-source DICOM server.</p>
</body>
</html>`);
  });

  // DICOMweb CORS proxy for OHIF -> any configured DICOMweb server.
  // Path shape: /dicomweb/{serverId}/{upstream-path-with-query}
  app.use('/dicomweb', dicomwebProxy);

  // OHIF static bundle. If ohif-dist/ is present (populated by
  // scripts/download-ohif.sh or a bundled build), serve it from /ohif/*.
  // Otherwise fall back to the placeholder that echoes query params.
  const ohifRouter = createOhifStaticRouter();
  if (ohifRouter) {
    app.use('/ohif', ohifRouter);
  } else {
    app.get('/ohif/viewer', ohifPlaceholder);
  }

  app.post('/mcp', handleMcpPost);
  app.get('/mcp', handleMcpGet);
  app.delete('/mcp', handleMcpDelete);

  // Alias routes. Claude.ai fingerprints connectors by URL and caches
  // serverInfo / session state per URL, so remove+re-add at the same URL
  // doesn't force a fresh initialize. Adding under a new path gives the
  // client a clean slate.
  app.post('/mcp-v2', handleMcpPost);
  app.get('/mcp-v2', handleMcpGet);
  app.delete('/mcp-v2', handleMcpDelete);

  return app;
}

async function handleMcpPost(req: Request, res: Response): Promise<void> {
  try {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    // Trace every inbound POST so we can tell whether the client is
    // re-initializing or reusing a cached session.
    console.log('[mcp-post]', JSON.stringify({
      method: req.body?.method,
      id: req.body?.id,
      hasSessionId: Boolean(sessionId),
      sessionKnown: Boolean(sessionId && transports[sessionId]),
      userAgent: req.headers['user-agent'],
    }));

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // One-time log of initialize params so we can see what clients advertise.
      console.log('[mcp-init]', JSON.stringify({
        userAgent: req.headers['user-agent'],
        clientInfo: req.body?.params?.clientInfo,
        capabilities: req.body?.params?.capabilities,
        protocolVersion: req.body?.params?.protocolVersion,
      }));
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string) => {
          transports[sid] = transport;
        },
      });
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) {
          delete transports[sid];
          clearViewState(sid);
        }
      };
      const server = createMcpServerInstance();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: no valid session id' },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : 'Internal server error',
        },
        id: null,
      });
    }
  }
}

async function handleMcpGet(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Bad Request: no active session' },
      id: null,
    });
    return;
  }
  await transports[sessionId].handleRequest(req, res);
}

async function handleMcpDelete(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Bad Request: no active session' },
      id: null,
    });
    return;
  }
  await transports[sessionId].handleRequest(req, res);
}

// Entry point - only run when executed directly (not imported by tests).
const isDirect =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('/server.ts') ||
  process.argv[1]?.endsWith('/server.js');

if (isDirect) {
  const app = createApp();
  const httpServer = app.listen(PORT, HOST, () => {
    console.log(`[${SERVER_INFO.name}] listening on http://${HOST}:${PORT}`);
    console.log(`  POST ${`http://${HOST}:${PORT}/mcp`}  (MCP Streamable HTTP)`);
    console.log(`  GET  ${`http://${HOST}:${PORT}/health`}`);
  });

  const GRACEFUL_SHUTDOWN_MS = 4_500; // Fly kill_timeout is 5s; leave a margin.

  async function gracefulShutdown(signal: string): Promise<void> {
    console.log(`[${SERVER_INFO.name}] ${signal} received, shutting down`);

    // Stop accepting new HTTP connections.
    httpServer.close((err) => {
      if (err) console.warn('[server] http close error', err);
    });

    // Close active MCP transports cleanly so clients see a proper EOF rather
    // than a socket reset mid-stream.
    const closes = Object.values(transports).map((t) =>
      Promise.resolve(t.close()).catch((err) => {
        console.warn('[server] transport close error', err);
      }),
    );
    await Promise.race([
      Promise.all(closes),
      new Promise<void>((resolve) => setTimeout(resolve, GRACEFUL_SHUTDOWN_MS)),
    ]);
    process.exit(0);
  }

  process.on('SIGTERM', () => {
    void gracefulShutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void gracefulShutdown('SIGINT');
  });
}
