import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServerInstance, SERVER_INFO } from './mcpServer.js';
import { dicomwebProxy } from './dicomweb/proxy.js';
import { ohifPlaceholder } from './ohif/placeholder.js';

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

// Map of transports keyed by their MCP session ID.
const transports: Record<string, StreamableHTTPServerTransport> = {};

export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Health check - for Fly.io / any uptime monitor.
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true, name: SERVER_INFO.name, version: SERVER_INFO.version });
  });

  // DICOMweb CORS proxy for OHIF -> any configured DICOMweb server.
  // Path shape: /dicomweb/{serverId}/{upstream-path-with-query}
  app.use('/dicomweb', dicomwebProxy);

  // OHIF static bundle. In U6 this is replaced by the real OHIF v3 build.
  // For now /ohif/viewer renders a placeholder that echoes its query params.
  app.get('/ohif/viewer', ohifPlaceholder);

  app.post('/mcp', handleMcpPost);
  app.get('/mcp', handleMcpGet);
  app.delete('/mcp', handleMcpDelete);

  return app;
}

async function handleMcpPost(req: Request, res: Response): Promise<void> {
  try {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
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
  app.listen(PORT, HOST, () => {
    console.log(`[${SERVER_INFO.name}] listening on http://${HOST}:${PORT}`);
    console.log(`  POST ${`http://${HOST}:${PORT}/mcp`}  (MCP Streamable HTTP)`);
    console.log(`  GET  ${`http://${HOST}:${PORT}/health`}`);
  });

  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
}
