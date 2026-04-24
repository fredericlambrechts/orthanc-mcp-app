/**
 * Widget entry. Thin <img>-per-slice viewer — the server decodes DICOM to
 * PNG at `/render/:server/:study/:series/:instance.png`, the widget just
 * fetches those PNGs and swaps them in as the user scrolls.
 *
 * No nested iframe (Claude's MCP Apps runtime drops `frameDomains` from
 * the widget CSP meta, blocking cross-origin iframe loads). No web workers,
 * no cornerstone, no megabyte bundles — just DICOMweb metadata fetches and
 * a single <img>.
 */
import { App } from '@modelcontextprotocol/ext-apps';
import {
  createDebouncedStateUpdater,
  fetchInstanceUids,
  fetchSeriesList,
  hidePlaceholder,
  setStatus,
  shortenUid,
  type SeriesSummary,
  type StateUpdate,
  type ViewerInitialData,
} from './bridge.js';

declare global {
  interface Window {
    __dicomMcpApp?: App;
  }
}

// Render server path template. `dicomwebBaseUrl` is e.g.
// `https://orthanc-mcp-app.fly.dev/dicomweb/orthanc-demo` so we peel off the
// `/dicomweb/<serverId>` suffix to derive the render URL prefix.
function buildRenderBase(dicomwebBaseUrl: string): string {
  const match = dicomwebBaseUrl.match(/^(https?:\/\/[^/]+)\/dicomweb\/([^/]+)\/?$/);
  if (!match) {
    throw new Error(`Unexpected dicomwebBaseUrl shape: ${dicomwebBaseUrl}`);
  }
  const [, origin, serverId] = match;
  return `${origin}/render/${serverId}`;
}

function buildRenderUrl(
  renderBase: string,
  studyUid: string,
  seriesUid: string,
  instanceUid: string,
  opts?: { wc?: number; ww?: number },
): string {
  const params = new URLSearchParams();
  if (opts?.wc != null) params.set('wc', String(opts.wc));
  if (opts?.ww != null) params.set('ww', String(opts.ww));
  const qs = params.toString();
  return (
    `${renderBase}/${encodeURIComponent(studyUid)}/${encodeURIComponent(
      seriesUid,
    )}/${encodeURIComponent(instanceUid)}.png` + (qs ? `?${qs}` : '')
  );
}

type Current = {
  studyUid: string;
  renderBase: string;
  series: SeriesSummary[];
  activeSeries: SeriesSummary;
  instanceUids: string[];
  index: number;
  windowCenter?: number;
  windowWidth?: number;
};

let current: Current | null = null;
let viewImg: HTMLImageElement | null = null;

function ensureViewerImg(): HTMLImageElement {
  if (viewImg && viewImg.isConnected) return viewImg;
  const viewport = document.getElementById('viewport');
  if (!viewport) throw new Error('viewport element missing');
  const img = document.createElement('img');
  img.id = 'slice-img';
  img.style.position = 'absolute';
  img.style.inset = '0';
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.objectFit = 'contain';
  img.style.background = '#000';
  img.alt = 'DICOM slice';
  viewport.appendChild(img);
  viewImg = img;
  return img;
}

function renderOverlay(): void {
  const bl = document.getElementById('overlay-bl');
  const br = document.getElementById('overlay-br');
  if (!current) {
    if (bl) bl.textContent = '';
    if (br) br.textContent = '';
    return;
  }
  const s = current.activeSeries;
  if (bl) {
    bl.textContent = `${s.modality} · ${s.description || 'series'}`;
  }
  if (br) {
    br.textContent = `${current.index + 1} / ${current.instanceUids.length}`;
  }
}

function renderSeriesTabs(onSelect: (s: SeriesSummary) => void): void {
  const container = document.getElementById('series-tabs');
  if (!container || !current) return;
  container.innerHTML = '';
  for (const s of current.series) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `${s.modality} ${s.description || 'series'} · ${s.instanceCount}`;
    btn.title = s.seriesInstanceUid;
    if (s.seriesInstanceUid === current.activeSeries.seriesInstanceUid) {
      btn.classList.add('active');
    }
    btn.addEventListener('click', () => onSelect(s));
    container.appendChild(btn);
  }
}

