import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const TOOL_NAME = 'list_public_datasets';

export type PublicDataset = {
  label: string;
  modality: string;
  study_uid: string;
  server_id: string;
};

// Populated in U6 after a live QIDO-RS query against the Orthanc demo.
// Empty for now; see probes/RESULTS.md for the candidate list.
export const DATASETS: readonly PublicDataset[] = [];

export function register(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      description:
        'Return curated sample studies from the Orthanc public demo server. Use when the user wants to see an example study without pasting a URL.',
      inputSchema: {},
    },
    async () => {
      const payload = { datasets: DATASETS };
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
