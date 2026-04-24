import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAllTools } from './tools/register.js';
import { registerViewerResource, getPublicOrigin } from './ui/resource.js';
import { VERSION } from './version.js';

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
      },
    },
  );
  registerAllTools(server);
  registerViewerResource(server);
  return server;
}
