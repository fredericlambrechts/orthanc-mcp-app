import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const TOOL_NAME = 'open_study';

export function register(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      description:
        'Open a DICOM study in the embedded viewer. Accepts a StudyInstanceUID, a DICOMweb study URL, an Orthanc UI URL, an Orthanc REST URL, or an OHIF share URL. Parses the reference, resolves to a StudyInstanceUID, and mounts the OHIF viewer.',
      inputSchema: {
        reference: z
          .string()
          .describe(
            'Any of: bare StudyInstanceUID (e.g. "1.2.840.113..."), DICOMweb study URL, Orthanc UI URL, Orthanc REST URL, or OHIF share URL.',
          ),
        server_id: z
          .string()
          .optional()
          .describe(
            'Override the DICOMweb server. If omitted, inferred from the reference or defaults to orthanc-demo.',
          ),
        initial_series_uid: z
          .string()
          .optional()
          .describe('Optional SeriesInstanceUID to open first.'),
      },
    },
    async (args) => {
      const payload = {
        study_uid: null,
        server_id: args.server_id ?? 'orthanc-demo',
        ui_resource: 'ui://viewer',
        note:
          'stub implementation - URL parser and UI resource wiring land in U4/U5. This tool call currently does not render a viewer.',
        received: args,
      };
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
