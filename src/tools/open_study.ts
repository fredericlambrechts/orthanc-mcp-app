import * as z from 'zod/v4';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  generateServerId,
  getDefaultServer,
  getServerById,
  registerRuntimeServer,
  type DicomWebServer,
} from '../config.js';
import {
  parseReferenceShape,
  resolveOrthancId,
  orthancDicomWebBase,
  type ParsedRef,
} from '../parser/url.js';
import { UI_RESOURCE_URI } from '../ui/resource.js';
import { setViewState } from '../state/session.js';

export const TOOL_NAME = 'open_study';

type OpenStudyResult = {
  study_uid: string;
  server_id: string;
  reference_kind: ParsedRef['kind'];
  ui_resource: string;
  ui_meta: {
    resourceUri: string;
    initialData: {
      studyUid: string;
      seriesUid: string | null;
      dicomwebBaseUrl: string;
      ohifBasePath: string;
    };
  };
};

type OpenStudyError = {
  error: true;
  code: string;
  message: string;
  suggestions?: string[];
};

export function register(server: McpServer): void {
  registerAppTool(
    server,
    TOOL_NAME,
    {
      description:
        'Open a DICOM study in the embedded OHIF viewer. Accepts a StudyInstanceUID, a DICOMweb study URL, an Orthanc UI URL, an Orthanc REST URL, or an OHIF share URL. Parses the reference, resolves it to a StudyInstanceUID (performing an Orthanc REST lookup if needed), registers the server if it was not already known, and mounts the OHIF viewer inline in the chat.',
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
            'Override the DICOMweb server id. If omitted, inferred from the reference or defaults to orthanc-demo.',
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
    async (args, extra) => {
      try {
        const resolved = await resolveReference(args.reference, args.server_id);

        // Pre-populate session state so describe_current_view has something
        // meaningful immediately, even before the widget sends STATE_UPDATE.
        setViewState(extra.sessionId, {
          study_uid: resolved.studyUid,
          series_uid: args.initial_series_uid,
          server_id: resolved.server.id,
        });

        const result: OpenStudyResult = {
          study_uid: resolved.studyUid,
          server_id: resolved.server.id,
          reference_kind: resolved.kind,
          ui_resource: UI_RESOURCE_URI,
          ui_meta: {
            resourceUri: UI_RESOURCE_URI,
            initialData: {
              studyUid: resolved.studyUid,
              seriesUid: args.initial_series_uid ?? null,
              dicomwebBaseUrl: `/dicomweb/${resolved.server.id}`,
              ohifBasePath: '/ohif/viewer',
            },
          },
        };

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: result,
        };
      } catch (err) {
        const e = err as OpenStudyError & Error;
        const payload: OpenStudyError = {
          error: true,
          code: e.code ?? 'RESOLUTION_FAILED',
          message: e.message,
          suggestions: e.suggestions,
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
      }
    },
  );
}

type Resolved = {
  studyUid: string;
  server: DicomWebServer;
  kind: ParsedRef['kind'];
};

async function resolveReference(
  reference: string,
  serverIdOverride?: string,
): Promise<Resolved> {
  const parsed = parseReferenceShape(reference);
  if (parsed.kind === 'reject') {
    const e = new Error(parsed.message) as Error & {
      code?: string;
      suggestions?: string[];
    };
    e.code = parsed.code;
    e.suggestions = parsed.suggestions;
    throw e;
  }

  switch (parsed.kind) {
    case 'bare_uid': {
      const server = serverIdOverride
        ? (getServerById(serverIdOverride) ?? getDefaultServer())
        : getDefaultServer();
      return { studyUid: parsed.studyUid, server, kind: parsed.kind };
    }
    case 'ohif_share': {
      // We don't know where to fetch from without a DICOMweb base hint.
      // If the user overrode the server_id, use it. Otherwise default.
      const server = serverIdOverride
        ? (getServerById(serverIdOverride) ?? getDefaultServer())
        : getDefaultServer();
      return { studyUid: parsed.studyUid, server, kind: parsed.kind };
    }
    case 'dicomweb_study': {
      const baseUrl = parsed.host + parsed.dicomwebBase;
      const server = ensureServerForOrigin(parsed.host, baseUrl);
      return { studyUid: parsed.studyUid, server, kind: parsed.kind };
    }
    case 'orthanc_ui':
    case 'orthanc_rest': {
      // Resolve the orthanc id to a StudyInstanceUID via the REST endpoint
      // at the Orthanc mount point. Register the DICOMweb base as an ad-hoc
      // server so the widget can fetch through our proxy.
      const studyUid = await resolveOrthancId(parsed.restBase, parsed.orthancId);
      const baseUrl = orthancDicomWebBase(parsed.restBase);
      const server = ensureServerForOrigin(parsed.restBase, baseUrl);
      return { studyUid, server, kind: parsed.kind };
    }
  }
}

function ensureServerForOrigin(
  origin: string,
  baseUrl: string,
): DicomWebServer {
  // If the origin matches a built-in server's base URL, use that entry.
  for (const builtin of [getDefaultServer()]) {
    if (builtin.base_url.startsWith(origin)) {
      return builtin;
    }
  }
  const id = generateServerId(origin);
  const existing = getServerById(id);
  if (existing) return existing;
  return registerRuntimeServer({
    id,
    label: `Ad-hoc: ${origin}`,
    base_url: baseUrl,
    auth: 'none',
    default: false,
  });
}
