export type ViewState = {
  study_uid?: string;
  series_uid?: string;
  server_id?: string;
  modality?: string;
  slice_index?: number;
  slice_count?: number;
  window_center?: number;
  window_width?: number;
  preset?: string;
  patient_age?: string;
  patient_sex?: string;
  slice_thickness_mm?: number;
  last_updated_at?: string;
};

const store = new Map<string, ViewState>();

const FALLBACK_KEY = '__default__';

function key(sessionId: string | undefined): string {
  return sessionId ?? FALLBACK_KEY;
}

export function getViewState(sessionId: string | undefined): ViewState {
  return store.get(key(sessionId)) ?? {};
}

export function setViewState(
  sessionId: string | undefined,
  partial: Partial<ViewState>,
): ViewState {
  const current = store.get(key(sessionId)) ?? {};
  const merged: ViewState = {
    ...current,
    ...partial,
    last_updated_at: new Date().toISOString(),
  };
  store.set(key(sessionId), merged);
  return merged;
}

export function clearViewState(sessionId: string | undefined): void {
  store.delete(key(sessionId));
}

export function clearAllViewStates(): void {
  store.clear();
}
