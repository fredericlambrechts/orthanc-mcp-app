/**
 * Bridge layer that sits between:
 *   - the MCP host (via @modelcontextprotocol/ext-apps App class)
 *   - the OHIF iframe nested inside this widget
 *
 * Responsibilities:
 *   - When a tool result arrives from the server with study/series info,
 *     build the OHIF iframe URL and load it.
 *   - Relay SET_VIEW commands from the MCP server to OHIF via postMessage.
 *   - Listen to OHIF's postMessage events and debounce a STATE_UPDATE back to
 *     the MCP server via `App.updateModelContext`.
 *
 * The OHIF-specific postMessage protocol is stubbed in U4 (messages defined
 * but real OHIF wiring lands in U6 when the actual OHIF bundle is deployed).
 */

export type ViewerInitialData = {
  studyUid: string | null;
  seriesUid?: string | null;
  dicomwebBaseUrl: string;
  ohifBasePath?: string;
};

export type SetViewCommand = {
  type: 'SET_VIEW';
  seriesUid?: string;
  sliceIndex?: number;
  windowCenter?: number;
  windowWidth?: number;
};

export type StateUpdate = {
  study_uid?: string;
  series_uid?: string;
  modality?: string;
  slice_index?: number;
  slice_count?: number;
  window_center?: number;
  window_width?: number;
  preset?: string;
  slice_thickness_mm?: number;
};

const STATUS_ID = 'status';
const VIEWER_ID = 'viewer';
const PLACEHOLDER_ID = 'placeholder';

export function setStatus(text: string | null): void {
  const el = document.getElementById(STATUS_ID);
  if (!el) return;
  if (text) {
    el.textContent = text;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

export function hidePlaceholder(): void {
  const el = document.getElementById(PLACEHOLDER_ID);
  if (el) el.classList.add('hidden');
}

export function buildViewerUrl(data: ViewerInitialData): string {
  if (!data.studyUid) {
    return 'about:blank';
  }
  const base = data.ohifBasePath ?? '/ohif/viewer';
  const params = new URLSearchParams();
  params.set('StudyInstanceUIDs', data.studyUid);
  if (data.seriesUid) {
    params.set('SeriesInstanceUIDs', data.seriesUid);
  }
  // OHIF reads the `url` query param as the DICOMweb base.
  params.set('url', data.dicomwebBaseUrl);
  return `${base}?${params.toString()}`;
}

export function loadStudyIntoIframe(data: ViewerInitialData): void {
  const iframe = document.getElementById(VIEWER_ID) as HTMLIFrameElement | null;
  if (!iframe) return;
  const target = buildViewerUrl(data);
  if (iframe.src !== target) {
    iframe.src = target;
  }
  hidePlaceholder();
  setStatus(`Loading study ${shortenUid(data.studyUid)}…`);
  iframe.addEventListener('load', () => setStatus(null), { once: true });
}

export function sendSetViewToIframe(cmd: SetViewCommand): void {
  const iframe = document.getElementById(VIEWER_ID) as HTMLIFrameElement | null;
  if (!iframe || !iframe.contentWindow) return;
  iframe.contentWindow.postMessage(cmd, '*');
}

/**
 * Debounced forwarder for OHIF state updates. Accumulates partial updates,
 * flushes at most once per `debounceMs` to avoid flooding the server on scroll.
 */
export function createDebouncedStateUpdater(
  onFlush: (state: StateUpdate) => void,
  debounceMs = 250,
): (partial: StateUpdate) => void {
  let pending: StateUpdate = {};
  let timer: ReturnType<typeof setTimeout> | null = null;

  return (partial) => {
    pending = { ...pending, ...partial };
    if (timer) return;
    timer = setTimeout(() => {
      const flush = pending;
      pending = {};
      timer = null;
      onFlush(flush);
    }, debounceMs);
  };
}

function shortenUid(uid: string | null): string {
  if (!uid) return 'n/a';
  if (uid.length <= 18) return uid;
  return `${uid.slice(0, 8)}…${uid.slice(-6)}`;
}

/**
 * Parses an inbound postMessage event from the nested OHIF iframe and returns
 * a partial StateUpdate, or null if the event is not recognized.
 *
 * OHIF's real message schema will be finalized in U6. For now we accept a
 * permissive shape: any object with a `type` of "STATE_UPDATE" plus scalar
 * fields matching our StateUpdate type.
 */
export function parseOhifStateMessage(data: unknown): StateUpdate | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.type !== 'STATE_UPDATE') return null;
  const out: StateUpdate = {};
  if (typeof d.study_uid === 'string') out.study_uid = d.study_uid;
  if (typeof d.series_uid === 'string') out.series_uid = d.series_uid;
  if (typeof d.modality === 'string') out.modality = d.modality;
  if (typeof d.slice_index === 'number') out.slice_index = d.slice_index;
  if (typeof d.slice_count === 'number') out.slice_count = d.slice_count;
  if (typeof d.window_center === 'number') out.window_center = d.window_center;
  if (typeof d.window_width === 'number') out.window_width = d.window_width;
  if (typeof d.preset === 'string') out.preset = d.preset;
  if (typeof d.slice_thickness_mm === 'number') {
    out.slice_thickness_mm = d.slice_thickness_mm;
  }
  return out;
}
