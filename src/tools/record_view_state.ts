import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { setViewState } from '../state/session.js';

export const TOOL_NAME = '_record_view_state';

export function register(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      description:
        'Internal: used by the embedded viewer widget to report its current state to the MCP server. Humans should not invoke this directly - Claude should not call it either. describe_current_view reads whatever this tool most recently wrote.',
      inputSchema: {
        study_uid: z.string().optional(),
        series_uid: z.string().optional(),
        modality: z.string().optional(),
        slice_index: z.number().int().nonnegative().optional(),
        slice_count: z.number().int().nonnegative().optional(),
        window_center: z.number().optional(),
        window_width: z.number().optional(),
        preset: z.string().optional(),
        slice_thickness_mm: z.number().optional(),
        patient_age: z.string().optional(),
        patient_sex: z.string().optional(),
      },
    },
    async (args, extra) => {
      const next = setViewState(extra.sessionId, args);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ ok: true, state: next }, null, 2),
          },
        ],
        structuredContent: { ok: true, state: next },
      };
    },
  );
}
