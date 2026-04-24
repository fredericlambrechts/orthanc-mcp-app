import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.js';

let appServer: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    appServer = app.listen(0, () => {
      const port = (appServer.address() as AddressInfo).port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => appServer.close(() => resolve()));
});

describe('MCP session handling', () => {
  const jsonrpcHeaders = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };

  test('POST with unknown session id returns 404 so clients know to re-initialize', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { ...jsonrpcHeaders, 'mcp-session-id': 'stale-session-from-previous-boot' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error?.code).toBe(-32001);
  });

  test('POST without session id on non-initialize returns 400', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: jsonrpcHeaders,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} }),
    });
    expect(res.status).toBe(400);
  });

  test('GET with unknown session id returns 404', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'GET',
      headers: { accept: 'text/event-stream', 'mcp-session-id': 'stale' },
    });
    expect(res.status).toBe(404);
  });

  test('DELETE with unknown session id returns 404', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'DELETE',
      headers: { 'mcp-session-id': 'stale' },
    });
    expect(res.status).toBe(404);
  });

  test('mcp-v2 alias shares the same handler', async () => {
    const res = await fetch(`${baseUrl}/mcp-v2`, {
      method: 'POST',
      headers: { ...jsonrpcHeaders, 'mcp-session-id': 'stale' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} }),
    });
    expect(res.status).toBe(404);
  });
});
