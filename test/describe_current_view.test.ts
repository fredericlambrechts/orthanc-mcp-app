/**
 * describe_current_view reads whatever _record_view_state most recently
 * wrote for the same session. Tests exercise the full loop:
 *   widget (simulated) -> _record_view_state -> describe_current_view
 */
import { describe, expect, test, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServerInstance } from '../src/mcpServer.js';
import { clearAllViewStates } from '../src/state/session.js';

async function connect() {
  const server = createMcpServerInstance();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(ct);
  return client;
}

beforeEach(() => clearAllViewStates());

describe('describe_current_view', () => {
  test('returns empty state before any write', async () => {
    const client = await connect();
    const res = await client.callTool({
      name: 'describe_current_view',
      arguments: {},
    });
    const state = res.structuredContent as Record<string, unknown>;
    // In-memory store keyed by session id. Fresh client -> empty or fallback.
    expect(Object.keys(state).length).toBeLessThanOrEqual(1); // last_updated_at may be absent
  });

  test('returns what _record_view_state wrote', async () => {
    const client = await connect();
    await client.callTool({
      name: '_record_view_state',
      arguments: {
        study_uid: '1.2.3',
        modality: 'CT',
        slice_index: 42,
        slice_count: 250,
        window_center: -600,
        window_width: 1500,
        preset: 'lung',
      },
    });
    const res = await client.callTool({
      name: 'describe_current_view',
      arguments: {},
    });
    const s = res.structuredContent as {
      study_uid?: string;
      modality?: string;
      slice_index?: number;
      slice_count?: number;
      window_center?: number;
      preset?: string;
      last_updated_at?: string;
    };
    expect(s.study_uid).toBe('1.2.3');
    expect(s.modality).toBe('CT');
    expect(s.slice_index).toBe(42);
    expect(s.slice_count).toBe(250);
    expect(s.window_center).toBe(-600);
    expect(s.preset).toBe('lung');
    expect(s.last_updated_at).toBeTruthy();
  });

  test('last_updated_at is ISO format and recent', async () => {
    const client = await connect();
    await client.callTool({
      name: '_record_view_state',
      arguments: { study_uid: '1.2.3' },
    });
    const res = await client.callTool({
      name: 'describe_current_view',
      arguments: {},
    });
    const s = res.structuredContent as { last_updated_at?: string };
    const ts = new Date(s.last_updated_at!);
    expect(Number.isNaN(ts.valueOf())).toBe(false);
    expect(Date.now() - ts.valueOf()).toBeLessThan(5_000);
  });

  test('open_study pre-populates state for describe_current_view', async () => {
    const client = await connect();
    await client.callTool({
      name: 'open_study',
      arguments: { reference: '1.2.840.113619.2.5.1762583153' },
    });
    const res = await client.callTool({
      name: 'describe_current_view',
      arguments: {},
    });
    const s = res.structuredContent as {
      study_uid?: string;
      server_id?: string;
    };
    expect(s.study_uid).toBe('1.2.840.113619.2.5.1762583153');
    expect(s.server_id).toBe('orthanc-demo');
  });
});
