import { describe, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServerInstance } from '../src/mcpServer.js';
import { clearAllViewStates, setViewState } from '../src/state/session.js';

async function connectClient() {
  const server = createMcpServerInstance();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return { client, server };
}

describe('MCP server - tool registration and schemas', () => {
  test('lists all expected tools (6 user-facing + 1 internal)', async () => {
    const { client } = await connectClient();
    const res = await client.listTools();
    const names = res.tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        '_record_view_state',
        'describe_current_view',
        'list_dicom_servers',
        'list_public_datasets',
        'open_study',
        'search_studies',
        'set_view',
      ].sort(),
    );
  });

  test('each tool has a non-empty description', async () => {
    const { client } = await connectClient();
    const res = await client.listTools();
    for (const t of res.tools) {
      expect(t.description, `tool ${t.name} missing description`).toBeTruthy();
      expect(typeof t.description).toBe('string');
      expect((t.description as string).length).toBeGreaterThan(10);
    }
  });

  test('every tool declares an object inputSchema', async () => {
    const { client } = await connectClient();
    const res = await client.listTools();
    for (const t of res.tools) {
      expect(t.inputSchema, `tool ${t.name} missing inputSchema`).toBeDefined();
      expect(t.inputSchema.type).toBe('object');
    }
  });
});

describe('list_dicom_servers', () => {
  test('returns the Orthanc demo entry as default', async () => {
    const { client } = await connectClient();
    const res = await client.callTool({ name: 'list_dicom_servers', arguments: {} });
    const structured = res.structuredContent as { servers: Array<{ id: string; default: boolean }> };
    expect(structured.servers.length).toBeGreaterThan(0);
    const defaults = structured.servers.filter((s) => s.default);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe('orthanc-demo');
  });
});

describe('list_public_datasets', () => {
  test('returns an array (stub empty in U2)', async () => {
    const { client } = await connectClient();
    const res = await client.callTool({ name: 'list_public_datasets', arguments: {} });
    const structured = res.structuredContent as { datasets: unknown[] };
    expect(Array.isArray(structured.datasets)).toBe(true);
  });
});

describe('search_studies - input validation', () => {
  test('returns NOT_IMPLEMENTED even for valid input (v1 behaviour)', async () => {
    const { client } = await connectClient();
    const res = await client.callTool({
      name: 'search_studies',
      arguments: { modality: 'CT', limit: 10 },
    });
    expect(res.isError).toBe(true);
    const s = res.structuredContent as { code: string };
    expect(s.code).toBe('NOT_IMPLEMENTED');
  });

  test('rejects an unknown modality', async () => {
    const { client } = await connectClient();
    const res = await client.callTool({
      name: 'search_studies',
      arguments: { modality: 'NOT_A_REAL_MODALITY' },
    });
    expect(res.isError).toBe(true);
  });

  test('rejects a malformed study_date_from', async () => {
    const { client } = await connectClient();
    const res = await client.callTool({
      name: 'search_studies',
      arguments: { study_date_from: 'not-a-date' },
    });
    expect(res.isError).toBe(true);
  });
});

describe('open_study - input validation', () => {
  test('accepts a bare StudyInstanceUID reference', async () => {
    const { client } = await connectClient();
    const res = await client.callTool({
      name: 'open_study',
      arguments: { reference: '1.2.840.113619.2.5' },
    });
    expect(res.isError).toBeFalsy();
  });

  test('rejects a non-string reference via zod type check', async () => {
    const { client } = await connectClient();
    const res = await client.callTool({
      name: 'open_study',
      arguments: { reference: 123 },
    });
    expect(res.isError).toBe(true);
  });

  test('rejects missing reference', async () => {
    const { client } = await connectClient();
    const res = await client.callTool({ name: 'open_study', arguments: {} });
    expect(res.isError).toBe(true);
  });
});

describe('set_view - presets', () => {
  test('resolves "lung" preset to the correct W/L', async () => {
    const { client } = await connectClient();
    const res = await client.callTool({
      name: 'set_view',
      arguments: { preset: 'lung' },
    });
    const structured = res.structuredContent as {
      resolved: { window_center: number; window_width: number; preset: string };
    };
    expect(structured.resolved.window_center).toBe(-600);
    expect(structured.resolved.window_width).toBe(1500);
    expect(structured.resolved.preset).toBe('lung');
  });

  test('rejects an unknown preset', async () => {
    const { client } = await connectClient();
    const res = await client.callTool({
      name: 'set_view',
      arguments: { preset: 'not-a-preset' },
    });
    expect(res.isError).toBe(true);
  });

  test('accepts manual window_center / window_width without a preset', async () => {
    const { client } = await connectClient();
    const res = await client.callTool({
      name: 'set_view',
      arguments: { window_center: 0, window_width: 100 },
    });
    const structured = res.structuredContent as {
      resolved: Record<string, unknown>;
    };
    expect(structured.resolved.window_center).toBe(0);
    expect(structured.resolved.window_width).toBe(100);
  });
});

describe('describe_current_view', () => {
  test('returns empty state when no session activity', async () => {
    clearAllViewStates();
    const { client } = await connectClient();
    const res = await client.callTool({
      name: 'describe_current_view',
      arguments: {},
    });
    const structured = res.structuredContent as Record<string, unknown>;
    expect(Object.keys(structured)).toHaveLength(0);
  });

  test('returns cached state when something has been set', async () => {
    clearAllViewStates();
    // Simulate a STATE_UPDATE on the fallback session (U5 will wire real session ids).
    setViewState(undefined, {
      study_uid: '1.2.3',
      modality: 'CT',
      slice_index: 42,
      slice_count: 200,
    });
    const { client } = await connectClient();
    const res = await client.callTool({
      name: 'describe_current_view',
      arguments: {},
    });
    const structured = res.structuredContent as {
      study_uid?: string;
      modality?: string;
      slice_index?: number;
      slice_count?: number;
    };
    expect(structured.study_uid).toBe('1.2.3');
    expect(structured.modality).toBe('CT');
    expect(structured.slice_index).toBe(42);
    expect(structured.slice_count).toBe(200);
  });
});

describe('unknown tool', () => {
  test('calling a non-existent tool returns an MCP error', async () => {
    const { client } = await connectClient();
    const res = await client.callTool({ name: 'does_not_exist', arguments: {} });
    expect(res.isError).toBe(true);
    const text = (res.content as Array<{ text?: string }>)[0]?.text ?? '';
    expect(text).toMatch(/not found/i);
  });
});
