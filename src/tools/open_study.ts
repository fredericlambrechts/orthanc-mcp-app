import * as z from 'zod/v4';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getServerById, getDefaultServer } from '../config.js';
import { UI_RESOURCE_URI } from '../ui/resource.js';

export const TOOL_NAME = 'open_study';

export function register(server: McpServer): void {
  registerAppTool(
    server,
    TOOL_NAME,
    {
      description:
        'Open a DICOM study in the embedded OHIF viewer. Accepts a StudyInstanceUID, a DICOMweb study URL, an Orthanc UI URL, an Orthanc REST URL, or an OHIF share URL. Parses the reference, resolves to a StudyInstanceUID, and mounts the OHIF viewer inline in the chat.',
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
      _meta: {
        ui: { resourceUri: UI_RESOURCE_URI },
      },
    },
    async (args) => {
      // U4 stub: no URL parsing yet (that's U5). We resolve server_id to a
      // base URL so the widget at least knows where DICOMweb traffic should
      // be proxied, and pass the raw reference as a "candidate" study UID.
      const serverConfig = args.server_id
        ? getServerById(args.server_id) ?? getDefaultServer()
        : getDefaultServer();

      const candidateStudyUid = /^[0-9]+(?:\.[0-9]+)+$/.test(args.reference)
        ? args.reference
        : null;

      const payload = {
        study_uid: candidateStudyUid,
        server_id: serverConfig.id,
        ui_resource: UI_RESOURCE_URI,
        ui_meta: {
          resourceUri: UI_RESOURCE_URI,
          initialData: {
            studyUid: candidateStudyUid,
            seriesUid: args.initial_series_uid ?? null,
            dicomwebBaseUrl: `/dicomweb/${serverConfig.id}`,
            ohifBasePath: '/ohif/viewer',
          },
        },
        note: candidateStudyUid
          ? 'bare StudyInstanceUID detected; full URL parsing lands in U5'
          : 'stub implementation - URL parser lands in U5. Non-UID references do not yet resolve.',
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