function paintCurrentSlice(): void {
  if (!current) return;
  const img = ensureViewerImg();
  const uid = current.instanceUids[current.index];
  const url = buildRenderUrl(
    current.renderBase,
    current.studyUid,
    current.activeSeries.seriesInstanceUid,
    uid,
    { wc: current.windowCenter, ww: current.windowWidth },
  );
  img.src = url;
}

async function loadStudy(
  data: ViewerInitialData,
  onState: (s: StateUpdate) => void,
): Promise<void> {
  if (!data.studyUid) return;

  const renderBase = buildRenderBase(data.dicomwebBaseUrl);
  setStatus('Loading series…');
  const series = await fetchSeriesList(data.dicomwebBaseUrl, data.studyUid);
  if (series.length === 0) {
    setStatus('No series in this study');
    return;
  }
  hidePlaceholder();

  const preferred =
    series.find((s) => s.seriesInstanceUid === data.seriesUid) ?? series[0];

  const selectSeries = async (chosen: SeriesSummary) => {
    setStatus(`Loading ${chosen.modality}…`);
    const instances = await fetchInstanceUids(
      data.dicomwebBaseUrl,
      data.studyUid!,
      chosen.seriesInstanceUid,
    );
    if (instances.length === 0) {
      setStatus('No instances in series');
      return;
    }
    current = {
      studyUid: data.studyUid!,
      renderBase,
      series,
      activeSeries: chosen,
      instanceUids: instances,
      index: Math.floor(instances.length / 2),
    };
    paintCurrentSlice();
    renderOverlay();
    renderSeriesTabs((s) => {
      void selectSeries(s);
    });
    setStatus(null);
    onState({
      study_uid: data.studyUid!,
      series_uid: chosen.seriesInstanceUid,
      modality: chosen.modality,
      slice_index: current.index,
      slice_count: instances.length,
    });
  };

  // Wheel scrolls slices.
  const viewport = document.getElementById('viewport');
  if (viewport && !(viewport as HTMLElement & { __scrollWired?: boolean }).__scrollWired) {
    viewport.addEventListener(
      'wheel',
      (ev) => {
        if (!current || current.instanceUids.length === 0) return;
        ev.preventDefault();
        const next = Math.min(
          Math.max(0, current.index + Math.sign((ev as WheelEvent).deltaY)),
          current.instanceUids.length - 1,
        );
        if (next === current.index) return;
        current.index = next;
        paintCurrentSlice();
        renderOverlay();
        onState({ slice_index: current.index });
      },
      { passive: false },
    );
    (viewport as HTMLElement & { __scrollWired?: boolean }).__scrollWired = true;
  }

  await selectSeries(preferred);
}

async function main(): Promise<void> {
  const app = new App(
    { name: 'orthanc-mcp-app/viewer', version: '0.3.0' },
    {},
  );

  const updateContext = createDebouncedStateUpdater((state: StateUpdate) => {
    app
      .callServerTool({
        name: '_record_view_state',
        arguments: state as Record<string, unknown>,
      })
      .catch((err: unknown) => console.warn('_record_view_state failed:', err));
  }, 250);

  app.ontoolresult = (params: { structuredContent?: unknown }) => {
    const structured = params.structuredContent as
      | Record<string, unknown>
      | undefined;
    if (!structured) return;
    const uiMeta = structured['ui_meta'] as
      | { initialData?: ViewerInitialData }
      | undefined;
    if (uiMeta?.initialData) {
      loadStudy(uiMeta.initialData, updateContext).catch((err: unknown) => {
        console.error('loadStudy failed:', err);
        setStatus(
          `Load failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
  };

  try {
    await app.connect();
    app
      .sendSizeChanged({ width: 900, height: 640 })
      .catch((err: unknown) => console.warn('sendSizeChanged failed:', err));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('App.connect failed:', err);
    setStatus(`Bridge error: ${msg}`);
  }

  window.__dicomMcpApp = app;
  // Expose helpers for debugging/test harnesses.
  (window as unknown as { __dicomMcpShorten?: typeof shortenUid }).__dicomMcpShorten =
    shortenUid;
}

main().catch((err) => {
  console.error('Widget init failed:', err);
  setStatus(`Init error: ${err instanceof Error ? err.message : String(err)}`);
});
