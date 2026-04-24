/**
 * Unit tests for the pure functions in ui/src/bridge.ts.
 * DOM-dependent helpers (setStatus, loadStudyIntoIframe) are tested as part
 * of the end-to-end widget smoke in U6 and not here.
 */
import { describe, expect, test, vi } from 'vitest';
import {
  buildViewerUrl,
  createDebouncedStateUpdater,
  parseOhifStateMessage,
  type StateUpdate,
} from '../ui/src/bridge.js';

describe('buildViewerUrl', () => {
  test('returns about:blank when no study UID', () => {
    expect(
      buildViewerUrl({ studyUid: null, dicomwebBaseUrl: '/dicomweb/orthanc-demo' }),
    ).toBe('about:blank');
  });

  test('encodes StudyInstanceUIDs and DICOMweb base URL', () => {
    const url = buildViewerUrl({
      studyUid: '1.2.3',
      dicomwebBaseUrl: '/dicomweb/orthanc-demo',
    });
    expect(url).toBe('/ohif/viewer?StudyInstanceUIDs=1.2.3&url=%2Fdicomweb%2Forthanc-demo');
  });

  test('includes SeriesInstanceUIDs when provided', () => {
    const url = buildViewerUrl({
      studyUid: '1.2.3',
      seriesUid: '4.5.6',
      dicomwebBaseUrl: '/dicomweb/x',
    });
    expect(url).toContain('StudyInstanceUIDs=1.2.3');
    expect(url).toContain('SeriesInstanceUIDs=4.5.6');
  });

  test('respects a custom ohifBasePath', () => {
    const url = buildViewerUrl({
      studyUid: '1.2.3',
      dicomwebBaseUrl: '/dicomweb/x',
      ohifBasePath: '/custom-ohif/viewer',
    });
    expect(url.startsWith('/custom-ohif/viewer?')).toBe(true);
  });
});

describe('parseOhifStateMessage', () => {
  test('returns null for non-object data', () => {
    expect(parseOhifStateMessage(null)).toBeNull();
    expect(parseOhifStateMessage('hello')).toBeNull();
    expect(parseOhifStateMessage(42)).toBeNull();
  });

  test('returns null for unrecognized message type', () => {
    expect(parseOhifStateMessage({ type: 'OTHER', modality: 'CT' })).toBeNull();
  });

  test('extracts scalar fields from a STATE_UPDATE message', () => {
    const parsed = parseOhifStateMessage({
      type: 'STATE_UPDATE',
      study_uid: '1.2.3',
      series_uid: '4.5.6',
      modality: 'CT',
      slice_index: 42,
      slice_count: 250,
      window_center: 40,
      window_width: 400,
      preset: 'soft-tissue',
      slice_thickness_mm: 0.625,
    });
    expect(parsed).toEqual({
      study_uid: '1.2.3',
      series_uid: '4.5.6',
      modality: 'CT',
      slice_index: 42,
      slice_count: 250,
      window_center: 40,
      window_width: 400,
      preset: 'soft-tissue',
      slice_thickness_mm: 0.625,
    });
  });

  test('skips fields with the wrong type', () => {
    const parsed = parseOhifStateMessage({
      type: 'STATE_UPDATE',
      study_uid: '1.2.3',
      slice_index: '42', // wrong: expected number
    });
    expect(parsed).toEqual({ study_uid: '1.2.3' });
  });
});

describe('createDebouncedStateUpdater', () => {
  test('coalesces multiple calls into a single flush', async () => {
    vi.useFakeTimers();
    try {
      const flushed: StateUpdate[] = [];
      const update = createDebouncedStateUpdater((s) => flushed.push(s), 250);
      update({ slice_index: 1 });
      update({ slice_index: 2 });
      update({ modality: 'CT', slice_index: 3 });
      vi.advanceTimersByTime(250);
      await vi.runAllTimersAsync();
      expect(flushed).toHaveLength(1);
      expect(flushed[0]).toEqual({ slice_index: 3, modality: 'CT' });
    } finally {
      vi.useRealTimers();
    }
  });

  test('schedules a new flush after the previous one fires', async () => {
    vi.useFakeTimers();
    try {
      const flushed: StateUpdate[] = [];
      const update = createDebouncedStateUpdater((s) => flushed.push(s), 100);
      update({ slice_index: 1 });
      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();
      update({ slice_index: 2 });
      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();
      expect(flushed).toEqual([{ slice_index: 1 }, { slice_index: 2 }]);
    } finally {
      vi.useRealTimers();
    }
  });
});
