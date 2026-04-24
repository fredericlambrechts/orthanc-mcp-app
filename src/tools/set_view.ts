import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const TOOL_NAME = 'set_view';

export type WindowLevelPreset =
  | 'soft-tissue'
  | 'lung'
  | 'bone'
  | 'brain'
  | 'mediastinum'
  | 'liver'
  | 'default';

// Standard radiology presets. Values are center/width in Hounsfield units for CT.
export const PRESETS: Record<WindowLevelPreset, { wc: number; ww: number }> = {
  'soft-tissue': { wc: 40, ww: 400 },
  lung: { wc: -600, ww: 1500 },
  bone: { wc: 400, ww: 1800 },
  brain: { wc: 40, ww: 80 },
  mediastinum: { wc: 40, ww: 400 },
  liver: { wc: 60, ww: 160 },
  default: { wc: 40, ww: 400 },
};

export function register(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      description:
        'Programmatically navigate the viewer. Any omitted field is left unchanged. Presets resolve server-side to window_center / window_width before being posted to the widget. Stub in U2; postMessage wiring lands in U4/U5.',
      inputSchema: {
        series_uid: z.string().optional().describe('Switch to this SeriesInstanceUID.'),
        slice_index: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe('Zero-based slice index within the current series.'),
        window_center: z.number().optional().describe('DICOM window center (level).'),
        window_width: z.number().optional().describe('DICOM window width.'),
        preset: z
          .enum([
            'soft-tissue',
            'lung',
            'bone',
            'brain',
            'mediastinum',
            'liver',
            'default',
          ])
          .optional()
          .describe(
            'Named window/level preset. If provided, overrides window_center/window_width.',
          ),
      },
    },
    async (args) => {
      const applied: Record<string, unknown> = {};
      if (args.preset) {
        const p = PRESETS[args.preset];
        applied.window_center = p.wc;
        applied.window_width = p.ww;
        applied.preset = args.preset;
      } else {
        if (args.window_center !== undefined) applied.window_center = args.window_center;
        if (args.window_width !== undefined) applied.window_width = args.window_width;
      }
      if (args.series_uid !== undefined) applied.series_uid = args.series_uid;
      if (args.slice_index !== undefined) applied.slice_index = args.slice_index;

      const payload = {
        applied: true,
        resolved: applied,
        note:
          'stub implementation - postMessage to widget lands in U4/U5. No viewer is actually driven yet.',
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
