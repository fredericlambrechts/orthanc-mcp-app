import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.js';
import { buildUpstreamHeaders } from '../src/dicomweb/proxy.js';

let appServer: Server;
let appPort: number;

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    appServer = app.listen(0, () => {
      appPort = (appServer.address() as AddressInfo).port;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => appServer.close(() => resolve()));
});

describe('buildUpstreamHeaders (pure)', () => {
  test('strips Authorization, Cookie, Host, Origin, Referer, mcp-session-id', () => {
    const out = buildUpstreamHeaders({
      authorization: 'Bearer secret',
      cookie: 'session=abc',
      host: 'claude.ai',
      origin: 'https://claude.ai',
      referer: 'https://claude.ai/chat/123',
      'mcp-session-id': 'xyz',
      accept: 'application/dicom+json',
      'user-agent': 'curl/8',
    });
    expect(out).not.toHaveProperty('authorization');
    expect(out).not.toHaveProperty('cookie');
    expect(out).not.toHaveProperty('host');
    expect(out).not.toHaveProperty('origin');
    expect(out).not.toHaveProperty('referer');
    expect(out).not.toHaveProperty('mcp-session-id');
    expect(out.accept).toBe('application/dicom+json');
    expect(out['user-agent']).toBe('curl/8');
  });

  test('case-insensitive Authorization stripping', () => {
    const out = buildUpstreamHeaders({
      Authorization: 'Bearer token',
      AUTHORIZATION: 'Bearer other',
    } as NodeJS.Dict<string | string[]>);
    expect(Object.keys(out).map((k) => k.toLowerCase())).not.toContain('authorization');
  });

  test('joins array header values with comma', () => {
    const out = buildUpstreamHeaders({
      accept: ['application/dicom+json', 'application/json'],
    });
    expect(out.accept).toBe('application/dicom+json, application/json');
  });
});

describe('OPTIONS preflight', () => {
  test('returns 204 with CORS headers and no upstream call', async () => {
    const res = await fetch(
      `http://127.0.0.1:${appPort}/dicomweb/orthanc-demo/studies`,
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://claude.ai',
          'Access-Control-Request-Method': 'GET',
        },
      },
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('GET');
    expect(res.headers.get('access-control-max-age')).toBe('86400');
  });
});

describe('Unknown serverId', () => {
  test('returns 404 with JSON error and CORS headers', async () => {
    const res = await fetch(
      `http://127.0.0.1:${appPort}/dicomweb/does-not-exist/studies`,
    );
    expect(res.status).toBe(404);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('Not Found');
    expect(body.message).toContain('does-not-exist');
  });
});

describe('Mock upstream - Authorization stripping end-to-end', () => {
  // We can't register a mock server in the main config without mutating it, but
  // we can use an ad-hoc fetch through a tiny upstream that echoes headers.
  let upstream: Server;
  let upstreamPort: number;
  let receivedHeaders: Record<string, string> = {};

  beforeAll(async () => {
    upstream = createServer((req, res) => {
      receivedHeaders = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') receivedHeaders[k] = v;
        else if (Array.isArray(v)) receivedHeaders[k] = v.join(', ');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: receivedHeaders }));
    });
    await new Promise<void>((resolve) => {
      upstream.listen(0, () => {
        upstreamPort = (upstream.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  test('buildUpstreamHeaders (indirect): forwarding a request through fetch with a stripped Authorization does not reach upstream', async () => {
    const headers = buildUpstreamHeaders({
      authorization: 'Bearer secret',
      accept: 'application/json',
    });
    const res = await fetch(`http://127.0.0.1:${upstreamPort}/`, { headers });
    const body = (await res.json()) as { received: Record<string, string> };
    expect(body.received).not.toHaveProperty('authorization');
    expect(body.received.accept).toBe('application/json');
  });
});

describe('Live proxy against Orthanc demo (integration)', () => {
  // These tests depend on https://orthanc.uclouvain.be/demo being reachable.
  // They're integration tests by design - the feasibility doc calls out that
  // we want to avoid the mock/prod divergence trap.

  test('GET /dicomweb/orthanc-demo/studies returns a non-empty array with CORS', async () => {
    const res = await fetch(
      `http://127.0.0.1:${appPort}/dicomweb/orthanc-demo/studies`,
      { headers: { Accept: 'application/dicom+json' } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const data = (await res.json()) as unknown[];
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  }, 15_000);

  test('GET /dicomweb/orthanc-demo/studies/{uid}/series returns series metadata', async () => {
    const listRes = await fetch(
      `http://127.0.0.1:${appPort}/dicomweb/orthanc-demo/studies`,
      { headers: { Accept: 'application/dicom+json' } },
    );
    const studies = (await listRes.json()) as Array<{
      '0020000D'?: { Value?: string[] };
    }>;
    const firstUid = studies[0]?.['0020000D']?.Value?.[0];
    expect(firstUid).toBeTruthy();

    const seriesRes = await fetch(
      `http://127.0.0.1:${appPort}/dicomweb/orthanc-demo/studies/${firstUid}/series`,
      { headers: { Accept: 'application/dicom+json' } },
    );
    expect(seriesRes.status).toBe(200);
    const series = (await seriesRes.json()) as unknown[];
    expect(Array.isArray(series)).toBe(true);
    expect(series.length).toBeGreaterThan(0);
  }, 15_000);

  test('GET with an Authorization header still succeeds (header stripped before upstream)', async () => {
    const res = await fetch(
      `http://127.0.0.1:${appPort}/dicomweb/orthanc-demo/studies`,
      {
        headers: {
          Accept: 'application/dicom+json',
          Authorization: 'Bearer fake-token-that-should-be-stripped',
        },
      },
    );
    expect(res.status).toBe(200);
  }, 15_000);
});
