import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { registerAllTools } from './tools/register.js';
import { registerViewerResource, getPublicOrigin } from './ui/resource.js';
import { VERSION } from './version.js';

// Extension id for MCP Apps UI capability (per ext-apps spec 2026-01-26).
const MCP_UI_EXTENSION = 'io.modelcontextprotocol/ui';

export const SERVER_INFO = {
  name: 'orthanc-mcp-app',
  title: 'Orthanc DICOM Viewer',
  version: VERSION,
  description:
    'View any DICOMweb study inline in chat via the OHIF viewer. Powered by Orthanc. For demonstration, education, and non-diagnostic use only.',
  websiteUrl: 'https://github.com/fredericlambrechts/orthanc-mcp-app',
} as const;

function buildIcons() {
  const origin = getPublicOrigin();
  return [
    {
      src: `${origin}/assets/orthanc-icon.png`,
      mimeType: 'image/png',
      sizes: ['32x32'],
    },
    {
      src: `${origin}/assets/orthanc-wordmark.png`,
      mimeType: 'image/png',
      sizes: ['786x250'],
    },
  ];
}

export function createMcpServerInstance(): McpServer {
  const server = new McpServer(
    { ...SERVER_INFO, icons: buildIcons() },
    {
      capabilities: {
        tools: {},
        resources: {},
        logging: {},
        // Advertise MCP Apps widget support. Without this, hosts that respect
        // capability negotiation (Claude.ai, Claude Desktop) will NOT render
        // our ui://viewer resource even though the tool declares
        // _meta.ui.resourceUri. Per the ext-apps spec, this goes under
        // `extensions.<namespace>` with a mimeTypes allowlist.
        extensions: {
          [MCP_UI_EXTENSION]: {
            mimeTypes: [RESOURCE_MIME_TYPE],
          },
        },
      },
    },
  );
  registerAllTools(server);
  registerViewerResource(server);
  return server;
}
