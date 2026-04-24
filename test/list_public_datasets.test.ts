import { describe, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServerInstance } from '../src/mcpServer.js';
import { DATASETS } from '../src/tools/list_public_datasets.js';

async function connect() {
  const server = createMcpServerInstance();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(ct);
  return client;
}

describe('list_public_datasets - curated shortlist', () => {
  test('ships at least 5 entries', () => {
    expect(DATASETS.length).toBeGreaterThanOrEqual(5);
  });

  test('each entry has the required shape and non-empty fields', () => {
    for (const d of DATASETS) {
      expect(d.label).toBeTruthy();
      expect(d.description).toBeTruthy();
      expect(d.modality).toMatch(/^[A-Z]{2,}(\/[A-Z]{2,})*$/);
      expect(d.study_uid).toMatch(/^[0-9]+(?:\.[0-9]+)+$/);
      expect(d.server_id).toBe('orthanc-demo');
      expect(d.approximate_instance_count).toBeGreaterThan(0);
    }
  });

  test('no two entries share a study UID', () => {
    const uids = new Set(DATASETS.map((d) => d.study_uid));
    expect(uids.size).toBe(DATASETS.length);
  });

  test('covers more than one modality', () => {
    const modalities = new Set(DATASETS.map((d) => d.modality.split('/')[0]));
    expect(modalities.size).toBeGreaterThanOrEqual(2);
  });

  test('returned via MCP tool', async () => {
    const client = await connect();
    const res = await client.callTool({
      name: 'list_public_datasets',
      arguments: {},
    });
    const s = res.structuredContent as {
      datasets: Array<{ label: string; study_uid: string }>;
    };
    expect(s.datasets.length).toBeGreaterThanOrEqual(5);
  });
});
