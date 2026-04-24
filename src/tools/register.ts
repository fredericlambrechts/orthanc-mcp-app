import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { register as registerListDicomServers } from './list_dicom_servers.js';
import { register as registerListPublicDatasets } from './list_public_datasets.js';
import { register as registerSearchStudies } from './search_studies.js';
import { register as registerOpenStudy } from './open_study.js';
import { register as registerDescribeCurrentView } from './describe_current_view.js';
import { register as registerSetView } from './set_view.js';
import { register as registerRecordViewState } from './record_view_state.js';

export function registerAllTools(server: McpServer): void {
  registerListDicomServers(server);
  registerListPublicDatasets(server);
  registerSearchStudies(server);
  registerOpenStudy(server);
  registerDescribeCurrentView(server);
  registerSetView(server);
  registerRecordViewState(server);
}
