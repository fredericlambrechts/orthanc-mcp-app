import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAllTools } from './tools/register.js';
import { VERSION } from './version.js';

export const SERVER_INFO = {
  name: 'orthanc-mcp-app',
  version: VERSION,
} as const;

export function createMcpServerInstance(): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: {
      tools: {},
      logging: {},
    },
  });
  registerAllTools(server);
  return server;
}
