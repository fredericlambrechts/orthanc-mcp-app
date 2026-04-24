/**
 * Widget entry point. Bootstraps the MCP Apps App, wires the OHIF bridge,
 * and handles tool results from the server.
 */
import { App } from '@modelcontextprotocol/ext-apps';
import {
  buildViewerUrl,
  createDebouncedStateUpdater,
  parseOhifStateMessage,
  renderStudyLaunchCard,
  sendSetViewToIframe,
  setStatus,
  type SetViewCommand,
  type StateUpdate,
  type ViewerInitialData,
} from './bridge.js';

// Expose for test and debugging; tree-shaking will keep this tiny.
declare global {
  interface Window {
    __dicomMcpApp?: App;
    __buildViewerUrl?: typeof buildViewerUrl;
  }
}

function setDiag(line: string, value: string): void {
  const el = document.getElementById('diag');
  if (!el) return;
  el.innerHTML = el.innerHTML.replace(
    new RegExp(`${line}:[^<]*`),
    `${line}: ${value}`,
  );
}

async function main(): Promise<void> {
  setDiag('widget js', 'running');

  const app = new App(
    { name: 'orthanc-mcp-app/viewer', version: '0.1.0' },
    {},
  );

  // On every STATE_UPDATE from OHIF, push the state to the MCP server via
  // the internal `_record_view_state` tool. The server caches it and
  // describe_current_view reads from that cache.
  const updateContext = createDebouncedStateUpdater((state: StateUpdate) => {
    app
      .callServerTool({
        name: '_record_view_state',
        arguments: state as Record<string, unknown>,
      })
      .catch((err: unknown) =>
        console.warn('_record_view_state failed:', err),
      );
  }, 250);

  // Tool results arrive via ontoolresult when a tool that renders this
  // widget finishes (open_study, set_view, etc).
  // ext-apps delivers the CallToolResult directly as `params` (schema:
  // McpUiToolResultNotificationSchema → params = CallToolResultSchema).
  app.ontoolresult = (params: {
    structuredContent?: unknown;
  }) => {
    const structured = params.structuredContent as
      | Record<string, unknown>
      | undefined;
    const keys = structured ? Object.keys(structured).join(',') : '(no structured)';
    setDiag('ontoolresult', `fired @ ${new Date().toISOString().slice(11, 23)} keys=${keys}`);

    if (!structured) return;

    // open_study carries ui_meta.initialData in its result.
    const uiMeta = structured['ui_meta'] as
      | { initialData?: ViewerInitialData }
      | undefined;
    if (uiMeta?.initialData) {
      setDiag('ontoolresult', `rendering launch card for ${uiMeta.initialData.studyUid?.slice(0, 16) ?? '?'}`);
      renderStudyLaunchCard(uiMeta.initialData, {
        openLink: (url) =>
          app
            .openLink({ url })
            .catch((err) => {
              console.warn('openLink failed:', err);
              // Fall back to window.open in case the host didn't advertise
              // openLinks capability.
              window.open(url, '_blank', 'noopener,noreferrer');
            }),
      });
      return;
    }

    // set_view carries a `resolved` payload we can forward to OHIF.
    const resolved = structured['resolved'] as
      | Record<string, unknown>
      | undefined;
    if (resolved) {
      const cmd: SetViewCommand = { type: 'SET_VIEW' };
      if (typeof resolved.series_uid === 'string') cmd.seriesUid = resolved.series_uid;
      if (typeof resolved.slice_index === 'number') cmd.sliceIndex = resolved.slice_index;
      if (typeof resolved.window_center === 'number') cmd.windowCenter = resolved.window_center;
      if (typeof resolved.window_width === 'number') cmd.windowWidth = resolved.window_width;
      sendSetViewToIframe(cmd);
    }
  };

  // Relay OHIF postMessage state updates back to the server.
  window.addEventListener('message', (ev: MessageEvent) => {
    const state = parseOhifStateMessage(ev.data);
    if (state) updateContext(state);
  });

  try {
    setDiag('app.connect', 'calling...');
    await app.connect();
    setDiag('app.connect', `ok @ ${new Date().toISOString()}`);
    setStatus(null);

    // We render a compact launch card, not a full viewer. ~300px tall is
    // enough for the title, subtitle, button, URL row, and disclaimer.
    app.sendSizeChanged({ width: 720, height: 300 }).catch((err) =>
      console.warn('sendSizeChanged failed:', err),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('App.connect failed:', err);
    setDiag('app.connect', `FAILED: ${msg}`);
    setStatus(`Bridge error: ${msg}`);
  }

  window.__dicomMcpApp = app;
  window.__buildViewerUrl = buildViewerUrl;
}

main().catch((err) => {
  console.error('Widget init failed:', err);
  setStatus(`Init error: ${err instanceof Error ? err.message : String(err)}`);
});
