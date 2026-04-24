import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const TOOL_NAME = 'list_public_datasets';

export type PublicDataset = {
  label: string;
  description: string;
  modality: string;
  study_uid: string;
  server_id: string;
  approximate_instance_count: number;
};

/**
 * Curated shortlist of studies from the Orthanc public demo server
 * (https://orthanc.uclouvain.be/demo/). All are well-known anonymised test
 * datasets from the Orthanc project; patient names are pseudonyms.
 *
 * Chosen for:
 *   - Modality variety (MR, CT, PET/CT)
 *   - Moderate size (<=250 instances per study) - keeps first-load latency
 *     acceptable inside the Claude sandbox iframe
 *   - Clinical breadth without being oncology-heavy
 *
 * Resolved from live QIDO-RS query against
 * https://orthanc.uclouvain.be/demo/dicom-web/studies (see probes/RESULTS.md).
 */
export const DATASETS: readonly PublicDataset[] = [
  {
    label: 'BRAINIX - brain MR',
    description:
      'MRI of the brain. Multi-sequence. Useful for showing series navigation.',
    modality: 'MR',
    study_uid: '2.16.840.1.113669.632.20.1211.10000357775',
    server_id: 'orthanc-demo',
    approximate_instance_count: 232,
  },
  {
    label: 'INCISIX - dental CT',
    description:
      'Maxillofacial / dental CT. Good for demonstrating bone-window viewing.',
    modality: 'CT',
    study_uid: '2.16.840.1.113669.632.20.1211.10000231621',
    server_id: 'orthanc-demo',
    approximate_instance_count: 166,
  },
  {
    label: 'KNIX - knee MR',
    description:
      'Multi-sequence MRI of the knee. Classic musculoskeletal imaging case.',
    modality: 'MR',
    study_uid: '1.2.840.113619.2.176.2025.1499492.7391.1171285944.390',
    server_id: 'orthanc-demo',
    approximate_instance_count: 135,
  },
  {
    label: 'COMUNIX - PET/CT',
    description:
      'Combined PET/CT oncology study. Demonstrates multi-modality series handling.',
    modality: 'CT/PT',
    study_uid: '1.2.840.113745.101000.1008000.38048.4626.5933732',
    server_id: 'orthanc-demo',
    approximate_instance_count: 166,
  },
  {
    label: 'VIX - ankle CT',
    description:
      'High-resolution CT of foot/ankle. Good for showing thin-slice 3D navigation.',
    modality: 'CT',
    study_uid: '2.16.840.1.113669.632.20.1211.10000315526',
    server_id: 'orthanc-demo',
    approximate_instance_count: 250,
  },
];

export function register(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      description:
        'Return a curated shortlist of sample DICOM studies hosted on the Orthanc public demo server. Covers CT, MR, and PET/CT. Use when the user wants to see an example study without pasting a URL. All studies are anonymised public test data from the Orthanc project.',
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
