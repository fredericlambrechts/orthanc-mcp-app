/**
 * Thin DICOMweb client + cornerstone viewport helpers for the widget.
 *
 * The widget renders a Cornerstone3D stack viewport directly in its own
 * body (no nested iframe — Claude's MCP Apps runtime drops `frameDomains`
 * from our CSP meta so cross-origin iframes don't work inside the widget,
 * see HANDOFF). We speak DICOMweb to our `/dicomweb/orthanc-demo/` proxy,
 * which is already in `connectDomains` so fetches are allowed.
 */

export type ViewerInitialData = {
  studyUid: string | null;
  seriesUid?: string | null;
  dicomwebBaseUrl: string;
  // Legacy field; no longer used now that we render Cornerstone inline.
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

export type SeriesSummary = {
  seriesInstanceUid: string;
  modality: string;
  description: string;
  instanceCount: number;
};

export function setStatus(text: string | null): void {
  const el = document.getElementById('status');
  if (!el) return;
  if (text) {
    el.textContent = text;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

export function hidePlaceholder(): void {
  const el = document.getElementById('placeholder');
  if (el) el.classList.add('hidden');
}

/**
 * Query `/studies/{study}/series` and return a summarised, sorted list.
 * DICOMweb returns one JSON object per series with numeric-string keyed
 * attributes; we only pull the handful we actually render in the tab strip.
 */
export async function fetchSeriesList(
  dicomwebBase: string,
  studyUid: string,
): Promise<SeriesSummary[]> {
  const url = `${dicomwebBase.replace(/\/+$/, '')}/studies/${encodeURIComponent(studyUid)}/series`;
  const res = await fetch(url, { headers: { Accept: 'application/dicom+json' } });
  if (!res.ok) throw new Error(`series query failed: ${res.status}`);
  const data = (await res.json()) as Array<Record<string, { Value?: unknown[] }>>;
  return data
    .map((s) => ({
      seriesInstanceUid: firstString(s['0020000E']) ?? '',
      modality: firstString(s['00080060']) ?? '?',
      description: firstString(s['0008103E']) ?? '',
      instanceCount: firstNumber(s['00201209']) ?? 0,
    }))
    .filter((s) => s.seriesInstanceUid)
    .sort((a, b) => b.instanceCount - a.instanceCount);
}

/**
 * Query `/studies/{study}/series/{series}/instances` and return the
 * instance UIDs in numerical-instance-number order so cornerstone sees
 * slices in scan order.
 */
export async function fetchInstanceUids(
  dicomwebBase: string,
  studyUid: string,
  seriesUid: string,
): Promise<string[]> {
  const url = `${dicomwebBase.replace(/\/+$/, '')}/studies/${encodeURIComponent(
    studyUid,
  )}/series/${encodeURIComponent(seriesUid)}/instances`;
  const res = await fetch(url, { headers: { Accept: 'application/dicom+json' } });
  if (!res.ok) throw new Error(`instances query failed: ${res.status}`);
  const data = (await res.json()) as Array<Record<string, { Value?: unknown[] }>>;
  return data
    .map((i) => ({
      uid: firstString(i['00080018']) ?? '',
      number: firstNumber(i['00200013']) ?? 0,
    }))
    .filter((x) => x.uid)
    .sort((a, b) => a.number - b.number)
    .map((x) => x.uid);
}

/**
 * Build the cornerstone `wadors:` imageId for each instance. The loader
 * resolves it with a GET against the metadata URL and then pulls frame 1.
 */
export function buildImageIds(
  dicomwebBase: string,
  studyUid: string,
  seriesUid: string,
  instanceUids: string[],
): string[] {
  const base = dicomwebBase.replace(/\/+$/, '');
  return instanceUids.map(
    (uid) =>
      `wadors:${base}/studies/${studyUid}/series/${seriesUid}/instances/${uid}/frames/1`,
  );
}

function firstString(tag: { Value?: unknown[] } | undefined): string | undefined {
  const v = tag?.Value?.[0];
  return typeof v === 'string' ? v : undefined;
}

function firstNumber(tag: { Value?: unknown[] } | undefined): number | undefined {
  const v = tag?.Value?.[0];
  return typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : undefined;
}

/**
 * Debounced forwarder for state updates. Accumulates partial updates,
 * flushes at most once per `debounceMs` to avoid flooding the server.
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

export function shortenUid(uid: string | null | undefined): string {
  if (!uid) return 'n/a';
  if (uid.length <= 18) return uid;
  return `${uid.slice(0, 8)}…${uid.slice(-6)}`;
}
