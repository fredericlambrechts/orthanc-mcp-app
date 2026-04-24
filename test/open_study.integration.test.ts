/**
 * open_study integration tests. Exercises the full tool via MCP client +
 * InMemoryTransport. Some tests hit the live Orthanc demo to resolve
 * orthanc-ids to StudyInstanceUIDs.
 */
import { describe, expect, test, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServerInstance } from '../src/mcpServer.js';
import { clearRuntimeServers } from '../src/config.js';
import { clearAllViewStates } from '../src/state/session.js';

async function connect() {
  const server = createMcpServerInstance();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(ct);
  return client;
}

beforeEach(() => {
  clearRuntimeServers();
  clearAllViewStates();
});

describe('open_study - bare UID', () => {
  test('resolves to orthanc-demo server, returns ui_meta', async () => {
    const client = await connect();
    const res = await client.callTool({
      name: 'open_study',
      arguments: { reference: '1.2.840.113619.2.5.1762583153' },
    });
    expect(res.isError).toBeFalsy();
    const s = res.structuredContent as {
      study_uid: string;
      server_id: string;
      reference_kind: string;
      ui_meta: { initialData: { studyUid: string; dicomwebBaseUrl: string } };
    };
    expect(s.study_uid).toBe('1.2.840.113619.2.5.1762583153');
    expect(s.server_id).toBe('orthanc-demo');
    expect(s.reference_kind).toBe('bare_uid');
    expect(s.ui_meta.initialData.studyUid).toBe('1.2.840.113619.2.5.1762583153');
    // dicomwebBaseUrl is absolute so the Claude-hosted widget iframe resolves
    // it against our Fly origin, not the MCP sandbox host.
    expect(s.ui_meta.initialData.dicomwebBaseUrl).toMatch(
      /^https?:\/\/[^/]+\/dicomweb\/orthanc-demo$/,
    );
  });
});

describe('open_study - rejections', () => {
  test('isError=true on auth token', async () => {
    const client = await connect();
    const res = await client.callTool({
      name: 'open_study',
      arguments: { reference: 'https://example.com/studies/1.2.3.4?token=abc' },
    });
    expect(res.isError).toBe(true);
    const s = res.structuredContent as { code: string; message: string };
    expect(s.code).toBe('AUTHENTICATED');
  });

  test('isError=true on file:// scheme', async () => {
    const client = await connect();
    const res = await client.callTool({
      name: 'open_study',
      arguments: { reference: 'file:///etc/passwd' },
    });
    expect(res.isError).toBe(true);
  });

  test('isError=true on empty reference', async () => {
    const client = await connect();
    const res = await client.callTool({
      name: 'open_study',
      arguments: { reference: '   ' },
    });
    expect(res.isError).toBe(true);
  });
});

describe('open_study - DICOMweb URL with ad-hoc server', () => {
  test('registers a runtime server and returns its id', async () => {
    const client = await connect();
    const res = await client.callTool({
      name: 'open_study',
      arguments: {
        reference: 'https://example-pacs.test/dicom-web/studies/1.2.3.4.5',
      },
    });
    expect(res.isError).toBeFalsy();
    const s = res.structuredContent as {
      study_uid: string;
      server_id: string;
      reference_kind: string;
    };
    expect(s.study_uid).toBe('1.2.3.4.5');
    expect(s.reference_kind).toBe('dicomweb_study');
    expect(s.server_id).toMatch(/^adhoc-example-pacs-test/);
  });
});

describe('open_study - Orthanc REST URL (live)', () => {
  test('resolves an orthanc-id against the live demo server', async () => {
    // First pick a valid orthanc-id from the live server.
    const listRes = await fetch('https://orthanc.uclouvain.be/demo/studies');
    const ids = (await listRes.json()) as string[];
    expect(ids.length).toBeGreaterThan(0);
    const orthancId = ids[0];

    const client = await connect();
    const res = await client.callTool({
      name: 'open_study',
      arguments: {
        reference: `https://orthanc.uclouvain.be/demo/studies/${orthancId}`,
      },
    });
    expect(res.isError).toBeFalsy();
    const s = res.structuredContent as {
      study_uid: string;
      reference_kind: string;
    };
    expect(s.reference_kind).toBe('orthanc_rest');
    expect(s.study_uid).toMatch(/^[0-9]+(?:\.[0-9]+)+$/);
  }, 20_000);
});
