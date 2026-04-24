import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const TOOL_NAME = 'search_studies';

const Modality = z
  .enum(['CT', 'MR', 'CR', 'DX', 'US', 'MG', 'PT', 'NM', 'XA'])
  .describe('DICOM modality code');

export function register(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      description:
        'QIDO-RS search against a configured DICOMweb server. Returns matching studies with minimal metadata. Stub in U2; live search lands in U5/U6.',
      inputSchema: {
        server_id: z
          .string()
          .optional()
          .describe('DICOMweb server id (defaults to orthanc-demo).'),
        patient_name: z.string().optional().describe('Patient name fragment (wildcard match).'),
        modality: Modality.optional(),
        study_date_from: z
          .string()
          .regex(/^\d{8}$/)
          .optional()
          .describe('Earliest study date, format YYYYMMDD.'),
        study_date_to: z
          .string()
          .regex(/^\d{8}$/)
          .optional()
          .describe('Latest study date, format YYYYMMDD.'),
        limit: z.number().int().min(1).max(100).default(20),
      },
    },
    async (args) => {
      const payload = {
        studies: [],
        query: args,
        note: 'stub implementation - live QIDO-RS search will be wired in U5/U6',
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
