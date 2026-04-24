/**
 * Unit tests for the pure functions in ui/src/bridge.ts.
 * DOM-dependent helpers (setStatus, hidePlaceholder) are exercised by the
 * widget e2e test against a live browser, not here.
 */
import { describe, expect, test, vi } from 'vitest';
import {
  createDebouncedStateUpdater,
  shortenUid,
  type StateUpdate,
} from '../ui/src/bridge.js';

describe('shortenUid', () => {
  test('returns n/a for null/undefined', () => {
    expect(shortenUid(null)).toBe('n/a');
    expect(shortenUid(undefined)).toBe('n/a');
  });

  test('passes through short UIDs', () => {
    expect(shortenUid('1.2.3')).toBe('1.2.3');
  });

  test('ellipsises middle of long UIDs', () => {
    const long = '1.2.840.113619.2.5.1762583153.215519.978957063.78';
    const short = shortenUid(long);
    expect(short).toMatch(/^1\.2\.840\.…/);
    expect(short.endsWith('063.78')).toBe(true);
    expect(short.length).toBeLessThan(long.length);
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
