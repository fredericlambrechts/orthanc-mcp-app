import { type NextFunction, type Request, type Response } from 'express';
import { getServerById } from '../config.js';

// Headers we never forward from the inbound request to the upstream server.
// - authorization / proxy-authorization / x-*-key / x-*-token: v1 safety rail;
//   we only talk to anonymous DICOMweb endpoints and refuse to relay credentials
// - host, connection, content-length: hop-by-hop or rewritten by fetch
// - cookie: belongs to the Claude host origin, irrelevant upstream
// - mcp-session-id: our own transport marker, not meaningful upstream
const INBOUND_HEADER_BLOCKLIST = new Set([
  'authorization',
  'proxy-authorization',
  'authentication',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
  'x-amz-security-token',
  'x-csrf-token',
  'host',
  'connection',
  'content-length',
  'cookie',
  'origin',
  'referer',
  'mcp-session-id',
]);

// Timeout on the outbound fetch. Kept generous for large WADO-RS bulkdata;
// tighten later per-route if we add streaming metadata vs. pixel splits.
const UPSTREAM_FETCH_TIMEOUT_MS = 30_000;

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

/**
 * Detect obvious path-traversal attempts. We reject both literal `..`
 * segments and common encoded forms (`%2e%2e`, `%2E%2E`, `..%2f`, `%2f..`,
 * and nested mixed encodings). Defence-in-depth alongside the resolved-URL
 * prefix check.
 */
export function hasPathTraversal(upstreamPath: string): boolean {
  if (!upstreamPath) return false;
  // Literal `..` path segment
  if (/(^|\/|\\)\.\.(\/|\\|$)/.test(upstreamPath)) return true;
  // Encoded variants (single or double-encoded)
  const lower = upstreamPath.toLowerCase();
  if (lower.includes('%2e%2e')) return true;
  if (lower.includes('%252e%252e')) return true;
  // Backslash variants (some servers treat as separator)
  if (upstreamPath.includes('\\..')) return true;
  return false;
}

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

  // Reject path-traversal inputs BEFORE URL resolution. We then verify the
  // resolved URL's pathname still lies under the configured base_url, as
  // defence-in-depth against encodings we might have missed.
  if (hasPathTraversal(upstreamPath)) {
    applyCorsHeaders(res);
    res.status(400).json({
      error: 'Bad Request',
      message: 'Path traversal segments are not permitted',
    });
    return;
  }

  const base = serverConfig.base_url.replace(/\/+$/, '');
  let resolved: URL;
  let baseUrl: URL;
  try {
    baseUrl = new URL(base + '/');
    resolved = new URL(upstreamPath.replace(/^\/+/, '') + upstreamQuery, baseUrl);
  } catch {
    applyCorsHeaders(res);
    res.status(400).json({
      error: 'Bad Request',
      message: 'Unresolvable upstream URL',
    });
    return;
  }
  if (
    resolved.origin !== baseUrl.origin ||
    !resolved.pathname.startsWith(baseUrl.pathname)
  ) {
    applyCorsHeaders(res);
    res.status(400).json({
      error: 'Bad Request',
      message: 'Resolved upstream URL escapes the configured server base',
    });
    return;
  }
  const targetUrl = resolved.toString();

  const headers = buildUpstreamHeaders(req.headers);

  // redirect: 'manual' means fetch() returns a 3xx response object rather
  // than silently following. We refuse to follow - an upstream redirect to
  // 127.0.0.1 / RFC1918 / 169.254.169.254 would turn the proxy into an SSRF
  // pivot. For a DICOMweb endpoint, a 3xx is nearly always misconfig anyway.
  let upstreamRes: globalThis.Response;
  try {
    upstreamRes = await fetch(targetUrl, {
      method: req.method,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(UPSTREAM_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    applyCorsHeaders(res);
    if (!res.headersSent) {
      const isTimeout =
        err instanceof DOMException && err.name === 'TimeoutError';
      console.warn('[dicomweb-proxy] upstream fetch failed', {
        server_id: serverId,
        timeout: isTimeout,
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(isTimeout ? 504 : 502).json({
        error: isTimeout ? 'Gateway Timeout' : 'Bad Gateway',
        message: isTimeout
          ? 'Upstream DICOMweb server did not respond in time'
          : 'Upstream DICOMweb server is unreachable',
        server_id: serverId,
      });
    } else {
      res.end();
    }
    return;
  }

  if (upstreamRes.status >= 300 && upstreamRes.status < 400) {
    applyCorsHeaders(res);
    console.warn('[dicomweb-proxy] refused to follow upstream redirect', {
      server_id: serverId,
      status: upstreamRes.status,
    });
    res.status(502).json({
      error: 'Bad Gateway',
      message:
        'Upstream DICOMweb server returned a redirect; following cross-host redirects is disabled for security',
      server_id: serverId,
    });
    return;
  }

  applyCorsHeaders(res);
  res.status(upstreamRes.status);

  upstreamRes.headers.forEach((value: string, key: string) => {
    if (UPSTREAM_HEADER_BLOCKLIST.has(key.toLowerCase())) return;
    res.setHeader(key, value);
  });

  const body = upstreamRes.body;
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
