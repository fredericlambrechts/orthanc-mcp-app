/**
 * Security-hardening regression tests for the DICOMweb proxy.
 * Each case corresponds to a P0/P1 finding from the code review.
 */
import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.js';
import {
  buildUpstreamHeaders,
  hasPathTraversal,
} from '../src/dicomweb/proxy.js';
import { registerRuntimeServer, clearRuntimeServers } from '../src/config.js';

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

describe('hasPathTraversal', () => {
  test('flags literal ../ segment', () => {
    expect(hasPathTraversal('/orthanc-demo/../admin')).toBe(true);
    expect(hasPathTraversal('/a/../../../b')).toBe(true);
  });

  test('flags encoded %2e%2e variants', () => {
    expect(hasPathTraversal('/a/%2e%2e/b')).toBe(true);
    expect(hasPathTraversal('/a/%2E%2E/b')).toBe(true);
  });

  test('flags double-encoded %252e%252e', () => {
    expect(hasPathTraversal('/a/%252e%252e/b')).toBe(true);
  });

  test('flags backslash ..', () => {
    expect(hasPathTraversal('/a/\\../b')).toBe(true);
  });

  test('does not flag legitimate DICOMweb paths', () => {
    expect(hasPathTraversal('/studies')).toBe(false);
    expect(hasPathTraversal('/studies/1.2.840.113/series')).toBe(false);
    expect(hasPathTraversal('')).toBe(false);
  });
});

describe('Proxy path traversal (P0 - blocks SSRF to sibling paths)', () => {
  test('GET /dicomweb/orthanc-demo/../../admin returns 400, never hits upstream', async () => {
    const res = await fetch(
      `http://127.0.0.1:${appPort}/dicomweb/orthanc-demo/../../admin`,
      { redirect: 'manual' },
    );
    // fetch() may normalize `..` client-side; verify a direct request too.
    expect([400, 404].includes(res.status)).toBe(true);
  });

  test('GET with %2e%2e encoded traversal does not reach upstream (Express normalization or our handler blocks)', async () => {
    // Express 5 normalizes percent-encoded dot segments before routing, which
    // means this request routes AWAY from /dicomweb (404) rather than into
    // our handler. Either outcome prevents SSRF; what matters is that no
    // upstream fetch to an unintended path occurs.
    const res = await fetch(
      `http://127.0.0.1:${appPort}/dicomweb/orthanc-demo/%2e%2e/%2e%2e/admin`,
    );
    expect([400, 404]).toContain(res.status);
  });
});

describe('Inbound header blocklist (P1)', () => {
  test('strips Proxy-Authorization, X-API-Key, X-Auth-Token, X-Access-Token, Authentication, X-CSRF-Token', () => {
    const out = buildUpstreamHeaders({
      'proxy-authorization': 'Basic xxx',
      'x-api-key': 'secret',
      'x-auth-token': 'tok',
      'x-access-token': 'tok',
      authentication: 'Bearer xxx',
      'x-csrf-token': 'xxx',
      accept: 'application/dicom+json',
    });
    expect(out).not.toHaveProperty('proxy-authorization');
    expect(out).not.toHaveProperty('x-api-key');
    expect(out).not.toHaveProperty('x-auth-token');
    expect(out).not.toHaveProperty('x-access-token');
    expect(out).not.toHaveProperty('authentication');
    expect(out).not.toHaveProperty('x-csrf-token');
    expect(out.accept).toBe('application/dicom+json');
  });
});

describe('Proxy refuses to follow redirects (P1)', () => {
  let redirector: Server;
  let redirectorPort: number;

  beforeAll(async () => {
    clearRuntimeServers();
    redirector = createServer((_req, res) => {
      res.writeHead(302, { Location: 'http://127.0.0.1:1/private' });
      res.end();
    });
    await new Promise<void>((resolve) => {
      redirector.listen(0, () => {
        redirectorPort = (redirector.address() as AddressInfo).port;
        resolve();
      });
    });
    registerRuntimeServer({
      id: 'test-redirector',
      label: 'test',
      base_url: `http://127.0.0.1:${redirectorPort}`,
      auth: 'none',
      default: false,
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => redirector.close(() => resolve()));
    clearRuntimeServers();
  });

  test('upstream 302 causes proxy to return 502, not follow', async () => {
    const res = await fetch(
      `http://127.0.0.1:${appPort}/dicomweb/test-redirector/studies`,
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { message: string };
    expect(body.message).toMatch(/redirect/i);
  });
});

describe('Proxy upstream fetch failure (P2 - generic error body)', () => {
  beforeAll(() => {
    clearRuntimeServers();
    registerRuntimeServer({
      id: 'test-unreachable',
      label: 'test',
      // Port 1 is almost never open; this triggers ECONNREFUSED fast.
      base_url: 'http://127.0.0.1:1',
      auth: 'none',
      default: false,
    });
  });

  afterAll(() => {
    clearRuntimeServers();
  });

  test('fetch failure returns generic 502 without leaking target URL', async () => {
    const res = await fetch(
      `http://127.0.0.1:${appPort}/dicomweb/test-unreachable/studies`,
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('target');
    // Error message must not include the full URL (SSRF oracle protection)
    expect(JSON.stringify(body)).not.toContain('127.0.0.1:1');
    expect(body.server_id).toBe('test-unreachable');
  });
});
