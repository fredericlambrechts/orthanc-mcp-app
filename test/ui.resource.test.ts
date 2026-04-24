/**
 * Verifies the ui://viewer resource registration and open_study's UI metadata
 * per MCP Apps (SEP-1865).
 */
import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServerInstance } from '../src/mcpServer.js';
import { UI_RESOURCE_URI } from '../src/ui/resource.js';
import { createApp } from '../src/server.js';

async function connectClient() {
  const server = createMcpServerInstance();
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientT);
  return client;
}

describe('ui://viewer resource', () => {
  test('is listed in resources', async () => {
    const client = await connectClient();
    const res = await client.listResources();
    const uris = res.resources.map((r) => r.uri);
    expect(uris).toContain(UI_RESOURCE_URI);
  });

  test('reads as mcp-app HTML with CSP metadata', async () => {
    const client = await connectClient();
    const res = await client.readResource({ uri: UI_RESOURCE_URI });
    expect(res.contents).toHaveLength(1);
    const content = res.contents[0] as {
      uri: string;
      mimeType: string;
      text: string;
      _meta?: { ui?: { csp?: Record<string, unknown> } };
    };
    expect(content.uri).toBe(UI_RESOURCE_URI);
    expect(content.mimeType).toMatch(/profile=mcp-app/);
    expect(content.text.length).toBeGreaterThan(100);
    expect(content.text.toLowerCase()).toContain('<!doctype html');
    expect(content._meta?.ui?.csp).toBeDefined();
    const csp = content._meta!.ui!.csp as {
      resourceDomains: string[];
      connectDomains: string[];
      frameDomains: string[];
    };
    expect(Array.isArray(csp.resourceDomains)).toBe(true);
    expect(csp.resourceDomains).toHaveLength(1);
    expect(csp.connectDomains).toHaveLength(1);
    expect(csp.frameDomains).toHaveLength(1);
    // Path A: all three point at the same origin (no third-party CDN).
    expect(csp.resourceDomains).toEqual(csp.connectDomains);
    expect(csp.resourceDomains).toEqual(csp.frameDomains);
  });
});

describe('open_study tool metadata', () => {
  test('declares _meta.ui.resourceUri pointing at ui://viewer', async () => {
    const client = await connectClient();
    const res = await client.listTools();
    const tool = res.tools.find((t) => t.name === 'open_study');
    expect(tool).toBeDefined();
    const meta = tool!._meta as { ui?: { resourceUri?: string } } | undefined;
    expect(meta?.ui?.resourceUri).toBe(UI_RESOURCE_URI);
  });

  test('returns ui_meta.initialData with bare UID candidate', async () => {
    const client = await connectClient();
    const res = await client.callTool({
      name: 'open_study',
      arguments: { reference: '1.2.840.113619.2.5.1762583153.215519.978957063.78' },
    });
    expect(res.isError).toBeFalsy();
    const structured = res.structuredContent as {
      study_uid: string | null;
      ui_meta?: {
        resourceUri: string;
        initialData: {
          studyUid: string | null;
          dicomwebBaseUrl: string;
          ohifBasePath?: string;
        };
      };
    };
    expect(structured.study_uid).toBe('1.2.840.113619.2.5.1762583153.215519.978957063.78');
    expect(structured.ui_meta?.resourceUri).toBe(UI_RESOURCE_URI);
    expect(structured.ui_meta?.initialData.studyUid).toBe(
      '1.2.840.113619.2.5.1762583153.215519.978957063.78',
    );
    expect(structured.ui_meta?.initialData.dicomwebBaseUrl).toBe('/dicomweb/orthanc-demo');
  });

  test('returns null studyUid for non-UID references (URL parsing lands in U5)', async () => {
    const client = await connectClient();
    const res = await client.callTool({
      name: 'open_study',
      arguments: { reference: 'https://example.com/studies/abc' },
    });
    const structured = res.structuredContent as {
      study_uid: string | null;
      ui_meta?: { initialData: { studyUid: string | null } };
    };
    expect(structured.study_uid).toBeNull();
    expect(structured.ui_meta?.initialData.studyUid).toBeNull();
  });
});

describe('GET /ohif/viewer placeholder', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        port = (server.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('responds with HTML that echoes the query params', async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/ohif/viewer?StudyInstanceUIDs=1.2.3&url=%2Fdicomweb%2Fmock`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toContain('1.2.3');
    expect(body).toContain('/dicomweb/mock');
    expect(body).toContain('non-diagnostic');
  });
});
