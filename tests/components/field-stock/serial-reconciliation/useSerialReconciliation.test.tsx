/** Tests for useSerialReconciliation — happy path + the two error branches (PR-11). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

import { useSerialReconciliation } from '@/modules/procurement/field-stock/hooks/useSerialReconciliation';

const SUMMARY = {
  checks: [{ name: 'latest_event_matches_status', tolerance: 0, drift: 0, passed: true }],
  ranAt: '2026-05-25T10:00:00.000Z',
  allPassed: true,
};

function mockFetch(impl: () => Partial<Response> & { json: () => Promise<unknown> }) {
  global.fetch = vi.fn().mockResolvedValue(impl()) as unknown as typeof fetch;
}

describe('useSerialReconciliation', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('loads the summary on mount (happy path)', async () => {
    mockFetch(() => ({ ok: true, status: 200, json: async () => ({ success: true, data: SUMMARY }) }));
    const { result } = renderHook(() => useSerialReconciliation());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.summary).toEqual(SUMMARY);
    expect(result.current.error).toBeNull();
  });

  it('sets an error on a non-2xx HTTP response', async () => {
    mockFetch(() => ({ ok: false, status: 500, json: async () => ({}) }));
    const { result } = renderHook(() => useSerialReconciliation());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.summary).toBeNull();
    expect(result.current.error).toBe('HTTP 500');
  });

  it('sets an error when the API returns success:false', async () => {
    mockFetch(() => ({ ok: true, status: 200, json: async () => ({ success: false, error: { message: 'boom' } }) }));
    const { result } = renderHook(() => useSerialReconciliation());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('boom');
  });
});
