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
        'QIDO-RS search against a configured DICOMweb server by patient name, modality, or date range. NOT YET IMPLEMENTED - v1 returns isError. Use list_public_datasets instead to discover sample studies, or ask the user to paste a DICOMweb/Orthanc study URL and use open_study.',
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
    async (_args) => {
      const payload = {
        error: true as const,
        code: 'NOT_IMPLEMENTED' as const,
        message:
          'search_studies is not implemented in v1. Use list_public_datasets to browse sample studies, or ask the user for a DICOMweb/Orthanc URL and call open_study.',
      };
      return {
        isError: true,
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
