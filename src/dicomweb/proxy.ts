import { type NextFunction, type Request, type Response } from 'express';
import { getServerById } from '../config.js';

// Headers we never forward from the inbound request to the upstream server.
// - authorization: safety rail for v1, we only talk to anonymous DICOMweb endpoints
// - host, connection, content-length: hop-by-hop or rewritten by fetch
// - cookie: belongs to the Claude host origin, irrelevant upstream
const INBOUND_HEADER_BLOCKLIST = new Set([
  'authorization',
  'host',
  'connection',
  'content-length',
  'cookie',
  'origin',
  'referer',
  'mcp-session-id',
]);

// Headers we never forward from the upstream response to our client.
// Node 22's fetch (undici) auto-decompresses, so content-encoding and
// content-length from upstream no longer describe the bytes we'll stream.
const UPSTREAM_HEADER_BLOCKLIST = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-max-age',
  'access-control-expose-headers',
]);

export function buildUpstreamHeaders(
  inbound: NodeJS.Dict<string | string[]>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(inbound)) {
    if (value === undefined) continue;
    if (INBOUND_HEADER_BLOCKLIST.has(key.toLowerCase())) continue;
    out[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

function applyCorsHeaders(res: Response): void {
  // TODO(U6): tighten to the Claude host iframe origin once we have a stable value.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Accept, Content-Type, Cache-Control',
  );
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Content-Type, Content-Length, ETag',
  );
  // Let intermediate caches vary on origin.
  res.setHeader('Vary', 'Origin');
}

/**
 * DICOMweb proxy handler.
 *
 * Expects to be mounted at a path prefix (e.g. `/dicomweb`). The remaining URL
 * has shape `/{serverId}/{upstream-path-with-query}`. The upstream URL is
 * constructed by concatenating the server's configured `base_url` with the
 * remaining path.
 *
 * Guarantees:
 * - Inbound `Authorization` headers are stripped before forwarding
 * - CORS headers are applied to every response (including 4xx/5xx)
 * - `OPTIONS` preflight is answered inline with 204
 * - Response body is streamed back without buffering
 */
export async function dicomwebProxy(
  req: Request,
  res: Response,
  _next: NextFunction,
): Promise<void> {
  if (req.method === 'OPTIONS') {
    applyCorsHeaders(res);
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    applyCorsHeaders(res);
    res.status(405).json({
      error: 'Method Not Allowed',
      message: 'v1 proxy supports GET and OPTIONS only',
    });
    return;
  }

  // req.url is mount-relative (e.g. "/orthanc-demo/studies?limit=5")
  const pathPart = req.url ?? '';
  const match = pathPart.match(/^\/([^/?#]+)((?:\/[^?#]*)?)(\?.*)?$/);
  if (!match) {
    applyCorsHeaders(res);
    res.status(400).json({
      error: 'Bad Request',
      message: 'Expected path shape /{serverId}/...',
    });
    return;
  }
  const serverId = match[1];
  const upstreamPath = match[2] || '/';
  const upstreamQuery = match[3] || '';

  const serverConfig = getServerById(serverId);
  if (!serverConfig) {
    applyCorsHeaders(res);
    res.status(404).json({
      error: 'Not Found',
      message: `Unknown DICOMweb server id: ${serverId}`,
    });
    return;
  }

  const base = serverConfig.base_url.replace(/\/+$/, '');
  const targetUrl = base + upstreamPath + upstreamQuery;

  const headers = buildUpstreamHeaders(req.headers);

  let upstreamRes: Response | globalThis.Response;
  try {
    upstreamRes = await fetch(targetUrl, {
      method: req.method,
      headers,
      redirect: 'follow',
    });
  } catch (err) {
    applyCorsHeaders(res);
    if (!res.headersSent) {
      res.status(502).json({
        error: 'Bad Gateway',
        message: err instanceof Error ? err.message : 'Upstream fetch failed',
        target: targetUrl,
      });
    } else {
      res.end();
    }
    return;
  }

  applyCorsHeaders(res);
  res.status(upstreamRes.status);

  (upstreamRes as globalThis.Response).headers.forEach(
    (value: string, key: string) => {
      if (UPSTREAM_HEADER_BLOCKLIST.has(key.toLowerCase())) return;
      res.setHeader(key, value);
    },
  );

  const body = (upstreamRes as globalThis.Response).body;
  if (!body) {
    res.end();
    return;
  }

  try {
    const reader = body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) res.write(Buffer.from(value));
    }
  } catch {
    // Client disconnected or upstream aborted. Nothing useful to signal.
  } finally {
    res.end();
  }
}
