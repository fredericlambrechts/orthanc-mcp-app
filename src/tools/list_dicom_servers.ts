import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listServers } from '../config.js';

export const TOOL_NAME = 'list_dicom_servers';

export function register(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      description:
        'List DICOMweb endpoints available to this MCP server. Returns the default server (Orthanc public demo) plus any user-configured endpoints.',
      inputSchema: {},
    },
    async () => {
      const servers = listServers();
      const payload = { servers };
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(payload, null, 2),
          },
        ],
        structuredContent: payload,
      };
    },
  );
}
