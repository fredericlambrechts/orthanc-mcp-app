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

/**
 * Render a "launch viewer" card in the widget body.
 *
 * Why a card, not an embedded OHIF:
 *   Claude's MCP Apps widget CSP only propagates our declared
 *   connectDomains and resourceDomains (surfaced in the widget URL as
 *   `connect-src` and `resource-src` params). It does NOT propagate
 *   frameDomains, and cross-origin navigation of the widget iframe is
 *   likewise blocked by the parent-page frame-src. Net effect: we cannot
 *   embed or navigate to our own OHIF origin from inside the widget.
 *
 *   The ext-apps API exposes `app.openLink(url)` which asks the host
 *   (Claude) to open the URL externally. That's the supported escape
 *   hatch for cross-origin launches. We build a card with study metadata
 *   + a big button that triggers openLink.
 *
 * The caller passes the App instance so the click handler can reach the
 * host. If openLink isn't supported by the host, the button falls back
 * to a plain <a href target="_blank"> (which Claude may or may not
 * allow to open, but at minimum makes the URL copy-paste-able).
 */
export function renderStudyLaunchCard(
  data: ViewerInitialData,
  opts: { openLink?: (url: string) => Promise<unknown> } = {},
): void {
  const target = buildViewerUrl(data);
  const placeholder = document.getElementById(PLACEHOLDER_ID);
  if (!placeholder) return;

  // Nuke the existing placeholder contents and build the launch card in
  // place. We don't hide the placeholder because it occupies the widget's
  // full area and the card IS what we want to show.
  placeholder.innerHTML = '';
  placeholder.classList.remove('hidden');

  const card = document.createElement('div');
  card.style.cssText = [
    'max-width:520px',
    'text-align:center',
    'padding:24px',
    'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
  ].join(';');

  const title = document.createElement('h1');
  title.textContent = 'DICOM study ready';
  title.style.cssText = 'font-size:20px;font-weight:600;margin:0 0 8px;color:#ececec';
  card.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.textContent = `Study ${shortenUid(data.studyUid)} - open in the OHIF viewer to scroll slices and switch series.`;
  subtitle.style.cssText = 'color:#a3a3a3;font-size:13px;margin:0 0 24px';
  card.appendChild(subtitle);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Open in OHIF viewer ↗';
  btn.style.cssText = [
    'background:#6b7fff',
    'color:#fff',
    'border:0',
    'border-radius:6px',
    'padding:14px 24px',
    'font-size:14px',
    'font-weight:600',
    'cursor:pointer',
    'display:inline-block',
  ].join(';');
  btn.addEventListener('click', async () => {
    setStatus('Opening viewer…');
    try {
      if (opts.openLink) {
        await opts.openLink(target);
        setStatus(null);
      } else {
        // Fallback: standard link. Works only if sandbox allows popups.
        window.open(target, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      setStatus(
        `Launch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });
  card.appendChild(btn);

  const fallback = document.createElement('p');
  fallback.style.cssText =
    'margin:20px 0 0;color:#8a8a8a;font-size:11px;word-break:break-all';
  const link = document.createElement('a');
  link.href = target;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = target;
  link.style.cssText = 'color:#8a8a8a;text-decoration:underline';
  fallback.appendChild(document.createTextNode('Or copy: '));
  fallback.appendChild(link);
  card.appendChild(fallback);

  const disclaimer = document.createElement('p');
  disclaimer.textContent =
    'For demonstration, education, and non-diagnostic use only.';
  disclaimer.style.cssText =
    'margin:16px 0 0;color:#8a8a8a;font-size:11px;font-style:italic';
  card.appendChild(disclaimer);

  const wrapper = document.createElement('div');
  wrapper.appendChild(card);
  placeholder.appendChild(wrapper);

  setStatus(null);
}

/**
 * Back-compat shim. The widget's ontoolresult handler still calls
 * `loadStudyIntoIframe` by name; keep the symbol stable but forward to
 * the new card renderer. Callers that have an App instance should pass
 * its `openLink` bound method via the options object.
 */
export function loadStudyIntoIframe(data: ViewerInitialData): void {
  renderStudyLaunchCard(data);
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
