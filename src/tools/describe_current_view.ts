import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getViewState } from '../state/session.js';

export const TOOL_NAME = 'describe_current_view';

export function register(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      description:
        "Return the viewer's current state: active study, series, slice index, window/level, zoom, and loaded metadata. Call this when the user asks questions about what they are looking at. Backed by the server-side cache of the last STATE_UPDATE message from the widget.",
      inputSchema: {},
    },
    async (_args, extra) => {
      const state = getViewState(extra.sessionId);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(state, null, 2),
          },
        ],
        structuredContent: state,
      };
    },
  );
}
